<?php

namespace App\Core\Audit;

use App\Core\Models\ConsoleAudit;

/**
 * 审计写入器（LB-06）：唯一写入口，语义逐条对齐 apps/server/src/core/audit.ts。
 *
 * - 只追加（ConsoleAudit 模型层拒绝 update/delete，LB-04）。
 * - 必须与状态变更同一事务：调用方在 DB::transaction 内调用，
 *   Eloquent 与业务更新共用连接即同一事务。
 * - detail 递归脱敏：敏感键（含子串/精确集）值替换为 "[REDACTED]"；
 *   不可序列化值降级为字符串。**永不记录**密钥、提示词与真实凭证。
 */
final class AuditWriter
{
    public const REDACTED = '[REDACTED]';

    private const SENSITIVE_PARTS = [
        'authorization', 'cookie', 'credential', 'password', 'passwd',
        'secret', 'token', 'apikey', 'hash',
    ];

    private const SENSITIVE_EXACT = [
        'code', 'otp', 'pwd', 'prompt', 'instruction', 'sms', 'smscode', 'verifycode',
    ];

    /** 审计单页上限（audit.ts AUDIT_MAX_PAGE）。 */
    public const MAX_PAGE = 100;

    /**
     * 递归脱敏（sanitizeAuditDetail 同口径）。
     */
    public static function sanitize(mixed $value): mixed
    {
        if (is_array($value)) {
            $out = [];
            foreach ($value as $key => $item) {
                if (! is_string($key)) {
                    $out[$key] = self::sanitize($item);

                    continue;
                }
                if (self::isSensitiveKey($key)) {
                    $out[$key] = self::REDACTED;

                    continue;
                }
                $out[$key] = self::sanitize($item);
            }

            return $out;
        }
        if ($value === null || is_string($value) || is_int($value) || is_float($value) || is_bool($value)) {
            return $value;
        }

        return (string) $value;
    }

    private static function isSensitiveKey(string $key): bool
    {
        $normalized = preg_replace('/[^a-z0-9]/', '', strtolower($key)) ?? $key;

        return in_array($normalized, self::SENSITIVE_EXACT, true)
            || collect(self::SENSITIVE_PARTS)->contains(fn (string $part): bool => str_contains($normalized, $part));
    }

    /**
     * 账户参与方审计（audit() 同口径）：在调用方事务内落 console_audit。
     *
     * @param  array<string, mixed>  $detail
     */
    public static function audit(
        string $action,
        Party $actor,
        ?Party $target = null,
        array $detail = [],
        string $actorSource = 'human',
    ): void {
        ConsoleAudit::query()->create([
            'action' => $action,
            'actor_source' => $actorSource,
            'actor_id' => $actor->id,
            'actor_username' => $actor->username,
            'actor_name' => $actor->name,
            'target_id' => $target?->id,
            'target_username' => $target?->username,
            'target_name' => $target?->name,
            'detail' => self::sanitize($detail),
        ]);
    }

    /**
     * 非账户资源审计（auditResource 同口径）：target 置空，code/name 落 human-readable 字段。
     *
     * @param  array{code: string, name: string, id?: int}  $resource
     * @param  array<string, mixed>  $detail
     */
    public static function auditResource(
        string $action,
        Party $actor,
        array $resource,
        array $detail = [],
        string $actorSource = 'human',
    ): void {
        $merged = $detail;
        if (array_key_exists('id', $resource)) {
            $merged = ['entityId' => $resource['id']] + $detail;
        }

        ConsoleAudit::query()->create([
            'action' => $action,
            'actor_source' => $actorSource,
            'actor_id' => $actor->id,
            'actor_username' => $actor->username,
            'actor_name' => $actor->name,
            'target_id' => null,
            'target_username' => $resource['code'],
            'target_name' => $resource['name'],
            'detail' => self::sanitize($merged),
        ]);
    }
}
