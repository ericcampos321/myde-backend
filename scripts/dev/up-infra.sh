#!/usr/bin/env bash
# Sobe APENAS a infraestrutura local: PostgreSQL + Redis.
# NÃO sobe mock-meta (que está isolado atrás do profile "mock").
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$BACKEND_ROOT"

info "Subindo Postgres + Redis (sem mock-meta)..."
docker compose up -d postgres redis

echo
docker compose ps

echo
ok "Infra no ar. Postgres :5432  ·  Redis :6380 (externo)."
info "mock-meta é LEGADO/OPCIONAL e NÃO sobe aqui."
info "Para usá-lo sob demanda: docker compose --profile mock up -d mock-meta"
info "Próximo passo: ./scripts/dev/dev-backend.sh  (e depois dev-worker / dev-frontend)"
