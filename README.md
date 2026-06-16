# Myde Inbox — Como rodar o projeto

## 1. Pré-requisitos

Tenha instalado:

- Node.js
- npm
- Docker
- Docker Compose

---

## 2. Subir o backend

Abra um terminal na pasta `myde-backend`:

```powershell
cd D:\PROJETOS\myde\myde-backend
npm install
```

Suba a infraestrutura local:

```powershell
.\scripts\dev\up-infra.ps1
```

Rode as migrations e o seed:

```powershell
npm run db:migrate
npm run check:db
npm run db:seed
```

`npm run check:db` não aplica migrations. Ele apenas valida se o banco local
tem as tabelas/colunas críticas esperadas pelo código atual. Se aparecer:

```text
Banco local desatualizado. Rode: npm run db:migrate
```

rode `npm run db:migrate` e depois `npm run check:db` novamente. Isso ajuda a
diagnosticar erros 500 causados por migration pendente, por exemplo quando um
endpoint passa a consultar uma coluna nova como
`ai_interaction_logs.cached_prompt_tokens`.

As migrations não rodam automaticamente no boot do backend para evitar mudança
implícita de schema ao iniciar a aplicação. Em desenvolvimento, rode migrations
explicitamente sempre que puxar alterações com arquivos novos em
`src/db/migrations`.

Inicie a API:

```powershell
npm run dev
```

A API sobe em:

```text
http://localhost:8000
```

Teste:

```powershell
curl http://localhost:8000/health
curl http://localhost:8000/ready
```

---

## 3. Subir o worker

Abra outro terminal na pasta `myde-backend`:

```powershell
cd D:\PROJETOS\myde\myde-backend
npm run dev:worker
```

---

## 4. Subir o frontend

Abra outro terminal na pasta `myde-frontend`:

```powershell
cd D:\PROJETOS\myde\myde-frontend
npm install
npm run dev
```

O frontend sobe em:

```text
http://localhost:3000
```

---

## 5. Webhook local com túnel

Para testar webhook real da Meta, abra outro terminal na pasta `myde-backend`:

```powershell
cd D:\PROJETOS\myde\myde-backend
cloudflared tunnel --url http://localhost:8000
```

Use a URL gerada pelo Cloudflare no painel da Meta:

```text
https://<url-gerada>/webhook
```

---

## 6. Comandos úteis

Backend:

```powershell
npm run dev
npm run dev:worker
npm run db:migrate
npm run db:seed
npm test
```

Frontend:

```powershell
npm run dev
npm test
npm run lint
npm run typecheck
```

---

## 7. Testes completos com DB e Redis

Antes de rodar, pare qualquer worker aberto:

```powershell
Stop-Process -Name node -Force
```

Depois rode no backend:

```powershell
cd D:\PROJETOS\myde\myde-backend
$env:RUN_DB_TESTS="true"; $env:RUN_REDIS_TESTS="true"; npm test
```

Resultado esperado:

```text
Test Files passed
Tests passed
```

---

## 8. Ordem recomendada para rodar tudo

Use um terminal para cada processo:

```text
Terminal 1: myde-backend - .\scripts\dev\up-infra.ps1
Terminal 2: myde-backend - docker compose up -d postgres redis e npm  run  dev
Terminal 3: myde-backend - npm run dev:worker
Terminal 4: myde-frontend - npm run dev


# simular tunelamento, pdoe utilizar ngrok, somente testes com alteração frequennte de rotas  de tunel.

Terminal 5: myde-backend  - cloudflared tunnel --url http://localhost:8000
```
