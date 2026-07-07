CREATE TABLE "tracking"."shipment_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"doc_type" text,
	"rank" integer,
	"is_current" boolean DEFAULT false NOT NULL,
	"source_email_id" text,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_identifiers_uq" UNIQUE("shipment_id","type","value")
);
--> statement-breakpoint
ALTER TABLE "tracking"."shipment_identifiers" ADD CONSTRAINT "shipment_identifiers_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "tracking"."shipments"("id") ON DELETE cascade ON UPDATE no action;