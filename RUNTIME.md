# API 运行时恢复记录

## 现象

- 预览环境中，API 运行在 Bun 1.3.14（Linux arm64）。此前开启 JIT 时出现过两次段错误；设置 `BUN_JSC_useJIT=false` 后，运行约 25 分钟仍然段错误退出。
- API 退出后，Vite 代理对 `/console/me` 返回空响应体的 502。旧版 `request()` 直接调用 `res.json()`，抛出 “Unexpected end of JSON input”，外壳页面只显示这行英文错误，没有重试入口。
- API 当时是临时重启恢复的。重启只能恢复服务，不能证明问题已解决。

## 根因判断（有限）

- 可以确认：段错误发生在 Bun 进程内，关闭 JIT 不能避免。
- 尚未确认：Bun 内部触发段错误的具体原因（没有 core dump 或符号化堆栈）。所以这里只是更换运行时来规避，并不是修复了 Bun。

## 处理

1. 常驻 API 改由 Node 24 运行：`node --import tsx apps/server/src/node.ts`，使用 `@hono/node-server`，监听 `0.0.0.0:${PORT:-38141}`，收到 SIGTERM/SIGINT 时正常关闭（最多等待 10 秒）。
2. `Bun.password` 改为 `apps/server/src/password.ts`（`@node-rs/argon2`，argon2id，m=65536，t=2，p=1，输出 32 字节）。哈希格式与 Bun 相同，已有哈希无需重置；格式错误的哈希一律校验失败。
3. compose：Bun 只负责短时的 `db:push`；api 服务加了 `restart: unless-stopped`，以及请求 `/` 并要求返回 `OK` 的健康检查。原来关闭 JIT 的 override 已移除。
4. 前端：`request()` 能处理网络错误、空响应和非 JSON 的 502/503，给出有长度上限的中文提示；401 仍然跳转登录页。外壳在启动失败时显示“服务暂时不可用”和“重试”按钮，不会自动轮询。

## 限制

- web 容器仍然通过 `bun run dev` 启动 Vite，`db:push` 也仍然用 Bun，这两处都需要继续观察。
- `restart: unless-stopped` 只在进程退出时重启。普通 compose 不会因为健康检查失败而自动重启，健康状态只能用于观察。
- 用 tsx 在运行时转译 TypeScript 是预览环境的做法；生产部署应先构建再运行。
- `@node-rs/argon2` 的 `Algorithm` 是 const enum，代码里使用它的字面值 2（即 Argon2id）。
- `apps/server/src/index.ts` 使用顶层 await，需要 server 包以 ESM 方式运行；如果 Node 启动报模块格式错误，先检查这一点。

## E2E 计划（尚未执行）

1. 执行 `docker compose up -d --build`，确认 api 的健康状态变为 healthy，容器进程是 node 而不是 bun。
2. 使用已有演示账户登录（验证旧的 Bun 哈希仍可通过），再创建临时测试账户，修改该账户密码并重新登录（验证新哈希可用；禁止修改默认演示密码）。
3. 并发访问工作台、资产、账户和日志页面，持续 30 分钟以上，观察有没有退出或重启（`docker compose ps`、`docker inspect` 中的 RestartCount）。
4. 停止 api 后刷新页面：应显示“服务暂时不可用”和“重试”，而不是 JSON 解析错误；恢复 api 后点“重试”，页面应能进入。
5. `docker compose stop api` 时应在 10 秒内正常退出，日志中有 SIGTERM 记录。

## 本次实际验收（2026-11-05）

- PASS：Docker 重建，Node API 启动并通过健康检查，配置 unless-stopped。
- PASS：server TypeScript 检查；web 在自身容器内类型检查及 Vite 构建。根级检查在 api 容器内因缺少 web 的 VITE_SERVER_URL 失败，已在 web 容器使用其正确环境单独通过。
- PASS：旧演示账号登录；临时账户改密、旧密码失效、新密码登录、全部会话撤销及权限边界。测试账户已清理，演示密码未修改。
- PASS：8 路并发 1,200 次鉴权请求全部返回有效 JSON（约 0.9 秒）；不等于长时稳定性测试。
- PASS：真实浏览器停服显示中文错误；恢复后点击重试返回资产表格，无需刷新。第一次分轮操作因窗口聚焦自动重新请求已先恢复，随后在同轮停服恢复明确点击重试再次通过。
- NOT_RUN：30 分钟以上 soak 测试；不声称长期稳定性已经证实。
- 证据：`evidence/runtime-recovery/`；HTTP 重跑：`python3 scripts/verify-runtime-load.py`；密码流程：`python3 scripts/verify-easm-settings.py`，完成后 `python3 scripts/verify-easm-settings.py --cleanup`。
