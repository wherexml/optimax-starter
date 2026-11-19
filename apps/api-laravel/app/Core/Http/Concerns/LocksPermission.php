<?php

namespace App\Core\Http\Concerns;

use App\Core\Audit\Party;
use App\Core\Auth\Actor;
use App\Core\Auth\ConsoleAuth;
use App\Core\Models\ConsoleAccount;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * lockPermission 同口径（guards.ts）：advisory lock + 事务内复核启用态与实时有效权限。
 * gen:module 生成的模块与本仓控制器共用（LD-01），不复制横切逻辑。
 */
trait LocksPermission
{
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

    private function partyOf(ConsoleAccount $self): Party
    {
        return new Party((int) $self->id, (string) $self->username, (string) $self->name);
    }
}
