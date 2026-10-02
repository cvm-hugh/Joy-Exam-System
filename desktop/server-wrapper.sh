#!/bin/zsh
set -u

SCRIPT_DIR="${0:A:h}"
MERGE_ROOT="${JOY_PROJECT_ROOT:-}"
if [[ -z "$MERGE_ROOT" && -d "$SCRIPT_DIR/../services" ]]; then
  MERGE_ROOT="${SCRIPT_DIR:h}"
elif [[ -z "$MERGE_ROOT" && -d "$SCRIPT_DIR/../../../../services" ]]; then
  MERGE_ROOT="${SCRIPT_DIR}/../../../.."
elif [[ -z "$MERGE_ROOT" && -f "$SCRIPT_DIR/project-root.txt" ]]; then
  MERGE_ROOT="$(<"$SCRIPT_DIR/project-root.txt")"
fi
if [[ -z "$MERGE_ROOT" || ! -d "$MERGE_ROOT/services" ]]; then
  print -u2 -- "找不到佳音考试管理项目目录。请从本项目重新构建开发 App。"
  exit 69
fi
MERGE_ROOT="${MERGE_ROOT:A}"
SCANNER_ROOT="$MERGE_ROOT/services/scanner"
RESULTS_ROOT="$MERGE_ROOT/services/results"
RUNTIME_ROOT="${JOY_MERGE_RUNTIME_ROOT:-$MERGE_ROOT/runtime}"
LOG_DIR="${JOY_LOG_DIR:-$MERGE_ROOT/.local/logs}"
LOG_FILE="$LOG_DIR/unified-server.log"
PYTHON_BIN="$MERGE_ROOT/.venv/bin/python"
NODE_BIN="${JOY_NODE_BIN:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if [[ -z "$NODE_BIN" && -f "$MERGE_ROOT/.local/node-bin" ]]; then
  NODE_BIN="$(<"$MERGE_ROOT/.local/node-bin")"
fi
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
WRANGLER_BIN="$RESULTS_ROOT/node_modules/wrangler/bin/wrangler.js"
BRIDGE_TOKEN="${JOY_DESKTOP_BRIDGE_TOKEN:-}"
SCANNER_PORT="${JOY_SCANNER_PORT:-8510}"
RESULTS_PORT="${JOY_RESULTS_PORT:-3010}"
mkdir -p "$LOG_DIR"

function stop_services() {
  for pid in "${SCANNER_PID:-}" "${RESULTS_PID:-}"; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null
  done
  for pid in "${SCANNER_PID:-}" "${RESULTS_PID:-}"; do
    [[ -n "$pid" ]] && wait "$pid" 2>/dev/null
  done
  SCANNER_PID=""
  RESULTS_PID=""
}
function handle_shutdown() {
  stop_services
  trap - TERM INT EXIT
  exit 0
}
trap handle_shutdown TERM INT
trap stop_services EXIT

if [[ ! -x "$PYTHON_BIN" || -L "$MERGE_ROOT/.venv" ]]; then
  print -r -- "找不到本项目的独立 Python 环境，请运行 npm run setup。" >> "$LOG_FILE"
  exit 69
fi
if [[ ! -x "$NODE_BIN" || ! -f "$WRANGLER_BIN" || -L "$RESULTS_ROOT/node_modules" ]]; then
  print -r -- "找不到本项目的独立结果管理依赖，请运行 npm run setup。" >> "$LOG_FILE"
  exit 69
fi
if [[ ! -f "$RESULTS_ROOT/dist/server/wrangler.json" ]]; then
  print -r -- "结果管理尚未构建，请运行 npm run build。" >> "$LOG_FILE"
  exit 69
fi
if [[ ! -f "$RUNTIME_ROOT/.dev.vars" ]]; then
  print -r -- "运行配置不存在，请先运行 npm run setup。" >> "$LOG_FILE"
  exit 69
fi
if [[ -z "$BRIDGE_TOKEN" ]]; then
  BRIDGE_TOKEN="$("$PYTHON_BIN" -c 'import secrets; print(secrets.token_hex(32))')"
fi
if [[ ${#BRIDGE_TOKEN} -lt 32 ]]; then
  print -r -- "桌面会话令牌无效，拒绝启动内部交接通道。" >> "$LOG_FILE"
  exit 69
fi

export WRANGLER_WRITE_LOGS=false
export WRANGLER_LOG_PATH="$LOG_DIR/wrangler"
export MINIFLARE_REGISTRY_PATH="$MERGE_ROOT/.local/wrangler-registry"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$MINIFLARE_REGISTRY_PATH"
print -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] 启动佳音考试管理独立服务" >> "$LOG_FILE"
(
  cd "$SCANNER_ROOT" || exit 70
  env DINGWEICE_DATA_DIR="$RUNTIME_ROOT/scanner" DINGWEICE_PORT="$SCANNER_PORT" DINGWEICE_HEADLESS=1 \
    RESULTS_BRIDGE_URL="http://127.0.0.1:$RESULTS_PORT/api/desktop/handoff" RESULTS_BRIDGE_TOKEN="$BRIDGE_TOKEN" \
    "$PYTHON_BIN" -m streamlit run app/scan_ui.py --server.address 127.0.0.1 --server.port "$SCANNER_PORT" \
    --server.headless true --browser.gatherUsageStats false
) >> "$LOG_FILE" 2>&1 &
SCANNER_PID=$!
(
  cd "$RESULTS_ROOT" || exit 70
  "$NODE_BIN" "$WRANGLER_BIN" dev --config "$RESULTS_ROOT/dist/server/wrangler.json" \
    --persist-to "$RUNTIME_ROOT/results" --port "$RESULTS_PORT" --ip 127.0.0.1 \
    --env-file "$RUNTIME_ROOT/.dev.vars" --var "DESKTOP_BRIDGE_TOKEN:$BRIDGE_TOKEN"
) >> "$LOG_FILE" 2>&1 &
RESULTS_PID=$!
while kill -0 "$SCANNER_PID" 2>/dev/null && kill -0 "$RESULTS_PID" 2>/dev/null; do
  sleep 1
done
if ! kill -0 "$SCANNER_PID" 2>/dev/null; then
  wait "$SCANNER_PID"
  SERVICE_STATUS=$?
  SCANNER_PID=""
  STOPPED_SERVICE="阅卷服务"
else
  wait "$RESULTS_PID"
  SERVICE_STATUS=$?
  RESULTS_PID=""
  STOPPED_SERVICE="结果管理服务"
fi
print -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] $STOPPED_SERVICE 结束，状态 $SERVICE_STATUS" >> "$LOG_FILE"
exit "$SERVICE_STATUS"
