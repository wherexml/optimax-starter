<?php

namespace App\Core\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * 资产（console_asset）。$fillable 对齐 contracts.assetInputSchema / assetPatchSchema。
 */
final class ConsoleAsset extends Model
{
    public $timestamps = false;

    protected $table = 'console_asset';

    protected $fillable = ['name', 'domain', 'owner', 'stage'];
}
