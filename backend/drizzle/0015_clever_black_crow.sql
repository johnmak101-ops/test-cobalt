CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE TABLE "ingest"."email_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"graph_attachment_id" text,
	"filename" text NOT NULL,
	"declared_mime" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"source_kind" text,
	"raw_bytes" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."email_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_message_id" text NOT NULL,
	"graph_id" text,
	"source_file" text,
	"conversation_id" text,
	"subject" text,
	"sender" text,
	"to_recipients" text,
	"cc_recipients" text,
	"received_at" timestamp with time zone,
	"status" text,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"body_text" text,
	"body_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_message_graph_message_id_unique" UNIQUE("graph_message_id")
);
--> statement-breakpoint
CREATE TABLE "ingest"."parsed_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"graph_message_id" text,
	"record_idx" integer DEFAULT 0 NOT NULL,
	"po_no" text,
	"email_type" text,
	"sender_type" text,
	"mode" text,
	"fields" jsonb,
	"match_keys" jsonb,
	"confidence" text,
	"parser_adapter" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."ingest_state" (
	"id" text PRIMARY KEY NOT NULL,
	"watermark" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest"."email_attachment" ADD CONSTRAINT "email_attachment_message_id_email_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "ingest"."email_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."parsed_record" ADD CONSTRAINT "parsed_record_message_id_email_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "ingest"."email_message"("id") ON DELETE cascade ON UPDATE no action;