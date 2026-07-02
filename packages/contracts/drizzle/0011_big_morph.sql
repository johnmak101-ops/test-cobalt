ALTER TABLE "queue"."queue_message" ADD COLUMN "to_recipients" text;--> statement-breakpoint
ALTER TABLE "queue"."queue_message" ADD COLUMN "cc_recipients" text;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "dismissed_at" timestamp with time zone;