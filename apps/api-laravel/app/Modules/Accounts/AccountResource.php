<?php

namespace App\Modules\Accounts;

use App\Core\Models\ConsoleAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * 账户实体响应（对齐 contracts.accountSchema 形状；LB-07 样例、LC-05 复用）。
 *
 * @property ConsoleAccount $resource
 */
final class AccountResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => (int) $this->resource->id,
            'username' => (string) $this->resource->username,
            'name' => (string) $this->resource->name,
            'role' => (string) $this->resource->role,
            'active' => (bool) $this->resource->active,
            'email' => $this->resource->getAttributeValue('email'),
            'company' => $this->resource->getAttributeValue('company'),
            // withCount('sessions') 装载时输出（关系预载防 N+1，LB-07）。
            'sessions' => $this->when(isset($this->resource->sessions_count), fn () => (int) $this->resource->sessions_count),
        ];
    }
}
