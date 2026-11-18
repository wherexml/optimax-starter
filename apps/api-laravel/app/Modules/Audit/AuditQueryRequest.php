<?php

namespace App\Modules\Audit;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * 审计查询入参（LC-01）：URL 查询参数不在契约产物内（契约覆盖 body），
 * 按 core/audit.ts auditQuerySchema 同口径逐条移植，经双栈对拍锁定。
 * 空白参数先剔除（与 Hono filter 行为一致）。
 */
final class AuditQueryRequest extends FormRequest
{
    /** @return array<string, list<string>> 查询参数走 Laravel 规则镜像 auditQuerySchema。 */
    public function rules(): array
    {
        $enums = self::contractEnums();
        $blank = fn (string $key): bool => trim((string) $this->query($key)) === '';

        return [
            'action' => $blank('action') ? [] : ['nullable', Rule::in($enums['auditActions'])],
            'actor' => $blank('actor') ? [] : ['nullable', 'string', 'max:80'],
            'source' => $blank('source') ? [] : ['nullable', Rule::in($enums['actorSources'])],
            'start' => $blank('start') ? [] : ['nullable', 'date_format:Y-m-d'],
            'end' => $blank('end') ? [] : ['nullable', 'date_format:Y-m-d'],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
            // size 超限按 Hono 语义收敛（Math.min）而非拒绝，控制器统一 min(100, size)。
            'size' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function validationData(): array
    {
        // 剔除空白参数后仅保留已声明键（对齐 Hono Object.fromEntries(filter)）。
        $keep = array_keys(array_filter($this->rules(), fn ($r): bool => $r !== []));
        $data = collect($this->query())->only($keep)->map(
            fn ($v): string => is_string($v) ? trim($v) : (string) $v,
        )->filter(fn (string $v): bool => $v !== '')->all();
        $data['page'] ??= 1;
        $data['size'] ??= 20;

        return $data;
    }

    /** 校验文案对齐 Hono 接口层通用中文。 */
    public function messages(): array
    {
        return [
            'action.in' => '筛选条件无效',
            'source.in' => '筛选条件无效',
            'start.date_format' => '筛选条件无效',
            'end.date_format' => '筛选条件无效',
            '*.integer' => '筛选条件无效',
            '*.min' => '筛选条件无效',
            '*.max' => '筛选条件无效',
        ];
    }

    /** @return array<string, mixed> */
    private static function contractEnums(): array
    {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }
        $file = (string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts')).'/enums.json';
        if (! is_file($file)) {
            throw new RuntimeException('enums.json 产物缺失：请运行 bun run contracts:generate');
        }
        $cache = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $cache;
    }
}
