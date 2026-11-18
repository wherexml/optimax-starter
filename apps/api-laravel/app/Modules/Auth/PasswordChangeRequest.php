<?php

namespace App\Modules\Auth;

use App\Core\Http\SchemaRequest;

/** 密码修改（LC-02）：契约 passwordChangeSchema。 */
final class PasswordChangeRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.passwordChangeSchema';
    }

    protected function contractError(): string
    {
        return '新密码需为 10–256 位';
    }
}
