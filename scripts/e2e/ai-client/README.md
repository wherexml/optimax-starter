# 模型客户端 E2E

从仓库根目录运行，需 Docker / Compose、Python 3 和 OpenSSL：

```sh
python3 scripts/e2e/ai-client/run.py --keep
```

脚本启动独立项目 `optimax-starter-aie2e`，使用自己的数据库卷、Cookie 和临时测试凭证，不读取现有 `.env`。页面 `http://127.0.0.1:38460/assets`，API `38461`，供应商模拟器 `38462`，测试 TLS `38463`。测试网络中的 `api.openai.com` 别名仅指向模拟器，配合一次性 CA 验证官方主机默认 token 字段和 TLS 校验；不访问真实 OpenAI。

测试通过实际 HTTP 调用 Starter、PostgreSQL 和供应商模拟器，覆盖配置、token 字段修正/缓存/上限、三类错误格式与脱敏、重试时间、取消、并发/FIFO/队列上限/超时及用户限额。它不代表真实模型的自然语言理解能力验收。默认完整运行；`--only token,errors,queue` 可选组，源码或 schema 改动后应重建镜像，不能加 `--skip-build` 继续使用旧代码。

结果：`evidence/ai-client-port/runs/<UTC>/results.json`、`fixture-trace.json` 与脱敏日志。测试会退出自己创建的 Session。`--keep` 保留隔离栈和私有测试凭证，便于浏览器验收；这些凭证仅适用于本次模拟器和独立数据库，不得用于真实服务。

## 浏览器

使用 ego-browser，在当前任务持有的 TaskSpace 内执行：

```js
const task = await taskSpace(实际空间ID);
const { verifyAiClientBrowser } = await import('/Users/steve/Projects/00-optimax/optimax-starter/scripts/e2e/ai-client/browser.mjs');
console.log(await verifyAiClientBrowser(task, {
  evidenceDir: '/Users/steve/Projects/00-optimax/optimax-starter/evidence/ai-client-port/browser',
}));
```

浏览器脚本仅从隔离栈的私有 runtime 文件读取自动生成的测试登录信息；不打印 Cookie 或密码。覆盖真实页面筛选、URL、数据库行数、工具结果回传、刷新、上游认证失败保持登录、停止取消和窄屏，保存截图及对应 URL；失败也保存结果。供应商是明确标记的脚本模拟器。

## 清理

```sh
python3 scripts/e2e/ai-client/run.py --cleanup
```

仅移除本测试项目的容器、卷和临时测试凭证；保留验收 JSON、截图与脱敏日志，不操作 `optimax-starter-preview`。
