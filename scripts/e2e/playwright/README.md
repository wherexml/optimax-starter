# Playwright 浏览器 E2E

可复跑的浏览器自动化流程（Playwright + Chromium），对本地 compose 栈做全功能全流程验证，每个关键动作整页截图留证。

## 命令

```sh
bun run test:e2e:pw                    # 全量（12 用例，约 25s）
bunx playwright test -c scripts/e2e/playwright/playwright.config.ts -g "全功能"
E2E_BASE_URL=http://127.0.0.1:38141 bun run test:e2e:pw   # 指向其它栈（双栈对拍用）
```

前置：本地栈已启动（`./scripts/init-local.sh && docker compose up -d`）；演示管理员密码只从本地 `.env` 读取，不写入源码与证据。

## 覆盖范围

| 套件 | 场景 |
| --- | --- |
| `login.spec.ts` | 品牌与表单结构；空提交契约校验（请输入账户名/密码）；错误密码行内报错（账户或密码错误）；正确凭证进入工作台 |
| `auth-guard.spec.ts` | 未认证访问 `/`、`/assets`、`/accounts`、`/audit` 重定向登录页 |
| `full-journey.spec.ts` | 全流程串行旅程：工作台统计 → 资产新增/动态筛选定位/编辑/删除/清空筛选 → 账户新增/筛选定位/编辑改角色（确认弹窗）/重置密码/停用再启用（确认弹窗）/下线入口 → 权限矩阵切换-保存-恢复默认（双击确认） → 系统配置时区保存与还原、运行控制探针 → 操作日志列表与筛选字段 → 个人设置资料保存 → 登出（确认弹窗） |
| `navigation.spec.ts` | 侧栏折叠/展开；快速导航 ⌘K 打开/过滤/Enter 跳转/Esc 关闭；375px 移动端抽屉 |

## 明确不覆盖（附原因）

- **AI 自然语言筛选**：`/assets/agent` 需要真实模型端点，本地默认关闭；启用后按同套件方式补测。
- **修改密码**：避免中途变更演示管理员密码破坏后续登录与其它 E2E。
- **`/demo/*` 演示页**：受 `VITE_ENABLE_DEMOS` 控制的演示模块，不属于核心功能验收。
- **对象存储上传**：功能尚不存在（Laravel 迁移 LD-02 才引入）。

## 证据

- 每次运行：`evidence/playwright/run-<时间戳>/`（逐步整页截图 + `manifest.json` 记录步骤名、页面 URL、文件路径），`evidence/` 不入库。
- HTML 报告：`evidence/playwright/report/`；失败 trace：`evidence/playwright-artifacts/<用例>/trace.zip`（`bunx playwright show-trace <zip>`）。

## 编写约定

- 断言依据真实 accessible name（角色/名称），不使用易碎的 CSS 路径；选择器经调试跑的页面快照核对。
- 用例必须幂等可重复：业务值带时间戳保持唯一；权限类断言先读当前状态再操作；筛选条件用「清空筛选」收尾。
- toast 断言收紧到具体文案（如「系统权限已保存」），避免被上一条残留 toast 误判通过。
- 新增页面或操作步骤时：先截图核对真实 DOM，再写进本目录测试并更新本 README 的覆盖表。
