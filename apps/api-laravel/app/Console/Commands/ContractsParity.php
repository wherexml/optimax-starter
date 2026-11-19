<?php

namespace App\Console\Commands;

use App\Core\Contracts\ContractRefines;
use App\Core\Contracts\SchemaRegistry;
use Illuminate\Console\Command;

/**
 * 契约双语言对拍（LB-03）：同一批样本在 Zod（bun scripts/contracts-pararity.ts）
 * 与本消费层（JSON Schema + ContractRefines）上逐样本判定，结果必须一致。
 * 样本文件由 compose 挂载至产物目录（parity-fixtures.json）。
 */
final class ContractsParity extends Command
{
    protected $signature = 'contracts:parity';

    protected $description = 'Run contract parity fixtures through the JSON Schema consumption layer';

    public function handle(): int
    {
        $registry = SchemaRegistry::make();
        $refines = new ContractRefines;
        $refines->assertCovers($registry->refines());

        $results = [];
        foreach ($registry->fixtures() as $fixture) {
            $schema = (string) $fixture['schema'];
            // 对齐 HTTP 层 TrimStrings 中间件语义（zod `.trim()` 的等价物）。
            $data = $this->trimStrings($fixture['data']);

            $schemaError = $registry->validate($schema, $data);
            $refineError = $refines->check($schema, $data);

            $results[] = [
                'id' => (string) $fixture['id'],
                'valid' => $schemaError === null && $refineError === null,
            ];
        }

        $this->line(json_encode($results, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return self::SUCCESS;
    }

    /** @return array<string, mixed>|mixed 递归去除字符串两端空白（等价 TrimStrings）。 */
    private function trimStrings(mixed $data): mixed
    {
        if (is_string($data)) {
            return trim($data);
        }
        if (is_array($data)) {
            return collect($data)->map(fn (mixed $v): mixed => $this->trimStrings($v))->all();
        }

        return $data;
    }
}
