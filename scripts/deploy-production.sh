#!/usr/bin/env bash
set -euo pipefail

# OptiMax Starter 生产部署与事务回滚入口（遵循 cicd-spec.md、DEPLOYMENT.md 与 duanju 事务状态原则）
# 准备阶段（precheck / backup / build）失败绝不触碰健康线上实例；
# 仅在本次事务已激活但健康/冒烟验收未通过，或显式执行 --rollback 时才执行镜像回切。
# 跨栈回滚（LD-03 栈切换边界）：--rollback 仅适用于同栈（Laravel 镜像）内的版本回退；
# 回到切换前的 node 单容器形态需先 checkout LD-03 之前的 compose.prod.yaml 与根
# Dockerfile.prod（git revert 本 spec 提交），再执行 --deploy <旧 SHA>；步骤见 DEPLOYMENT.md。

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT/.env.production}"
STATE_DIR="${DEPLOY_STATE_DIR:-$ROOT/.deploy-state}"
COMPOSE_CMD=(docker compose -f "$ROOT/compose.prod.yaml" --env-file "$ENV_FILE")

usage() {
  cat <<'EOF'
用法:
  ./scripts/deploy-production.sh --check
  ./scripts/deploy-production.sh --deploy <target-sha> [--deploy-id <id>]
  ./scripts/deploy-production.sh --rollback [<previous-sha>]
EOF
}

read_env_key() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
}

precheck() {
  for cmd in git docker curl python3; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "缺少必需命令: $cmd" >&2; exit 1; }
  done
  [[ -f "$ENV_FILE" ]] || { echo "缺少私有生产配置: $ENV_FILE" >&2; exit 1; }

  local db_pw cors cookie seed admin_pw app_key app_url node_api_url disk
  db_pw="$(read_env_key STARTER_DB_PASSWORD)"
  cors="$(read_env_key CORS_ORIGIN)"
  cookie="$(read_env_key SESSION_COOKIE_NAME)"
  seed="$(read_env_key STARTER_SEED_DEMO)"
  admin_pw="$(read_env_key STARTER_ADMIN_PASSWORD)"
  app_key="$(read_env_key APP_KEY)"
  app_url="$(read_env_key APP_URL)"
  node_api_url="$(read_env_key STARTER_NODE_API_URL)"
  disk="$(read_env_key ATTACHMENT_DISK)"

  [[ -n "$db_pw" && "${#db_pw}" -ge 16 ]] || { echo "预检拒绝: STARTER_DB_PASSWORD 未设置或长度不足 16 位" >&2; exit 1; }
  [[ "$cors" =~ ^https?:// ]] || { echo "预检拒绝: CORS_ORIGIN 格式无效" >&2; exit 1; }
  [[ -n "$cookie" && "$cookie" != "optimax_console" ]] || { echo "预检拒绝: 生产环境必须设置项目专属 SESSION_COOKIE_NAME" >&2; exit 1; }
  [[ "$seed" != "true" ]] || { echo "预检拒绝: 生产环境禁止启用 STARTER_SEED_DEMO=true" >&2; exit 1; }
  [[ "$admin_pw" != "demo@2026!" ]] || { echo "预检拒绝: 生产环境禁止使用本地演示密码" >&2; exit 1; }

  # PHP 栈（LD-03）：env 完整性。
  [[ -n "$app_key" && "$app_key" == base64:* ]] || { echo "预检拒绝: 生产环境必须设置 APP_KEY（base64: 前缀；php artisan key:generate --show 生成）" >&2; exit 1; }
  [[ "$app_url" =~ ^https?:// ]] || { echo "预检拒绝: APP_URL 格式无效（附件签名 URL 基址）" >&2; exit 1; }
  if [[ -n "$node_api_url" ]]; then
    [[ "$node_api_url" =~ ^https?:// ]] || { echo "预检拒绝: STARTER_NODE_API_URL 格式无效" >&2; exit 1; }
  fi
  case "$disk" in ""|local|s3) ;; *) echo "预检拒绝: ATTACHMENT_DISK 仅支持 local/s3" >&2; exit 1 ;; esac
  if [[ "$disk" == "s3" ]]; then
    for key in ATTACHMENT_S3_KEY ATTACHMENT_S3_SECRET ATTACHMENT_S3_BUCKET ATTACHMENT_S3_ENDPOINT; do
      [[ -n "$(read_env_key "$key")" ]] || { echo "预检拒绝: ATTACHMENT_DISK=s3 需要设置 $key" >&2; exit 1; }
    done
  fi

  # 产物门禁（LD-03）：契约 JSON Schema 产物已生成并提交（镜像内置分发，不挂载宿主目录）。
  [[ -n "$(find packages/api/json-schema -name '*.json' -print -quit 2>/dev/null)" ]] || { echo "预检拒绝: 契约产物缺失（先 bun run contracts:generate 并提交）" >&2; exit 1; }
  [[ -z "$(git status --porcelain -- packages/api/json-schema)" ]] || { echo "预检拒绝: 契约产物存在未提交漂移（先重新生成并提交）" >&2; exit 1; }
  # D2 零迁移门禁（LD-03）：Laravel 侧不得出现迁移文件（schema 权威在 Drizzle；移交决策在 LD-04）。
  [[ -z "$(find apps/api-laravel/database/migrations -name '*.php' -print -quit 2>/dev/null)" ]] || { echo "预检拒绝: apps/api-laravel/database/migrations 出现迁移文件（违背 D2 零迁移）" >&2; exit 1; }

  "${COMPOSE_CMD[@]}" config --quiet
  echo "PASS precheck (env redacted, compose.prod.yaml valid)"
}

smoke_check() {
  local port
  port="$(read_env_key PROD_PORT)"
  port="${port:-38140}"
  local base="http://127.0.0.1:${port}"
  for _ in $(seq 1 30); do
    if curl -fsS "${base}/healthz" >/dev/null 2>&1; then
      curl -fsS "${base}/console/auth/providers" >/dev/null
      local code
      code="$(curl -s -o /dev/null -w '%{http_code}' "${base}/console/me")"
      [[ "$code" == "401" ]] || { echo "冒烟失败: 匿名 /console/me 返回 $code (预期 401)" >&2; return 1; }
      local html
      html="$(curl -fsS "${base}/login")"
      [[ "$html" == *"<div id=\"app\">"* || "$html" == *"<html"* ]] || { echo "冒烟失败: /login 未返回前端入口 HTML" >&2; return 1; }
      echo "PASS smoke_check (${base}/healthz, /console/me=401, /login SPA)"
      return 0
    fi
    sleep 2
  done
  echo "健康检查超时: ${base}/healthz" >&2
  return 1
}

backup_db() {
  mkdir -p "$STATE_DIR/backups"
  umask 077
  if "${COMPOSE_CMD[@]}" ps --status running db 2>/dev/null | grep -q db; then
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    local dump="$STATE_DIR/backups/db-${stamp}.sql.gz"
    "${COMPOSE_CMD[@]}" exec -T db pg_dump -U starter -d starter | gzip -c > "$dump"
    [[ -s "$dump" ]] || { echo "数据库备份为空: $dump" >&2; exit 1; }
    echo "PASS backup_db: $dump"
  else
    echo "INFO backup_db: 首次部署，db 尚未运行，跳过在线备份"
  fi
}

deploy_sha() {
  local target_sha="$1"
  local deploy_id="${2:-manual-$(date -u +%s)}"
  [[ "$target_sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "非法 target SHA: $target_sha" >&2; exit 1; }

  precheck
  mkdir -p "$STATE_DIR"
  local prev_sha=""
  [[ -f "$STATE_DIR/accepted-sha" ]] && prev_sha="$(cat "$STATE_DIR/accepted-sha")"
  local proj
  proj="$(read_env_key STARTER_PROD_PROJECT)"
  proj="${proj:-optimax-starter-prod}"

  if [[ "$prev_sha" == "$target_sha" ]] && smoke_check >/dev/null 2>&1; then
    echo "PASS idempotent: 目标 SHA ($target_sha) 已在线且健康，跳过重复重建"
    return 0
  fi

  backup_db

  local candidate_img="${proj}:${target_sha}"
  echo "Building candidate image ${candidate_img} (app + migrate)..."
  STARTER_PROD_IMAGE="$candidate_img" "${COMPOSE_CMD[@]}" build app migrate

  # 激活前记录事务状态；只有越过此点发生失败才允许自动回滚。
  printf '%s\n' "$deploy_id" > "$STATE_DIR/active-deploy-id"
  printf '%s\n' "$prev_sha" > "$STATE_DIR/previous-sha"

  echo "Activating ${candidate_img}..."
  if STARTER_PROD_IMAGE="$candidate_img" "${COMPOSE_CMD[@]}" up -d && smoke_check; then
    printf '%s\n' "$target_sha" > "$STATE_DIR/accepted-sha"
    rm -f "$STATE_DIR/active-deploy-id"
    echo "PASS deployed and accepted SHA: ${target_sha}"
    return 0
  fi

  echo "ERROR 激活或冒烟失败，尝试回滚至上一已验收版本 (${prev_sha:-none})..." >&2
  if [[ -n "$prev_sha" ]]; then
    rollback_sha "$prev_sha"
  fi
  exit 1
}

rollback_sha() {
  local target="${1:-}"
  if [[ -z "$target" && -f "$STATE_DIR/previous-sha" ]]; then
    target="$(cat "$STATE_DIR/previous-sha")"
  fi
  [[ -n "$target" && "$target" =~ ^[0-9a-f]{7,40}$ ]] || { echo "无法确定有效的回滚目标 SHA" >&2; exit 1; }
  local proj
  proj="$(read_env_key STARTER_PROD_PROJECT)"
  proj="${proj:-optimax-starter-prod}"
  local rollback_img="${proj}:${target}"
  docker image inspect "$rollback_img" >/dev/null 2>&1 || { echo "本地不存在上一版本镜像: $rollback_img" >&2; exit 1; }

  STARTER_PROD_IMAGE="$rollback_img" "${COMPOSE_CMD[@]}" up -d --no-build
  smoke_check
  printf '%s\n' "$target" > "$STATE_DIR/accepted-sha"
  rm -f "$STATE_DIR/active-deploy-id"
  echo "PASS rolled back to accepted SHA: ${target}"
}

case "${1:-}" in
  --check)
    precheck
    ;;
  --deploy)
    SHA="${2:?--deploy 需要目标 SHA}"
    shift 2
    DEPLOY_ID=""
    if [[ "${1:-}" == "--deploy-id" ]]; then
      DEPLOY_ID="${2:?--deploy-id 需要值}"
    fi
    deploy_sha "$SHA" "$DEPLOY_ID"
    ;;
  --rollback)
    rollback_sha "${2:-}"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
