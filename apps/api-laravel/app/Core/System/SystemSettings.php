<?php

namespace App\Core\System;

use App\Core\Audit\AuditWriter;
use App\Core\Audit\Party;
use App\Core\Models\ConsoleSystemSetting;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * 系统设置服务（LC-03/04）：core/system-settings.ts 同口径。
 *
 * - 时区来源优先级 db → env（STARTER_TIMEZONE/APP_TIMEZONE）→ 默认 Asia/Shanghai。
 * - ai.enabled 行存 "false" = 熔断开启。
 * - 2s 进程缓存（对齐 CACHE_TTL_MS）+ 写路径主动失效。
 */
final class SystemSettings
{
    public const SETTING_TIMEZONE = 'timezone';

    public const SETTING_AI_ENABLED = 'ai.enabled';

    public const DEFAULT_TIMEZONE = 'Asia/Shanghai';

    private const CACHE_TTL_SECONDS = 2;

    /** @var array{expiresAt: int, data: array<string, mixed>}|null */
    private static ?array $cache = null;

    public static function normalizeTimezone(mixed $raw): ?string
    {
        if (! is_string($raw)) {
            return null;
        }
        $trimmed = trim($raw);
        if ($trimmed === '' || strlen($trimmed) > 64) {
            return null;
        }
        try {
            new \DateTimeZone($trimmed);
        } catch (\Exception) {
            return null;
        }

        return $trimmed;
    }

    /** @return array<string, string> value → label（源自 packages/api SYSTEM_TIMEZONE_OPTIONS）。 */
    public static function timezoneOptions(): array
    {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }
        $file = self::contractsDir().'/timezone-options.json';
        if (! is_file($file)) {
            throw new RuntimeException('timezone-options.json 产物缺失：请运行 bun run contracts:generate');
        }
        $decoded = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        $cache = collect($decoded)->pluck('label', 'value')->all();

        return $cache;
    }

    public static function timezoneLabel(string $timezone): string
    {
        $options = self::timezoneOptions();
        if (isset($options[$timezone])) {
            return (string) $options[$timezone];
        }

        $offset = (new \DateTimeZone($timezone))->getOffset(new \DateTime('now', new \DateTimeZone('UTC')));
        $sign = $offset < 0 ? '-' : '+';
        $abs = abs($offset);

        return $timezone.sprintf(' UTC%s%02d:%02d', $sign, intdiv($abs, 3600), intdiv($abs % 3600, 60));
    }

    /** @return array<string, mixed> */
    public static function snapshot(): array
    {
        $now = time();
        if (self::$cache === null || self::$cache['expiresAt'] <= $now) {
            self::$cache = ['expiresAt' => $now + self::CACHE_TTL_SECONDS, 'data' => self::load()];
        }

        return self::$cache['data'];
    }

    public static function invalidateCache(): void
    {
        self::$cache = null;
    }

    /** @return array{timezone: string, timezoneSource: string, timezoneUpdatedAt: string|null, circuitOpen: bool, aiUpdatedAt: string|null} */
    private static function load(): array
    {
        $rows = ConsoleSystemSetting::query()
            ->whereIn('key', [self::SETTING_TIMEZONE, self::SETTING_AI_ENABLED])
            ->get()
            ->keyBy('key');

        $dbTzRow = $rows->get(self::SETTING_TIMEZONE);
        $dbTz = $dbTzRow !== null ? self::normalizeTimezone((string) $dbTzRow->getAttributeValue('value')) : null;
        $envTz = self::normalizeTimezone(getenv('STARTER_TIMEZONE') ?: getenv('APP_TIMEZONE'));
        $timezone = $dbTz ?? $envTz ?? self::DEFAULT_TIMEZONE;
        $timezoneSource = $dbTz !== null ? 'database' : ($envTz !== null ? 'env' : 'default');

        $aiRow = $rows->get(self::SETTING_AI_ENABLED);
        $circuitOpen = $aiRow !== null && (string) $aiRow->getAttributeValue('value') === 'false';

        return [
            'timezone' => $timezone,
            'timezoneSource' => $timezoneSource,
            'timezoneUpdatedAt' => $dbTzRow !== null ? $dbTzRow->getAttributeValue('updated_at')?->utc()->format('Y-m-d\TH:i:s.v\Z') : null,
            'circuitOpen' => $circuitOpen,
            'aiUpdatedAt' => $aiRow !== null ? $aiRow->getAttributeValue('updated_at')?->utc()->format('Y-m-d\TH:i:s.v\Z') : null,
        ];
    }

    /** @return array<string, mixed> SystemSettingsResponse 形状。 */
    public static function payload(): array
    {
        $snap = self::snapshot();

        return [
            'timezone' => $snap['timezone'],
            'timezoneLabel' => self::timezoneLabel($snap['timezone']),
            'source' => $snap['timezoneSource'],
            'updatedAt' => $snap['timezoneUpdatedAt'],
            'timezoneOptions' => collect(self::timezoneOptions())
                ->map(fn (string $label, string $value): array => ['value' => $value, 'label' => $label])
                ->values()
                ->all(),
        ];
    }

    /** 时区更新（对齐 updateSystemTimezoneTx）：normalize 失败 422；变更落审计。 */
    public static function updateTimezone(Party $actor, string $rawTimezone): array
    {
        return DB::transaction(function () use ($actor, $rawTimezone): array {
            DB::selectOne('select pg_advisory_xact_lock(7140301)');
            $normalized = self::normalizeTimezone($rawTimezone);
            if ($normalized === null) {
                throw new HttpException(422, '请选择有效的系统时区');
            }
            $before = self::load();

            ConsoleSystemSetting::query()->updateOrCreate(
                ['key' => self::SETTING_TIMEZONE],
                ['value' => $normalized, 'updated_by' => $actor->id],
            );

            if ($before['timezone'] !== $normalized) {
                AuditWriter::auditResource('system.timezone_update', $actor,
                    ['code' => self::SETTING_TIMEZONE, 'name' => '系统时区'],
                    ['from' => $before['timezone'], 'to' => $normalized]);
            }
            self::invalidateCache();

            return self::payload();
        });
    }

    /**
     * AI 熔断开关更新（对齐 updateAiCircuitTx）。
     *
     * @return array{circuitOpen: bool, updatedAt: string}
     */
    public static function updateCircuit(Party $actor, bool $enabled): array
    {
        return DB::transaction(function () use ($actor, $enabled): array {
            DB::selectOne('select pg_advisory_xact_lock(7140301)');
            $before = self::load();
            $beforeEnabled = ! $before['circuitOpen'];

            ConsoleSystemSetting::query()->updateOrCreate(
                ['key' => self::SETTING_AI_ENABLED],
                ['value' => $enabled ? 'true' : 'false', 'updated_by' => $actor->id],
            );

            if ($beforeEnabled !== $enabled) {
                AuditWriter::auditResource('system.ai_circuit', $actor,
                    ['code' => self::SETTING_AI_ENABLED, 'name' => 'AI 全局熔断开关'],
                    ['from' => $beforeEnabled, 'to' => $enabled]);
            }
            self::invalidateCache();

            return ['circuitOpen' => ! $enabled, 'updatedAt' => now()->utc()->format('Y-m-d\TH:i:s.v\Z')];
        });
    }

    /** @return array{circuitOpen: bool, updatedAt: string|null} */
    public static function circuitState(): array
    {
        $snap = self::snapshot();

        return ['circuitOpen' => $snap['circuitOpen'], 'updatedAt' => $snap['aiUpdatedAt']];
    }

    private static function contractsDir(): string
    {
        return rtrim((string) (getenv('CONTRACTS_DIR') ?: base_path('storage/contracts')), '/');
    }
}
