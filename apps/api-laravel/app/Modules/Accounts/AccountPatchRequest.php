<?php

namespace App\Modules\Accounts;

use App\Core\Http\SchemaRequest;

/** 账户变更（LC-05）：路由 id 与入参在控制器分别校验。 */
final class AccountPatchRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.accountPatchSchema';
    }

    protected function contractError(): string
    {
        return '无效的账户设置';
    }
}
