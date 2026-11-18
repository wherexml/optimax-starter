<?php

namespace App\Modules\Auth;

use App\Core\Audit\AuditWriter;
use App\Core\Audit\Party;
use App\Core\Auth\Actor;
use App\Core\Auth\ConsoleAuth;
use App\Core\Http\ConsoleResponse;
use App\Core\Models\ConsoleAccount;
use App\Core\Models\ConsoleSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

    /** PATCH /console/me：对齐 modules/auth.ts /me PATCH（同名 diff、审计、回 profile+permissions）。 */
    public function updateProfile(ProfileUpdateRequest $request): JsonResponse
    {
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);
        $data = $request->input();

        $row = DB::transaction(function () use ($actor, $data) {
            // ADMIN_LOCK 对齐 guards.ts：系统管理与特权写入同锁串行。
            DB::selectOne('select pg_advisory_xact_lock(7140301)');
            $self = ConsoleAccount::query()->where('id', $actor->id)->lockForUpdate()->first();
            if ($self === null || ! $self->active) {
                return null;
            }

            $set = [];
            if (array_key_exists('name', $data) && $data['name'] !== $self->getAttributeValue('name')) {
                $set['name'] = (string) $data['name'];
            }
            if (array_key_exists('email', $data) && ($data['email'] !== '' ? (string) $data['email'] : null) !== $self->getAttributeValue('email')) {
                $set['email'] = $data['email'] !== '' ? (string) $data['email'] : null;
            }
            if (array_key_exists('company', $data) && ($data['company'] !== '' ? (string) $data['company'] : null) !== $self->getAttributeValue('company')) {
                $set['company'] = $data['company'] !== '' ? (string) $data['company'] : null;
            }
            $changed = array_keys($set);
            if ($changed === []) {
                return $self;
            }

            $before = $self->replicate();
            $self->fill($set)->save();

            $detail = array_key_exists('name', $set)
                ? ['from' => $before->getAttributeValue('name'), 'to' => $self->getAttributeValue('name')]
                : [];
            if (array_key_exists('email', $set) || array_key_exists('company', $set)) {
                $detail['fields'] = $changed;
            }
            AuditWriter::audit('profile.update', new Party($actor->id, $actor->username, $actor->name), new Party($actor->id, $actor->username, $actor->name), $detail);

            return $self;
        });

        if ($row === null) {
            throw new HttpException(401, '请登录');
        }

        return ConsoleResponse::json([
            'id' => (int) $row->id,
            'username' => (string) $row->username,
            'name' => (string) $row->name,
            'role' => (string) $row->role,
            'active' => (bool) $row->active,
            'email' => $row->getAttributeValue('email'),
            'company' => $row->getAttributeValue('company'),
            'permissions' => ConsoleAuth::effectivePermissions((string) $row->role),
        ]);
    }

    /** POST /console/me/password：对齐 modules/auth.ts（复核会话、全撤销、审计、清 Cookie）。 */
    public function changePassword(PasswordChangeRequest $request): JsonResponse
    {
        $current = (string) $request->input('current');
        $password = (string) $request->input('password');
        if ($current === $password) {
            throw new HttpException(400, '新密码不能与当前密码相同');
        }

        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);
        $token = (string) $request->cookie(ConsoleAuth::cookieName());
        $key = ConsoleAuth::digest($token);

        $revoked = DB::transaction(function () use ($actor, $key, $current, $password) {
            DB::selectOne('select pg_advisory_xact_lock(7140301)');

            // 复核：账户仍启用且当前会话有效（对齐 Hono 的 innerJoin 复查语义）。
            $self = ConsoleAccount::query()
                ->join('console_session', 'console_account.id', '=', 'console_session.account')
                ->where('console_account.id', $actor->id)
                ->where('console_account.active', true)
                ->where('console_session.key', $key)
                ->where('console_session.expires', '>', now())
                ->first(['console_account.id', 'console_account.username', 'console_account.name', 'console_account.hash']);
            if ($self === null) {
                throw new HttpException(401, '请登录');
            }
            if (! Hash::check($current, (string) $self->getAttributeValue('hash'))) {
                throw new HttpException(400, '当前密码错误');
            }

            ConsoleAccount::query()->where('id', $actor->id)->update(['hash' => Hash::make($password)]);
            // Hono 对拍：tx.delete(sessions).returning()（auth.ts）；LC-02 移植时误写成
            // 仅计数，改密后旧会话仍有效。delete 返回受影响行数，审计 detail 语义不变。
            $removed = (int) ConsoleSession::query()->where('account', $actor->id)->delete();

            $party = new Party((int) $self->id, (string) $self->getAttributeValue('username'), (string) $self->getAttributeValue('name'));
            AuditWriter::audit('profile.password_change', $party, $party, ['sessions' => $removed]);

            return $removed;
        });

        return ConsoleResponse::json(['ok' => true, 'revoked' => $revoked])
            ->withCookie(new Cookie(ConsoleAuth::cookieName(), '', -1, '/', null, false, true, false, 'strict'));
    }
}
