CREATE TABLE "tracking"."app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "review_status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "tracking"."app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;