<?php

namespace App\Core\Permissions;

use App\Core\Audit\AuditWriter;
use App\Core\Audit\Party;
use App\Core\Models\ConsoleAccount;
use App\Core\Models\ConsoleRolePermission;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 权限矩阵服务（LC-03/04）：getPermissionMatrixPayload / updatePermissionMatrixTx /
 * resetPermissionMatrixTx 同口径。超管固定全量默认且不可写；member/admin 覆盖行
 * 经 normalize（目录过滤 + 超管独占剔除 + 目录序）。写路径在调用方事务内。
 */
final class PermissionMatrix
{
    /** @return array<string, list<string>> */
    private static function defaults(): array
    {
        $file = self::contractsDir().'/permissions.defaults.json';
        if (! is_file($file)) {
            throw new RuntimeException('permissions.defaults.json 产物缺失');
        }
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $decoded['defaults'];
    }

    /** @return list<array<string, mixed>> */
    private static function catalog(): array
    {
        $file = self::contractsDir().'/permissions.defaults.json';
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $decoded['catalog'];
    }

    /** @return list<string> */
    private static function superAdminOnly(): array
    {
        $file = self::contractsDir().'/permissions.defaults.json';
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $decoded['superAdminOnly'];
    }

    /** validateRolePermissionsInput 同口径：异常消息 422 逐条对齐。 */
    private static function validateRoleInput(string $role, mixed $raw): array
    {
        if (! in_array($role, ['member', 'admin', 'super_admin'], true)) {
            throw new HttpException(422, "未知系统角色：{$role}");
        }
        if (! is_array($raw)) {
            throw new HttpException(422, "{$role} 权限配置必须是数组");
        }
        $normalized = [];
        foreach ($raw as $item) {
            if (! is_string($item)) {
                throw new HttpException(422, '权限码格式无效');
            }
            $trimmed = trim($item);
            if ($trimmed !== '') {
                $normalized[$trimmed] = true;
            }
        }
        $catalogCodes = array_column(self::catalog(), 'code');
        $unknown = array_values(array_diff(array_keys($normalized), $catalogCodes));
        //
        if ($unknown !== []) {
            sort($unknown);
            throw new HttpException(422, '未知权限码：'.implode(', ', $unknown));
        }
        if ($role !== 'super_admin') {
            $exclusive = array_values(array_intersect(array_keys($normalized), self::superAdminOnly()));
            if ($exclusive !== []) {
                throw new HttpException(422, '超级管理员专属权限不能分配给其他角色');
            }
        }
        if ($role === 'super_admin') {
            return self::defaults()['super_admin'];
        }

        // sortPermissionCodes：目录序 + 字典序兜底。
        $order = array_flip($catalogCodes);
        $sorted = array_keys($normalized);
        usort($sorted, fn (string $a, string $b): int => ($order[$a] ?? PHP_INT_MAX) <=> ($order[$b] ?? PHP_INT_MAX) ?: strcmp($a, $b));

        return $sorted;
    }

    /** @return array<string, mixed> SystemPermissionMatrixPayload 形状。 */
    public static function payload(): array
    {
        $rows = ConsoleRolePermission::query()->get()->keyBy('role');
        $latest = $rows->pluck('updated_at')->filter()->max();

        return [
            'catalog' => self::catalog(),
            'roles' => [
                'member' => self::normalize('member', $rows->get('member')?->getAttributeValue('permissions')),
                'admin' => self::normalize('admin', $rows->get('admin')?->getAttributeValue('permissions')),
                'super_admin' => self::defaults()['super_admin'],
            ],
            'defaults' => self::defaults(),
            'immutable' => ['super_admin' => self::defaults()['super_admin']],
            'updatedAt' => $latest !== null ? $latest->utc()->format('Y-m-d\TH:i:s.v\Z') : null,
        ];
    }

    /** @param  array<mixed>|null  $persisted */
    private static function normalize(string $role, ?array $persisted): array
    {
        if ($role === 'super_admin') {
            return self::defaults()['super_admin'];
        }
        if ($persisted === null) {
            return self::defaults()[$role];
        }
        $catalogCodes = array_column(self::catalog(), 'code');
        $valid = array_values(array_filter(
            $persisted,
            fn ($code): bool => is_string($code)
                && in_array($code, $catalogCodes, true)
                && ! in_array($code, self::superAdminOnly(), true),
        ));
        $valid = array_values(array_unique($valid));
        $order = array_flip($catalogCodes);
        usort($valid, fn (string $a, string $b): int => ($order[$a] ?? PHP_INT_MAX) <=> ($order[$b] ?? PHP_INT_MAX) ?: strcmp($a, $b));

        return $valid;
    }

    /** lockSuperAdmin 同口径：advisory lock + 复核操作者仍为启用的超管。 */
    private static function lockSuperAdmin(Party $actor): void
    {
        DB::selectOne('select pg_advisory_xact_lock(7140301)');
        $self = ConsoleAccount::query()->where('id', $actor->id)->first(['id', 'active', 'role']);
        if ($self === null || ! $self->active || (string) $self->role !== 'super_admin') {
            throw new HttpException(403, '需要超级管理员权限');
        }
    }

    /**
     * @param  array<string, mixed>  $roles
     * @return array<string, mixed> 更新后的矩阵 payload。
     */
    public static function update(Party $actor, array $roles): array
    {
        return DB::transaction(function () use ($actor, $roles): array {
            self::lockSuperAdmin($actor);
            $before = self::payload()['roles'];

            foreach (['member', 'admin', 'super_admin'] as $role) {
                if (! array_key_exists($role, $roles)) {
                    continue;
                }
                $normalized = self::validateRoleInput($role, $roles[$role]);
                if ($role === 'super_admin') {
                    continue; // 不可变：提交被校验但忽略写。
                }
                if ($before[$role] === $normalized) {
                    continue;
                }

                ConsoleRolePermission::query()->updateOrCreate(
                    ['role' => $role],
                    ['permissions' => $normalized, 'updated_by' => $actor->id],
                );

                AuditWriter::auditResource('permission.update', $actor,
                    ['code' => $role, 'name' => self::roleLabel($role)],
                    ['targetRole' => $role, 'beforePermissions' => $before[$role], 'afterPermissions' => $normalized]);
            }

            return self::payload();
        });
    }

    /** @return array<string, mixed> */
    public static function reset(Party $actor): array
    {
        return DB::transaction(function () use ($actor): array {
            self::lockSuperAdmin($actor);
            $before = self::payload()['roles'];
            $changed = false;

            foreach (['member', 'admin'] as $role) {
                if ($before[$role] !== self::defaults()[$role]) {
                    $changed = true;
                }
                ConsoleRolePermission::query()->updateOrCreate(
                    ['role' => $role],
                    ['permissions' => self::defaults()[$role], 'updated_by' => $actor->id],
                );
            }

            AuditWriter::auditResource('permission.reset', $actor,
                ['code' => 'all_roles', 'name' => '全部系统角色'],
                ['from' => $changed ? 'custom' : 'default', 'to' => 'default']);

            return self::payload();
        });
    }

    private static function roleLabel(string $role): string
    {
        return ['member' => '成员', 'admin' => '管理员', 'super_admin' => '超级管理员'][$role] ?? $role;
    }

    private static function contractsDir(): string
    {
        return rtrim((string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts')), '/');
    }
}
