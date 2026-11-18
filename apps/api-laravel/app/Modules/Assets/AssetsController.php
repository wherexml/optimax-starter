<?php

namespace App\Modules\Assets;

use App\Core\Audit\AuditWriter;
use App\Core\Audit\Party;
use App\Core\Auth\Actor;
use App\Core\Auth\ConsoleAuth;
use App\Core\Http\ConsoleResponse;
use App\Core\Models\ConsoleAccount;
use App\Core\Models\ConsoleAsset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 资产台账（LC-06）：modules/assets.ts 同口径。
 * GET /assets 全量（客户端筛选兼容）；GET /assets/page 服务端分页筛选；
 * 写路径同事务审计（assetResource：AS-%03d 编号 + entityId）。
 */
final class AssetsController
{
    /** GET /console/assets：全量列表（assets:read）。 */
    public function index(): JsonResponse
    {
        return ConsoleResponse::json(
            ConsoleAsset::query()->orderBy('id')->get()->map(fn (ConsoleAsset $row): array => [
                'id' => (int) $row->id,
                'name' => (string) $row->name,
                'domain' => (string) $row->domain,
                'owner' => (string) $row->owner,
                'stage' => (string) $row->stage,
            ])->all()
        );
    }

    /** GET /console/assets/page：服务端分页 + 多选筛选（q/qOp/stage[]/domain[]）。 */
    public function page(Request $request): JsonResponse
    {
        // scalar 参数走规则镜像 assetPageQuerySchema；stage/domain 走多值解析。
        $q = trim((string) $request->query('q', ''));
        $qOp = trim((string) $request->query('qOp', ''));
        $page = (int) $request->query('page', 1);
        $size = (int) $request->query('size', 20);

        if ($q !== '' && strlen($q) > 200) {
            throw new HttpException(400, '筛选参数无效');
        }
        if ($qOp !== '' && ! in_array($qOp, ['contains', 'equals'], true)) {
            throw new HttpException(400, '筛选参数无效');
        }
        if ($page < 1 || $page > 100000) {
            throw new HttpException(400, '筛选参数无效');
        }
        $size = min(AuditWriter::MAX_PAGE, max(1, $size));

        $stages = $this->normalizeListParam($request, 'stage', 20);
        $allowedStages = ['已登记', '待复核'];
        if (collect($stages)->contains(fn (string $s): bool => ! in_array($s, $allowedStages, true))) {
            throw new HttpException(400, '无效的登记状态');
        }
        $domains = $this->normalizeListParam($request, 'domain', 80);

        $query = ConsoleAsset::query()
            ->when($q !== '', function ($builder) use ($q, $qOp): void {
                if ($qOp === 'equals') {
                    $builder->where('name', $q);
                } else {
                    $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
                    $builder->where('name', 'ilike', '%'.$escaped.'%');
                }
            })
            ->when($stages !== [], fn ($builder) => $builder->whereIn('stage', $stages))
            ->when($domains !== [], fn ($builder) => $builder->whereIn('domain', $domains));

        $total = (clone $query)->count();
        $items = (clone $query)->orderBy('id')->forPage($page, $size)->get()
            ->map(fn (ConsoleAsset $row): array => [
                'id' => (int) $row->id,
                'name' => (string) $row->name,
                'domain' => (string) $row->domain,
                'owner' => (string) $row->owner,
                'stage' => (string) $row->stage,
            ])->all();

        return ConsoleResponse::json(['items' => $items, 'total' => $total, 'page' => $page, 'size' => $size]);
    }

    /** POST /console/assets：创建（409 重名；auditResource detail 记录 domain/owner/stage）。 */
    public function store(AssetCreateRequest $request): JsonResponse
    {
        $data = $request->input();
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        $row = DB::transaction(function () use ($actor, $data): array {
            $self = $this->lockPermission($actor, 'assets:manage');

            $exists = ConsoleAsset::query()->where('name', (string) $data['name'])->exists();
            if ($exists) {
                throw new HttpException(409, '资产名称已存在');
            }

            $asset = ConsoleAsset::query()->create([
                'name' => (string) $data['name'],
                'domain' => (string) $data['domain'],
                'owner' => (string) $data['owner'],
                'stage' => (string) $data['stage'],
            ]);

            AuditWriter::auditResource('asset.create', $this->partyOf($self), $this->assetResource($asset),
                ['domain' => (string) $asset->domain, 'owner' => (string) $asset->owner, 'stage' => (string) $asset->stage]);

            return [
                'id' => (int) $asset->id,
                'name' => (string) $asset->name,
                'domain' => (string) $asset->domain,
                'owner' => (string) $asset->owner,
                'stage' => (string) $asset->stage,
            ];
        });

        return ConsoleResponse::json($row, 201);
    }

    /** PATCH /console/assets/{id}：变更（重名 409；404；auditResource detail 形状对齐）。 */
    public function update(AssetPatchRequest $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的资产变更');
        }
        $change = $request->input();
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        $after = DB::transaction(function () use ($actor, $id, $change): ConsoleAsset {
            $self = $this->lockPermission($actor, 'assets:manage');

            $asset = ConsoleAsset::query()->where('id', $id)->lockForUpdate()->first();
            if ($asset === null) {
                throw new HttpException(404, '资产不存在');
            }

            $set = [];
            if (isset($change['name']) && $change['name'] !== $asset->name) {
                $set['name'] = (string) $change['name'];
            }
            if (isset($change['domain']) && $change['domain'] !== $asset->domain) {
                $set['domain'] = (string) $change['domain'];
            }
            if (isset($change['owner']) && $change['owner'] !== $asset->owner) {
                $set['owner'] = (string) $change['owner'];
            }
            if (isset($change['stage']) && $change['stage'] !== $asset->stage) {
                $set['stage'] = (string) $change['stage'];
            }

            if ($set !== []) {
                $before = ['name' => (string) $asset->name, 'stage' => (string) $asset->stage];
                if (isset($set['name'])) {
                    $dup = ConsoleAsset::query()->where('name', $set['name'])->where('id', '!=', $id)->exists();
                    if ($dup) {
                        throw new HttpException(409, '资产名称已存在');
                    }
                }
                $asset->fill($set)->save();

                $detail = ['fields' => array_keys($set)];
                if (isset($set['stage'])) {
                    $detail['from'] = $before['stage'];
                    $detail['to'] = (string) $asset->stage;
                } elseif (isset($set['name'])) {
                    $detail['from'] = $before['name'];
                    $detail['to'] = (string) $asset->name;
                }
                AuditWriter::auditResource('asset.update', $this->partyOf($self), $this->assetResource($asset), $detail);
            }

            return $asset;
        });

        return ConsoleResponse::json([
            'id' => (int) $after->id,
            'name' => (string) $after->name,
            'domain' => (string) $after->domain,
            'owner' => (string) $after->owner,
            'stage' => (string) $after->stage,
        ]);
    }

    /** DELETE /console/assets/{id}：删除（404；auditResource）。 */
    public function destroy(Request $request, int $id): JsonResponse
    {
        if ($id <= 0) {
            throw new HttpException(400, '无效的资产');
        }
        $actor = $request->attributes->get('consoleActor');
        assert($actor instanceof Actor);

        DB::transaction(function () use ($actor, $id): void {
            $self = $this->lockPermission($actor, 'assets:manage');

            $asset = ConsoleAsset::query()->where('id', $id)->first();
            if ($asset === null) {
                throw new HttpException(404, '资产不存在');
            }
            $resource = $this->assetResource($asset);
            $asset->delete();

            AuditWriter::auditResource('asset.delete', $this->partyOf($self), $resource,
                ['domain' => (string) $asset->domain, 'owner' => (string) $asset->owner, 'stage' => (string) $asset->stage]);
        });

        return ConsoleResponse::json(['ok' => true]);
    }

    /** @return array{code: string, name: string, id: int} assetResource 同口径（AS-%03d）。 */
    private function assetResource(ConsoleAsset $asset): array
    {
        return ['id' => (int) $asset->id, 'code' => 'AS-'.str_pad((string) $asset->id, 3, '0', STR_PAD_LEFT), 'name' => (string) $asset->name];
    }

    /** normalizeListParam 同口径：重复键 + JSON 数组串，去空白去重，单项长度上限，最多 20 项。 */
    private function normalizeListParam(Request $request, string $key, int $maxLen): array
    {
        $raw = $request->query($key);
        $values = is_array($raw) ? $raw : ($raw !== null ? [$raw] : []);
        $out = [];
        foreach ($values as $item) {
            $trimmed = trim((string) $item);
            if ($trimmed === '') {
                continue;
            }
            if (str_starts_with($trimmed, '[')) {
                $decoded = json_decode($trimmed, true);
                if (is_array($decoded)) {
                    foreach ($decoded as $sub) {
                        $subTrimmed = trim((string) $sub);
                        if ($subTrimmed !== '' && strlen($subTrimmed) <= $maxLen) {
                            $out[] = $subTrimmed;
                        }
                    }

                    continue;
                }
            }
            if (strlen($trimmed) <= $maxLen) {
                $out[] = $trimmed;
            }
        }

        return array_slice(array_values(array_unique($out)), 0, 20);
    }

    private function partyOf(ConsoleAccount $self): Party
    {
        return new Party((int) $self->id, (string) $self->username, (string) $self->name);
    }

    private function lockPermission(Actor $actor, string $permission): ConsoleAccount
    {
        DB::selectOne('select pg_advisory_xact_lock(7140301)');
        $self = ConsoleAccount::query()->where('id', $actor->id)->first(['id', 'username', 'name', 'role', 'active']);
        if ($self === null || ! $self->active) {
            throw new HttpException(403, '无权执行该操作');
        }
        $effective = ConsoleAuth::effectivePermissions((string) $self->role);
        if (! in_array($permission, $effective, true)) {
            throw new HttpException(403, '无权执行该操作');
        }

        return $self;
    }
}
