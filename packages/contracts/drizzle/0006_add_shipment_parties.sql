CREATE TABLE "tracking"."shipment_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"role" text NOT NULL,
	"customer_id" uuid,
	"customer_code" text NOT NULL,
	"customer_name" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"doc_type" text,
	"rank" integer,
	"is_current" boolean DEFAULT true NOT NULL,
	"source_email_id" text,
	"observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_parties_uq" UNIQUE("shipment_id","role","customer_code")
);
--> statement-breakpoint
ALTER TABLE "tracking"."shipment_parties" ADD CONSTRAINT "shipment_parties_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "tracking"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipment_parties" ADD CONSTRAINT "shipment_parties_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "tracking"."customers"("id") ON DELETE no action ON UPDATE no action;