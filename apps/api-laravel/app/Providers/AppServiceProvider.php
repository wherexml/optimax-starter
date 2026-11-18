<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use RuntimeException;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // 生产种子拦截（LB-06）：对齐 core/config.ts 启动守卫。
        // deploy-production.sh 的 STARTER_SEED_DEMO 预检在栈级拒绝同一共享键，此处是第二道防线。
        if (config('app.env') === 'production' && getenv('STARTER_SEED_DEMO') === 'true') {
            throw new RuntimeException('生产环境禁止开启 STARTER_SEED_DEMO');
        }
    }
}
