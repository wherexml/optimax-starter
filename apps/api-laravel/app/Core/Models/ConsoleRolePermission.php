<?php

namespace App\Core\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * 角色有效权限矩阵（console_role_permission）：role → 权限码数组。
 * 系统权限页（LC-04）按本表覆盖默认目录；updated_by 记录最近操作者。
 *
 * 零迁移使 Larastan 无法静态发现列名，@property 为真实列的显式声明（非压制）。
 *
 * @property string $role
 * @property list<string> $permissions
 * @property CarbonInterface|null $updated_at
 * @property int|null $updated_by
 */
final class ConsoleRolePermission extends Model
{
    public $incrementing = false;

    protected $table = 'console_role_permission';

    protected $primaryKey = 'role';

    protected $keyType = 'string';

    public $timestamps = false;

    const UPDATED_AT = 'updated_at';

    protected $fillable = ['role', 'permissions', 'updated_by'];

    protected function casts(): array
    {
        return [
            'permissions' => 'array',
            'updated_at' => 'datetime',
        ];
    }
}
