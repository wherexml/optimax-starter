<?php

namespace App\Core\Http\Middleware;

use App\Core\Auth\ConsoleAuth;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 全局入口守卫（LB-05）：逐条对齐 apps/server/src/console.ts 的挂载中间件。
 *
 * - 响应统一 Cache-Control: no-store。
 * - 非 GET 请求强校验 Origin === CORS_ORIGIN 且 Content-Type 为 JSON，
 *   否则 403 { error: "请求来源无效" }（登录与 SSO 发现豁免）。
 * - Cookie token → console_session → actor；无效即 401 { error: "请登录" }。
 * - Actor 与有效权限写入 request attribute，业务侧经 RequirePermission 消费。
 */
final class ResolveConsoleActor
{
    public function handle(Request $request, Closure $next): Response
    {
        // 对齐 console.ts：所有非 GET（含 /login）强校验 Origin 与 JSON 类型；登录仅豁免会话。
        if ($request->method() !== 'GET'
            && (($request->headers->get('Origin') !== ConsoleAuth::corsOrigin()
                || ! str_starts_with((string) $request->headers->get('Content-Type'), 'application/json'))
            )) {
            throw new HttpException(403, '请求来源无效');
        }

        $actor = null;
        if (! $request->is('console/login') && ! $request->is('console/auth/providers')) {
            $actor = ConsoleAuth::resolve($request);
            if ($actor === null) {
                throw new HttpException(401, '请登录');
            }
            $request->attributes->set('consoleActor', $actor);
        }

        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }
}
