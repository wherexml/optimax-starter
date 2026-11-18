<?php

namespace App\Core\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * 资产（console_asset）。$fillable 对齐 contracts.assetInputSchema / assetPatchSchema。
 *
 * 零迁移使 Larastan 无法静态发现列名，@property 为真实列的显式声明（非压制）。
 *
 * @property int $id
 * @property string $name
 * @property string $domain
 * @property string $owner
 * @property string $stage
 */
final class ConsoleAsset extends Model
{
    public $timestamps = false;

    protected $table = 'console_asset';

    protected $fillable = ['name', 'domain', 'owner', 'stage'];

    /** @param  Builder<self>  $query 单个或多个登记状态（LC-06 多选筛选复用）。 */
    public function scopeStage(Builder $query, string|array $stage): Builder
    {
        return $query->whereIn('stage', is_array($stage) ? array_values($stage) : [$stage]);
    }
}
