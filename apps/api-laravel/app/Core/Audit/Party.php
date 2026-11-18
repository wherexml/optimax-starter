<?php

namespace App\Core\Audit;

/**
 * 审计参与方（对齐 guards.ts Party）：操作者或目标（账户）。
 */
final class Party
{
    public function __construct(
        public readonly int $id,
        public readonly string $username,
        public readonly string $name,
    ) {}
}
