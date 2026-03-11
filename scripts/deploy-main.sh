#!/usr/bin/env bash

# File: scripts/deploy-main.sh
# Module: scripts（主站容器化部署）
#
# Responsibility:
#   - 在主站机器统一执行 Docker 化部署与回滚。
#   - 启动后完成 API 健康检查与远端论文服务 smoke check。
#
# Runtime Logic Overview:
#   1. 读取 `.env.main`（或自定义环境文件）并校验关键变量。
#   2. deploy：`git pull -> compose build/up -> health/smoke -> 启动监控脚本`。
#   3. rollback：使用指定镜像 tag 执行 `down + up` 还原。
#
# Last Updated:
#   - 2026-03-11 by Codex - 新增主站 Docker 发布脚本

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose.main.yml"
ENV_FILE="${DEPLOY_ENV_FILE:-${ROOT_DIR}/.env.main}"
ACTION="${1:-deploy}"
TARGET_MAIN_TAG="${2:-}"

require_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "环境文件不存在: ${ENV_FILE}" >&2
    echo "请先复制 .env.main.example -> .env.main 并填写配置。" >&2
    exit 1
  fi
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
}

require_var() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "${value}" ]]; then
    echo "缺少必要变量 ${key}（来自 ${ENV_FILE}）。" >&2
    exit 1
  fi
}

pull_latest_code() {
  if [[ "${SKIP_GIT_PULL:-0}" == "1" ]]; then
    echo "SKIP_GIT_PULL=1，跳过 git pull。"
    return 0
  fi
  git -C "${ROOT_DIR}" fetch origin main
  git -C "${ROOT_DIR}" pull --ff-only origin main
}

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

smoke_check_main() {
  local api_port="${API_PORT:-3000}"
  local paper_base="${PAPER_ASSISTANT_BASE_URL%/}"

  curl -fsS "http://127.0.0.1:${api_port}/api/health" >/dev/null
  curl -fsS "${paper_base}/health" >/dev/null

  local payload
  payload='{"query":"deep learning","limit":3,"sources":["arxiv"]}'
  local response
  response="$(curl -fsS -X POST "${paper_base}/v1/search" -H "Content-Type: application/json" -d "${payload}")"
  if [[ "${response}" != *"results"* ]] || [[ "${response}" != *"sourceStatuses"* ]]; then
    echo "论文服务 smoke check 失败：返回结构异常。" >&2
    exit 1
  fi
}

deploy_main() {
  pull_latest_code
  export MAIN_IMAGE_TAG="${MAIN_IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
  echo "deploy MAIN_IMAGE_TAG=${MAIN_IMAGE_TAG}"

  compose pull || true
  compose build api worker paper-report-worker
  compose up -d --remove-orphans
  smoke_check_main

  PAPER_ASSISTANT_BASE_URL="${PAPER_ASSISTANT_BASE_URL}" \
    bash "${ROOT_DIR}/scripts/monitor-paper-service.sh" start
  echo "主站部署完成。"
}

rollback_main() {
  if [[ -z "${TARGET_MAIN_TAG}" ]]; then
    echo "rollback 需要提供目标镜像 tag，例如: scripts/deploy-main.sh rollback 20260311-1" >&2
    exit 1
  fi

  export MAIN_IMAGE_TAG="${TARGET_MAIN_TAG}"
  echo "rollback MAIN_IMAGE_TAG=${MAIN_IMAGE_TAG}"
  compose down
  compose up -d --remove-orphans
  smoke_check_main
  echo "主站回滚完成。"
}

main() {
  require_env_file
  load_env
  require_var "PAPER_ASSISTANT_BASE_URL"
  require_var "PLATFORM_POSTGRES_PASSWORD"

  case "${ACTION}" in
    deploy)
      deploy_main
      ;;
    rollback)
      rollback_main
      ;;
    *)
      echo "Usage: scripts/deploy-main.sh [deploy|rollback] [image-tag]" >&2
      exit 1
      ;;
  esac
}

main "$@"

# Code Review:
# - `deploy` 与 `rollback` 合并在一个脚本中，发布入口统一，避免主站机器出现多套不一致手工命令。
# - smoke check 直接验证主站健康与远端论文搜索结构，能提前暴露“服务启动成功但跨地域调用失败”的隐蔽问题。
# - 监控脚本在部署后自动启动，满足“定时探测 + 日志落盘”的运维可观测性要求，同时不侵入 API 主进程。
