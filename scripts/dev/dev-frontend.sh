#!/usr/bin/env bash
# Inicia o frontend (Next.js) em modo dev. Porta esperada: 3000.
# Valida que NEXT_PUBLIC_API_BASE_URL aponta para o backend (http://localhost:8000).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if [ -z "${FRONTEND_ROOT:-}" ] || [ ! -d "$FRONTEND_ROOT" ]; then
  err "Frontend não encontrado em ../myde-frontend (irmão de myde-backend)."
  exit 1
fi

cd "$FRONTEND_ROOT"

# Procura a base da API nos arquivos de env do frontend, sem imprimir segredos.
env_file=""
[ -f .env.local ] && env_file=".env.local"
[ -z "$env_file" ] && [ -f .env ] && env_file=".env"

if [ -n "$env_file" ]; then
  api_base="$(grep -E '^NEXT_PUBLIC_API_BASE_URL=' "$env_file" | cut -d'=' -f2- || true)"
  if [ -z "$api_base" ]; then
    warn "NEXT_PUBLIC_API_BASE_URL não definido em $env_file."
    warn "Esperado: NEXT_PUBLIC_API_BASE_URL=http://localhost:8000"
  else
    info "NEXT_PUBLIC_API_BASE_URL = $api_base"
  fi
else
  warn "Sem .env.local/.env no frontend. Crie com:"
  warn "  NEXT_PUBLIC_API_BASE_URL=http://localhost:8000"
fi

info "Iniciando frontend em http://localhost:3000 ..."
npm run dev
