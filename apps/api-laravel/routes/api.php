<?php

use Illuminate\Support\Facades\Route;

// /console 前缀与现有 Hono 栈一致；会话认证与权限中间件在 LB-05 落地，
// JSON Schema 请求校验基类在 LB-03 落地（LARAVEL.md 模块标准开发流程）。
Route::prefix('console')->group(function (): void {
    Route::get('/ping', fn () => response()->json(['ok' => true]));
});
