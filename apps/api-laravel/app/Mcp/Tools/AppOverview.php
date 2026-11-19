<?php

namespace App\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * 只读应用概览（LD-05 前置：laravel/mcp 能力加载）。
 * 输出框架/运行时版本与模块清单等非敏感事实；不触碰数据库与密钥。
 */
#[Description('返回 Laravel 应用概览：框架/PHP 版本、环境、业务模块与迁移数量。只读，无输入参数。')]
#[IsReadOnly]
final class AppOverview extends Tool
{
    public function handle(Request $request): Response
    {
        $modules = collect(glob(base_path('app/Modules/*'), GLOB_ONLYDIR) ?: [])
            ->map(fn (string $dir): string => basename($dir))
            ->values()
            ->all();

        return Response::json([
            'laravel' => app()->version(),
            'php' => PHP_VERSION,
            'env' => (string) config('app.env'),
            'modules' => $modules,
            'migrations' => count(glob(base_path('database/migrations/*.php')) ?: []),
        ]);
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [];
    }
}
