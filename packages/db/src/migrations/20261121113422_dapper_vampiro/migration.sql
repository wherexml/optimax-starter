CREATE TABLE "console_account_invite" (
	"id" serial PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE,
	"account_id" integer NOT NULL,
	"created_by" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_api_token" (
	"id" serial PRIMARY KEY,
	"account_id" integer NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"scopes" jsonb DEFAULT '[]' NOT NULL,
	"actor_source" text DEFAULT 'agent' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"revoked_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_attachment" (
	"id" serial PRIMARY KEY,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"storage_driver" text NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_auth_identity" (
	"id" serial PRIMARY KEY,
	"account_id" integer NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_job" (
	"id" serial PRIMARY KEY,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"result" jsonb,
	"error" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_login_guard" (
	"key" text PRIMARY KEY,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_oidc_state" (
	"state_hash" text PRIMARY KEY,
	"provider" text NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"redirect_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "console_session" ADD COLUMN IF NOT EXISTS "id" serial;--> statement-breakpoint
ALTER TABLE "console_session" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "console_session" ADD COLUMN IF NOT EXISTS "user_agent" text;--> statement-breakpoint
ALTER TABLE "console_session" ADD COLUMN IF NOT EXISTS "ip_address" text;--> statement-breakpoint
ALTER TABLE "console_session" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "console_attachment_entity_idx" ON "console_attachment" ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "console_auth_identity_provider_subject_idx" ON "console_auth_identity" ("provider","subject");--> statement-breakpoint
ALTER TABLE "console_account_invite" ADD CONSTRAINT "console_account_invite_account_id_console_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "console_account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "console_account_invite" ADD CONSTRAINT "console_account_invite_created_by_console_account_id_fkey" FOREIGN KEY ("created_by") REFERENCES "console_account"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "console_api_token" ADD CONSTRAINT "console_api_token_account_id_console_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "console_account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "console_api_token" ADD CONSTRAINT "console_api_token_created_by_console_account_id_fkey" FOREIGN KEY ("created_by") REFERENCES "console_account"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "console_attachment" ADD CONSTRAINT "console_attachment_uploaded_by_console_account_id_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "console_account"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "console_auth_identity" ADD CONSTRAINT "console_auth_identity_account_id_console_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "console_account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "console_job" ADD CONSTRAINT "console_job_created_by_console_account_id_fkey" FOREIGN KEY ("created_by") REFERENCES "console_account"("id") ON DELETE SET NULL;