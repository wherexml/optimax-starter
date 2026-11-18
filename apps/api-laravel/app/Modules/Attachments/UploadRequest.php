<?php

namespace App\Modules\Attachments;

use Illuminate\Foundation\Http\FormRequest;
use RuntimeException;

/**
 * 附件上传（LD-02）：multipart 入参不在 JSON 契约产物内，
 * 白名单/大小以 attachments.policy.json（单一事实源）校验。
 */
final class UploadRequest extends FormRequest
{
    /** @return array{mime: list<string>, max: int} */
    private static function policy(): array
    {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }
        $file = rtrim((string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts')), '/').'/attachments.policy.json';
        if (! is_file($file)) {
            throw new RuntimeException('attachments.policy.json 产物缺失：请运行 bun run contracts:generate');
        }
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        $cache = ['mime' => $decoded['mimeWhitelist'], 'max' => (int) $decoded['maxBytes']];

        return $cache;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        $policy = self::policy();

        return [
            'file' => ['required', 'file', 'max:'.intdiv($policy['max'], 1024), 'mimes:'.self::extensionsFor($policy['mime'])],
        ];
    }

    /** @param  list<string>  $mimes */
    private static function extensionsFor(array $mimes): string
    {
        $map = [
            'image/png' => 'png',
            'image/jpeg' => 'jpg,jpeg',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            'application/pdf' => 'pdf',
            'text/plain' => 'txt',
            'text/csv' => 'csv',
            'application/zip' => 'zip',
        ];

        return implode(',', array_values(array_intersect_key($map, array_flip($mimes))));
    }

    public function messages(): array
    {
        $policy = self::policy();

        return [
            'file.required' => '请选择要上传的文件',
            'file.max' => '文件大小超过上限（'.intdiv($policy['max'], 1024).'KB）',
            'file.mimes' => '仅支持：'.implode('、', $policy['mime']),
        ];
    }
}
