<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// /console 前缀与现有 Hono 栈一致；会话认证与权限中间件在 LB-05 落地，
// JSON Schema 请求校验基类在 LB-03 落地（LARAVEL.md 模块标准开发流程）。
Route::prefix('console')->group(function (): void {
    Route::get('/ping', fn () => response()->json(['ok' => true]));

    // 系统探针语义对齐现有栈：数据库连通与延迟；compose 健康检查入口（LB-02）。
    Route::get('/health', function () {
        $started = microtime(true);
        try {
            DB::select('select 1');
        } catch (Throwable) {
            return response()->json(['ok' => false, 'db' => 'unreachable'], 503);
        }

        return response()->json([
            'ok' => true,
            'db' => 'ok',
            'dbLatencyMs' => (int) round((microtime(true) - $started) * 1000),
        ]);
    });
});
