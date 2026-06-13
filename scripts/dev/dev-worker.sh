#!/usr/bin/env bash
# Inicia o worker dedicado (BullMQ) em modo watch. Terminal separado do backend.
# Requer infra no ar (Redis) e .env preenchido.
#
# ATENÇÃO: a suíte `RUN_REDIS_TESTS=true npm test` exige acesso exclusivo à fila
# `message-processing`. PARE este worker antes de rodar esses testes, senão eles
# falham com "locked by another worker".
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$BACKEND_ROOT"

info "Iniciando worker de processamento de mensagens (BullMQ)..."
warn "Mantenha em terminal separado. Pare-o antes de rodar RUN_REDIS_TESTS."
npm run dev:worker
