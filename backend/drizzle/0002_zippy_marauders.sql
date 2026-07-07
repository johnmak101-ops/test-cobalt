ALTER TABLE "tracking"."shipments" ADD COLUMN "review_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD CONSTRAINT "shipments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;