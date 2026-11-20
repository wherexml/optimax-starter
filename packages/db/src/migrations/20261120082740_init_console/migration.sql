CREATE TABLE "console_account" (
	"id" serial PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hash" text NOT NULL,
	"email" text,
	"company" text
);
--> statement-breakpoint
CREATE TABLE "console_asset" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"domain" text NOT NULL,
	"owner" text NOT NULL,
	"stage" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_audit" (
	"id" serial PRIMARY KEY,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"actor_source" text DEFAULT 'human' NOT NULL,
	"actor_id" integer,
	"actor_username" text NOT NULL,
	"actor_name" text NOT NULL,
	"target_id" integer,
	"target_username" text,
	"target_name" text,
	"detail" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_role_permission" (
	"role" text PRIMARY KEY,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "console_session" (
	"key" text PRIMARY KEY,
	"account" integer NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "console_setting" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
ALTER TABLE "console_audit" ADD CONSTRAINT "console_audit_actor_id_console_account_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "console_account"("id");--> statement-breakpoint
ALTER TABLE "console_audit" ADD CONSTRAINT "console_audit_target_id_console_account_id_fkey" FOREIGN KEY ("target_id") REFERENCES "console_account"("id");--> statement-breakpoint
ALTER TABLE "console_role_permission" ADD CONSTRAINT "console_role_permission_updated_by_console_account_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "console_account"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "console_session" ADD CONSTRAINT "console_session_account_console_account_id_fkey" FOREIGN KEY ("account") REFERENCES "console_account"("id");--> statement-breakpoint
ALTER TABLE "console_setting" ADD CONSTRAINT "console_setting_updated_by_console_account_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "console_account"("id") ON DELETE SET NULL;