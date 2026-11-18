<?php

namespace App\Core\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 附件元数据（console_attachment，LD-02）：文件本体在 Storage 磁盘，本表只存元数据。
 *
 * @property int $id
 * @property string $name
 * @property string $mime
 * @property int $size
 * @property string $disk
 * @property string $path
 * @property string $sha256
 * @property int|null $uploaded_by
 * @property CarbonInterface $created_at
 */
final class ConsoleAttachment extends Model
{
    const UPDATED_AT = null;

    protected $table = 'console_attachment';

    protected $fillable = ['name', 'mime', 'size', 'disk', 'path', 'sha256', 'uploaded_by'];

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(ConsoleAccount::class, 'uploaded_by');
    }

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
