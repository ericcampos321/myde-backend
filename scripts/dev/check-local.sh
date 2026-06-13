#!/usr/bin/env bash
# Diagnóstico do ambiente local. Não falha de forma confusa se algo estiver
# fora do ar — apenas reporta cada item. Nunca imprime segredos do .env.
# Uso: ./scripts/dev/check-local.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
set +e  # diagnóstico não deve abortar no primeiro erro

cd "$BACKEND_ROOT"

API="http://localhost:8000"
CURL_BIN="curl"
if command -v curl.exe >/dev/null 2>&1; then
  CURL_BIN="curl.exe"
fi

echo "=============================================="
echo " Myde/Maude — diagnóstico do ambiente local"
echo "=============================================="

# 1. Docker / infra
info "Containers (docker compose ps):"
if docker compose ps >/dev/null 2>&1; then
  docker compose ps --format "  {{.Service}}: {{.State}}"
else
  warn "  docker compose indisponível ou nenhum serviço definido."
fi

# 2. Backend /health
echo
if "$CURL_BIN" -fsS "$API/health" --max-time 3 >/dev/null 2>&1; then
  ok "backend /health: OK ($API)"
else
  warn "backend /health: FORA DO AR. Suba com ./scripts/dev/dev-backend.sh"
  warn "Pulando checagens que dependem do backend."
  echo
  info "Resumo: infra verificada; backend não respondeu."
  exit 0
fi

# 3. /me (depende de tenant seedado)
if me="$("$CURL_BIN" -fsS "$API/me" --max-time 3 2>/dev/null)"; then
  name="$(printf '%s' "$me" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
  ok "/me: OK (tenant: ${name:-?})"
else
  warn "/me: erro. Rodou o seed? -> npm run db:seed (precisa de META_PHONE_NUMBER_ID no .env)"
fi

# 4. /conversations (200 [] é estado válido de banco vazio)
if conv="$("$CURL_BIN" -fsS "$API/conversations" --max-time 3 2>/dev/null)"; then
  if [ "$conv" = "[]" ]; then
    ok "/conversations: OK (200 [] — banco sem conversas ainda; estado vazio é normal)"
  else
    count="$(printf '%s' "$conv" | grep -o '"id"' | wc -l | tr -d ' ')"
    ok "/conversations: OK ($count conversa(s) persistida(s))"
  fi
else
  warn "/conversations: erro ao consultar."
fi

# 5. Handshake do webhook (GET) — usa META_VERIFY_TOKEN do .env SEM imprimi-lo.
echo
if [ -f .env ]; then
  verify_token="$(grep -E '^META_VERIFY_TOKEN=' .env | cut -d'=' -f2-)"
  if [ -n "$verify_token" ]; then
    code="$("$CURL_BIN" -s -o /dev/null -w '%{http_code}' \
      "$API/webhook?hub.mode=subscribe&hub.verify_token=${verify_token}&hub.challenge=ping" \
      --max-time 3)"
    if [ "$code" = "200" ]; then
      ok "webhook GET handshake: OK (200) — META_VERIFY_TOKEN confere"
    else
      warn "webhook GET handshake: HTTP $code (verifique META_VERIFY_TOKEN no .env)"
    fi
  else
    warn "webhook GET handshake: META_VERIFY_TOKEN vazio no .env — pulando."
  fi
else
  warn "webhook GET handshake: .env ausente — pulando."
fi

echo
ok "Diagnóstico concluído."
