<?php

use App\Core\Http\Middleware\ResolveConsoleActor;
use App\Modules\Accounts\AccountsController;
use App\Modules\Assets\AssetAgentController;
use App\Modules\Assets\AssetsController;
use App\Modules\Audit\AuditController;
use App\Modules\Auth\AuthController;
use App\Modules\System\SystemController;
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

        // 操作日志（LC-01）。
        Route::get('/audit', AuditController::class.'@index')
            ->middleware('console.permission:audit:read');

        // 系统配置（LC-03/04）：路由对齐 modules/system.ts。
        Route::get('/system/status', [SystemController::class, 'status'])
            ->middleware('console.permission:system:settings:read');
        Route::get('/system/settings', [SystemController::class, 'settings'])
            ->middleware('console.permission:system:settings:read');
        Route::put('/system/settings', [SystemController::class, 'updateSettings'])
            ->middleware('console.permission:system:settings:manage');
        Route::get('/system/permissions', [SystemController::class, 'permissions'])
            ->middleware(['console.superadmin', 'console.permission:system:permission:read']);
        Route::put('/system/permissions', [SystemController::class, 'updatePermissions'])
            ->middleware(['console.superadmin', 'console.permission:system:permission:manage']);
        Route::post('/system/permissions/reset', [SystemController::class, 'resetPermissions'])
            ->middleware(['console.superadmin', 'console.permission:system:permission:manage']);
        Route::patch('/system/ai-circuit', [SystemController::class, 'updateCircuit'])
            ->middleware(['console.superadmin', 'console.permission:system:ai:manage']);

        // 资产台账（LC-06）。
        Route::get('/assets', [AssetsController::class, 'index'])
            ->middleware('console.permission:assets:read');
        Route::get('/assets/page', [AssetsController::class, 'page'])
            ->middleware('console.permission:assets:read');
        Route::post('/assets', [AssetsController::class, 'store'])
            ->middleware('console.permission:assets:manage');
        Route::patch('/assets/{id}', [AssetsController::class, 'update'])
            ->whereNumber('id')
            ->middleware('console.permission:assets:manage');
        Route::delete('/assets/{id}', [AssetsController::class, 'destroy'])
            ->whereNumber('id')
            ->middleware('console.permission:assets:manage');

        // 资产自然语言筛选桥（LC-07，D5 直接代理；审计与模型在 Node 侧）。
        Route::get('/assets/agent/config', fn (Request $r) => app(AssetAgentController::class)->proxy($r, 'config'))
            ->middleware('console.permission:assets:read');
        Route::post('/assets/agent/plan', fn (Request $r) => app(AssetAgentController::class)->proxy($r, 'plan'))
            ->middleware('console.permission:assets:read');
        Route::post('/assets/agent/result', fn (Request $r) => app(AssetAgentController::class)->proxy($r, 'result'))
            ->middleware('console.permission:assets:read');

        // 账户管理（LC-05）。
        Route::get('/accounts', [AccountsController::class, 'index'])
            ->middleware('console.permission:accounts:read');
        Route::post('/accounts', [AccountsController::class, 'store'])
            ->middleware('console.permission:accounts:manage');
        Route::patch('/accounts/{id}', [AccountsController::class, 'update'])
            ->whereNumber('id')
            ->middleware('console.permission:accounts:manage');
        Route::post('/accounts/{id}/password', [AccountsController::class, 'resetPassword'])
            ->whereNumber('id')
            ->middleware('console.permission:accounts:manage');
        Route::post('/accounts/{id}/revoke', [AccountsController::class, 'revoke'])
            ->whereNumber('id')
            ->middleware('console.permission:accounts:manage');

        // 认证（LC-02）。
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);
        Route::patch('/me', [AuthController::class, 'updateProfile']);
        Route::post('/me/password', [AuthController::class, 'changePassword']);

        // LB-05 权限链路探针（LC-06 迁真实模块后移除）。
        // accounts:manage 默认仅 admin+：超管 200、member 403，覆盖权限矩阵链路。
        Route::get('/probe/accounts', fn (Request $request) => response()->json([
            'ok' => true,
            'actor' => $request->attributes->get('consoleActor')->username,
        ]))->middleware('console.permission:accounts:manage');
    });
});
