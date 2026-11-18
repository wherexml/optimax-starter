<?php

use App\Core\Http\ConsoleResponse;
use App\Core\Http\Middleware\RequirePermission;
use App\Core\Http\Middleware\RequireSuperAdmin;
use App\Core\Http\Middleware\ResolveConsoleActor;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        // 与现有 Hono 栈同前缀（/console），前端零改动（LARAVEL.md D4）。
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        apiPrefix: '',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // 空串保留语义（LB-03/LC-05 实测修正）：Laravel 13 的 ConvertEmptyStringsToNull 在
        // 全局栈（仅从 api 组 remove 无效——浏览器空 email/company 被 null 化即此因）；
        // zod 把 "" 当字符串（如 optionalEmail 空串合法），TrimStrings 保留（对齐 .trim()）。
        $middleware->remove([ConvertEmptyStringsToNull::class]);

        $middleware->alias([
            'console.actor' => ResolveConsoleActor::class,
            'console.permission' => RequirePermission::class,
            'console.superadmin' => RequireSuperAdmin::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('console/*') || $request->is('api/*') || $request->expectsJson(),
        );

        // { error } 错误协议（LB-03）：对齐现有 Hono 栈的响应形状。
        // ValidationException → 400 + 首条文案；HttpException 用自身状态码；其余 500 通用文案。
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($e instanceof ValidationException) {
                $message = collect($e->errors())->flatten()->first();

                return ConsoleResponse::json(['error' => $message ?? '请求参数无效'], 400);
            }

            $status = $e instanceof HttpException ? $e->getStatusCode() : 500;
            $message = match (true) {
                $status >= 500 => '服务内部错误',
                $status === 404 => '请求的资源不存在',
                $e instanceof HttpException && $e->getMessage() !== '' => $e->getMessage(),
                default => "请求失败（{$status}）",
            };

            return ConsoleResponse::json(['error' => $message], $status);
        });
    })->create();
