---
name: feishu-auth
description: Opt-in workflow to enable, configure, verify, or disable Feishu Enterprise OAuth 2.0 + PKCE login in OptiMax Starter and derived projects. Default is disabled; apply ONLY when the user explicitly requests Feishu login, /feishu-auth, SSO coexistence, or Feishu-only login.
---

# 飞书企业登录按需接入（`feishu-auth`）

`optimax-starter` 默认关闭飞书登录（`AUTH_FEISHU_ENABLED=false`、`AUTH_PASSWORD_LOGIN_ENABLED=true`），登录页零展示、零多余请求。**仅当用户明确要求开启、切换或排查飞书登录时使用本技能；默认新建项目不主动开启。**

## 1. 先检查当前状态与回调地址

在项目根目录执行（只读，不打印密钥内容）：

```sh
node .agents/skills/feishu-auth/scripts/configure-feishu-auth.mjs --status
```

记录返回的 `callbackUrl`（默认为 `${CORS_ORIGIN}/console/auth/sso/feishu/callback`）。

## 2. 飞书开放平台应用准备（需告知管理员确认）

在飞书开放平台对应的**企业自建应用**完成以下配置：
1. **安全设置 → 重定向 URL**：添加上一步输出的完整 `callbackUrl`（本地调试如 `http://127.0.0.1:<WEB_PORT>/console/auth/sso/feishu/callback`，线上如 `https://your-domain/console/auth/sso/feishu/callback`）。
2. **权限管理**：确认已开通获取用户基础身份的网页应用身份权限（授权码 `authen/v2/oauth/token` 与 `authen/v1/user_info`）。
3. **版本管理与发布**：配置批准的使用人员或部门可用范围，并发布应用版本。
4. **凭据收集**：获取 `App ID`、`App Secret` 和企业 `tenant_key`。
   - **密钥安全红线**：`App Secret` 写入项目下被 Git 忽略的私有文件（如 `.local/feishu-app-secret`，权限 `0600`）或宿主机独立密钥路径，绝不写入仓库、前端或日志。

## 3. 确认两种业务策略并开启

开启前与用户确认两项组合（未说明时默认采用保守模式：并存 + 仅绑定已有账户）：

| 维度 | 选项 A（默认保守） | 选项 B（对齐 `optimax-demo` 内部全员模式） |
| --- | --- | --- |
| 登录页形态 | 账号密码 + 下方「使用飞书登录」并存 | 仅飞书登录（隐藏密码表单，后端禁用 `POST /console/login`）：加 `--feishu-only` |
| 账户映射策略 | 仅匹配已绑定 `open_id` 或已有企业邮箱账户，未建号拒绝 | 同企业租户首次登录自动创建 `member` 成员并绑定 `open_id`：加 `--auto-provision` |

执行配置脚本（密钥经临时环境变量传入并立即落盘至 `0600` 私有文件，避免出现在 `.env` 或 shell 参数中）：

```sh
# 1. 创建私有目录并存入密钥（示例路径已在 .gitignore 中忽略）
mkdir -p .local && chmod 700 .local
# 让用户或安全的本机流程写入 .local/feishu-app-secret 并 chmod 600 .local/feishu-app-secret

# 2. 按选定组合更新 .env
node .agents/skills/feishu-auth/scripts/configure-feishu-auth.mjs \
  --enable \
  --app-id "<APP_ID>" \
  --tenant-key "<TENANT_KEY>" \
  --secret-file ".local/feishu-app-secret"
# 若需同企业自动建普通成员账号，追加: --auto-provision
# 若需纯飞书登录（隐藏密码框，对齐 Demo 平台），追加: --feishu-only
```

### Docker Compose 运行时的密钥挂载

`compose.yaml` 与 `compose.prod.yaml` 仅透传 `AUTH_FEISHU_APP_SECRET_FILE`，不直接传明文密钥环境。若服务端跑在 Docker 容器内，请使用私有 `compose.feishu.yaml` 覆盖文件（不入库）将宿主机 `.local/feishu-app-secret` 挂载为 `/run/secrets/feishu_app_secret`，并在 `.env` 设置 `AUTH_FEISHU_APP_SECRET_FILE=/run/secrets/feishu_app_secret`：

```yaml
services:
  api:
    volumes:
      - ./.local/feishu-app-secret:/run/secrets/feishu_app_secret:ro
```

## 4. 验收清单

1. 重启后端服务 / `docker compose up -d api` 使新环境生效。
2. 验证发现接口：`curl -fsS http://127.0.0.1:<WEB_PORT>/console/auth/providers` 返回含 `"id":"feishu","icon":"feishu","label":"使用飞书登录"`（纯飞书模式额外带 `"passwordLoginDisabled":true`）。
3. 浏览器打开 `/login`，确认飞书按钮左侧正常渲染飞书官方三色矢量 Logo（纯飞书模式不展示用户名密码框，且 `POST /console/login` 返回 `403 AUTH_PASSWORD_DISABLED`）。
4. 使用企业内已授权账号完成真实飞书授权跳转、回调与退出登录，并在 `/audit` 确认 `auth.sso_login` 记录；确认其他租户账号被拒绝并跳转 `?sso_error=tenant_forbidden`。

## 5. 一键关闭并回退默认状态

```sh
node .agents/skills/feishu-auth/scripts/configure-feishu-auth.mjs --disable
```

执行后 `.env` 恢复 `AUTH_FEISHU_ENABLED=false` 与 `AUTH_PASSWORD_LOGIN_ENABLED=true`，登录页回到纯账号密码模式。
