#!/usr/bin/env bash
# Abre um Cloudflare Tunnel público apontando para o backend local (porta 8000),
# para receber webhooks reais da Meta. Não salva token/credencial.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if ! command -v cloudflared >/dev/null 2>&1; then
  err "cloudflared não encontrado no PATH."
  err "Instale: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

info "Abrindo túnel para http://localhost:8000 ..."
info "Copie a URL https://<algo>.trycloudflare.com gerada abaixo e configure na Meta:"
info "  Callback URL : https://<tunel>/webhook"
info "  Verify token : o valor de META_VERIFY_TOKEN do seu .env (não exibido aqui)"
info "  Campo        : messages"
echo
cloudflared tunnel --url http://localhost:8000
