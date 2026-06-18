# scripts/dev — operação local do Myde/Maude

Helpers para subir o projeto localmente em **operação real** (Meta WhatsApp Cloud
API + OpenAI reais). Nenhum script sobe `mock-meta` nem apaga dados.

> Recomendação para **Windows**: use **PowerShell** como fluxo principal.
> Use Bash/Git Bash só se você realmente quiser rodar os `.sh`.

## Comece por aqui (Windows / PowerShell)

Se você está no Windows, rode exatamente nesta ordem.

### Terminal 1 — infra

Dentro de `myde-backend`:

```powershell
.\scripts\dev\up-infra.ps1
```

Isso sobe:
- Postgres
- Redis

### Terminal 2 — backend API

Ainda dentro de `myde-backend`:

```powershell
npm run dev
```

Isso sobe a API em:

```txt
http://localhost:8000
```

### Terminal 3 — worker

Ainda dentro de `myde-backend`:

```powershell
npm run dev:worker
```

Esse processo precisa ficar aberto em outra janela.

### Terminal 4 — frontend

Vá para `myde-frontend`:

```powershell
Set-Location ..\myde-frontend
npm run dev
```

Isso sobe o frontend em:

```txt
http://localhost:3000
```

### Terminal 5 — tunnel para webhook da Meta

Se for testar webhook real:

```powershell
cloudflared tunnel --url http://localhost:8000
```

Use a URL pública gerada e configure na Meta:
- Callback URL: `https://<tunel>.trycloudflare.com/webhook`
- Verify token: valor de `META_VERIFY_TOKEN` do `.env`
- Campo: `messages`

### Diagnóstico

De volta em `myde-backend`:

```powershell
.\scripts\dev\check-local.ps1
```

Esse script valida:
- containers
- `/health`
- `/me`
- `/conversations`
- handshake `GET /webhook`

## Ordem (um terminal por processo)

| Terminal | Bash (Git Bash/WSL) | PowerShell | O que faz |
|---|---|---|---|
| 1 — infra | `./scripts/dev/up-infra.sh` | `.\scripts\dev\up-infra.ps1` | sobe Postgres + Redis |
| 2 — backend | `./scripts/dev/dev-backend.sh` | `npm run dev` | API em `:8000` |
| 3 — worker | `./scripts/dev/dev-worker.sh` | `npm run dev:worker` | processa fila BullMQ |
| 4 — frontend | `./scripts/dev/dev-frontend.sh` | `cd ..\myde-frontend; npm run dev` | UI em `:3000` |
| 5 — túnel | `./scripts/dev/tunnel-backend.sh` | `cloudflared tunnel --url http://localhost:8000` | webhook real |

Diagnóstico a qualquer momento:
`./scripts/dev/check-local.sh` (ou `.\scripts\dev\check-local.ps1`).

Encerrar infra **preservando dados**:
`./scripts/dev/down-infra.sh` (ou `.\scripts\dev\down-infra.ps1`).

## Antes de começar

- Backend: `cp .env.example .env` e preencher `OPENAI_API_KEY` + `META_*` reais.
- Frontend: `.env.local` com `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.
- Rodar uma vez: `npm run db:migrate` e `npm run db:seed`.

### Arquivos esperados

Backend:

```txt
myde-backend/.env
```

Frontend:

```txt
myde-frontend/.env.local
```

Valor esperado no frontend:

```txt
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Como executar `npm run dev` e `npm run dev:worker`

Esses dois comandos devem ser executados **dentro da pasta `myde-backend`** e
em **terminais separados**.

### Backend API

Use para subir a API HTTP em modo watch na porta `8000`.

```bash
cd myde-backend
npm run dev
```

No PowerShell:

```powershell
Set-Location d:\PROJETOS\myde\myde-backend
npm run dev
```

### Worker

Use para subir o worker BullMQ em modo watch. Ele processa a fila em paralelo
com a API, então precisa ficar em **outra janela/terminal**.

```bash
cd myde-backend
npm run dev:worker
```

No PowerShell:

```powershell
Set-Location d:\PROJETOS\myde\myde-backend
npm run dev:worker
```

### Sequência recomendada

1. Terminal 1: subir a infra (`up-infra`)
2. Terminal 2: rodar `npm run dev`
3. Terminal 3: rodar `npm run dev:worker`
4. Terminal 4: subir o frontend
5. Terminal 5: abrir o tunnel, quando for testar webhook real

## Comandos prontos para copiar (PowerShell)

### Dentro de `myde-backend`

```powershell
.\scripts\dev\up-infra.ps1
npm run db:migrate
npm run db:seed
npm run dev
```

Em outra janela, ainda dentro de `myde-backend`:

```powershell
npm run dev:worker
```

Em outra janela:

```powershell
Set-Location ..\myde-frontend
npm run dev
```

Em outra janela, para webhook real:

```powershell
Set-Location ..\myde-backend
cloudflared tunnel --url http://localhost:8000
```

Para diagnóstico:

```powershell
.\scripts\dev\check-local.ps1
```

## Fluxo sugerido

### Bash (opcional)

```bash
./scripts/dev/up-infra.sh
./scripts/dev/dev-backend.sh
./scripts/dev/dev-worker.sh
./scripts/dev/dev-frontend.sh
./scripts/dev/tunnel-backend.sh   # quando for testar webhook real da Meta
./scripts/dev/check-local.sh
```

### PowerShell

```powershell
.\scripts\dev\up-infra.ps1
npm run dev
npm run dev:worker
Set-Location ..\myde-frontend; npm run dev
cloudflared tunnel --url http://localhost:8000
Set-Location ..\myde-backend; .\scripts\dev\check-local.ps1
```

## Cuidados

- **Dados persistem** no volume `myde_pg_data`. `down-infra` preserva; **nunca** use
  `docker compose down -v` no fluxo normal (apaga banco e conversas).
- `docker compose down` preserva dados; `docker compose down -v` apaga banco e conversas.
- Antes de `RUN_REDIS_TESTS=true npm test`, **pare o worker** (acesso exclusivo à fila).
- `mock-meta` é **legado/opcional** e só sobe com:
  `docker compose --profile mock up -d mock-meta`
- Os scripts **não** imprimem segredos; `.env` permanece gitignored.

## Quando usar `tunnel-backend.sh`

Se você já usa este comando direto no PowerShell:

```powershell
cloudflared tunnel --url http://localhost:8000
```

continue assim.

O script:

```bash
./scripts/dev/tunnel-backend.sh
```

é só um atalho para Bash. Ele é **opcional**.
