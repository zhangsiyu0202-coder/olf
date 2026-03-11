#!/usr/bin/env bash

# File: scripts/deploy-paper-hk.sh
# Module: scripts（香港论文服务容器化部署）
#
# Responsibility:
#   - 在香港服务器统一部署 `paper-service + HTTPS 网关`。
#   - 部署后执行本地 HTTPS 健康检查和搜索 smoke check。
#
# Runtime Logic Overview:
#   1. 读取 `.env.paper-hk`（或自定义环境文件）。
#   2. deploy：`git pull -> compose build/up -> https health/search smoke check`。
#   3. rollback：指定镜像 tag 后执行 `down + up`。
#
# Last Updated:
#   - 2026-03-11 by Codex - 新增香港论文服务 Docker 发布脚本

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose.paper-hk.yml"
ENV_FILE="${DEPLOY_ENV_FILE:-${ROOT_DIR}/.env.paper-hk}"
ACTION="${1:-deploy}"
TARGET_TAG="${2:-}"

require_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "环境文件不存在: ${ENV_FILE}" >&2
    echo "请先复制 .env.paper-hk.example -> .env.paper-hk 并填写配置。" >&2
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

smoke_check_hk() {
  local domain="${PAPER_PUBLIC_DOMAIN}"
  local health_url="https://${domain}/health"
  local search_url="https://${domain}/v1/search"

  curl -kfsS --resolve "${domain}:443:127.0.0.1" "${health_url}" >/dev/null

  local payload
  payload='{"query":"deep learning","limit":3,"sources":["arxiv"]}'
  local response
  response="$(
    curl -kfsS --resolve "${domain}:443:127.0.0.1" \
      -X POST "${search_url}" \
      -H "Content-Type: application/json" \
      -d "${payload}"
  )"

  if [[ "${response}" != *"results"* ]] || [[ "${response}" != *"sourceStatuses"* ]]; then
    echo "香港论文服务 smoke check 失败：返回结构异常。" >&2
    exit 1
  fi
}

deploy_hk() {
  pull_latest_code
  export PAPER_HK_IMAGE_TAG="${PAPER_HK_IMAGE_TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
  echo "deploy PAPER_HK_IMAGE_TAG=${PAPER_HK_IMAGE_TAG}"

  compose pull || true
  compose build paper-service
  compose up -d --remove-orphans
  smoke_check_hk
  echo "香港论文服务部署完成。"
}

rollback_hk() {
  if [[ -z "${TARGET_TAG}" ]]; then
    echo "rollback 需要提供目标镜像 tag，例如: scripts/deploy-paper-hk.sh rollback 20260311-1" >&2
    exit 1
  fi

  export PAPER_HK_IMAGE_TAG="${TARGET_TAG}"
  echo "rollback PAPER_HK_IMAGE_TAG=${PAPER_HK_IMAGE_TAG}"
  compose down
  compose up -d --remove-orphans
  smoke_check_hk
  echo "香港论文服务回滚完成。"
}

main() {
  require_env_file
  load_env
  require_var "PAPER_PUBLIC_DOMAIN"
  require_var "ACME_EMAIL"

  case "${ACTION}" in
    deploy)
      deploy_hk
      ;;
    rollback)
      rollback_hk
      ;;
    *)
      echo "Usage: scripts/deploy-paper-hk.sh [deploy|rollback] [image-tag]" >&2
      exit 1
      ;;
  esac
}

main "$@"

# Code Review:
# - 香港侧部署脚本固定通过本机 `--resolve domain:443:127.0.0.1` 验证 HTTPS 网关，避免 DNS 延迟导致的假阴性。
# - smoke check 除了 `/health` 还验证 `/v1/search` 返回结构，可以更早发现反向代理到应用层的协议问题。
# - 发布与回滚共享同一 compose 文件和镜像 tag 变量，确保操作路径一致，降低人工回滚时的命令漂移风险。
