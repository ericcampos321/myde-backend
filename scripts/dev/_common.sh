#!/usr/bin/env bash
# Helpers comuns aos scripts de dev. Resolve as raízes dos dois repositórios
# (backend e frontend) a partir da localização do próprio script, para que os
# comandos funcionem independente do diretório atual.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Frontend é repositório irmão de myde-backend.
FRONTEND_ROOT="$(cd "$BACKEND_ROOT/../myde-frontend" 2>/dev/null && pwd || true)"

info()  { printf '\033[36m[dev]\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m[dev]\033[0m %s\n' "$*"; }
err()   { printf '\033[31m[dev]\033[0m %s\n' "$*" >&2; }
ok()    { printf '\033[32m[dev]\033[0m %s\n' "$*"; }
