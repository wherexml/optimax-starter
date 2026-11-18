<?php

namespace App\Core\System;

use App\Core\Models\ConsoleSystemSetting;
use Illuminate\Support\Facades\Cache;

/**
 * 全局系统设置读写（console_setting，LB-07）：
 * 读走缓存（TTL 2 秒，与权限矩阵缓存口径一致），写即失效（写路径主动失效）。
 * LC-03/04 消费：timezone / ai_circuit。生效点与失效点登记见 app/Core/README.md。
 */
final class SystemSettings
{
    private const CACHE_TTL_SECONDS = 2;

    private const CACHE_PREFIX = 'console_setting:';

    /** 写后缓存立即失效（写路径主动失效）。 */
    public static function put(string $key, string $value, ?int $updatedBy = null): void
    {
        ConsoleSystemSetting::query()->updateOrCreate(
            ['key' => $key],
            ['value' => $value, 'updated_by' => $updatedBy],
        );
        Cache::forget(self::CACHE_PREFIX.$key);
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $cached = Cache::get(self::CACHE_PREFIX.$key);
        if ($cached !== null) {
            return is_string($cached) ? $cached : $default;
        }

        $value = ConsoleSystemSetting::query()->where('key', $key)->value('value');
        if ($value === null) {
            return $default;
        }

        Cache::put(self::CACHE_PREFIX.$key, $value, self::CACHE_TTL_SECONDS);

        return $value;
    }

    /** 读后写回的缓存失效（与 ConsoleAuth::invalidatePermissionCache 同属写路径主动失效）。 */
    public static function forget(string $key): void
    {
        Cache::forget(self::CACHE_PREFIX.$key);
    }
}
