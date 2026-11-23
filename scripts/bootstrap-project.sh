#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEFAULT_STARTER_REPO="https://github.com/wherexml/optimax-starter.git"
BUN_IMAGE="oven/bun:1.3.14"
CI_DATABASE_URL="postgres://starter:ci@127.0.0.1:5432/starter"

usage() {
  cat <<'EOF'
用法:
  ./scripts/bootstrap-project.sh <project-slug> [选项]
  ./scripts/bootstrap-project.sh --local-env

选项:
  --title "项目名称"      侧栏与登录页标题（默认由 slug 生成）
  --web-port <port>      Web 端口（API 为其 +1）；省略时从 38150 起自动扫描空闲相邻端口
  --no-demos             关闭 Demo 菜单（写入 VITE_ENABLE_DEMOS=false）
  --no-agent             移除 AI 智能助理（packages/agent、服务端 agent 模块与右侧助理面板），无需迁移
  --no-example           移除示例 assets 业务模块，并生成 remove_example_assets 迁移
  --starter-sha <sha>    写入 .starter-version 的上游基线提交（默认当前 HEAD）
  --starter-repo <url>   上游模板仓库（默认 STARTER_REPO 环境变量或
                         https://github.com/wherexml/optimax-starter.git）
  --dry-run              只校验并打印计划（改动、端口、Cookie、.starter-version），不改文件、不运行 bun
  --force                允许 slug 为 optimax-starter 或 origin 仍指向模板仓库
  --local-env            仅为本地预览补齐 .env 中的 STARTER_DB_PASSWORD / STARTER_ADMIN_PASSWORD
                         （无需 project-slug，不改项目文件；scripts/init-local.sh 即调用此模式）
  -h, --help             显示本帮助

功能（初始化模式）:
  在首次 docker compose up 之前一键完成新项目派生初始化：
  1. 修改 package.json 的 name 与 compose.yaml 的项目名/镜像名（确保 Docker 数据卷独立隔离）
  2. 自动探测本机空闲的相邻五位端口（默认从 38150/38151 起扫描）
  3. 写入 .starter-version 记录上游基线，并生成隔离的 .env（独立 SESSION_COOKIE_NAME、随机数据库密码、端口与品牌配置）
  4. 可选 --no-example 移除示例 assets 模块并生成对应迁移；可选 --no-agent 移除 AI 智能助理
  5. 自动更新 bun.lock（优先使用本机 bun，未安装时调用 oven/bun:1.3.14 容器）

建议在 GitHub Template 生成的首个提交上运行；先加 --dry-run 预览计划。
EOF
}

SLUG=""
TITLE=""
WEB_PORT=""
ENABLE_DEMOS="true"
STARTER_SHA=""
STARTER_REPO_ARG=""
FORCE="false"
DRY_RUN="false"
LOCAL_ENV="false"
NO_EXAMPLE="false"
NO_AGENT="false"

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --title)
      TITLE="${2:?--title 需要参数}"
      shift 2
      ;;
    --web-port)
      WEB_PORT="${2:?--web-port 需要参数}"
      shift 2
      ;;
    --no-demos)
      ENABLE_DEMOS="false"
      shift
      ;;
    --no-example)
      NO_EXAMPLE="true"
      shift
      ;;
    --no-agent)
      NO_AGENT="true"
      shift
      ;;
    --starter-sha)
      STARTER_SHA="${2:?--starter-sha 需要参数}"
      shift 2
      ;;
    --starter-repo)
      STARTER_REPO_ARG="${2:?--starter-repo 需要参数}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --force)
      FORCE="true"
      shift
      ;;
    --local-env)
      LOCAL_ENV="true"
      shift
      ;;
    -*)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$SLUG" ]]; then
        echo "错误: 只能指定一个 project-slug（已有 $SLUG，又收到 $1）" >&2
        exit 1
      fi
      SLUG="$1"
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# --local-env: local preview secrets only (former scripts/init-local.sh). Never touches project files.
# ---------------------------------------------------------------------------
if [[ "$LOCAL_ENV" == "true" ]]; then
  if [[ -n "$SLUG" ]]; then
    echo "错误: --local-env 不接受 project-slug；请先单独运行初始化，再运行 --local-env" >&2
    exit 1
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    for key in STARTER_DB_PASSWORD STARTER_ADMIN_PASSWORD; do
      if [[ -f .env ]] && grep -q "^${key}=" .env; then
        echo "[dry-run] .env 已有 ${key}，保持不变"
      else
        echo "[dry-run] 将向 .env 追加 ${key}（值不打印）"
      fi
    done
    exit 0
  fi
  umask 077
  touch .env
  if ! grep -q "^STARTER_DB_PASSWORD=" .env; then
    printf 'STARTER_DB_PASSWORD=%s\n' "${STARTER_DB_PASSWORD:-$(openssl rand -hex 16)}" >> .env
  fi
  if ! grep -q "^STARTER_ADMIN_PASSWORD=" .env; then
    printf 'STARTER_ADMIN_PASSWORD=%s\n' "${STARTER_ADMIN_PASSWORD:-demo@2026!}" >> .env
  fi
  exit 0
fi

if [[ -z "$SLUG" ]]; then
  echo "错误: 缺少 project-slug" >&2
  usage >&2
  exit 1
fi

if [[ ! "$SLUG" =~ ^[a-z][a-z0-9-]{1,39}$ ]]; then
  echo "错误: project-slug 必须以小写字母开头，仅含 a-z、0-9 和连字符（2-40 位），当前: $SLUG" >&2
  exit 1
fi

if [[ "$SLUG" == "optimax-starter" && "$FORCE" != "true" ]]; then
  echo "错误: 请使用新项目自己的名称（而非 optimax-starter）；确需重置模板本身请加 --force" >&2
  exit 1
fi

ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$ORIGIN_URL" == *"optimax-starter"* && "$FORCE" != "true" ]]; then
  echo "错误: 当前 git origin 仍指向模板仓库 ($ORIGIN_URL)。请先用 GitHub Template 创建新仓库，切勿直接向模板推送业务代码。" >&2
  exit 1
fi

if [[ -z "$TITLE" ]]; then
  TITLE="$(python3 -c 'import sys; print(" ".join(p.capitalize() for p in sys.argv[1].split("-")))' "$SLUG")"
fi

if [[ -z "$WEB_PORT" ]]; then
  WEB_PORT="$(python3 - <<'PY'
import socket
for port in range(38150, 38990, 10):
    ok = True
    for candidate in (port, port + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", candidate)) == 0:
                ok = False
                break
    if ok:
        print(port)
        raise SystemExit(0)
raise SystemExit("未在 38150-38990 范围内找到空闲相邻端口对，请通过 --web-port 指定")
PY
)"
fi

if [[ ! "$WEB_PORT" =~ ^[0-9]{4,5}$ ]] || (( WEB_PORT < 10000 || WEB_PORT > 65530 )); then
  echo "错误: --web-port 必须为 10000-65530 之间的五位端口，当前: $WEB_PORT" >&2
  exit 1
fi
API_PORT=$((WEB_PORT + 1))

python3 - "$WEB_PORT" "$API_PORT" <<'PY'
import socket, sys
for p in map(int, sys.argv[1:]):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", p)) == 0:
            raise SystemExit(f"错误: 本机端口 127.0.0.1:{p} 已被占用，请更换 --web-port")
PY

COOKIE_NAME="$(printf '%s_session' "${SLUG//-/_}")"
STARTER_COMMIT="${STARTER_SHA:-$(git rev-parse HEAD 2>/dev/null || echo "unknown")}"
STARTER_REPO="${STARTER_REPO_ARG:-${STARTER_REPO:-$DEFAULT_STARTER_REPO}}"

# Commit baseline: STARTER_COMMIT should be the template commit this project was created from.
if [[ -z "$STARTER_SHA" ]]; then
  COMMIT_COUNT="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
  if [[ "$COMMIT_COUNT" =~ ^[0-9]+$ ]] && (( COMMIT_COUNT > 1 )); then
    cat >&2 <<EOF

!!! 警告: 当前仓库已有 ${COMMIT_COUNT} 个提交，且未传 --starter-sha。
!!! STARTER_COMMIT 将默认记录为当前 HEAD (${STARTER_COMMIT})，它可能包含本项目自己的改动，
!!! 后续按 docs/UPGRADE.md 比对上游时会漏掉或错算差异。
!!! 建议: 在 GitHub Template 生成的首个提交上运行本脚本，或显式传入
!!!       --starter-sha <上游 optimax-starter 对应提交 SHA>。

EOF
  fi
fi

# Runs a Node ESM script with node, falling back to bun, then the bun container.
run_js() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
  elif command -v bun >/dev/null 2>&1; then
    bun "$@"
  elif [[ -x "${HOME}/.bun/bin/bun" ]]; then
    "${HOME}/.bun/bin/bun" "$@"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$PWD:/app" -w /app "$BUN_IMAGE" bun "$@"
  else
    echo "错误: 未检测到 node、bun 或 docker，无法执行 $1" >&2
    return 1
  fi
}

if [[ "$DRY_RUN" == "true" ]]; then
  cat <<EOF
[dry-run] 校验通过，以下为计划（未修改任何文件，未运行 bun）:

计划改动:
  ~ package.json            name -> ${SLUG}
  ~ compose.yaml            name -> ${SLUG}-preview，image -> ${SLUG}-preview:local
  ~ apps/web/index.html     <title> -> ${TITLE}
  + .starter-version
  + .env                    （覆盖写入；密码值不打印）
  ~ bun.lock                bun install --lockfile-only

端口:
  Web: http://127.0.0.1:${WEB_PORT}/login
  API: http://127.0.0.1:${API_PORT}/healthz
Cookie: ${COOKIE_NAME}
Demo 菜单: ${ENABLE_DEMOS}

.starter-version:
  STARTER_REPO=${STARTER_REPO}
  STARTER_COMMIT=${STARTER_COMMIT}
  STARTER_BOOTSTRAPPED_AT=<运行时 UTC 时间>
  STARTER_SLUG=${SLUG}
EOF
  if [[ "$NO_EXAMPLE" == "true" ]]; then
    echo ""
    echo "--no-example 计划:"
    run_js scripts/lib/strip-example.mjs --dry-run
    echo "  + packages/db/src/migrations/<timestamp>_remove_example_assets（drizzle-kit generate）"
  fi
  if [[ "$NO_AGENT" == "true" ]]; then
    echo ""
    echo "--no-agent 计划（助理不建表，无需迁移）:"
    run_js scripts/lib/strip-agent.mjs --dry-run
  fi
  exit 0
fi

python3 - "$SLUG" "$TITLE" <<'PY'
import html, json, pathlib, re, sys
slug, title = sys.argv[1], sys.argv[2]
pkg_path = pathlib.Path("package.json")
pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
pkg["name"] = slug
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

compose_path = pathlib.Path("compose.yaml")
text = compose_path.read_text(encoding="utf-8")
text = re.sub(r"^name:\s*\S+", f"name: {slug}-preview", text, count=1, flags=re.M)
text = re.sub(r"^(\s*image:\s*)\S+:local", rf"\g<1>{slug}-preview:local", text, count=1, flags=re.M)
compose_path.write_text(text, encoding="utf-8")

index_html = pathlib.Path("apps/web/index.html")
if index_html.exists():
    html_text = index_html.read_text(encoding="utf-8")
    html_text = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", html_text, count=1)
    index_html.write_text(html_text, encoding="utf-8")
PY

BOOTSTRAPPED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > .starter-version <<EOF
STARTER_REPO=${STARTER_REPO}
STARTER_COMMIT=${STARTER_COMMIT}
STARTER_BOOTSTRAPPED_AT=${BOOTSTRAPPED_AT}
STARTER_SLUG=${SLUG}
EOF

(
  umask 077
  DB_PW="${STARTER_DB_PASSWORD:-$(openssl rand -hex 16)}"
  ADMIN_USER="${STARTER_ADMIN_USERNAME:-demo@optimax.hk}"
  ADMIN_PW="${STARTER_ADMIN_PASSWORD:-demo@2026!}"

  cat > .env <<EOF
VITE_APP_SLUG=${SLUG}
VITE_APP_TITLE=${TITLE}
VITE_ENABLE_DEMOS=${ENABLE_DEMOS}
WEB_PORT=${WEB_PORT}
API_PORT=${API_PORT}
CORS_ORIGIN=http://127.0.0.1:${WEB_PORT}
VITE_SERVER_URL=http://127.0.0.1:${API_PORT}
API_PROXY_TARGET=http://api:${API_PORT}
SESSION_COOKIE_NAME=${COOKIE_NAME}
STARTER_SEED_DEMO=true
STARTER_ADMIN_USERNAME=${ADMIN_USER}
STARTER_ADMIN_PASSWORD=${ADMIN_PW}
STARTER_DB_PASSWORD=${DB_PW}
EOF
)

AGENT_NOTE="保留 AI 智能助理"
if [[ "$NO_AGENT" == "true" ]]; then
  # No tables are owned by the assistant, so no migration is generated.
  run_js scripts/lib/strip-agent.mjs
  AGENT_NOTE="已移除 AI 智能助理（无需数据库迁移）"
fi

EXAMPLE_NOTE="保留示例 assets 模块"
if [[ "$NO_EXAMPLE" == "true" ]]; then
  run_js scripts/lib/strip-example.mjs
  EXAMPLE_NOTE="已移除示例 assets 模块"
  GEN_CMD="bun install --ignore-scripts && cd packages/db && bunx drizzle-kit generate --name remove_example_assets"
  if command -v bun >/dev/null 2>&1 || [[ -x "${HOME}/.bun/bin/bun" ]]; then
    BUN_BIN="$(command -v bun || echo "${HOME}/.bun/bin/bun")"
    if [[ ! -d node_modules ]]; then
      "$BUN_BIN" install --ignore-scripts
    fi
    (cd packages/db && DATABASE_URL="$CI_DATABASE_URL" "$BUN_BIN" x drizzle-kit generate --name remove_example_assets)
    EXAMPLE_NOTE="${EXAMPLE_NOTE}，已生成 remove_example_assets 迁移"
  elif command -v docker >/dev/null 2>&1; then
    # Anonymous volume keeps the container's Linux node_modules out of the host checkout.
    docker run --rm -v "$PWD:/app" -v /app/node_modules -w /app \
      -e DATABASE_URL="$CI_DATABASE_URL" "$BUN_IMAGE" sh -c "$GEN_CMD"
    EXAMPLE_NOTE="${EXAMPLE_NOTE}，已生成 remove_example_assets 迁移"
  else
    cat >&2 <<EOF
!!! 警告: 未检测到 bun 或 docker，未生成移除 console_asset 表的迁移。
!!! 安装 bun 后请执行:
!!!   bun install && cd packages/db && DATABASE_URL=${CI_DATABASE_URL} bunx drizzle-kit generate --name remove_example_assets
!!! 否则 bun run db:check 会失败。
EOF
    EXAMPLE_NOTE="${EXAMPLE_NOTE}（迁移未生成，见上方警告）"
  fi
fi

if command -v bun >/dev/null 2>&1; then
  bun install --lockfile-only --ignore-scripts
elif [[ -x "${HOME}/.bun/bin/bun" ]]; then
  "${HOME}/.bun/bin/bun" install --lockfile-only --ignore-scripts
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$PWD:/app" -w /app "$BUN_IMAGE" \
    bun install --lockfile-only --ignore-scripts
else
  echo "警告: 未检测到 bun 或 docker，请稍后手动更新 bun.lock" >&2
fi

cat <<EOF
已完成项目初始化:
  项目标识: ${SLUG} (${TITLE})
  Compose : ${SLUG}-preview / ${SLUG}-preview:local
  基线版本: ${STARTER_COMMIT}（已写入 .starter-version，升级指引见 docs/UPGRADE.md）
  上游仓库: ${STARTER_REPO}
  前端入口: http://127.0.0.1:${WEB_PORT}/login
  API 入口: http://127.0.0.1:${API_PORT}/healthz
  Cookie  : ${COOKIE_NAME}
  示例模块: ${EXAMPLE_NOTE}
  智能助理: ${AGENT_NOTE}

下一步:
  bun run doctor
  docker compose config --quiet
  docker compose up -d --build
  python3 scripts/verify-console.py
EOF
