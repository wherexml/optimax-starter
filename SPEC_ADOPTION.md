# 团队规范采用与偏差

本机基线为 optimax-team/spec 的 spec-2026.10.23-4，来源 aec8c890a244414d3f25546a202ffd1fd2c0ecff。采用 RiskOps 导航和登录布局、EASM 表格。管理 API 使用同源 Hono HTTP、数据库会话及两级角色。只提供本地 Docker 开发配置。

> 初始化、升级团队规范或核对规则冲突时读取；日常业务修改无需加载历史记录。

### 规范基线与偏差记录

> 记录本项目采用的团队规范版本，以及所有有意偏离团队规范的做法。初始化与复制清单见[团队使用指南](https://github.com/wherexml/optimax-team/blob/main/spec/README.md#3-初始化流程)；基线标识见[团队变更记录](https://github.com/wherexml/optimax-team/blob/main/spec/CHANGELOG.md)；升级按[安全升级流程](https://github.com/wherexml/optimax-team/blob/main/spec/README.md#8-版本基线安全升级与后续维护)逐条合并，不整文件覆盖。这些文件只在团队仓库维护，不复制到业务项目。

采用记录：

| 项 | 内容 |
| --- | --- |
| 基线标识 | <!-- 例如 spec-2026.10.23-4；早期复制写「未版本化（早于 spec-2026.10.16）」 --> |
| 来源仓库 | https://github.com/wherexml/optimax-team；历史原文使用下行 SHA 替换链接中的 main |
| 来源修订 | <!-- optimax-team 中包含该版 spec/ 的 commit SHA；未知写「未知」 --> |
| 采用/最近升级日期 | <!-- YYYY-MM-DD --> |
| 核对日期与证据 | <!-- YYYY-MM-DD；核对了哪些文件、命令、页面或 workflow --> |
| 指令正文位置 | <!-- AGENTS.md（CLAUDE.md 为固定提示 / 导入 / 符号链接）或 CLAUDE.md（AGENTS.md 为符号链接） --> |
| 负责人 | <!-- 补充 --> |

偏差记录：

| 规范条款（文件 §） | 项目实际做法 | 理由 | 证据 | 负责人 | 复查触发条件 |
| --- | --- | --- | --- | --- | --- |
| <!-- 例如 FRONTEND.md §1 参考栈 --> | <!-- 补充 --> | <!-- 补充 --> | <!-- 文件路径 / 命令 / 链接 --> | <!-- 补充 --> | <!-- 基线升级 / 技术栈变更 / 进入生产 / 指定日期 --> |

规则：

- 偏差必须有理由、证据、负责人和复查触发条件；没有记录的不一致视为待修正问题，不视为偏差。
- AGENTS.md 的核心约束不能通过偏差记录取消。
- 触发条件发生时复查偏差：保留、调整或取消，并更新核对日期。
