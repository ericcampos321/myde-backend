# myde-backend

Backend de **Atendimento WhatsApp com IA** — recebe webhooks da Meta, persiste
mensagens, processa de forma assíncrona com uma LLM e responde via Meta API (mock).

> Estado atual: **fundação** (API Fastify + estrutura de worker dedicado).
> Webhook, BullMQ, banco e OpenAI entram em commits subsequentes.

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

---

## Arquitetura (dois processos)

```
API (npm run dev)                         Worker (npm run dev:worker)
  bootstrap/server.ts → bootstrap/app.ts    tenant/workers/message-processing/
  ├ GET /health                             ├ consome BullMQ (commit futuro)
  ├ POST /webhook        (futuro)           ├ processor puro
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
  api/              rotas públicas/técnicas
    health/         HealthController.ts
  tenant/           tudo que é dado/processo do cliente
    whatsapp/       webhook, contacts, conversations, messages, meta
    ai/             AiTypes, providers/, knowledge-base/ (futuro)
    queues/         message-processing/      — fila próxima do domínio
    workers/        message-processing/      — worker dedicado por domínio
```

`tenant/` agrupa o canal WhatsApp inteiro; novos canais (`tenant/instagram/`,
`tenant/messenger/`) entram sem bagunçar a raiz.

---

## Como rodar

```bash
# 1. Infra local (Postgres, Redis, mock-meta)
docker compose up -d
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

### Validação

```bash
npm run typecheck
npm run build
npm test
```

---

## Scripts

| Script | Descrição |
|---|---|
| `dev` | API em watch (`src/server.ts`) |
| `dev:worker` | Worker dedicado em watch |
| `build` | Compila para `dist/` (tsc) |
| `start` / `start:worker` | Roda o build de produção |
| `typecheck` | `tsc --noEmit` |
| `test` / `test:watch` | Vitest |
| `db:generate` / `db:migrate` | Drizzle Kit |

---

## Variáveis de ambiente

Todas validadas em `src/config/env.ts` (única leitura de `process.env`).
Padrões locais refletem o `.env.example`/mock — sobrescreva em produção.

`NODE_ENV`, `PORT` (8000), `HOST` (0.0.0.0), `LOG_LEVEL`, `DATABASE_URL`,
`REDIS_URL`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_TOKEN`,
`META_API_BASE_URL`, `META_PHONE_NUMBER_ID`, `OPENAI_API_KEY` (opcional),
`OPENAI_MODEL`.
