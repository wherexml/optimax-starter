<?php

namespace App\Modules\Accounts;

use App\Core\Http\SchemaRequest;

/** 账户创建（LC-05）。 */
final class AccountCreateRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.accountCreateSchema';
    }

    protected function contractError(): string
    {
        return '请检查姓名、账户、初始密码及资料格式';
    }
}
