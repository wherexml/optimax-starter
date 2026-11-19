<?php

namespace App\Modules\Assets;

use App\Core\Http\SchemaRequest;

/** 资产创建（LC-06）。 */
final class AssetCreateRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.assetInputSchema';
    }

    protected function contractError(): string
    {
        return '请完整填写资产名称、业务域、责任团队与登记状态';
    }
}
