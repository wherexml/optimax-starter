<?php

namespace App\Core\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 账户（console_account）。schema 权威在 Drizzle（LARAVEL.md D2，零迁移）。
 * $fillable 对齐 contracts.accountCreateSchema / accountPatchSchema 字段集；
 * hash 不入 fillable——密码只能经 Hash 服务写入（LB-05）。
 *
 * 零迁移使 Larastan 无法静态发现列名，@property 为真实列的显式声明（非压制）。
 *
 * @property int $id
 * @property string $username
 * @property string $name
 * @property string $role
 * @property bool $active
 * @property string $hash
 * @property string|null $email
 * @property string|null $company
 */
final class ConsoleAccount extends Model
{
    public $timestamps = false;

    protected $table = 'console_account';

    protected $fillable = ['username', 'name', 'role', 'active', 'email', 'company'];

    protected function casts(): array
    {
        return ['active' => 'boolean'];
    }
}
