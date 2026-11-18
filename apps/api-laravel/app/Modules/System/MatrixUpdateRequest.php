<?php

namespace App\Modules\System;

use App\Core\Http\SchemaRequest;

/** 权限矩阵更新（LC-04）。 */
final class MatrixUpdateRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'permissions.systemPermissionsUpdateSchema';
    }

    protected function contractError(): string
    {
        return '请提交角色权限配置';
    }
}
