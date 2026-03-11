#!/usr/bin/env bash

# File: scripts/monitor-paper-service.sh
# Module: scripts（主站论文服务连通监控）
#
# Responsibility:
#   - 定时探测远端 `PAPER_ASSISTANT_BASE_URL/health`。
#   - 把探测结果写入本地日志文件，便于主站运维排障。
#
# Runtime Logic Overview:
#   1. `start`：后台启动监控循环并写入 PID 文件。
#   2. `run`：按固定周期请求健康检查接口，记录成功/失败和状态码。
#   3. `once`：仅执行一次健康检查，适用于部署脚本中的 smoke check。
#   4. `stop/status`：用于查询或停止后台监控进程。
#
# Last Updated:
#   - 2026-03-11 by Codex - 新增远端论文服务健康监控脚本

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${PAPER_MONITOR_LOG_DIR:-${ROOT_DIR}/.runtime}"
LOG_FILE="${PAPER_MONITOR_LOG_FILE:-${LOG_DIR}/paper-service-monitor.log}"
PID_FILE="${PAPER_MONITOR_PID_FILE:-${LOG_DIR}/paper-service-monitor.pid}"
INTERVAL_S="${PAPER_MONITOR_INTERVAL_S:-60}"
TIMEOUT_S="${PAPER_MONITOR_TIMEOUT_S:-10}"
TARGET_BASE_URL="${PAPER_ASSISTANT_BASE_URL:-}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/monitor-paper-service.sh start
  scripts/monitor-paper-service.sh stop
  scripts/monitor-paper-service.sh status
  scripts/monitor-paper-service.sh once
  scripts/monitor-paper-service.sh run
USAGE
}

ensure_target_url() {
  if [[ -z "${TARGET_BASE_URL}" ]]; then
    echo "缺少 PAPER_ASSISTANT_BASE_URL，无法监控远端论文服务。" >&2
    exit 1
  fi
}

log_line() {
  local level="$1"
  local message="$2"
  mkdir -p "${LOG_DIR}"
  local now
  now="$(date '+%Y-%m-%d %H:%M:%S %z')"
  printf '[%s] [%s] %s\n' "${now}" "${level}" "${message}" | tee -a "${LOG_FILE}"
}

healthcheck_once() {
  ensure_target_url
  local health_url="${TARGET_BASE_URL%/}/health"
  local response_file
  response_file="$(mktemp)"
  local http_code
  http_code="$(
    curl -sS -o "${response_file}" -w "%{http_code}" \
      --connect-timeout "${TIMEOUT_S}" \
      --max-time "${TIMEOUT_S}" \
      "${health_url}" || true
  )"
  local response_text
  response_text="$(tr '\n' ' ' < "${response_file}")"
  rm -f "${response_file}"

  if [[ "${http_code}" == "200" ]]; then
    log_line "INFO" "paper-service healthy: code=${http_code} body=${response_text}"
    return 0
  fi

  log_line "ERROR" "paper-service unhealthy: code=${http_code} body=${response_text}"
  return 1
}

run_loop() {
  while true; do
    healthcheck_once || true
    sleep "${INTERVAL_S}"
  done
}

start_monitor() {
  mkdir -p "${LOG_DIR}"

  if [[ -f "${PID_FILE}" ]]; then
    local current_pid
    current_pid="$(cat "${PID_FILE}")"
    if [[ -n "${current_pid}" ]] && kill -0 "${current_pid}" >/dev/null 2>&1; then
      log_line "INFO" "monitor already running pid=${current_pid}"
      return 0
    fi
    rm -f "${PID_FILE}"
  fi

  nohup bash "$0" run >>"${LOG_FILE}" 2>&1 &
  local monitor_pid="$!"
  printf '%s' "${monitor_pid}" > "${PID_FILE}"
  log_line "INFO" "monitor started pid=${monitor_pid}"
}

stop_monitor() {
  if [[ ! -f "${PID_FILE}" ]]; then
    echo "monitor not running (missing pid file)." >&2
    return 0
  fi

  local monitor_pid
  monitor_pid="$(cat "${PID_FILE}")"
  if [[ -z "${monitor_pid}" ]]; then
    rm -f "${PID_FILE}"
    echo "monitor not running (empty pid)." >&2
    return 0
  fi

  if kill -0 "${monitor_pid}" >/dev/null 2>&1; then
    kill "${monitor_pid}"
    log_line "INFO" "monitor stopped pid=${monitor_pid}"
  else
    echo "monitor process already exited pid=${monitor_pid}." >&2
  fi
  rm -f "${PID_FILE}"
}

status_monitor() {
  if [[ ! -f "${PID_FILE}" ]]; then
    echo "monitor status: stopped"
    return 0
  fi

  local monitor_pid
  monitor_pid="$(cat "${PID_FILE}")"
  if [[ -n "${monitor_pid}" ]] && kill -0 "${monitor_pid}" >/dev/null 2>&1; then
    echo "monitor status: running pid=${monitor_pid}"
    return 0
  fi

  echo "monitor status: stopped (stale pid file)"
  return 0
}

action="${1:-}"
case "${action}" in
  start)
    start_monitor
    ;;
  stop)
    stop_monitor
    ;;
  status)
    status_monitor
    ;;
  once)
    healthcheck_once
    ;;
  run)
    run_loop
    ;;
  *)
    usage
    exit 1
    ;;
esac

# Code Review:
# - 采用独立监控脚本而不是把健康探测塞进 API 主进程，避免主业务链路承担额外循环任务风险。
# - `start/stop/status/once` 做成可复用子命令后，部署脚本和日常排障可以共享同一套入口，减少运维分叉。
# - 日志默认写入 `.runtime`，不会污染仓库源码目录，也方便后续交给外部日志采集。
