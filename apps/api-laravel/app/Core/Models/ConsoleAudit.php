<?php

namespace App\Core\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * 操作日志（console_audit）：只追加。写路径必须与状态变更同一事务，
 * 由 AuditWriter（LB-06）唯一入口写入。模型层拒绝更新与删除，
 * 保证「只追加」不变量不依赖调用方自觉。
 *
 * 零迁移使 Larastan 无法静态发现列名，@property 为真实列的显式声明（非压制）。
 *
 * @property int $id
 * @property CarbonInterface $at
 * @property string $action
 * @property string $actor_source
 * @property int|null $actor_id
 * @property string $actor_username
 * @property string $actor_name
 * @property int|null $target_id
 * @property string|null $target_username
 * @property string|null $target_name
 * @property array<string, mixed> $detail
 */
final class ConsoleAudit extends Model
{
    public $timestamps = false;

    protected $table = 'console_audit';

    protected $fillable = [
        'action',
        'actor_source',
        'actor_id',
        'actor_username',
        'actor_name',
        'target_id',
        'target_username',
        'target_name',
        'detail',
    ];

    public function actor(): BelongsTo
    {
        return $this->belongsTo(ConsoleAccount::class, 'actor_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(ConsoleAccount::class, 'target_id');
    }

    /** @param  Builder<self>  $query start/end 为 YYYY-MM-DD（audit.ts daySchema 语义，含当日）。 */
    public function scopeTimeWindow(Builder $query, ?string $start, ?string $end): Builder
    {
        return $query
            ->when($start !== null, fn (Builder $q): Builder => $q->where('at', '>=', $start.' 00:00:00'))
            ->when($end !== null, fn (Builder $q): Builder => $q->where('at', '<=', $end.' 23:59:59.999999'));
    }

    /** @param  Builder<self>  $query human/agent（ACTOR_SOURCES 语义）。 */
    public function scopeSource(Builder $query, string $source): Builder
    {
        return $query->where('actor_source', $source);
    }

    protected function casts(): array
    {
        return [
            'at' => 'datetime',
            'detail' => 'array',
        ];
    }

    public function save(array $options = []): bool
    {
        if ($this->exists) {
            throw new RuntimeException('console_audit 只追加，禁止更新');
        }

        return parent::save($options);
    }

    public function delete(): bool
    {
        throw new RuntimeException('console_audit 只追加，禁止删除');
    }
}
