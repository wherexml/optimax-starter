<?php

namespace App\Modules\Attachments;

use App\Core\Audit\AuditWriter;
use App\Core\Auth\Actor;
use App\Core\Http\Concerns\LocksPermission;
use App\Core\Http\ConsoleResponse;
use App\Core\Models\ConsoleAttachment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 附件管理（LD-02）：上传（multipart，策略来自 attachments.policy.json 单源产物）、
 * 分页列表、签名下载 URL（local=HMAC 临时链接 / s3=presigned）、删除（同事务审计）。
 * 存储形态：D8 —— ATTACHMENT_DISK=local 开发态；S3 兼容 OSS（含 MinIO 验证）生产态。
 */
final class AttachmentsController
{
    use LocksPermission;

    private const POLICY_FILE = 'attachments.policy.json';

    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $size = min(100, max(1, (int) $request->query('size', 20)));

        $query = ConsoleAttachment::query()->with('uploader')->orderByDesc('id');
        $total = (clone $query)->count();
        $items = (clone $query)->forPage($page, $size)->get()->map(fn (ConsoleAttachment $row): array => [
            'id' => (int) $row->id,
            'name' => (string) $row->name,
            'mime' => (string) $row->mime,
            'size' => (int) $row->size,
            'uploadedByUsername' => $row->uploader?->getAttributeValue('username'),
            'createdAt' => ConsoleResponse::isoTime($row->getAttributeValue('created_at')),
        ])->all();

        return ConsoleResponse::json(['items' => $items, 'total' => $total, 'page' => $page, 'size' => $size]);
    }

    /** POST /console/attachments：multipart 上传，落盘 + 元数据 + 审计同事务。 */
    public function store(UploadRequest $request): JsonResponse
    {
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);
        $file = $request->file('file');
        assert($file !== null);

        $disk = self::disk();
        $sha = hash_file('sha256', $file->getRealPath());
        if ($sha === false) {
            throw new HttpException(500, '服务内部错误');
        }
        $path = 'attachments/'.substr($sha, 0, 2).'/'.substr($sha, 2).'.'.$file->getClientOriginalExtension();

        $row = DB::transaction(function () use ($actor, $file, $disk, $sha, $path): array {
            $self = $this->lockPermission($actor, 'attachments:manage');

            if (! Storage::disk($disk)->put($path, fopen($file->getRealPath(), 'rb'))) {
                throw new HttpException(500, '附件落盘失败');
            }

            $record = ConsoleAttachment::query()->create([
                'name' => (string) $file->getClientOriginalName(),
                'mime' => (string) $file->getClientMimeType(),
                'size' => (int) $file->getSize(),
                'disk' => $disk,
                'path' => $path,
                'sha256' => $sha,
                'uploaded_by' => $actor->id,
            ]);

            AuditWriter::auditResource('attachment.create', $this->partyOf($self),
                ['id' => (int) $record->id, 'code' => self::code((int) $record->id), 'name' => (string) $record->name],
                ['mime' => (string) $record->mime, 'size' => (int) $record->size]);

            return [
                'id' => (int) $record->id,
                'name' => (string) $record->name,
                'mime' => (string) $record->mime,
                'size' => (int) $record->size,
                'uploadedByUsername' => (string) $self->username,
                'createdAt' => ConsoleResponse::isoTime($record->getAttributeValue('created_at')),
            ];
        });

        return ConsoleResponse::json($row, 201);
    }

    /** GET /console/attachments/{id}/url：签名下载 URL（TTL 进契约产物）。 */
    public function url(Request $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的附件');
        }
        $record = ConsoleAttachment::query()->where('id', $id)->first();
        if ($record === null) {
            throw new HttpException(404, '附件不存在');
        }
        $ttl = self::policy()['urlTtlSeconds'];
        $expiresAt = now()->addSeconds($ttl)->utc();

        // URL 基址用 APP_URL（公网可解析）：直连/代理形态下 request Host 可能是内网目标名。
        $base = rtrim((string) config('app.url'), '/');
        $url = $record->disk === 'attachments_local'
            ? $base.'/console/attachments/file/'.$record->id.'?expires='.$expiresAt->timestamp.'&token='.$this->signToken((int) $record->id, $expiresAt->timestamp)
            : Storage::disk((string) $record->disk)->temporaryUrl((string) $record->path, $expiresAt);

        return ConsoleResponse::json(['url' => $url, 'expiresAt' => $expiresAt->format('Y-m-d\TH:i:s.v\Z')]);
    }

    /** GET /console/attachments/file/{id}：local 盘 HMAC 临时链接出口（s3 走 presigned 不经过这里）。 */
    public function serve(Request $request, int $id): StreamedResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的附件');
        }
        $expires = (int) $request->query('expires', 0);
        $token = (string) $request->query('token', '');
        if ($expires < time() || ! hash_equals($this->signToken($id, $expires), $token)) {
            throw new HttpException(403, '下载链接已过期');
        }
        $record = ConsoleAttachment::query()->where('id', $id)->first();
        if ($record === null || $record->disk !== 'attachments_local') {
            throw new HttpException(404, '附件不存在');
        }
        if (! Storage::disk('attachments_local')->exists((string) $record->path)) {
            throw new HttpException(404, '附件不存在');
        }

        return response()->streamDownload(function () use ($record): void {
            echo Storage::disk('attachments_local')->get((string) $record->path);
        }, (string) $record->name, ['Content-Type' => (string) $record->mime]);
    }

    /** DELETE /console/attachments/{id}：删文件 + 元数据 + 审计同事务。 */
    public function destroy(Request $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的附件');
        }
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        DB::transaction(function () use ($actor, $id): void {
            $self = $this->lockPermission($actor, 'attachments:manage');

            $record = ConsoleAttachment::query()->where('id', $id)->lockForUpdate()->first();
            if ($record === null) {
                throw new HttpException(404, '附件不存在');
            }
            $resource = ['id' => (int) $record->id, 'code' => self::code((int) $record->id), 'name' => (string) $record->name];
            $detail = ['mime' => (string) $record->mime, 'size' => (int) $record->size];
            $record->delete();
            Storage::disk((string) $record->disk)->delete((string) $record->path);

            AuditWriter::auditResource('attachment.delete', $this->partyOf($self), $resource, $detail);
        });

        return ConsoleResponse::json(['ok' => true]);
    }

    /** @return array{mimeWhitelist: list<string>, maxBytes: int, urlTtlSeconds: int} */
    private static function policy(): array
    {
        $file = rtrim((string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts')), '/').'/'.self::POLICY_FILE;
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $decoded;
    }

    /** @return string local（开发）或 attachments_s3（OSS/MinIO） */
    private static function disk(): string
    {
        return getenv('ATTACHMENT_DISK') === 's3' ? 'attachments_s3' : 'attachments_local';
    }

    private static function code(int $id): string
    {
        return 'AT-'.str_pad((string) $id, 3, '0', STR_PAD_LEFT);
    }

    private function signToken(int $id, int $expires): string
    {
        return hash_hmac('sha256', $id.'|'.$expires, (string) config('app.key'));
    }
}
