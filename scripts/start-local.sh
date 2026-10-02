#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h:h}"
export JOY_PROJECT_ROOT="$PROJECT_ROOT"
exec /bin/zsh "$PROJECT_ROOT/desktop/server-wrapper.sh"
