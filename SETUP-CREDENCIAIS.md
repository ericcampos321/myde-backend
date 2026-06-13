# Guia de Credenciais — Meta WhatsApp Cloud API & OpenAI

Este projeto opera com **chamadas reais** para a OpenAI e para a **Meta WhatsApp
Cloud API**. Para desenvolvimento, use o **ambiente de teste real da Meta**
(número de teste gratuito provisionado pelo app) — esse é o fluxo padrão.

> O serviço `mock-meta` ainda existe como ferramenta auxiliar **legada/opcional**
> (ver a última seção), mas **não** é o ambiente padrão e não é necessário no
> fluxo principal.

---

## 1. OpenAI (necessária para a parte de IA)

1. Crie uma conta em <https://platform.openai.com>.
2. **Crie um Project dedicado** para este desafio (menu de Projects no topo). Isso isola os
   limites e facilita acompanhar o gasto.
3. Em **Settings → Limits / Billing → Usage limits**, defina um **hard limit** baixo
   (ex.: US$ 5) e um **soft limit** (ex.: US$ 3). O controle é por **projeto/conta**,
   então configure aqui.
4. Em **API keys**, gere uma chave **dentro do Project** criado e coloque em `OPENAI_API_KEY`
   no seu `.env`.
5. Use o modelo definido no `.env.example` (**`gpt-5.4`**) em `OPENAI_MODEL`. Combine com os
   limites de gasto acima para manter o custo sob controle.

---

## 2. Meta WhatsApp Cloud API (ambiente de teste real)

> ⚠️ O token de acesso temporário do painel **expira em 24h** e vai te interromper no meio do
> desafio. Por isso o passo do **System User token** abaixo é importante para uso prolongado.

1. Crie um app em <https://developers.facebook.com> → **Create App** → tipo **Business**.
2. Adicione o produto **WhatsApp**. A Meta provisiona um **número de teste** gratuito e um
   `phone_number_id` → coloque em `META_PHONE_NUMBER_ID`.
3. No painel do WhatsApp, copie:
   - **Phone number ID** e **WhatsApp Business Account ID**.
   - **Temporary access token** (24h) → bom só para um teste rápido.
4. Em **App Settings → Basic**, copie o **App Secret** → vai em `META_APP_SECRET`
   (é com ele que se valida a assinatura `X-Hub-Signature-256`).
5. **Token que não expira (recomendado para durar o desafio inteiro)** — crie um *System User*:
   - Business Settings → **Users → System Users → Add** (role Admin).
   - **Add Assets** → seu app WhatsApp, com permissão total.
   - **Generate new token** → selecione `whatsapp_business_messaging` e
     `whatsapp_business_management`. Esse token é de longa duração → use em `META_TOKEN`.
6. `META_API_BASE_URL` = `https://graph.facebook.com/v20.0` (Graph API real).

### Configurar o webhook real (com túnel para o backend local)

1. Exponha a API local (porta `8000`) publicamente com um túnel:
   - `ngrok http 8000`, ou
   - `cloudflared tunnel --url http://localhost:8000`.
2. No painel da Meta (**WhatsApp → Configuration → Webhooks**):
   - **Callback URL**: `https://<seu-túnel>/webhook` — o endpoint real do backend exposto.
   - **Verify token**: a **mesma** string definida em `META_VERIFY_TOKEN` no `.env`.
   - Assine o campo **`messages`**.
3. A Meta faz o handshake (GET) validando o `META_VERIFY_TOKEN` e passa a entregar eventos
   assinados (POST), validados com `META_APP_SECRET`.

---

## Resumo das variáveis (`.env`)

| Variável | De onde vem | Obrigatória? |
|----------|-------------|--------------|
| `OPENAI_API_KEY` | OpenAI (Project) | Sim |
| `OPENAI_MODEL` | `gpt-5.4` (ver `.env.example`) | Sim |
| `META_VERIFY_TOKEN` | Você define (mesma string no painel da Meta) | Sim (handshake) |
| `META_APP_SECRET` | App Settings → Basic (App Secret real) | Sim (assinatura) |
| `META_TOKEN` | System User token (real, longa duração) | Sim (envio/Graph API) |
| `META_PHONE_NUMBER_ID` | Número de teste provisionado pela Meta | Sim |
| `META_API_BASE_URL` | `https://graph.facebook.com/v20.0` | Sim |

Preencha tudo no **`.env` local** (gitignored). **Nunca** versione tokens/segredos reais.

---

## Legado/opcional — mock da Meta

Apenas para testes manuais **offline**, sem a Meta real. **Não** é o ambiente padrão.

O serviço está atrás do profile `mock` (não sobe no fluxo padrão). Suba-o
explicitamente com o profile e aponte o `.env` para ele (somente nesse modo):

```bash
docker compose --profile mock up -d mock-meta
# no .env:  META_API_BASE_URL=http://localhost:8001
```

`POST http://localhost:8001/simulate/inbound` injeta uma mensagem assinada como se viesse da
Meta, e `POST http://localhost:8001/{phoneNumberId}/messages` recebe os envios.