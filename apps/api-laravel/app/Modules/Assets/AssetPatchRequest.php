<?php

namespace App\Modules\Assets;

use App\Core\Http\SchemaRequest;

/** 资产变更（LC-06）。 */
final class AssetPatchRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.assetPatchSchema';
    }

    protected function contractError(): string
    {
        return '无效的资产变更';
    }
}
