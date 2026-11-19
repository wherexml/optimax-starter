<?php

namespace App\Core\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * 全局系统设置（console_setting）：键值对（全局时区、AI 熔断开关，LC-03/04）。
 *
 * 零迁移使 Larastan 无法静态发现列名，@property 为真实列的显式声明（非压制）。
 *
 * @property string $key
 * @property string $value
 * @property CarbonInterface|null $updated_at
 * @property int|null $updated_by
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
