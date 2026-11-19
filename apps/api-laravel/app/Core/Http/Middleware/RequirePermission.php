<?php

namespace App\Core\Http\Middleware;

use App\Core\Auth\Actor;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * requirePermission 等价（LB-05）：actor 有效权限不含目标码即 403。
 * 文案与 guards.ts requirePermission 一致（{ error: "无权执行该操作" }，
 * 经 bootstrap 错误渲染器输出）。权限码经路由别名参数传入 handle()：
 * Route::...->middleware('console.permission:accounts:manage')。
 */
final class RequirePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $actor = $request->attributes->get('consoleActor');

        if (! $actor instanceof Actor || ! in_array($permission, $actor->permissions, true)) {
            throw new HttpException(403, '无权执行该操作');
        }

        return $next($request);
    }
}
