#!/usr/bin/env bash

# File: scripts/dev-stack.sh
# Module: scripts（本地联调启动）
#
# Responsibility:
#   - 为本地开发提供统一的一键启动入口。
#   - 自动对齐前端代理端口、API 端口和论文服务地址，避免多终端手工启动时配置漂移。
#
# Runtime Logic Overview:
#   1. 若未显式指定远端论文服务，则默认拉起本地 paper-service。
#   2. 统一导出 API、Web 和论文服务相关环境变量。
#   3. 并发启动 paper-service、API、Worker 和 Web，任一进程退出时整体退出。
#
# Last Updated:
#   - 2026-03-08 by Codex - 初始化本地一键联调脚本

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
PAPER_SERVICE_PORT="${PAPER_SERVICE_PORT:-8090}"
PAPER_SERVICE_BIND_HOST="${PAPER_SERVICE_BIND_HOST:-127.0.0.1}"
START_LOCAL_PAPER_SERVICE="${START_LOCAL_PAPER_SERVICE:-}"

if [[ -z "${PAPER_ASSISTANT_BASE_URL:-}" ]]; then
  export PAPER_ASSISTANT_BASE_URL="http://127.0.0.1:${PAPER_SERVICE_PORT}"
  START_LOCAL_PAPER_SERVICE="${START_LOCAL_PAPER_SERVICE:-1}"
else
  START_LOCAL_PAPER_SERVICE="${START_LOCAL_PAPER_SERVICE:-0}"
fi

export API_PORT
export WEB_PORT
export WEB_HOST
export PAPER_SERVICE_PORT
export PAPER_SERVICE_BIND_HOST
export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://127.0.0.1:${API_PORT}}"

declare -a CHILD_PIDS=()

cleanup() {
  for pid in "${CHILD_PIDS[@]:-}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

echo "本地联调端口：API=${API_PORT} Web=${WEB_HOST}:${WEB_PORT} Paper=${PAPER_SERVICE_BIND_HOST}:${PAPER_SERVICE_PORT}"
echo "论文服务地址：${PAPER_ASSISTANT_BASE_URL}"

if [[ "${START_LOCAL_PAPER_SERVICE}" == "1" ]]; then
  npm run dev:paper-service &
  CHILD_PIDS+=("$!")
fi

npm run dev:api &
CHILD_PIDS+=("$!")

npm run dev:worker &
CHILD_PIDS+=("$!")

npm run dev:web &
CHILD_PIDS+=("$!")

wait -n
