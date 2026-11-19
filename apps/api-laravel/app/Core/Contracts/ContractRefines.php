<?php

namespace App\Core\Contracts;

use RuntimeException;

/**
 * zod `.refine()` 跨字段/格式语义的 PHP 等价实现（LB-03）。
 *
 * 语义唯一权威在 packages/api/src/refines.ts（经 refines.json 产物对拍）；
 * 本类按 refine id 实现同口径检查。构造时校验产物的登记 id 全部有实现——
 * TS 侧生成器保证「源码 refine 数 = 登记数」，本类保证「登记 id ⊆ 已实现」。
 */
final class ContractRefines
{
    /** @var array<string, callable(mixed): bool> */
    private array $rules;

    public function __construct()
    {
        $this->rules = [
            // 邮箱可为空串或省略；非空时必须匹配 EMAIL_RE（contracts.ts optionalEmailSchema）。
            'email-format' => function (mixed $data): bool {
                $email = is_array($data) ? ($data['email'] ?? null) : null;
                if ($email === null || $email === '') {
                    return true;
                }

                return is_string($email) && preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email) === 1;
            },
            // 账户变更至少提供 active/role/name/email/company 之一。
            'account-patch-nonempty' => fn (mixed $data): bool => is_array($data)
                && collect(['active', 'role', 'name', 'email', 'company'])->contains(fn (string $k): bool => array_key_exists($k, $data)),
            // 个人资料更新至少提供 name/email/company 之一（防提权白名单由 schema strict 保证）。
            'profile-update-nonempty' => fn (mixed $data): bool => is_array($data)
                && collect(['name', 'email', 'company'])->contains(fn (string $k): bool => array_key_exists($k, $data)),
            // 资产变更至少提供 name/domain/owner/stage 之一。
            'asset-patch-nonempty' => fn (mixed $data): bool => is_array($data)
                && collect(['name', 'domain', 'owner', 'stage'])->contains(fn (string $k): bool => array_key_exists($k, $data)),
            // 权限矩阵更新至少提交一个角色的权限数组。
            'permission-roles-nonempty' => function (mixed $data): bool {
                $roles = is_array($data) ? ($data['roles'] ?? null) : null;
                if (! is_array($roles)) {
                    return false;
                }

                return collect(['member', 'admin', 'super_admin'])
                    ->contains(fn (string $r): bool => array_key_exists($r, $roles) && is_array($roles[$r]));
            },
            // 指定匹配方式时必须同时提供非空 q（asset-agent.ts）。
            'agent-qop-requires-q' => function (mixed $data): bool {
                $filters = is_array($data) && array_key_exists('current', $data) && is_array($data['current'])
                    ? $data['current']
                    : (is_array($data) ? $data : []);

                $qOp = $filters['qOp'] ?? null;

                return $qOp === null || (isset($filters['q']) && is_string($filters['q']) && $filters['q'] !== '');
            },
            // ---- gen:module 追加 refine 实现（勿删锚点）----
        ];
    }

    /** @param array<int, array<string, mixed>> $manifest refines.json 的 refines 数组 */
    public function assertCovers(array $manifest): void
    {
        $registered = collect($manifest)->pluck('id')->all();
        $missing = array_diff($registered, array_keys($this->rules));
        if ($missing !== []) {
            throw new RuntimeException('refines.json 存在未实现的语义：'.implode(', ', $missing));
        }
    }

    /** 校验某个 schema 的全部已登记 refine；通过返回 null，失败返回 refine id。 */
    public function check(string $schemaName, mixed $data): ?string
    {
        $manifest = SchemaRegistry::make()->refines();
        $this->assertCovers($manifest);

        foreach ($manifest as $entry) {
            if (! in_array($schemaName, $entry['schemas'] ?? [], true)) {
                continue;
            }
            $id = (string) $entry['id'];
            if (! isset($this->rules[$id])) {
                throw new RuntimeException("refine 未实现：{$id}");
            }
            if (! ($this->rules[$id])($data)) {
                return $id;
            }
        }

        return null;
    }
}
