# Auditoria de Fundamentos de Banco — Myde Backend

Data: 2026-06-16 · Escopo: `myde-backend` (Fastify + Drizzle/Postgres + BullMQ/Redis).
Objetivo: garantir o básico que resolve a maior parte dos problemas reais em produção —
ACID, índices, ausência de N+1 relevante, transações/idempotência em operações
críticas, pool configurado e queries críticas analisáveis via EXPLAIN. **Sem**
sharding, event sourcing, CRDT ou banco distribuído.

---

## Resumo executivo

O projeto **cumpre os fundamentos de banco** em grau alto. Destaques positivos:

- **Tenant isolation forte**, inclusive no nível do banco: todas as queries filtram
  `tenant_id` e há **FKs compostas** (`(id, tenant_id)`) que tornam referências
  cross-tenant impossíveis fisicamente (conversa→contato, mensagem→conversa,
  log de IA→conversa/contato).
- **Índices adequados** para todos os fluxos de leitura/escrita críticos (listagem
  de conversas, histórico de mensagens, idempotência de webhook, usage de IA).
- **Idempotência** bem desenhada: webhook (índice único parcial em
  `(tenant, external_message_id)` + job com `jobId = externalMessageId`), e
  auto-reply (índice único parcial em `(tenant, reply_to_message_id)` + checagem
  antes de chamar a Meta).
- **Segurança de dados sensíveis**: `ai_interaction_logs` guarda apenas
  contagens/metadados (nunca prompt, mensagem, resposta, token ou segredo); o painel
  `/ai/usage` seleciona só campos seguros; logs mascaram telefone e nunca logam
  body/token/prompt; erros de OpenAI/Meta logam só metadados.
- **Pool singleton** por processo (sem conexão por request) e **worker** com
  shutdown gracioso fechando worker, queue e pool.

Foram aplicadas **correções seguras e de baixo risco** (pool e shutdown da API) e
criado um **script de EXPLAIN ANALYZE** read-only. Os achados de maior impacto
(carga total de mensagens na listagem de conversas e dupla carga no worker) são de
**escala** — corretos hoje, mas crescem com o volume — e estão documentados com
correção proposta, **sem** serem implementados nesta passagem para não alterar
comportamento de um caminho central e bem testado.

**Gates:** `check:db` ✅ · `typecheck` ✅ · `build` ✅ · `test` ✅. Canônico (`npm test`)
250 passed / 46 skipped (integração gated). Com `RUN_DB_TESTS=true RUN_REDIS_TESTS=true`:
**296 passed, 0 skipped, 0 falhas** — inclusive com o `dev:worker` ativo (os testes Redis
usam fila isolada `message-processing-test-*`, sem competir com a fila real).

---

## Tabela de achados

| # | Severidade | Área | Achado | Status |
|---|-----------|------|--------|--------|
| A-01 | **Alto** | Escala / N+1 | `GET /conversations` carregava **todas as mensagens do tenant** para montar preview + unread (`findByConversationIds` sem limite). Cresce com `whatsapp_messages`. | **corrigido** |
| A-02 | Médio | Escala | Worker carrega a **conversa inteira 2×** por job (`findByConversationId` pré-IA e pré-envio). Cresce com o tamanho da conversa. | precisa ajuste (documentado) |
| A-03 | Médio | Idempotência / confiabilidade | Webhook: se o inbound já existe (re-entrega), o fluxo retornava `duplicated` **sem re-enfileirar**. Se o enqueue falhou na 1ª vez, a mensagem ficava **sem job** (sem auto-reply). | **corrigido** |
| A-04 | Médio | Pool / shutdown | API não fechava o pool Postgres no shutdown (`closeDb` ausente em `server.ts`). | **corrigido** |
| A-05 | Baixo | Pool | Pool sem `idle_timeout` / `connect_timeout` explícitos. | **corrigido** |
| A-06 | Baixo | Outbound / ACID | Outbound é "Meta-first depois persiste". Se a Meta aceitar mas o INSERT falhar, em retry de auto-reply pode reenviar (duplicar) por não achar a outbound persistida. | aceito (documentado) |
| A-07 | Baixo | N+1 | `listRecentSearches` faz `findById` de conversa+contato por item (máx. 4 itens → ~8 queries). Bounded. | aceito (documentado) |
| A-08 | Baixo | Índice | Busca de contatos por `ILIKE '%termo%'` (name/phone) não usa índice btree (wildcard à esquerda). | aceito (documentado) |
| — | OK | Tenant isolation | Todas as queries tenant-scoped; FKs compostas impedem cross-tenant. | ok |
| — | OK | Segurança | Sem exposição de prompt/mensagem/token/segredo em logs ou painéis. | ok |
| — | OK | Idempotência | Webhook + auto-reply com chaves únicas e checagem prévia. | ok |

---

## Parte 1 — Inventário do schema

| Tabela | PK | FKs | Unique | Check | Índices | Gaps |
|--------|----|----|--------|-------|---------|------|
| `tenants` | `id` | — | `phone_number_id` | — | unique acima | — |
| `whatsapp_contacts` | `id` | `tenant_id→tenants` | `(tenant_id, phone)`; `(id, tenant_id)` | — | `(tenant_id)`, uniques | busca textual sem trgm (A-08) |
| `whatsapp_conversations` | `id` | composta `(contact_id, tenant_id)→contacts(id,tenant_id)`; `tenant_id→tenants` | `(tenant_id, contact_id)`; `(id, tenant_id)` | — | `(tenant_id, last_message_at desc)`, `(tenant_id, status)` | — |
| `whatsapp_messages` | `id` | composta `(conversation_id, tenant_id)→conversations`; `tenant_id→tenants`; `reply_to_message_id→self` | `(tenant_id, external_message_id)` parcial; `(tenant_id, reply_to_message_id)` parcial | `direction in (...)` | `(tenant_id, conversation_id, created_at)`, `(tenant_id, external_message_id)` | — |
| `ai_interaction_logs` | `id` | composta `(conversation_id, tenant_id)` e `(contact_id, tenant_id)`; `tenant_id→tenants` | — | stage/action/risk/contagens ≥ 0 | `(tenant_id, created_at desc)`, `(conversation_id, created_at desc)`, `(tenant_id, conversation_id, created_at desc)` | filtros secundários (model/source/...) sem índice próprio — ver Parte 2 |
| `conversation_read_states` | `id` | composta `(conversation_id, tenant_id)`; `tenant_id→tenants`; `last_read_message_id→messages` | `(tenant_id, conversation_id, operator_id)` | — | `(tenant_id, operator_id)`, `(tenant_id, conversation_id, operator_id)` | — |
| `inbox_recent_searches` | `id` | `tenant_id→tenants` | `(tenant_id, operator_id, target_type, target_id)` | `target_type in (...)` | `(tenant_id, operator_id, updated_at desc)` | — |

Não existem tabelas de "knowledge base" nem "prompt versions" em banco: a base de
conhecimento é carregada de arquivo (`KnowledgeBaseService`) e a versão de prompt é
constante de código (`AiPromptVersion`). Nada a auditar em DB para esses itens.

---

## Parte 2 — Índices obrigatórios (conferência por fluxo)

**Contatos** — `(tenant_id, phone)` unique ✅ · `(tenant_id)` ✅ · busca textual
`name/phone` via `ILIKE '%...%'` → **não indexável por btree** (A-08). Aceitável na
escala atual (contatos por tenant são poucos). Se crescer, avaliar `pg_trgm`.

**Conversas** — listagem `(tenant_id, last_message_at desc)` ✅ · `(tenant_id, status)`
✅ · unique `(tenant_id, contact_id)` ✅ · cross-tenant barrado por FK composta ✅.

**Mensagens** — histórico `(tenant_id, conversation_id, created_at)` ✅ · idempotência
`(tenant_id, external_message_id)` unique parcial ✅ · `reply_to_message_id` unique
parcial `(tenant_id, reply_to_message_id)` ✅ · status por `external_message_id`
coberto por `(tenant_id, external_message_id)` ✅.

**AI usage** — agregação/paginação por `(tenant_id, created_at)` ✅ (cobre summary,
byModel e recent com range em `created_at`). Os filtros opcionais
(`model/source/provider/blocked/stage/conversationId`) são aplicados **sobre** a
janela já reduzida pelo índice `(tenant_id, created_at desc)`; para o volume do
projeto, **não justificam** índices compostos adicionais (regra: não criar índice
redundante sem padrão de query que o exija). Há ainda
`(tenant_id, conversation_id, created_at desc)` para o filtro por conversa.

Conclusão: **todas as queries críticas têm índice compatível**. Nenhum índice novo
foi criado por falta de justificativa de padrão de acesso.

---

## Parte 3 — Queries críticas

| Endpoint / fluxo | Filtros | Ordenação | Limit/paginação | Índice cobre? | Risco scan | N+1 |
|---|---|---|---|---|---|---|
| `GET /conversations` (read model A-01) | `tenant_id` (+ `operator_id` no unread) | `last_message_at desc` | — (1 linha/conversa via DISTINCT ON) | ✅ | baixo (corrigido) | — |
| `GET /conversations/:id/messages` | `tenant_id`, `conversation_id` | `created_at desc, id desc` | cursor + `limit+1` | ✅ | baixo | — |
| busca na conversa | idem + `ILIKE body`, `dateRange?` | `created_at desc, id desc` | cursor + `limit+1` | ✅ (ILIKE bounded por conversa) | baixo | — |
| `POST /webhook` | `tenant_id`+`external` (idemp.), upserts | — | `limit 1` | ✅ | baixo | — |
| `POST /conversations/:id/messages` (outbound) | tenant/conv/contato por id | — | `limit 1` | ✅ | baixo | — |
| `POST /ai/suggest` | últimas N (bounded 30) | `created_at desc` | `limit 31` | ✅ | baixo | — |
| `GET /ai/usage` | `(tenant, created_at[from,to))` + filtros | `created_at desc, id desc` | clamp janela+limit, cursor | ✅ | baixo | — |
| busca/listagem de contatos | `tenant_id` + `ILIKE` | `updated_at desc` | — | parcial (A-08) | baixo (poucos contatos) | — |
| worker message-processing | conversa inteira (×2) | `created_at asc` | **sem limite** | ✅ (mas varre tudo) | **médio (A-02)** | — |

EXPLAIN ANALYZE para cada um: ver `src/db/explain/critical-queries.explain.sql`.

---

## Parte 4 — N+1

- **Não há N+1 relevante** nos fluxos principais. `listConversations` faz **batching**
  correto: 1 query de conversas + 3 queries agregadas em paralelo
  (`contacts.findByIds`, `messages.findByConversationIds`, `readStates.findByConversationIds`)
  — sem query por item. O problema dela é de **volume** (A-01), não de N+1.
- `listRecentSearches` (A-07) é o único padrão tipo N+1: por item recente faz
  `findById` de conversa+contato. **Bounded a 4 itens** (≈8 queries), portanto
  irrelevante; correção (batch via `findByIds`) não compensa a complexidade.

---

## Parte 5 — Transações e ACID

**Webhook inbound.** Sequência: validar assinatura → idempotência por
`external_message_id` → `upsert` contato → `upsert` conversa → `createInbound`
(`onConflictDoNothing`) → `enqueue`. Avaliação:

- **Não precisa de transação de banco.** Todas as escritas são upserts idempotentes,
  e a ordem **persistir-antes-de-enfileirar** já é o padrão seguro: nunca existe
  "job sem mensagem". O enqueue é externo (Redis) e, por regra, não pode/deve entrar
  numa transação de Postgres.
- **A-03 (médio) — CORRIGIDO:** o enqueue NÃO é coberto por transação (correto), e o
  caminho de **duplicado** agora **repara o job** de forma idempotente. Antes: se a 1ª
  entrega persistiu a mensagem e **falhou no enqueue** (throw → Meta faz retry), a 2ª
  entrega encontrava a mensagem e retornava `duplicated` **sem criar o job** → mensagem
  ficava **sem job**. Agora `WhatsAppWebhookService.ensureInboundProcessingEnqueued`
  re-enfileira com `jobId = externalMessageId` (idempotente: o BullMQ não duplica job
  existente; recria se foi removido). Guardas: só inbound com `externalMessageId`
  (duplicado de outbound/status é ignorado). Best-effort (erro logado com evento
  seguro `webhook.inbound.reenqueue_failed`, sem prompt/token; ACK permanece 200). Sem
  OpenAI/Meta/Postgres no handler. Anti-loop/human-takeover/auto-reply seguem 100% no
  worker (que já é idempotente via índice único `(tenant, reply_to_message_id)`).

**Outbound (A-06, baixo).** "Meta-first, depois persiste" é deliberado (não mostrar
`sent` se a Meta rejeitar). Risco: Meta aceita mas o INSERT falha → em retry de
auto-reply, `findReplyOutbound` não acha a outbound e **reenvia** (duplicado). Janela
estreita (falha de INSERT após sucesso da Meta) e só no caminho de auto-reply.
Resolver 100% exigiria padrão outbox — **overkill** para o escopo. Aceito e documentado.

**Isolamento dos testes Redis.** Os testes de integração da fila usavam a fila real
(`message-processing`), competindo com o `dev:worker` quando ativo (job "locked by another
worker"). Corrigido: `BullMqMessageProcessingQueue` e `createMessageProcessingWorker`
aceitam um `queueName` opcional (injeção segura SÓ para teste; produção usa o default
inalterado), e o teste usa uma fila única `message-processing-test-<ts>`, limpa via
`obliterate` apenas nesse namespace. Resultado: os testes Redis passam mesmo com o
dev worker rodando, sem parar processos manualmente.

**Auto-reply worker (concorrência).** Bem desenhado: decide **duas vezes** (pré-IA e
pré-envio com busca *fresh*) cobrindo a corrida "operador responde durante a geração";
anti-loop e human-takeover via `AutoReplyPolicy`; idempotência via índice único
`(tenant, reply_to_message_id)` + checagem antes da Meta; `jobId = externalMessageId`
e lock do BullMQ evitam processamento concorrente do mesmo inbound. **Sem transação
longa envolvendo Meta/OpenAI** — conforme a regra. OK.

---

## Parte 6 — Connection pool

- **Postgres** (`src/db/client.ts`): `postgres(url, { max: 10, idle_timeout: 20,
  connect_timeout: 10 })`, **singleton de módulo** (uma instância por processo, nunca
  por request); driver lazy (não conecta ao importar — bom para testes). `max: 10`
  cobre API e worker (`concurrency 5`). `idle_timeout`/`connect_timeout` **adicionados**
  nesta auditoria (A-05).
- **Shutdown gracioso**: worker fecha worker+queueEvents+queue+pool. A API agora
  também fecha o pool (`closeDb`) após `queue.close()` e `app.close()` (A-04 corrigido).
- **Redis/BullMQ**: conexão centralizada (`getRedisConnectionOptions`) com
  `maxRetriesPerRequest: null` (exigido por conexões de bloqueio); shutdown fecha
  Queue/Worker/QueueEvents. OK.
- **Testes**: sem conexão a menos que a query rode; integrações DB/Redis são gated por
  `RUN_DB_TESTS`/`RUN_REDIS_TESTS`. OK.

---

## Parte 7 — EXPLAIN ANALYZE

Entregue em **`src/db/explain/critical-queries.explain.sql`** (read-only):
listagem de conversas (+ a carga de mensagens do A-01), mensagens por conversa,
busca na conversa, idempotência e update de status por `external_message_id`, busca
de contato, e usage summary/recent. O script **não seleciona conteúdo sensível**
(onde haveria body, usa `length(body)`), usa placeholders de ID de teste via `psql -v`
e o update roda só com `EXPLAIN` (sem `ANALYZE`) para não mutar dados.

---

## Parte 8 — Crescimento e retenção

- **`whatsapp_messages`**: paginação obrigatória no inbox (cursor + `limit+1`,
  clamp de limite) ✅. A-01 (listagem de conversas) **corrigido**: preview/unread
  agora vêm de uma query agregada (DISTINCT ON + GROUP BY), sem carregar todas as
  mensagens. Resta A-02 (worker carrega a conversa inteira) como alvo de escala.
  Índice por `created_at` presente.
- **`ai_interaction_logs`**: recentes paginados; summaries com janela **clampada**
  (`resolveUsageWindow`) e limite clampado; índices por `created_at`. ✅
- **Retenção/particionamento**: **não necessário agora**. Recomendação futura (sem
  implementar): política de retenção por `created_at` para `whatsapp_messages` e
  `ai_interaction_logs`; particionamento por data só se o volume exigir.

---

## Parte 9 — Tenant isolation

- Todas as queries filtram `tenant_id` (repos recebem `tenantId` e o aplicam). ✅
- Endpoints validam `conversationId`/`contactId` **tenant-scoped** antes de usar
  (`assertConversationExists` → `findById(tenantId, id)`; outbound resolve tenant→conv→contato
  todos por `(id, tenant_id)`). ✅
- **FKs compostas** impedem cross-tenant no nível do banco. ✅
- Agregações de usage são tenant-scoped (`usageWhere` sempre injeta `tenant_id`). ✅
- Status de webhook atualiza só `where tenant_id = <resolvido> and external_message_id = ...`
  → não atualiza mensagem de outro tenant. ✅

---

## Parte 10 — Segurança (dados sensíveis)

- `ai_interaction_logs` armazena **apenas** contagens/metadados; comentário e schema
  reforçam: nunca prompt, mensagem, resposta, token ou segredo. ✅
- `/ai/usage` (`listRecentUsage`) seleciona **lista explícita de campos seguros**
  (sem `risk_reasons`, sem body). ✅
- Logs: telefone mascarado (`maskPhone`); webhook/outbound/worker não logam body;
  Meta client loga host (não token); OpenAI loga só `status/code/param/type/request_id`.
  ✅
- Sem segredo em código (credenciais via env; mock só em `NODE_ENV=test`). ✅

---

## Correções aplicadas nesta auditoria

1. **A-01** — `WhatsAppConversationRepository.listConversationSummaries` (novo): read
   model da listagem em UMA query (CTEs `latest_messages` via `DISTINCT ON`,
   `latest_inbound`, `unread_counts` via `GROUP BY` + JOIN com `conversation_read_states`
   do operador). `InboxService.listConversations` passou a consumi-lo, eliminando a
   carga de todas as mensagens do tenant em memória. Contrato do endpoint inalterado;
   `tenantId`/`operatorId` sempre parametrizados. Cobertura: unit (mapeamento) +
   integração (`*.integration.test.ts`, gated por RUN_DB_TESTS) validando preview,
   unread por operador, ordenação, tenant isolation e conversa sem mensagens.
2. **A-03** — `WhatsAppWebhookService.ensureInboundProcessingEnqueued` (novo): o webhook
   duplicado repara o job ausente com re-enqueue idempotente (`jobId = externalMessageId`),
   só para inbound com id, best-effort (eventos `webhook.inbound.reenqueue_attempted`
   `_skipped` `_failed`). Sem recriar mensagem, sem OpenAI/Meta, sem tocar o Postgres.
   Cobertura: unit (`WhatsAppWebhookService.test.ts`) + integração de persistência atualizada.
3. **A-04** — `src/bootstrap/server.ts`: fecha o pool Postgres (`closeDb()`) no shutdown
   gracioso da API, após `closeMessageProcessingQueue()` e `app.close()`.
4. **A-05** — `src/db/client.ts`: `idle_timeout: 20` e `connect_timeout: 10` no pool,
   com documentação do racional do `max`.
5. **Entregável** — `src/db/explain/critical-queries.explain.sql`: EXPLAIN ANALYZE
   read-only das queries críticas (inclui o read model do A-01), sem dados sensíveis.

## Follow-ups recomendados (não implementados — exigem mudança de comportamento)

- **A-02 (médio):** no worker, limitar o contexto a uma janela recente
  (ex.: reusar `findRecentByConversationId`) em vez de `findByConversationId` (conversa
  inteira) — validando que `AutoReplyPolicy` (anti-loop/takeover) continua correto com a
  janela.
