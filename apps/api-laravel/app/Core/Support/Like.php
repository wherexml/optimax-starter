<?php

namespace App\Core\Support;

/**
 * ilike/like 通配符转义（对齐 core/audit.ts containsPattern）。
 */
final class Like
{
    public static function escape(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
