<?php

use App\Core\Http\Middleware\ResolveConsoleActor;
use App\Modules\Audit\AuditController;
use App\Modules\Auth\AuthController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

// /console 前缀与现有 Hono 栈一致。守卫中间件对齐 console.ts 挂载层：
// 所有非 GET（含 login）强校验 Origin 与 JSON；login/auth-providers 豁免会话；
// ping/health 为公开探针（compose 健康检查），不进守卫组。
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

    Route::middleware(ResolveConsoleActor::class)->group(function (): void {
        Route::post('/login', [AuthController::class, 'login']);
        Route::get('/auth/providers', fn () => response()->json([]));

        Route::get('/audit', AuditController::class.'@index')
            ->middleware('console.permission:audit:read');

        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);

        // LB-05 权限链路探针（LC-06 迁真实模块后移除）。
        // accounts:manage 默认仅 admin+：超管 200、member 403，覆盖权限矩阵链路。
        Route::get('/probe/accounts', fn (Request $request) => response()->json([
            'ok' => true,
            'actor' => $request->attributes->get('consoleActor')->username,
        ]))->middleware('console.permission:accounts:manage');
    });
});
