#!/bin/zsh
# Compatibility entry: build only 佳音考试管理.
set -euo pipefail
PROJECT_ROOT="${0:A:h:h:h:h}"
exec /bin/zsh "$PROJECT_ROOT/scripts/build-macos-app.sh"
