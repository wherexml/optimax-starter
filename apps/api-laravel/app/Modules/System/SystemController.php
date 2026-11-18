<?php

namespace App\Modules\System;

use App\Core\Audit\Party;
use App\Core\Auth\Actor;
use App\Core\Auth\ConsoleAuth;
use App\Core\Http\ConsoleResponse;
use App\Core\Permissions\PermissionMatrix;
use App\Core\System\SystemSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 系统配置模块（LC-03/04）：status / settings / permissions 读与写。
 * nodeVersion 字段语义决策（LB-03 记录项）：保留字段名，值改为 PHP 运行时版本
 * —— 前端零改动，字段语义为「后端运行时版本」。
 */
final class SystemController
{
    /** GET /console/system/status */
    public function status(Request $request): JsonResponse
    {
        $dbState = 'ok';
        $dbLatencyMs = null;
        $activeSessions = 0;

        $start = microtime(true);
        try {
            DB::select('select 1');
            $dbLatencyMs = round((microtime(true) - $start) * 1000, 1);
            $activeSessions = (int) DB::table('console_session')->where('expires', '>', now())->count();
        } catch (\Throwable) {
            $dbState = 'unreachable';
        }

        // AI 配置态（D5：模型客户端保留在 Node 侧，此处仅报告配置与熔断）。
        $aiConfigured = getenv('STARTER_AI_BASE_URL') !== false && getenv('STARTER_AI_BASE_URL') !== '';
        $configMode = $aiConfigured ? 'client' : 'disabled';
        $circuit = SystemSettings::circuitState();
        $envReady = $aiConfigured;

        $ai = [
            'configMode' => $configMode,
            'circuitOpen' => $circuit['circuitOpen'],
            'effectiveEnabled' => $envReady && ! $circuit['circuitOpen'],
            'model' => $envReady ? (string) (getenv('STARTER_AI_MODEL') ?: '') : null,
            'timeoutMs' => null,
            'limits' => null,
            // 队列水位是 Node 侧进程内状态（D5），Laravel 不可见 → null。
            // LC-07 若选择服务间透传，此处改为透传值。
            'queue' => null,
            'updatedAt' => $circuit['updatedAt'],
        ];

        return ConsoleResponse::json([
            'checkedAt' => now()->utc()->format('Y-m-d\TH:i:s.v\Z'),
            'overall' => $dbState === 'ok' ? 'ok' : 'degraded',
            'probe' => [
                'db' => $dbState,
                'dbLatencyMs' => $dbLatencyMs !== null ? (float) $dbLatencyMs : null,
                'activeSessions' => $activeSessions,
                'uptimeSec' => defined('LARAVEL_START') ? max(0, (int) (time() - LARAVEL_START)) : 0,
                'nodeVersion' => PHP_VERSION,
            ],
            'ai' => $ai,
        ]);
    }

    /** GET /console/system/settings */
    public function settings(): JsonResponse
    {
        return ConsoleResponse::json(SystemSettings::payload());
    }

    /** PUT /console/system/settings */
    public function updateSettings(TimezoneUpdateRequest $request): JsonResponse
    {
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        // lockPermission 同口径：advisory lock + 复核启用态与实时权限。
        return ConsoleResponse::json(SystemSettings::updateTimezone(
            new Party($actor->id, $actor->username, $actor->name),
            (string) $request->input('timezone'),
        ));
    }

    /** GET /console/system/permissions（requireSuperAdmin + system:permission:read）。 */
    public function permissions(Request $request): JsonResponse
    {
        $this->requireSuperAdmin($request);

        return ConsoleResponse::json(PermissionMatrix::payload());
    }

    /** PUT /console/system/permissions */
    public function updatePermissions(MatrixUpdateRequest $request): JsonResponse
    {
        $actor = $this->requireSuperAdmin($request);
        $updated = PermissionMatrix::update(
            new Party($actor->id, $actor->username, $actor->name),
            is_array($request->input('roles')) ? $request->input('roles') : [],
        );
        ConsoleAuth::invalidatePermissionCache();

        return ConsoleResponse::json($updated);
    }

    /** POST /console/system/permissions/reset */
    public function resetPermissions(Request $request): JsonResponse
    {
        $actor = $this->requireSuperAdmin($request);
        $reset = PermissionMatrix::reset(new Party($actor->id, $actor->username, $actor->name));
        ConsoleAuth::invalidatePermissionCache();

        return ConsoleResponse::json($reset);
    }

    /** PATCH /console/system/ai-circuit（注意：现栈路径为 ai-circuit，非 ai/circuit）。 */
    public function updateCircuit(CircuitUpdateRequest $request): JsonResponse
    {
        $actor = $this->requireSuperAdmin($request);
        $state = SystemSettings::updateCircuit(
            new Party($actor->id, $actor->username, $actor->name),
            (bool) $request->input('enabled'),
        );

        return ConsoleResponse::json(['ok' => true] + $state);
    }

    private function requireSuperAdmin(Request $request): Actor
    {
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);
        if ($actor->role !== 'super_admin') {
            throw new HttpException(403, '需要超级管理员权限');
        }

        return $actor;
    }
}
