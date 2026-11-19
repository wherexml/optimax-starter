<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\AppOverview;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

/**
 * 控制台只读信息 server（LD-05 前置：laravel/mcp 能力加载）。
 * 仅经 Mcp::local 以 artisan stdio 方式供本地 AI 代理使用；
 * 不做 web 注册（HTTP 暴露需先设计 OAuth/会话边界，见 routes/ai.php 注释）。
 */
#[Name('console-info')]
#[Version('0.0.1')]
#[Instructions('OptiMax Starter 控制台只读概览：框架/运行时版本、模块清单、迁移数量。工具均为只读，不产生写操作。')]
final class ConsoleInfo extends Server
{
    protected array $tools = [
        AppOverview::class,
    ];

    protected array $resources = [
        //
    ];

    protected array $prompts = [
        //
    ];
}
