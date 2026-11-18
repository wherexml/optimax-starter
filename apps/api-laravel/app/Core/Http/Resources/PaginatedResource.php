<?php

namespace App\Core\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

/**
 * PaginatedResult { items, total, page, size } 形状的唯一实现处（LB-07）。
 * 子类声明 itemResource()；LC 各模块响应必须经 Resource 输出，禁止手拼分页形状。
 *
 * @template TItemResource of JsonResource
 */
abstract class PaginatedResource extends JsonResource
{
    /** @return class-string<TItemResource> */
    abstract protected function itemResource(): string;

    /** @return array{items: list<mixed>, total: int, page: int, size: int} */
    public function toArray($request): array
    {
        $itemClass = $this->itemResource();

        return [
            'items' => collect($this->resource->items())
                ->map(fn (object $item): JsonResource => new $itemClass($item))
                ->map(fn (JsonResource $r): array => $r->toArray($request))
                ->all(),
            'total' => $this->resource->total(),
            'page' => $this->resource->currentPage(),
            'size' => $this->resource->perPage(),
        ];
    }
}
