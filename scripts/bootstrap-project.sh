#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
用法:
  ./scripts/bootstrap-project.sh <project-slug> [--title "项目名称"] [--web-port 38150] [--no-demos] [--force]

功能:
  在首次 docker compose up 之前一键完成新项目派生初始化：
  1. 修改 package.json 的 name 与 compose.yaml 的项目名/镜像名（确保 Docker 数据卷独立隔离）
  2. 自动探测本机空闲的相邻三位端口 web/ai/laravel（默认从 38150 起扫描，步进 10）
  3. 生成隔离的 .env（独立 SESSION_COOKIE_NAME、随机数据库密码、端口与品牌配置）
     与 apps/api-laravel/.env（APP_KEY 随机生成；dev 形态经 override 挂载宿主目录，
     需要宿主 vendor——本机有 composer 时自动安装）
  4. 自动更新 bun.lock（优先使用本机 bun，未安装时调用 oven/bun:1.3.14 容器）
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -eq 0 ]]; then
  usage
  exit 0
fi

SLUG="$1"
shift
TITLE=""
WEB_PORT=""
ENABLE_DEMOS="true"
FORCE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --force)
      FORCE="true"
      shift
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

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
    for candidate in (port, port + 1, port + 2):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", candidate)) == 0:
                ok = False
                break
    if ok:
        print(port)
        raise SystemExit(0)
raise SystemExit("未在 38150-38990 范围内找到空闲的相邻三端口（web/ai/laravel），请通过 --web-port 指定")
PY
)"
fi

if [[ ! "$WEB_PORT" =~ ^[0-9]{4,5}$ ]] || (( WEB_PORT < 10000 || WEB_PORT > 65530 )); then
  echo "错误: --web-port 必须为 10000-65530 之间的五位端口，当前: $WEB_PORT" >&2
  exit 1
fi
API_PORT=$((WEB_PORT + 1))
LARAVEL_PORT=$((WEB_PORT + 2))

python3 - "$WEB_PORT" "$API_PORT" "$LARAVEL_PORT" <<'PY'
import socket, sys
for p in map(int, sys.argv[1:]):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", p)) == 0:
            raise SystemExit(f"错误: 本机端口 127.0.0.1:{p} 已被占用，请更换 --web-port")
PY

COOKIE_NAME="$(printf '%s_session' "${SLUG//-/_}")"

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
API_LARAVEL_PORT=${LARAVEL_PORT}
CORS_ORIGIN=http://127.0.0.1:${WEB_PORT}
VITE_SERVER_URL=http://127.0.0.1:${API_PORT}
SESSION_COOKIE_NAME=${COOKIE_NAME}
STARTER_SEED_DEMO=true
STARTER_ADMIN_USERNAME=${ADMIN_USER}
STARTER_ADMIN_PASSWORD=${ADMIN_PW}
STARTER_DB_PASSWORD=${DB_PW}
EOF

# Laravel 侧本地 .env（dev override 挂载宿主目录时生效；compose 注入的环境变量优先）。
# APP_KEY 用 openssl 生成 base64: 前缀（等价 php artisan key:generate --show）。
umask 077
if [[ ! -f apps/api-laravel/.env ]]; then
  sed -e "s|^APP_KEY=$|APP_KEY=base64:$(openssl rand 32 | base64 | tr -d '\n')|" \
      apps/api-laravel/.env.example > apps/api-laravel/.env
fi
# dev 形态经 compose.override 挂载宿主 apps/api-laravel（覆盖镜像内置 vendor），
# 本机有 composer 时先装好；没有则提示：CI 形态（-f compose.yaml，无 override）
# 使用镜像内置 vendor，不受影响。
if [[ ! -d apps/api-laravel/vendor ]]; then
  if command -v composer >/dev/null 2>&1; then
    (cd apps/api-laravel && composer install --no-interaction --no-progress)
  else
    echo "警告: 未检测到 composer——dev 形态（含 override）需要宿主 vendor；请安装后运行: (cd apps/api-laravel && composer install)。CI 形态（docker compose -f compose.yaml up）使用镜像内置 vendor，不受影响。" >&2
  fi
fi

if command -v bun >/dev/null 2>&1; then
  bun install --lockfile-only --ignore-scripts
elif [[ -x "${HOME}/.bun/bin/bun" ]]; then
  "${HOME}/.bun/bin/bun" install --lockfile-only --ignore-scripts
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$PWD:/app" -w /app oven/bun:1.3.14 \
    bun install --lockfile-only --ignore-scripts
else
  echo "警告: 未检测到 bun 或 docker，请稍后手动更新 bun.lock" >&2
fi

cat <<EOF
已完成项目初始化:
  项目标识: ${SLUG} (${TITLE})
  Compose : ${SLUG}-preview / ${SLUG}-preview:local
  前端入口: http://127.0.0.1:${WEB_PORT}/login
  AI 服务 : http://127.0.0.1:${API_PORT}/healthz（内部，/console 流量走 Laravel）
  Laravel : http://127.0.0.1:${LARAVEL_PORT}/console/health
  Cookie  : ${COOKIE_NAME}

下一步:
  docker compose config --quiet
  docker compose up -d --build
  python3 scripts/verify-console.py
EOF
