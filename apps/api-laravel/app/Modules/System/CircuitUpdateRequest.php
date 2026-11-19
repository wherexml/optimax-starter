<?php

namespace App\Modules\System;

use App\Core\Http\SchemaRequest;

/** AI 熔断开关（LC-04）。 */
final class CircuitUpdateRequest extends SchemaRequest
{
    protected function contract(): string
    {
        return 'system.aiCircuitUpdateSchema';
    }

    protected function contractError(): string
    {
        return '无效的熔断开关状态';
    }
}
