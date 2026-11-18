<?php

namespace App\Modules\Accounts;

use App\Core\Http\Resources\PaginatedResource;

/**
 * 账户分页响应（PaginatedResult { items, total, page, size } 唯一实现处的消费方）。
 */
final class AccountsPaginatedResource extends PaginatedResource
{
    protected function itemResource(): string
    {
        return AccountResource::class;
    }
}
