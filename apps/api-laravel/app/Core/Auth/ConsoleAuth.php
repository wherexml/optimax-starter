<?php

namespace App\Core\Auth;

use App\Core\Models\ConsoleAccount;
use App\Core\Models\ConsoleRolePermission;
use App\Core\Models\ConsoleSession;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * 会话与权限底座（LB-05）：逐条对齐现有 Hono 栈语义。
 *
 * - Cookie 持有原始 token；库中只存 sha256(token)（guards.ts digest）。
 * - 生命周期 8h；查询即校验过期（与现栈 innerJoin 条件一致）。
 * - 有效权限：super_admin 固定全量默认；member/admin 读 DB 覆盖并按
 *   目录过滤 + 剔除超管独占码 + 目录序排序（normalizePersistedRolePermissions 同口径），
 *   带 2 秒进程内缓存（对齐 core/permissions.ts CACHE_TTL_MS）。
 *
 * 偏差说明：现有「会话」实为登录令牌表（无 payload 列），不承载 Laravel 会话负载，
 * 故不走 SessionHandler/StartSession，以 Auth 中间件直读 Cookie 实现（LARAVEL.md D3）。
 */
final class ConsoleAuth
{
    public const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

    private const CACHE_TTL_SECONDS = 2;

    /** @var array{expiresAt: int, roles: array<string, list<string>>}|null */
    private static ?array $cache = null;

    public static function digest(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function cookieName(): string
    {
        return (string) (getenv('SESSION_COOKIE_NAME') ?: 'optimax_console');
    }

    public static function corsOrigin(): string
    {
        return (string) (getenv('CORS_ORIGIN') ?: 'http://127.0.0.1:38140');
    }

    /** 会话签发：写 console_session 并返回原始 token（Cookie 携带值）。 */
    public static function issueSession(int $accountId): string
    {
        $token = bin2hex(random_bytes(32));
        ConsoleSession::query()->create([
            'key' => self::digest($token),
            'account' => $accountId,
            'expires' => now()->addSeconds(self::SESSION_LIFETIME_SECONDS),
        ]);

        return $token;
    }

    public static function destroySession(string $token): void
    {
        ConsoleSession::query()->where('key', self::digest($token))->delete();
    }

    /** @param  list<string>  $permissions */
    public static function actorFromRow(object $row, array $permissions): Actor
    {
        return new Actor(
            id: (int) $row->id,
            username: (string) $row->username,
            name: (string) $row->name,
            role: (string) $row->role,
            active: (bool) $row->active,
            permissions: $permissions,
        );
    }

    /** 解析请求中的操作者；无有效会话返回 null（调用方按 401 处理）。 */
    public static function resolve(Request $request): ?Actor
    {
        $token = (string) $request->cookie(self::cookieName());
        if ($token === '') {
            return null;
        }

        $row = ConsoleAccount::query()
            ->join('console_session', 'console_account.id', '=', 'console_session.account')
            ->where('console_session.key', self::digest($token))
            ->where('console_session.expires', '>', now())
            ->where('console_account.active', true)
            ->selectRaw('console_account.id, console_account.username, console_account.name, console_account.role, console_account.active')
            ->first();

        if ($row === null) {
            return null;
        }

        return self::actorFromRow($row, self::effectivePermissions((string) $row->role));
    }

    /** @return list<string> */
    public static function effectivePermissions(string $role): array
    {
        if ($role === 'super_admin') {
            return self::permissionDefaults()['super_admin'];
        }
        if ($role !== 'admin' && $role !== 'member') {
            return [];
        }

        $now = time();
        if (self::$cache === null || self::$cache['expiresAt'] <= $now) {
            $roles = [
                'member' => self::normalize('member', ConsoleRolePermission::query()->where('role', 'member')->value('permissions')),
                'admin' => self::normalize('admin', ConsoleRolePermission::query()->where('role', 'admin')->value('permissions')),
                'super_admin' => self::permissionDefaults()['super_admin'],
            ];
            self::$cache = ['expiresAt' => $now + self::CACHE_TTL_SECONDS, 'roles' => $roles];
        }

        return self::$cache['roles'][$role] ?? [];
    }

    /** 测试与 E2E 用的进程缓存失效。 */
    public static function invalidatePermissionCache(): void
    {
        self::$cache = null;
    }

    /** @return array<string, list<string>> */
    private static function permissionDefaults(): array
    {
        return self::defaultsArtifact()['defaults'];
    }

    /** @return list<array<string, mixed>> */
    private static function catalog(): array
    {
        return self::defaultsArtifact()['catalog'];
    }

    /** @return list<string> */
    private static function superAdminOnly(): array
    {
        return self::defaultsArtifact()['superAdminOnly'];
    }

    /** @return array<string, mixed> permissions.defaults.json 产物（单一事实来源，LB-05）。 */
    private static function defaultsArtifact(): array
    {
        static $cached = null;
        if ($cached !== null) {
            return $cached;
        }
        $file = self::contractsDir().'/permissions.defaults.json';
        if (! is_file($file)) {
            throw new RuntimeException('permissions.defaults.json 产物缺失：请运行 bun run contracts:generate');
        }
        $cached = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $cached;
    }

    /**
     * normalizePersistedRolePermissions 同口径：过滤目录外码、剔除超管独占、目录序排序。
     *
     * @param  array<mixed>|null  $persisted
     * @return list<string>
     */
    private static function normalize(string $role, ?array $persisted): array
    {
        if ($persisted === null) {
            return self::permissionDefaults()[$role];
        }

        $catalogCodes = array_column(self::catalog(), 'code');
        $superAdminOnly = self::superAdminOnly();
        $valid = array_values(array_filter(
            $persisted,
            fn ($code): bool => is_string($code)
                && in_array($code, $catalogCodes, true)
                && ! in_array($code, $superAdminOnly, true),
        ));
        $valid = array_values(array_unique($valid));

        $order = array_flip($catalogCodes);
        usort($valid, fn (string $a, string $b): int => ($order[$a] ?? PHP_INT_MAX) <=> ($order[$b] ?? PHP_INT_MAX) ?: strcmp($a, $b));

        return $valid;
    }

    /** 与 SchemaRegistry 同源的产物目录。 */
    private static function contractsDir(): string
    {
        return rtrim((string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts')), '/');
    }
}
