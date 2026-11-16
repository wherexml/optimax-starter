FROM oven/bun:1.3.14 AS bun
FROM node:24.10.0-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# 依赖层：仅拷贝 workspace 清单、锁文件与环境 schema，源码修改不击穿缓存
COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/web/package.json apps/web/bunfig.toml apps/web/.env.schema apps/web/
COPY apps/server/package.json apps/server/bunfig.toml apps/server/.env.schema apps/server/
COPY packages/api/package.json packages/api/
COPY packages/config/package.json packages/config/tsconfig.base.json packages/config/
COPY packages/db/package.json packages/db/.env.schema packages/db/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile

# 源码层：复制源码并确保生成 varlock 类型文件
COPY . .
RUN bun run env:generate
