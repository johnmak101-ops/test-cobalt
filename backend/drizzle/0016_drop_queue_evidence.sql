DROP TABLE "queue"."ingest_state" CASCADE;--> statement-breakpoint
DROP TABLE "queue"."queue_attachment" CASCADE;--> statement-breakpoint
DROP TABLE "queue"."queue_message" CASCADE;--> statement-breakpoint
DROP TABLE "queue"."queue_normalized" CASCADE;--> statement-breakpoint
DROP TABLE "evidence"."parsed_record" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "evidence" CASCADE;--> statement-breakpoint
DROP SCHEMA IF EXISTS "queue" CASCADE;
