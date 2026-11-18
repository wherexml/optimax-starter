<?php

namespace App\Modules\Audit;

use App\Core\Audit\AuditWriter;
use App\Core\Http\ConsoleResponse;
use App\Core\Models\ConsoleAudit;
use App\Core\System\SystemSettings;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 操作日志只读接口（LC-01）：GET /console/audit。
 * 语义对齐 apps/server/src/modules/audit.ts：分页、筛选、时区口径与响应形状。
 */
final class AuditController
{
    public function index(AuditQueryRequest $request): JsonResponse
    {
        $start = $request->validated('start');
        $end = $request->validated('end');
        if ($start !== null && $end !== null && strcmp((string) $end, (string) $start) < 0) {
            throw new HttpException(400, '结束日期不能早于开始日期');
        }

        $timezone = (string) (SystemSettings::get('timezone') ?? 'Asia/Shanghai');

        $query = ConsoleAudit::query()
            ->when($request->validated('action') !== null,
                fn ($q) => $q->where('action', (string) $request->validated('action')))
            ->when($request->validated('source') !== null,
                fn ($q) => $q->where('actor_source', (string) $request->validated('source')))
            ->when($request->validated('actor') !== null,
                fn ($q) => $q->where(fn ($w) => $w
                    ->where('actor_name', 'ilike', '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $request->validated('actor')).'%')
                    ->orWhere('actor_username', 'ilike', '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $request->validated('actor')).'%')));

        if ($start !== null) {
            $dayStart = $this->dayStart((string) $start, $timezone);
            $query->where('at', '>=', $dayStart);
        }
        if ($end !== null) {
            $nextDayStart = $this->dayStart((string) $end, $timezone)->addDay();
            $query->where('at', '<', $nextDayStart);
        }

        $page = max(1, (int) $request->validated('page', 1));
        $size = min(AuditWriter::MAX_PAGE, max(1, (int) $request->validated('size', 20)));

        $total = (clone $query)->count();
        $items = (clone $query)
            ->orderByDesc('at')
            ->orderByDesc('id')
            ->forPage($page, $size)
            ->get()
            ->map(fn (ConsoleAudit $row): array => [
                'id' => (int) $row->id,
                'at' => $row->at->utc()->format('Y-m-d\TH:i:s.v\Z'),
                'action' => (string) $row->action,
                'actorSource' => (string) $row->getAttributeValue('actor_source'),
                'actorId' => $row->getAttributeValue('actor_id') !== null ? (int) $row->getAttributeValue('actor_id') : null,
                'actorUsername' => (string) $row->getAttributeValue('actor_username'),
                'actorName' => (string) $row->getAttributeValue('actor_name'),
                'targetId' => $row->getAttributeValue('target_id') !== null ? (int) $row->getAttributeValue('target_id') : null,
                'targetUsername' => $row->getAttributeValue('target_username'),
                'targetName' => $row->getAttributeValue('target_name'),
                'detail' => $row->getAttributeValue('detail'),
            ])
            ->all();

        return ConsoleResponse::json([
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'size' => $size,
            'timezone' => $timezone,
        ]);
    }

    /** 配置时区的当日零点（dayStart 同口径；Carbon 原生处理 DST/时区）。 */
    private function dayStart(string $day, string $timezone): CarbonInterface
    {
        return Carbon::parse($day, $timezone)->startOfDay()->utc();
    }
}
