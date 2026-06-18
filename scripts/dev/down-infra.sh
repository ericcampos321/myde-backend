#!/usr/bin/env bash
# Para a infraestrutura local PRESERVANDO os dados (volumes Docker mantidos).
# NUNCA usa `down -v` — isso apagaria banco e conversas reais.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$BACKEND_ROOT"

info "Parando containers (docker compose down)..."
docker compose down

echo
ok "Infra parada. Volumes PRESERVADOS — Postgres (myde_pg_data) e Redis intactos."
warn "NÃO use 'docker compose down -v': isso APAGA o banco e todas as conversas."
