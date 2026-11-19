<?php

namespace App\Core\Auth;

/**
 * 已认证操作者（对齐 apps/ai-service/src/core/guards.ts 的 Actor）。
 */
final class Actor
{
    /**
     * @param  list<string>  $permissions
     */
    public function __construct(
        public readonly int $id,
        public readonly string $username,
        public readonly string $name,
        public readonly string $role,
        public readonly bool $active,
        public readonly array $permissions,
    ) {}
}
