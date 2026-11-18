<?php

namespace App\Core\Http;

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
}
