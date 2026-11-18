<?php

namespace App\Core\Contracts;

use Opis\JsonSchema\Validator;
use RuntimeException;

/**
 * 契约产物注册表（LB-03）。
 *
 * 唯一消费物是 packages/api/json-schema/ 生成产物（LARAVEL.md 路线 A）：
 * - <module>.<SchemaName>.json：draft-2020-12 JSON Schema（zod 生成）。
 * - refines.json：zod `.refine()` 语义清单，由 ContractRefines 按同口径实现。
 *
 * 目录来源：env CONTRACTS_DIR（compose 挂载 packages/api/json-schema），
 * 默认 base_path('storage/contracts')。校验失败返回 null；调用方负责统一
 * 的接口层文案（对齐现有 Hono 语义：schema 层不透出字段级文案）。
 */
final class SchemaRegistry
{
    /** @var array<string, object> */
    private array $decoded = [];

    public function __construct(private readonly string $dir) {}

    public static function make(): self
    {
        $dir = (string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts'));

        return new self(rtrim($dir, '/'));
    }

    /** @return object 解码后的 JSON Schema（opis 2.x 接受对象形态 schema） */
    public function schema(string $name): object
    {
        if (! isset($this->decoded[$name])) {
            $file = $this->dir.'/'.$name.'.json';
            if (! is_file($file)) {
                throw new RuntimeException("contracts:generate 产物缺失：{$name}（请先在 packages/api 生成并提交）");
            }
            $decoded = json_decode((string) file_get_contents($file), false, 512, JSON_THROW_ON_ERROR);
            $this->decoded[$name] = $decoded;
        }

        return $this->decoded[$name];
    }

    /** @return array<int, array<string, mixed>> */
    public function refines(): array
    {
        $file = $this->dir.'/refines.json';
        if (! is_file($file)) {
            throw new RuntimeException('refines.json 产物缺失：请运行 bun run contracts:generate 并提交产物');
        }
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $decoded['refines'] ?? [];
    }

    /**
     * 对拍样本（scripts/e2e/fixtures/contract-parity.json 经 compose 挂载进产物目录；
     * 与 bun 侧 scripts/contracts-pararity.ts 读同一份文件，输出逐样本比对）。
     *
     * @return array<int, array<string, mixed>>
     */
    public function fixtures(): array
    {
        $file = $this->dir.'/parity-fixtures.json';
        if (! is_file($file)) {
            throw new RuntimeException('parity-fixtures.json 缺失：请挂载 scripts/e2e/fixtures/contract-parity.json');
        }

        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        return $decoded['fixtures'] ?? [];
    }

    /**
     * 校验数据是否满足契约 schema；通过返回 null，失败返回首个错误摘要。
     * 注意：TrimStrings 中间件已对输入做去空白（对齐 zod `.trim()` 语义）；
     * ConvertEmptyStringsToNull 已从 api 组移除（空串保留，对齐 zod 空串语义）。
     */
    public function validate(string $name, mixed $data): ?string
    {
        $validator = new Validator;
        // opis 2.x 要求对象形态数据；调用方一律传 PHP 数组，此处统一转换。
        $result = $validator->validate(self::toObject($data), $this->schema($name));

        if ($result->isValid()) {
            return null;
        }

        $error = $result->error();
        $path = $error?->data()->path() ?? [];

        return 'contract:'.$name.':'.implode('/', array_map(strval(...), $path));
    }

    /** PHP 数组 → stdClass 对象（opis 2.x 消费形态）。 */
    public static function toObject(mixed $data): mixed
    {
        return json_decode((string) json_encode($data), false, 512, JSON_THROW_ON_ERROR);
    }

    /** 对拍用：判定 +（失败时的）首个错误摘要，供双语言结果比对。 */
    public function verdict(string $name, mixed $data): array
    {
        $error = $this->validate($name, $data);
        if ($error === null) {
            return ['valid' => true];
        }

        return ['valid' => false, 'error' => $error];
    }
}
