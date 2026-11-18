<?php

namespace App\Modules\Assets;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 资产自然语言筛选桥（LC-07）：按 D5「直接代理」实现。
 *
 * 模型调用、运行态（runs）、agent 审计仍由保留的 Node AI 服务（apps/server，
 * LC-08 切流后经 STARTER_NODE_API_URL 指向）原样承担；本控制器把 /console/assets/agent
 * 透传过去并转发会话 Cookie 与 Origin，语义与单栈部署完全等价。
 * bodyLimit 8192 → 413「请求过大」对齐 asset-agent.ts。
 */
final class AssetAgentController
{
    private const BODY_LIMIT = 8192;

    public function proxy(Request $request, string $path): Response
    {
        $body = $request->getContent();
        if (strlen($body) > self::BODY_LIMIT) {
            throw new HttpException(413, '请求过大');
        }

        $target = rtrim((string) (getenv('STARTER_NODE_API_URL') ?: 'http://api:38141'), '/')
            .'/console/assets/agent/'.$path
            .($request->getQueryString() !== null ? '?'.$request->getQueryString() : '');

        $response = Http::withHeaders([
            'Origin' => (string) (getenv('CORS_ORIGIN') ?: 'http://127.0.0.1:38140'),
            'Content-Type' => 'application/json',
            'Cookie' => (string) $request->headers->get('Cookie', ''),
        ])->{strtolower($request->method())}($target, $body === '' ? null : $body);

        return response($response->body(), $response->status(), [
            'Content-Type' => $response->header('Content-Type', 'application/json'),
            'Cache-Control' => 'no-store',
        ]);
    }
}
