CREATE TABLE "tracking"."shipment_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"graph_message_id" text,
	"email_type" text,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_emails_uq" UNIQUE("shipment_id","graph_message_id")
);
--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "kind" text DEFAULT 'SHIPMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "linked_shipment_id" uuid;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "forwarder_raw" text;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "pol_raw" text;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "pod_raw" text;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "gross_weight" double precision;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "measurement" double precision;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "hts_code" text;--> statement-breakpoint
ALTER TABLE "tracking"."shipment_emails" ADD CONSTRAINT "shipment_emails_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "tracking"."shipments"("id") ON DELETE cascade ON UPDATE no action;