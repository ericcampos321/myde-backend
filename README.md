# myde-backend

Backend de **Atendimento WhatsApp com IA** — recebe webhooks da Meta, persiste
mensagens, processa de forma assíncrona com uma LLM e prepara a resposta IA.

> Estado atual: API Fastify, webhook assinado, schema Drizzle, repositories,
> dispatch BullMQ para mensagens inbound, worker dedicado e camada de IA com
> `StubAiProvider`/`OpenAiProvider`. Envio outbound real de texto pela Meta
> Graph API exposto em `POST /conversations/:conversationId/messages`.

---

## Stack

| Camada | Tecnologia |
|---|---|
| API HTTP | Fastify + TypeScript |
| Persistência | PostgreSQL + Drizzle ORM |
| Fila | Redis + BullMQ |
| Worker | Processo dedicado, separado da API |
| IA | OpenAI atrás de interface (`OpenAiProvider`); stub apenas em `NODE_ENV=test` |
| Logs | Pino (estruturado) |
| Testes | Vitest |

**Decisões:** PostgreSQL é a fonte da verdade; Redis/BullMQ é apenas dispatch.
Sem SQS, sem LocalStack. Tenant resolvido por `metadata.phone_number_id` /
`entry[].id` do payload — tenant desconhecido é rejeitado, sem auto-provisionar.

Webhooks assinados de tenants desconhecidos recebem HTTP 200 e são ignorados
com log de aviso. Isso evita retries infinitos da Meta sem auto-provisionar
clientes. Eventos sem mensagem de texto também são aceitos e ignorados.

---

## Arquitetura (dois processos)

```
API (npm run dev)                         Worker (npm run dev:worker)
  bootstrap/server.ts → bootstrap/app.ts    workers/message-processing/
  ├ GET /health                             ├ consome BullMQ
  ├ GET/POST /webhook                       ├ processor + services/tenant/ai
  ├ GET /me /conversations /messages        └ shutdown gracioso
  ├ POST /ai/suggest
  └ POST /conversations/:id/messages ─────────────▶ Meta Graph API (outbound)
            │  enqueue jobId=externalMessageId
            ▼
     Redis / BullMQ  ──dispatch──▶  Worker
            ▲                          │
            └────────  PostgreSQL  ◀───┘   (fonte da verdade)
```

### Organização por camadas (padrão Rufus)

```
src/
  bootstrap/      app.ts, server.ts          — composição e entrypoint HTTP
  config/         env.ts
  routes/         registro de rotas (api/, tenant/) — registerRoutes(app)
  controllers/    handlers HTTP finos; chamam services
    api/health/   tenant/whatsapp/
  services/       casos de uso e orquestração
    tenant/whatsapp/  tenant/ai/  tenant/message-processing/
  repositories/   acesso a dados (Drizzle), isolado por tenantId
    tenant/whatsapp/
  schemas/        validação runtime Zod (request, payload Meta, etc.)
  types/          contratos TS sem runtime (não vindos de Drizzle nem Zod)
  db/             schema/ (Drizzle por domínio + Row types), client.ts, migrations/, seeds/
  queues/         BullMQ Queue (enqueue idempotente por jobId)
  workers/        processo dedicado: bootstrap, eventos, shutdown
  clients/        contratos de integrações externas (meta/)
  plugins/        cors, sensible, raw-body
  errors/         AppError, HttpError (error handler central)
  shared/         logger, utils
```

Regras de dependência: controller → service → repository/queue. Controller não
importa repository nem queue; worker chama o processor (service); repository só
conhece o banco.

### Fronteiras de schema e tipo

- **`db/schema/`** — schema físico Drizzle dividido por domínio
  (`tenant/tenants.schema.ts`, `whatsapp/whatsappContacts.schema.ts`, etc.),
  reexportado pelo barrel `db/schema/index.ts`. É a única fonte dos tipos de
  tabela, exportados como `TenantRow`/`NewTenantRow`, `WhatsAppContactRow`, etc.
  O `drizzle-kit` lê os arquivos via `tsx` (scripts `db:generate`/`db:migrate`),
  pois resolve os imports `.js` entre os arquivos de schema do NodeNext.
- **`schemas/**`** — apenas validação runtime (Zod ou JSON-schema Fastify):
  request body, params, query, payload externo da Meta, payload de fila,
  resposta pública. Pode exportar o tipo via `z.infer`.
- **`types/**`** — apenas contratos TS que não vêm do Drizzle nem do Zod
  (ex.: `Upsert*Input` derivado de `New*Row`, contratos do webhook Meta).
- **DTO** — criado só quando a resposta pública difere da row do banco;
  preferir `ResponseSchema` + `z.infer`. Sem pasta global `dtos/`.
- **Repositories** retornam rows do Drizzle; **services** recebem inputs de
  `schemas`/`types` e retornam row ou DTO explícito.

---

## Como rodar

> **Portas locais:** Postgres `5432`, **Redis `6380`** (externo — mapeado para
> `6379` dentro do Docker, evitando conflito com Redis de outros projetos).

### Fluxo local

```bash
# 1. Variáveis de ambiente: copie o template e edite o .env com credenciais reais
cp .env.example .env
#   → edite o .env e preencha OPENAI_API_KEY e as variáveis META_* (ver abaixo)

# 2. Dependências
npm install

# 3. Infra local (Postgres + Redis)
docker compose up -d postgres redis

# 4. Migrações e seed
npm run db:migrate
npm run db:seed

# 5. API (porta 8000)
npm run dev
curl http://localhost:8000/health   # → { "ok": true, "service": "myde-backend" }

# 6. Worker dedicado (outro terminal)
npm run dev:worker
```

### Variáveis de ambiente

- **`.env.example`** é o template seguro, com credenciais **em branco**. Vai para git.
- **`.env`** é o arquivo real que o app lê (via `dotenv/config` em `src/config/env.ts`).
  Está no `.gitignore` — **nunca commite**.

Para os **fluxos reais** de IA e Meta, preencha no `.env` local:

| Variável | Necessária para |
|---|---|
| `OPENAI_API_KEY` | Gerar respostas de IA reais (`OpenAiProvider`) |
| `META_VERIFY_TOKEN` | Handshake de verificação do webhook |
| `META_APP_SECRET` | Validar a assinatura `X-Hub-Signature-256` dos webhooks |
| `META_TOKEN` | Enviar mensagens via Graph API (outbound futuro) |
| `META_PHONE_NUMBER_ID` | Identificar o número de origem |

- Sem `OPENAI_API_KEY`, o worker **falha com erro de configuração explícito** em
  desenvolvimento/produção (o `StubAiProvider` só é usado em `NODE_ENV=test`).
- Sem as variáveis `META_*` reais, a validação de assinatura do webhook recusa as
  chamadas da Meta — os fluxos reais ficam indisponíveis até serem configurados.
- **Segredos nunca devem ir para o git.** O `.gitignore` protege `.env`.

### Webhook real da Meta (ambiente de teste)

O fluxo padrão usa a **Meta WhatsApp Cloud API real** (use o ambiente de teste da
Meta para desenvolvimento — número de teste gratuito). Para receber webhooks no
backend local:

1. Exponha a API local (porta `8000`) publicamente com um túnel:
   `ngrok http 8000` (ou `cloudflared tunnel --url http://localhost:8000`).
2. No painel da Meta (**WhatsApp → Configuration → Webhooks**):
   - **Callback URL**: `https://<seu-túnel>/webhook` (o endpoint real do backend).
   - **Verify token**: a mesma string definida em `META_VERIFY_TOKEN` no `.env`.
   - Assine o campo **`messages`**.
3. `META_APP_SECRET` valida a assinatura `X-Hub-Signature-256` de cada evento.

Passo a passo completo de credenciais em [SETUP-CREDENCIAIS.md](SETUP-CREDENCIAIS.md).

### Envio outbound (REST)

```
POST /conversations/:conversationId/messages
Header:  X-Tenant-ID: <id do tenant>
Body:    { "text": "mensagem a enviar" }
→ 201   { id, conversationId, direction:"outbound", body, status:"sent",
          externalMessageId, createdAt }
```

Fluxo: o backend valida a conversa/contato/tenant, chama a **Meta Graph API**
(`POST /{phoneNumberId}/messages`) usando o `phoneNumberId` **do tenant**, e só
então persiste a mensagem outbound (estratégia *Meta primeiro* — se a Meta falhar,
nada é gravado). O frontend nunca chama a Meta diretamente; apenas este endpoint.

> ⚠️ **`X-Tenant-ID` é uma simplificação de DEV/desafio** (não há auth). O
> isolamento é garantido no banco — toda query filtra por `tenantId` e a conversa
> precisa pertencer ao tenant. Em **produção**, troque o header por auth/JWT/sessão
> e derive o tenant da identidade autenticada.

### Mock da Meta (legado/opcional — não é o ambiente padrão)

> O caminho padrão é a **Meta real de teste** (acima). O `mock-meta` é apenas uma
> ferramenta auxiliar legada para testes manuais offline — **não** representa o
> ambiente padrão e não é necessário no fluxo principal.

O `docker-compose.yml` ainda inclui o serviço `mock-meta` (porta `8001`). Ele não
sobe com `docker compose up -d postgres redis`; para usá-lo, suba explicitamente e
aponte o `.env` para ele:

```bash
docker compose up -d mock-meta
# no .env (apenas para esse modo legado):  META_API_BASE_URL=http://localhost:8001
```

### Validação

```bash
npm run typecheck
npm run build
npm test
```

### Banco de dados

O schema Drizzle fica em `src/db/schema.ts` e as migrations em
`src/db/migrations/`. O seed explícito cria ou atualiza o tenant padrão
**NeoFibra** usando `META_PHONE_NUMBER_ID`; ele não roda no startup da API.

```bash
npm run db:generate
npm run db:migrate
npm run db:seed

# Suíte de integração dos repositories, com Postgres migrado disponível
RUN_DB_TESTS=true npm test

# Integração opcional da BullMQ, com Redis ativo
RUN_REDIS_TESTS=true npm test
```

PostgreSQL permanece a fonte da verdade. Redis/BullMQ será adicionado apenas
como dispatch idempotente por `externalMessageId`; SQS e LocalStack não fazem
parte da solução.

### IA e knowledge base

O provider é selecionado por factory (`selectAiProviderKind` / `createAiProvider`):

- Com `OPENAI_API_KEY`: usa `OpenAiProvider` com `OPENAI_MODEL`.
- Sem `OPENAI_API_KEY` em `NODE_ENV=test`: usa `StubAiProvider`, determinístico
  para os testes (não faz chamadas externas).
- Sem `OPENAI_API_KEY` em desenvolvimento/produção: **falha com erro de
  configuração explícito** — a ausência da chave real não é mascarada por mock.

A base de conhecimento fica em `knowledge-base/` e hoje é pequena o suficiente
para ser carregada inteira em memória e enviada como contexto bruto para o
provider. Não há RAG vetorial nesta fase; isso pode entrar depois se a base
crescer.

Neste bloco o worker gera `aiResponseText`/`aiSource` durante o processamento,
mas ainda não persiste mensagem outbound nem chama a Meta para envio.

---

## Scripts

| Script | Descrição |
|---|---|
| `dev` | API em watch (`src/bootstrap/server.ts`) |
| `dev:worker` | Worker dedicado em watch |
| `build` | Compila para `dist/` (tsc) |
| `start` / `start:worker` | Roda o build de produção |
| `typecheck` | `tsc --noEmit` |
| `test` / `test:watch` | Vitest |
| `db:generate` / `db:migrate` | Gera e aplica migrations Drizzle |
| `db:seed` | Cria ou atualiza o tenant padrão NeoFibra |

---

## Variáveis de ambiente

Todas validadas em `src/config/env.ts` (única leitura de `process.env`).
O `.env.example` é o template com os segredos em branco; o setup real é preenchido
no `.env` local (gitignored) — nunca commite segredos.

`NODE_ENV`, `PORT` (8000), `HOST` (0.0.0.0), `LOG_LEVEL`, `DATABASE_URL`,
`REDIS_URL`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_TOKEN`,
`META_API_BASE_URL`, `META_PHONE_NUMBER_ID`, `OPENAI_API_KEY`, `OPENAI_MODEL`.
