<?php

namespace App\Modules\System;

use App\Core\Http\SchemaRequest;

/** 系统时区更新（LC-04）。 */
final class TimezoneUpdateRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'system.systemSettingsUpdateSchema';
    }

    protected function contractError(): string
    {
        return '请选择有效的系统时区';
    }
}
