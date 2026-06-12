# myde-backend

Backend de **Atendimento WhatsApp com IA** — recebe webhooks da Meta, persiste
mensagens, processa de forma assíncrona com uma LLM e prepara a resposta IA.

> Estado atual: API Fastify, webhook assinado, schema Drizzle, repositories,
> dispatch BullMQ para mensagens inbound, worker dedicado e camada de IA com
> `StubAiProvider`/`OpenAiProvider`. O worker ainda não envia outbound à Meta
> neste bloco; ele apenas gera a resposta candidata.

---

## Stack

| Camada | Tecnologia |
|---|---|
| API HTTP | Fastify + TypeScript |
| Persistência | PostgreSQL + Drizzle ORM |
| Fila | Redis + BullMQ |
| Worker | Processo dedicado, separado da API |
| IA | OpenAI atrás de interface, com Stub provider sem `OPENAI_API_KEY` |
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
  bootstrap/server.ts → bootstrap/app.ts    tenant/message-processing/
  ├ GET /health                             ├ consumira BullMQ (commit futuro)
  ├ GET/POST /webhook                       ├ processor + ai-responses/
  └ GET /conversations   (futuro)           └ shutdown gracioso
            │  enqueue jobId=externalMessageId
            ▼
     Redis / BullMQ  ──dispatch──▶  Worker
            ▲                          │
            └────────  PostgreSQL  ◀───┘   (fonte da verdade)
```

### Organização por contexto (padrão Rufus)

```
src/
  bootstrap/        app.ts, server.ts        — composição e entrypoint HTTP
  config/           env.ts
  plugins/          cors, sensible, raw-body
  shared/           errors, logger, utils
  db/               client.ts, schema.ts, migrations/
  controllers/api/  rotas públicas/técnicas
    health/         HealthController.ts, teste HTTP
  tenant/           tudo que é dado/processo do cliente
    whatsapp-webhooks/
    whatsapp-contacts/
    whatsapp-conversations/
    whatsapp-messages/
    whatsapp-meta/
    whatsapp-tenants/
    ai-responses/   AiTypes, providers/, knowledge-base/
    message-processing/  fila, processor e worker dedicado
```

Cada pasta em `tenant/` representa uma capacidade funcional. Novos canais podem
seguir o mesmo padrão, como `tenant/instagram-webhooks/`.

---

## Como rodar

```bash
# 1. Infra local (Postgres, Redis, mock-meta)
docker compose up -d postgres redis mock-meta
curl http://localhost:8001/health   # mock da Meta

# 2. Variáveis de ambiente
cp .env.example .env

# 3. Dependências
npm install

# 4. API (porta 8000)
npm run dev
curl http://localhost:8000/health   # → { "ok": true, "service": "myde-backend" }

# 5. Worker dedicado (outro terminal)
npm run dev:worker
```

Quando o worker sobe, ele registra qual provider de IA está ativo:
`stub` quando `OPENAI_API_KEY` não está configurada e `openai` quando a chave
existe.

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

O provider é selecionado por factory:

- Sem `OPENAI_API_KEY`: usa `StubAiProvider`, determinístico e seguro para
  desenvolvimento/testes.
- Com `OPENAI_API_KEY`: usa `OpenAiProvider` com `OPENAI_MODEL`.

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
Padrões locais refletem o `.env.example`/mock — sobrescreva em produção.

`NODE_ENV`, `PORT` (8000), `HOST` (0.0.0.0), `LOG_LEVEL`, `DATABASE_URL`,
`REDIS_URL`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_TOKEN`,
`META_API_BASE_URL`, `META_PHONE_NUMBER_ID`, `OPENAI_API_KEY` (opcional),
`OPENAI_MODEL`.
