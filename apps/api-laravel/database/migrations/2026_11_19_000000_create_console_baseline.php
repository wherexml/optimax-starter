<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Expression;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * D2 终态基线迁移（LD-04）：schema 与迁移权威由 Drizzle（packages/db）移交 Laravel。
 *
 * 与 packages/db/src/schema（Drizzle db:push 的现行库）逐表对齐；除 `migrations`
 * 簿记表外不得有语义漂移（LD-04 验收以 information_schema/pg_index 指纹对拍证明）。
 * - 时间戳显式 precision 6：PostgreSQL 裸 timestamp/timestamptz 默认精度即 6，
 *   与 Drizzle 未指定精度的 DDL 语义等价。
 * - jsonb/now() 默认值用 Expression 显式书写，对齐 Drizzle 生成的 DDL。
 * - 守卫：D2 双轨期存量卷（Drizzle db:push 产物，7 表总是同批创建）跳过重建、
 *   仅登记本迁移；全新库（派生项目/CI/生产演练）经本迁移建全量 schema。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('console_account')) {
            return;
        }

        Schema::create('console_account', function (Blueprint $table): void {
            $table->increments('id');
            $table->text('username')->unique();
            $table->text('name');
            $table->text('role');
            $table->boolean('active')->default(true);
            $table->text('hash');
            $table->text('email')->nullable();
            $table->text('company')->nullable();
        });

        Schema::create('console_session', function (Blueprint $table): void {
            $table->text('key')->primary();
            $table->integer('account');
            $table->timestamp('expires', 6);
            $table->foreign('account')->references('id')->on('console_account');
        });

        Schema::create('console_asset', function (Blueprint $table): void {
            $table->increments('id');
            $table->text('name')->unique();
            $table->text('domain');
            $table->text('owner');
            $table->text('stage');
        });

        // Append-only 操作日志：只随状态变更同事务插入；actor/target 名写时复制。
        Schema::create('console_audit', function (Blueprint $table): void {
            $table->increments('id');
            $table->timestampTz('at', 6)->default(new Expression('now()'));
            $table->text('action');
            $table->text('actor_source')->default('human');
            $table->integer('actor_id')->nullable();
            $table->text('actor_username');
            $table->text('actor_name');
            $table->integer('target_id')->nullable();
            $table->text('target_username')->nullable();
            $table->text('target_name')->nullable();
            $table->jsonb('detail')->default(new Expression("'{}'::jsonb"));
            $table->foreign('actor_id')->references('id')->on('console_account');
            $table->foreign('target_id')->references('id')->on('console_account');
        });

        Schema::create('console_role_permission', function (Blueprint $table): void {
            $table->text('role')->primary();
            $table->jsonb('permissions')->default(new Expression("'[]'::jsonb"));
            $table->timestampTz('updated_at', 6)->default(new Expression('now()'));
            $table->integer('updated_by')->nullable();
            $table->foreign('updated_by')->references('id')->on('console_account')->nullOnDelete();
        });

        Schema::create('console_setting', function (Blueprint $table): void {
            $table->text('key')->primary();
            $table->text('value');
            $table->timestampTz('updated_at', 6)->default(new Expression('now()'));
            $table->integer('updated_by')->nullable();
            $table->foreign('updated_by')->references('id')->on('console_account')->nullOnDelete();
        });

        // 附件元数据（LD-02）：文件本体在 Storage 磁盘；uploaded_by 保留外键不级联删除。
        Schema::create('console_attachment', function (Blueprint $table): void {
            $table->increments('id');
            $table->text('name');
            $table->text('mime');
            $table->integer('size');
            $table->text('disk');
            $table->text('path');
            $table->text('sha256');
            $table->integer('uploaded_by')->nullable();
            $table->timestampTz('created_at', 6)->default(new Expression('now()'));
            $table->foreign('uploaded_by')->references('id')->on('console_account');
        });
    }

    public function down(): void
    {
        // 基线不提供 down：回滚等同拆库（append-only 审计表在此列），按 DEPLOYMENT 恢复预案处理。
    }
};
