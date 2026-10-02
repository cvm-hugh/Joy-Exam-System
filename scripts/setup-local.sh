#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
RESULTS_ROOT="$PROJECT_ROOT/services/results"
NODE_BIN="${JOY_NODE_BIN:-$(command -v node || true)}"
NPM_BIN="$(command -v npm || true)"
PYTHON_BOOTSTRAP="${JOY_PYTHON_BOOTSTRAP:-}"

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  print -u2 -- "请先安装 Node.js（建议使用 .node-version 中的版本）。"
  exit 69
fi
"$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)' || {
  print -u2 -- "需要 Node.js 22.13 或以上版本。"
  exit 69
}
export PATH="${NODE_BIN:h}:$PATH"

if [[ -z "$PYTHON_BOOTSTRAP" ]]; then
  for candidate in python3.12 python3; do
    found="$(command -v "$candidate" || true)"
    if [[ -n "$found" ]] && "$found" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))' 2>/dev/null; then
      PYTHON_BOOTSTRAP="$found"
      break
    fi
  done
fi
if [[ -z "$PYTHON_BOOTSTRAP" ]] || ! "$PYTHON_BOOTSTRAP" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))'; then
  print -u2 -- "需要 Python 3.12。可通过 JOY_PYTHON_BOOTSTRAP 指定 Python 解释器。"
  exit 69
fi

mkdir -p "$PROJECT_ROOT/.local"
# Detach only the link itself; never modify the linked historical project.
for dependency_path in "$RESULTS_ROOT/node_modules" "$PROJECT_ROOT/.venv"; do
  if [[ -L "$dependency_path" ]]; then
    unlink "$dependency_path"
  fi
done
if [[ ! -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
  "$PYTHON_BOOTSTRAP" -m venv "$PROJECT_ROOT/.venv"
fi
"$PROJECT_ROOT/.venv/bin/python" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))'
PYTHON_REQUIREMENTS="$PROJECT_ROOT/services/scanner/requirements.txt"
if [[ -f "$PROJECT_ROOT/services/scanner/requirements-lock.txt" ]]; then
  PYTHON_REQUIREMENTS="$PROJECT_ROOT/services/scanner/requirements-lock.txt"
fi
"$PROJECT_ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$PYTHON_REQUIREMENTS"
"$PROJECT_ROOT/.venv/bin/python" -m pip check

cd "$RESULTS_ROOT"
"$NPM_BIN" ci --no-audit --no-fund
print -r -- "$NODE_BIN" > "$PROJECT_ROOT/.local/node-bin"
"$NODE_BIN" "$RESULTS_ROOT/scripts/init-local.mjs" "$PROJECT_ROOT/runtime" 3010
cd "$PROJECT_ROOT"
"$NODE_BIN" scripts/check-source-independence.mjs
print -r -- "独立开发环境已准备好；运行 npm run desktop:build 构建统一 App。"
