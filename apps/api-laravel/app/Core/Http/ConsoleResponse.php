<?php

namespace App\Core\Http;

use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;

/**
 * 统一 JSON 出口（LC）：与 Hono c.json 字节级对齐——原生 UTF-8 不转义、
 * 不转义斜杠。所有端点与错误渲染必须经此出口，保证双栈对拍可比。
 */
final class ConsoleResponse
{
    public static function json(mixed $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** JS Date.toJSON 同构（毫秒 + Z），供实体资源与审计时间字段统一使用。 */
    public static function isoTime(?CarbonInterface $time): ?string
    {
        return $time?->utc()->format('Y-m-d\TH:i:s.v\Z');
    }
}
