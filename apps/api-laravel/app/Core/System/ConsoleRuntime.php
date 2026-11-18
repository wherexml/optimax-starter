<?php

namespace App\Core\System;

/**
 * 运行时元数据（LC-08 审计修正）：
 * /proc/self/stat 的 starttime + /proc/uptime 计算真实进程 uptime
 * （对齐 Hono process.uptime() 语义；php -S worker 的 PHP 静态变量不保证跨请求持久，
 * /proc 读取对每个请求进程都成立；容器外无 /proc 时回退 0）。
 */
final class ConsoleRuntime
{
    public static function uptimeSeconds(): int
    {
        $stat = @file_get_contents('/proc/self/stat');
        $uptime = @file_get_contents('/proc/uptime');
        if ($stat === false || $uptime === false) {
            return 0;
        }
        // starttime 是第 22 个字段（空格分隔，comm 可能含空格故从尾部数：倒序第 20 个）。
        $fields = explode(' ', $stat);
        if (count($fields) < 22) {
            return 0;
        }
        $startTimeTicks = (float) $fields[21];
        $upSeconds = (float) explode(' ', $uptime)[0];
        $ticksPerSecond = defined('SC_CLK_TCK') ? (int) SC_CLK_TCK : 100;

        return max(0, (int) floor($upSeconds - $startTimeTicks / $ticksPerSecond));
    }
}
