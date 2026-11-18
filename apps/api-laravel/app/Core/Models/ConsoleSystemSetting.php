<?php

namespace App\Core\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 全局系统设置（console_setting）：键值对（全局时区、AI 熔断开关，LC-03/04）。
 */
final class ConsoleSystemSetting extends Model
{
    public $incrementing = false;

    protected $table = 'console_setting';

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $timestamps = false;

    const UPDATED_AT = 'updated_at';

    protected $fillable = ['key', 'value', 'updated_by'];

    protected function casts(): array
    {
        return ['updated_at' => 'datetime'];
    }
}
