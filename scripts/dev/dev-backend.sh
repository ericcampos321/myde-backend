#!/usr/bin/env bash
# Inicia a API do backend (Fastify) em modo watch. Porta esperada: 8000.
# Requer infra no ar (./scripts/dev/up-infra.sh) e .env preenchido.
# Mantenha este processo em um terminal dedicado.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$BACKEND_ROOT"

if [ ! -f .env ]; then
  warn ".env não encontrado no backend. Copie o template: cp .env.example .env"
  warn "e preencha OPENAI_API_KEY + as variáveis META_* reais antes de subir."
fi

info "Iniciando backend (API) em http://localhost:8000 ..."
info "Health: curl http://localhost:8000/health"
npm run dev
