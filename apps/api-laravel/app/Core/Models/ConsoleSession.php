<?php

namespace App\Core\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 会话（console_session）：复用现有栈的表结构（LARAVEL.md D3，迁移期数据连续）。
 * 自定义 SessionHandler（LB-05）按本表读写。
 */
final class ConsoleSession extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $table = 'console_session';

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    protected $fillable = ['key', 'account', 'expires'];

    protected function casts(): array
    {
        return ['expires' => 'datetime'];
    }
}
