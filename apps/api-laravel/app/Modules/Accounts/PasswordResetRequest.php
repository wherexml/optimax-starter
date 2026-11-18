<?php

namespace App\Modules\Accounts;

use App\Core\Http\SchemaRequest;

/** 管理员重置成员密码（LC-05）。 */
final class PasswordResetRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.passwordResetSchema';
    }

    protected function contractError(): string
    {
        return '新密码至少 10 位';
    }
}
