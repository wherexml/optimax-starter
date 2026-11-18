<?php

namespace App\Modules\Auth;

use App\Core\Auth\Actor;
use App\Core\Auth\ConsoleAuth;
use App\Core\Models\ConsoleAccount;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 会话与认证最小端点（LB-05，供会话互通与 E2E 验证）。
 * 完整 auth 模块（/me PATCH、密码修改等）在 LC-02 按路由基线迁移。
 */
final class AuthController
{
    public function login(LoginRequest $request): JsonResponse
    {
        $account = ConsoleAccount::query()
            ->where('username', $request->input('username'))
            ->first();

        if ($account === null
            || ! $account->active
            || ! Hash::check((string) $request->input('password'), (string) $account->getAttributeValue('hash'))
        ) {
            throw new HttpException(401, '账户或密码错误');
        }

        $token = ConsoleAuth::issueSession((int) $account->id);

        // 单 Cookie、8h 过期、HttpOnly、SameSite=Strict（对齐 Hono setCookie 语义）。
        return response()
            ->json(['ok' => true])
            ->withCookie(new Cookie(
                ConsoleAuth::cookieName(),
                $token,
                now()->addSeconds(ConsoleAuth::SESSION_LIFETIME_SECONDS)->getTimestamp(),
                '/',
                null,
                false,
                true,
                false,
                'strict',
            ));
    }

    public function logout(Request $request): JsonResponse
    {
        $token = (string) $request->cookie(ConsoleAuth::cookieName());
        if ($token !== '') {
            ConsoleAuth::destroySession($token);
        }

        return response()
            ->json(['ok' => true])
            ->withCookie(new Cookie(ConsoleAuth::cookieName(), '', -1, '/', null, false, true, false, 'strict'));
    }

    /** GET /console/me：对齐现栈 /me 的响应形状（profile + permissions）。 */
    public function me(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        $row = ConsoleAccount::query()
            ->where('id', $actor->id)
            ->first(['id', 'username', 'name', 'role', 'active', 'email', 'company']);

        if ($row === null || ! $row->active) {
            throw new HttpException(401, '请登录');
        }

        return response()->json([
            'id' => (int) $row->id,
            'username' => (string) $row->username,
            'name' => (string) $row->name,
            'role' => (string) $row->role,
            'active' => (bool) $row->active,
            'email' => $row->getAttributeValue('email'),
            'company' => $row->getAttributeValue('company'),
            'permissions' => $actor->permissions,
        ]);
    }
}
