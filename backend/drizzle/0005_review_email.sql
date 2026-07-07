CREATE TABLE "tracking"."review_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"graph_message_id" text,
	"subject" text,
	"sender" text,
	"received_at" timestamp with time zone,
	"body_text" text,
	"email_type" text,
	"extracted_data" jsonb,
	"original_extracted_data" jsonb,
	"suggested_data" jsonb,
	"reviewer_notes" text,
	"extraction_confidence" double precision,
	"shipment_id" uuid,
	"review_status" text DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking"."review_email" ADD CONSTRAINT "review_email_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "tracking"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."review_email" ADD CONSTRAINT "review_email_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;