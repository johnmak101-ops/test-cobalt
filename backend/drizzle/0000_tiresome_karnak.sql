CREATE SCHEMA "queue";
--> statement-breakpoint
CREATE SCHEMA "evidence";
--> statement-breakpoint
CREATE SCHEMA "tracking";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "alerts";
--> statement-breakpoint
CREATE SCHEMA "match";
--> statement-breakpoint
CREATE TABLE "queue"."ingest_state" (
	"id" text PRIMARY KEY NOT NULL,
	"watermark" timestamp with time zone NOT NULL,
	"delta_link" text,
	"stuck_graph_id" text,
	"stuck_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue"."queue_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"parent_filename" text,
	"source_kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"declared_mime" text,
	"raw_bytes" "bytea",
	"needs_review" boolean DEFAULT false NOT NULL,
	"warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue"."queue_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_message_id" text NOT NULL,
	"graph_id" text,
	"source_file" text,
	"conversation_id" text,
	"subject" text,
	"sender" text,
	"received_at" timestamp with time zone,
	"body_text" text,
	"body_html" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"blobs_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_message_graph_message_id_unique" UNIQUE("graph_message_id")
);
--> statement-breakpoint
CREATE TABLE "queue"."queue_normalized" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"kind" text NOT NULL,
	"text_content" text,
	"image_bytes" "bytea",
	"mime" text,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence"."parsed_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"graph_message_id" text,
	"record_idx" integer NOT NULL,
	"po_no" text,
	"email_type" text,
	"sender_type" text,
	"mode" text,
	"fields" jsonb,
	"match_keys" jsonb,
	"amendments" jsonb,
	"needs_review" jsonb,
	"confidence" text,
	"parser_adapter" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking"."booking_pos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_pos_uq" UNIQUE("booking_id","po_id")
);
--> statement-breakpoint
CREATE TABLE "tracking"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_no" text NOT NULL,
	"customer_id" uuid,
	"vendor_id" uuid,
	"forwarder_id" uuid,
	"consignee_id" uuid,
	"brand" text,
	"crd" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_job_no_unique" UNIQUE("job_no")
);
--> statement-breakpoint
CREATE TABLE "tracking"."consignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"maps_to_customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"erp_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tracking"."field_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"locked_value" text,
	"locked_by" uuid,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_locks_uq" UNIQUE("entity_type","entity_id","field")
);
--> statement-breakpoint
CREATE TABLE "tracking"."forwarder_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forwarder_id" uuid NOT NULL,
	"alias_type" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forwarder_aliases_type_value_uq" UNIQUE("alias_type","value")
);
--> statement-breakpoint
CREATE TABLE "tracking"."forwarders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forwarders_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tracking"."ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unlocode" text NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"mode" text DEFAULT 'sea' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ports_unlocode_unique" UNIQUE("unlocode")
);
--> statement-breakpoint
CREATE TABLE "tracking"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text NOT NULL,
	"customer_id" uuid,
	"vendor_id" uuid,
	"brand" text,
	"item_style_no" text,
	"total_quantity" double precision,
	"quantity_unit" text,
	"crd" timestamp with time zone,
	"erp_synced_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "tracking"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tracking"."shipment_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"milestone_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"signal" text,
	"sender_type" text,
	"evidence_record_id" uuid,
	"email_message_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking"."shipment_pos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"quantity" double precision,
	"quantity_unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_pos_uq" UNIQUE("shipment_id","po_id")
);
--> statement-breakpoint
CREATE TABLE "tracking"."shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"leg_no" integer DEFAULT 1 NOT NULL,
	"mode" text,
	"state" text DEFAULT 'BOOKED' NOT NULL,
	"leg_status" text DEFAULT 'ACTIVE' NOT NULL,
	"superseded_by_id" uuid,
	"risk_level" text DEFAULT 'ON_TRACK' NOT NULL,
	"confirmed_by_email" boolean DEFAULT false NOT NULL,
	"forwarder_id" uuid,
	"consignee_id" uuid,
	"booking_no" text,
	"so_no" text,
	"hbl_awb_fcr_no" text,
	"mbl" text,
	"container_no" text,
	"vessel_name" text,
	"voyage_no" text,
	"flight_no" text,
	"mawb" text,
	"pol_id" uuid,
	"pod_id" uuid,
	"cargo_ready_date" timestamp with time zone,
	"cfs_cutoff" timestamp with time zone,
	"warehouse_start_date" timestamp with time zone,
	"warehouse_end_date" timestamp with time zone,
	"etd" timestamp with time zone,
	"atd" timestamp with time zone,
	"eta" timestamp with time zone,
	"ata" timestamp with time zone,
	"in_dc_date" timestamp with time zone,
	"qty" double precision,
	"qty_unit" text,
	"item_style_no" text,
	"consignee_name" text,
	"consignee_address" text,
	"match_keys" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_booking_leg_uq" UNIQUE("booking_id","leg_no")
);
--> statement-breakpoint
CREATE TABLE "tracking"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'VIEWER' NOT NULL,
	"avatar_initials" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "tracking"."vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"type" text DEFAULT 'factory' NOT NULL,
	"location" text,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"erp_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"change_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"actor_user_id" uuid,
	"is_delay" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts"."alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" text NOT NULL,
	"booking_id" uuid,
	"shipment_id" uuid,
	"severity" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"message" text NOT NULL,
	"dedup_key" text,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "alerts"."alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"state" text,
	"trigger_type" text NOT NULL,
	"trigger_reference" text NOT NULL,
	"watch_for" text NOT NULL,
	"threshold_hours" integer NOT NULL,
	"severity" text NOT NULL,
	"compute_tz" text DEFAULT 'server' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match"."match_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"evidence_record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_booking_id" uuid,
	"target_shipment_id" uuid,
	"decision" jsonb,
	"extraction_confidence" text,
	"resolution_confidence" text,
	"reasoning" text,
	"status" text DEFAULT 'PENDING_COMMIT' NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match"."match_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_record_id" uuid NOT NULL,
	"message_id" uuid,
	"candidates" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue"."queue_attachment" ADD CONSTRAINT "queue_attachment_message_id_queue_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "queue"."queue_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue"."queue_normalized" ADD CONSTRAINT "queue_normalized_attachment_id_queue_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "queue"."queue_attachment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."parsed_record" ADD CONSTRAINT "parsed_record_message_id_queue_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "queue"."queue_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."booking_pos" ADD CONSTRAINT "booking_pos_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "tracking"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."booking_pos" ADD CONSTRAINT "booking_pos_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "tracking"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "tracking"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."bookings" ADD CONSTRAINT "bookings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "tracking"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."bookings" ADD CONSTRAINT "bookings_forwarder_id_forwarders_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "tracking"."forwarders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."bookings" ADD CONSTRAINT "bookings_consignee_id_consignees_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "tracking"."consignees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."consignees" ADD CONSTRAINT "consignees_maps_to_customer_id_customers_id_fk" FOREIGN KEY ("maps_to_customer_id") REFERENCES "tracking"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."field_locks" ADD CONSTRAINT "field_locks_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."forwarder_aliases" ADD CONSTRAINT "forwarder_aliases_forwarder_id_forwarders_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "tracking"."forwarders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."purchase_orders" ADD CONSTRAINT "purchase_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "tracking"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "tracking"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "tracking"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipment_milestones" ADD CONSTRAINT "shipment_milestones_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "tracking"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipment_pos" ADD CONSTRAINT "shipment_pos_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "tracking"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipment_pos" ADD CONSTRAINT "shipment_pos_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "tracking"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD CONSTRAINT "shipments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "tracking"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD CONSTRAINT "shipments_forwarder_id_forwarders_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "tracking"."forwarders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD CONSTRAINT "shipments_consignee_id_consignees_id_fk" FOREIGN KEY ("consignee_id") REFERENCES "tracking"."consignees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD CONSTRAINT "shipments_pol_id_ports_id_fk" FOREIGN KEY ("pol_id") REFERENCES "tracking"."ports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD CONSTRAINT "shipments_pod_id_ports_id_fk" FOREIGN KEY ("pod_id") REFERENCES "tracking"."ports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts"."alerts" ADD CONSTRAINT "alerts_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "alerts"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match"."match_decision" ADD CONSTRAINT "match_decision_request_id_match_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "match"."match_request"("id") ON DELETE cascade ON UPDATE no action;