<?php

namespace App\Core\Http\Middleware;

use App\Core\Auth\Actor;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * requireSuperAdmin 等价（guards.ts）：非超管 403「需要超级管理员权限」。
 * 路由顺序须在 console.permission 之前（对齐 modules/system.ts 的中间件次序）。
 */
final class RequireSuperAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->attributes->get('consoleActor');

        if (! $actor instanceof Actor || $actor->role !== 'super_admin') {
            throw new HttpException(403, '需要超级管理员权限');
        }

        return $next($request);
    }
}
