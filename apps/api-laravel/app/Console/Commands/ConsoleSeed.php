<?php

namespace App\Console\Commands;

use App\Core\Models\ConsoleAccount;
use App\Core\Models\ConsoleAsset;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

/**
 * 演示种子（LB-08）：core/seed.ts initializeConsole 的对等移植。
 *
 * 幂等：管理员缺失则建（super_admin，STARTER_ADMIN_PASSWORD 哈希）；存在但
 * 非 super_admin/停用则修正；12 条演示资产按唯一名 onConflict 忽略。
 * 生产拒绝：APP_ENV=production 时无论开关一律退出非零（对齐 assertProductionSafety）。
 */
final class ConsoleSeed extends Command
{
    /** @var list<string> */
    private const DEMO_SYSTEMS = [
        '采购门户', '库存服务', '订单中心', '供应商门户', '合同服务', '仓储平台',
        '运输管理', '结算中心', '质量平台', '报表服务', '数据目录', '客户门户',
    ];

    /** @var list<string> */
    private const DOMAINS = ['采购', '履约', '运营'];

    /** @var list<string> */
    private const OWNERS = ['业务运营组', '交付组', '平台组'];

    protected $signature = 'console:seed';

    protected $description = 'Idempotently seed the demo admin and demo assets (refuses in production)';

    public function handle(): int
    {
        if (config('app.env') === 'production') {
            $this->error('生产环境禁止执行演示种子（console:seed）');

            return self::FAILURE;
        }
        if (getenv('STARTER_SEED_DEMO') === 'false') {
            $this->info('STARTER_SEED_DEMO=false，跳过演示种子。');

            return self::SUCCESS;
        }

        $adminUsername = (string) (getenv('STARTER_ADMIN_USERNAME') ?: 'demo@optimax.hk');
        $password = (string) (getenv('STARTER_ADMIN_PASSWORD') ?: '');
        if ($password === '') {
            throw new RuntimeException('缺少 STARTER_ADMIN_PASSWORD：无法初始化引导管理员');
        }

        $existing = ConsoleAccount::query()->where('username', $adminUsername)->first(['id', 'role', 'active']);
        if ($existing === null) {
            // hash 不在 $fillable（LB-04 防提权白名单），显式属性赋值写入而非 mass create。
            $admin = new ConsoleAccount;
            $admin->username = $adminUsername;
            $admin->name = '本地管理员';
            $admin->role = 'super_admin';
            $admin->active = true;
            $admin->setAttribute('hash', Hash::make($password));
            $admin->save();
            $this->info("已创建演示管理员 {$adminUsername}");
        } elseif ($existing->role !== 'super_admin' || ! $existing->active) {
            ConsoleAccount::query()->where('id', $existing->id)->update(['role' => 'super_admin', 'active' => true]);
            $this->info("已修正演示管理员 {$adminUsername} 为启用的超级管理员");
        }

        $before = ConsoleAsset::count();
        foreach (self::DEMO_SYSTEMS as $i => $name) {
            ConsoleAsset::query()->firstOrCreate(
                ['name' => $name],
                [
                    'domain' => self::DOMAINS[$i % 3],
                    'owner' => self::OWNERS[$i % 3],
                    'stage' => $i % 4 === 1 ? '待复核' : '已登记',
                ],
            );
        }
        $added = ConsoleAsset::count() - $before;
        $this->info("演示资产：新增 {$added}，总计 ".ConsoleAsset::count());

        return self::SUCCESS;
    }
}
