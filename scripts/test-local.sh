#!/bin/zsh
set -euo pipefail
PROJECT_ROOT="${0:A:h:h}"
if [[ ! -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
  print -u2 -- "请先运行 npm run setup，创建本项目的 Python 环境。"
  exit 69
fi
TEST_RUNTIME="$(mktemp -d "${TMPDIR:-/tmp}/joy-independent-tests.XXXXXX")"
trap 'rm -rf "$TEST_RUNTIME"' EXIT
cd "$PROJECT_ROOT/services/scanner"
DINGWEICE_DATA_DIR="$TEST_RUNTIME/scanner" "$PROJECT_ROOT/.venv/bin/python" -B -m unittest discover -s tests -v
cd "$PROJECT_ROOT/services/results"
npm test
