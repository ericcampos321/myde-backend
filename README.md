# myde-backend

Backend de **Atendimento WhatsApp com IA** — recebe webhooks da Meta, persiste
mensagens, processa de forma assíncrona com uma LLM e responde via Meta API (mock).

> Estado atual: API Fastify, webhook assinado, schema Drizzle e repositories
> base. BullMQ, processamento real do worker e OpenAI entram depois.

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

**Decisões:** PostgreSQL é a fonte da verdade; Redis/BullMQ será apenas dispatch.
Sem SQS, sem LocalStack. Tenant resolvido por `metadata.phone_number_id` /
`entry[].id` do payload — tenant desconhecido é rejeitado, sem auto-provisionar.

---

## Arquitetura (dois processos)

```
API (npm run dev)                         Worker (npm run dev:worker)
  bootstrap/server.ts → bootstrap/app.ts    tenant/message-processing/
  ├ GET /health                             ├ consome BullMQ (commit futuro)
  ├ GET/POST /webhook                       ├ processor puro
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
```

PostgreSQL permanece a fonte da verdade. Redis/BullMQ será adicionado apenas
como dispatch; SQS e LocalStack não fazem parte da solução.

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
