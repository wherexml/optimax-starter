<?php

namespace App\Modules\Accounts;

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
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 账户管理（LC-05）：modules/accounts.ts 同口径。
 * 防提权三线：路由权限中间件 + 事务内 lockPermission 复核 + 角色维护边界。
 * 最后超管保护：停用/降级后启用超管计数为零 → 409 回滚。
 */
final class AccountsController
{
    /** GET /console/accounts：全量列表 + 在线会话计数。 */
    public function index(): JsonResponse
    {
        $rows = ConsoleAccount::query()->withCount('sessions')->orderBy('id')->get();

        return ConsoleResponse::json($rows->map(fn (ConsoleAccount $row): array => [
            'id' => (int) $row->id,
            'username' => (string) $row->username,
            'name' => (string) $row->name,
            'role' => (string) $row->role,
            'active' => (bool) $row->active,
            'email' => $row->getAttributeValue('email'),
            'company' => $row->getAttributeValue('company'),
            'sessions' => (int) $row->getAttributeValue('sessions_count'),
        ])->all());
    }

    /** POST /console/accounts：创建（409 重名；非超管只能建 member）。 */
    public function store(AccountCreateRequest $request): JsonResponse
    {
        $data = $request->input();
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        $row = DB::transaction(function () use ($actor, $data): array {
            $self = $this->lockPermission($actor, 'accounts:manage');

            $role = (string) $data['role'];
            if ($self->role !== 'super_admin' && $role !== 'member') {
                throw new HttpException(403, '需要超级管理员权限才能分配管理员角色');
            }

            $exists = ConsoleAccount::query()->where('username', (string) $data['username'])->exists();
            if ($exists) {
                throw new HttpException(409, '账户名已存在');
            }

            $account = new ConsoleAccount;
            $account->username = (string) $data['username'];
            $account->name = (string) $data['name'];
            $account->role = $role;
            $account->active = true;
            $account->setAttribute('hash', Hash::make((string) $data['password']));
            $nextEmail = trim((string) ($data['email'] ?? ''));
            $nextCompany = trim((string) ($data['company'] ?? ''));
            $account->setAttribute('email', $nextEmail !== '' ? $nextEmail : null);
            $account->setAttribute('company', $nextCompany !== '' ? $nextCompany : null);
            $account->save();

            $extraFields = array_values(array_filter([
                $nextEmail !== '' ? 'email' : null,
                $nextCompany !== '' ? 'company' : null,
            ]));
            AuditWriter::audit('account.create', $this->partyOf($self), $this->partyOf($account),
                array_merge(['role' => $role], $extraFields !== [] ? ['fields' => $extraFields] : []));

            return [
                'id' => (int) $account->id,
                'username' => (string) $account->username,
                'name' => (string) $account->name,
                'role' => $role,
                'active' => true,
                'email' => $account->getAttributeValue('email'),
                'company' => $account->getAttributeValue('company'),
                'sessions' => 0,
            ];
        });

        return ConsoleResponse::json($row, 201);
    }

    /** PATCH /console/accounts/{id}：变更（角色/状态/资料）+ 最后超管保护。 */
    public function update(AccountPatchRequest $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的账户设置');
        }
        $change = $request->input();
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        if ($id === $actor->id && ($change['active'] ?? null) === false) {
            throw new HttpException(400, '不能停用当前账户');
        }
        if ($id === $actor->id && isset($change['role']) && $change['role'] !== $actor->role) {
            throw new HttpException(400, '不能更改当前账户的角色');
        }

        $target = DB::transaction(function () use ($actor, $id, $change): array {
            $self = $this->lockPermission($actor, 'accounts:manage');

            $before = ConsoleAccount::query()->where('id', $id)->lockForUpdate()->first();
            if ($before === null) {
                throw new HttpException(404, '账户不存在');
            }

            $beforeRole = (string) $before->role;
            if ($self->role !== 'super_admin') {
                if (isset($change['role']) && $change['role'] !== $beforeRole) {
                    throw new HttpException(403, '需要超级管理员权限才能调整系统角色');
                }
                if ((int) $before->id !== $self->id && $beforeRole !== 'member') {
                    throw new HttpException(403, '普通管理员仅可维护成员账户');
                }
            }
            $bootstrap = (string) (getenv('STARTER_ADMIN_USERNAME') ?: 'demo@optimax.hk');
            if ($before->username === $bootstrap
                && ((($change['active'] ?? null) === false) || (isset($change['role']) && $change['role'] !== 'super_admin'))
            ) {
                throw new HttpException(403, '核心超级管理员账户不可停用或降级');
            }

            $set = [];
            if (isset($change['name']) && $change['name'] !== $before->getAttributeValue('name')) {
                $set['name'] = (string) $change['name'];
            }
            if (array_key_exists('email', $change)
                && ($change['email'] !== '' ? (string) $change['email'] : null) !== $before->getAttributeValue('email')) {
                $set['email'] = $change['email'] !== '' ? (string) $change['email'] : null;
            }
            if (array_key_exists('company', $change)
                && ($change['company'] !== '' ? (string) $change['company'] : null) !== $before->getAttributeValue('company')) {
                $set['company'] = $change['company'] !== '' ? (string) $change['company'] : null;
            }
            if (isset($change['role']) && $change['role'] !== $beforeRole) {
                $set['role'] = (string) $change['role'];
            }
            if (isset($change['active']) && (bool) $change['active'] !== (bool) $before->active) {
                $set['active'] = (bool) $change['active'];
            }

            if ($set !== []) {
                $beforeSnapshot = [
                    'name' => $before->getAttributeValue('name'),
                    'role' => $beforeRole,
                    'active' => (bool) $before->active,
                ];
                $before->fill($set)->save();
                $target = $before;

                $revoked = 0;
                if (($set['active'] ?? null) === false) {
                    $revoked = (int) ConsoleSession::query()->where('account', $id)->count();
                    ConsoleSession::query()->where('account', $id)->delete();
                }

                $superAdmins = (int) ConsoleAccount::query()
                    ->where('role', 'super_admin')->where('active', true)->count();
                if ($superAdmins === 0) {
                    throw new HttpException(409, '至少保留一名启用的超级管理员');
                }

                $party = $this->partyOf($target);
                $selfParty = $this->partyOf($self);
                $profileChanged = array_values(array_intersect(['name', 'email', 'company'], array_keys($set)));
                if ($profileChanged !== []) {
                    $detail = isset($set['name'])
                        ? ['from' => $beforeSnapshot['name'], 'to' => $target->getAttributeValue('name')]
                        : [];
                    if (isset($set['email']) || isset($set['company'])) {
                        $detail['fields'] = $profileChanged;
                    }
                    AuditWriter::audit('account.update', $selfParty, $party, $detail);
                }
                if (isset($set['role'])) {
                    AuditWriter::audit('account.role', $selfParty, $party, ['from' => $beforeRole, 'to' => (string) $target->role]);
                }
                if (isset($set['active'])) {
                    $detail = ['from' => $beforeSnapshot['active'], 'to' => (bool) $target->active];
                    if (! $set['active']) {
                        $detail['sessions'] = $revoked;
                    }
                    AuditWriter::audit('account.status', $selfParty, $party, $detail);
                }
            }

            return [
                'id' => (int) $before->id,
                'username' => (string) $before->username,
                'name' => (string) $before->name,
                'role' => (string) $before->role,
                'active' => (bool) $before->active,
                'email' => $before->getAttributeValue('email'),
                'company' => $before->getAttributeValue('company'),
            ];
        });

        return ConsoleResponse::json($target);
    }

    /** POST /console/accounts/{id}/password：管理员重置（撤销目标全部会话）。 */
    public function resetPassword(PasswordResetRequest $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '新密码至少 10 位');
        }
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);
        if ($id === $actor->id) {
            throw new HttpException(400, '不能在账户管理中重置当前账户密码');
        }

        DB::transaction(function () use ($actor, $id, $request): void {
            $self = $this->lockPermission($actor, 'accounts:manage');

            $target = ConsoleAccount::query()->where('id', $id)->lockForUpdate()->first(['id', 'username', 'name', 'role', 'active']);
            if ($target === null) {
                throw new HttpException(404, '账户不存在');
            }
            if ($self->role !== 'super_admin' && (string) $target->role !== 'member') {
                throw new HttpException(403, '普通管理员仅可维护成员账户');
            }

            ConsoleAccount::query()->where('id', $id)
                ->update(['hash' => Hash::make((string) $request->input('password'))]);
            $removed = (int) ConsoleSession::query()->where('account', $id)->count();
            ConsoleSession::query()->where('account', $id)->delete();

            AuditWriter::audit('account.password_reset', $this->partyOf($self), $this->partyOf($target), ['sessions' => $removed]);
        });

        return ConsoleResponse::json(['ok' => true]);
    }

    /** POST /console/accounts/{id}/revoke：强制下线。 */
    public function revoke(Request $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的账户');
        }
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);
        if ($id === $actor->id) {
            throw new HttpException(400, '请使用退出登录结束当前会话');
        }

        $revoked = DB::transaction(function () use ($actor, $id): int {
            $self = $this->lockPermission($actor, 'accounts:manage');

            $target = ConsoleAccount::query()->where('id', $id)->lockForUpdate()->first(['id', 'username', 'name', 'role', 'active']);
            if ($target === null) {
                throw new HttpException(404, '账户不存在');
            }
            if ($self->role !== 'super_admin' && (string) $target->role !== 'member') {
                throw new HttpException(403, '普通管理员仅可维护成员账户');
            }

            $removed = (int) ConsoleSession::query()->where('account', $id)->count();
            ConsoleSession::query()->where('account', $id)->delete();

            AuditWriter::audit('account.revoke', $this->partyOf($self), $this->partyOf($target), ['sessions' => $removed]);

            return $removed;
        });

        return ConsoleResponse::json(['revoked' => $revoked]);
    }

    /** lockPermission 同口径：advisory lock + 复核启用态与实时有效权限（事务内）。返回完整 self。 */
    private function lockPermission(Actor $actor, string $permission): ConsoleAccount
    {
        DB::selectOne('select pg_advisory_xact_lock(7140301)');
        $self = ConsoleAccount::query()->where('id', $actor->id)->first(['id', 'username', 'name', 'role', 'active']);
        if ($self === null || ! $self->active) {
            throw new HttpException(403, '无权执行该操作');
        }
        $effective = ConsoleAuth::effectivePermissions((string) $self->role);
        if (! in_array($permission, $effective, true)) {
            throw new HttpException(403, '无权执行该操作');
        }

        return $self;
    }

    /** @param  ConsoleAccount  $self  审计用参与方。 */
    private function partyOf(ConsoleAccount $self): Party
    {
        return new Party((int) $self->id, (string) $self->username, (string) $self->name);
    }
}
