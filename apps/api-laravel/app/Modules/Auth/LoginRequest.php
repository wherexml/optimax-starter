<?php

namespace App\Modules\Auth;

use App\Core\Http\SchemaRequest;

/** 登录入参（LB-05 最小实现；完整 auth 模块归 LC-02）。 */
final class LoginRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'contracts.credentialsSchema';
    }

    protected function contractError(): string
    {
        // 与 Hono modules/auth.ts 的 400 文案一致。
        return '请输入账户和密码';
    }
}
