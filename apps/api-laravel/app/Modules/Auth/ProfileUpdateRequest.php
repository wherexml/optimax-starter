<?php

namespace App\Modules\Auth;

use App\Core\Http\SchemaRequest;

/** 个人资料更新（LC-02）：契约 profileInputSchema，防提权由 .strict() 映射保证。 */
final class ProfileUpdateRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.profileInputSchema';
    }

    protected function contractError(): string
    {
        return '请检查显示名称、邮箱和公司';
    }
}
