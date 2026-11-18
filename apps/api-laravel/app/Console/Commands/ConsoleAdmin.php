<?php

namespace App\Console\Commands;

use App\Core\Models\ConsoleAccount;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

/**
 * 生产管理员引导（LD-03）：console:seed 生产拒绝（LB-08）后，首个管理员的唯一入口。
 *
 * 创建或轮转 super_admin：账号缺失则建，存在则更新哈希并修正为启用超管。
 * 与种子同性质不落 console_audit（首个管理员先于一切可鉴权写路径存在）；
 * 密码强度对齐契约 accountCreateSchema（10-256 位）且无条件拒绝本地演示密码。
 */
final class ConsoleAdmin extends Command
{
    protected $signature = 'console:admin {--username=} {--password=}';

    protected $description = 'Bootstrap or rotate the super admin (production-safe first-admin entry)';

    public function handle(): int
    {
        $username = trim((string) ($this->option('username') ?: getenv('STARTER_ADMIN_USERNAME') ?: $this->ask('管理员账户名')));
        if ($username === '' || mb_strlen($username) > 64) {
            $this->error('账户名无效：需 1-64 个字符（对齐契约 username 规则）');

            return self::FAILURE;
        }

        // 密码优先走 env / 隐式输入，--password 仅供脚本化注入，避免进 shell 历史。
        $password = (string) ($this->option('password') ?: getenv('STARTER_ADMIN_PASSWORD') ?: $this->secret('管理员密码'));
        if ($password === '') {
            throw new RuntimeException('缺少管理员密码');
        }
        if ($password === 'demo@2026!') {
            $this->error('拒绝使用本地演示密码');

            return self::FAILURE;
        }
        if (mb_strlen($password) < 10 || mb_strlen($password) > 256) {
            $this->error('密码需 10-256 位（对齐契约 accountCreateSchema）');

            return self::FAILURE;
        }

        $created = DB::transaction(function () use ($username, $password): bool {
            $existing = ConsoleAccount::query()->where('username', $username)->first(['id']);
            if ($existing === null) {
                // hash 不在 $fillable（LB-04 防提权白名单），显式属性赋值写入而非 mass create。
                $admin = new ConsoleAccount;
                $admin->username = $username;
                $admin->name = '系统管理员';
                $admin->role = 'super_admin';
                $admin->active = true;
                $admin->setAttribute('hash', Hash::make($password));
                $admin->save();

                return true;
            }

            // 轮转既有账号：更新哈希并保证启用超管身份。
            $admin = ConsoleAccount::query()->findOrFail($existing->id);
            $admin->role = 'super_admin';
            $admin->active = true;
            $admin->setAttribute('hash', Hash::make($password));
            $admin->save();

            return false;
        });

        if ($created) {
            $this->info("已创建超级管理员 {$username}");
        } else {
            $this->info("已轮转超级管理员 {$username}（密码更新，身份修正为启用超管）");
        }

        return self::SUCCESS;
    }
}
