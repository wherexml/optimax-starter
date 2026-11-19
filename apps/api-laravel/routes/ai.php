<?php

use App\Mcp\Servers\ConsoleInfo;
use Laravel\Mcp\Facades\Mcp;

// MCP 注册（laravel/mcp，LD-05 前置加载）。
// 仅本地注册：artisan stdio（`php artisan mcp:serve console-info`）供本地 AI 代理只读使用。
// 不做 web 注册——HTTP 暴露需先设计 OAuth/会话边界（D4 同源 JSON 边界之外的新面），
// 设计完成前禁止 Mcp::web。
Mcp::local('console-info', ConsoleInfo::class);
