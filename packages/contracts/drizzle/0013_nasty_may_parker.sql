-- Performance indexes for the tracking hot paths (list/dashboard filters + sorts, FK joins,
-- review queue). IF NOT EXISTS keeps this safe on any DB that already received the schema via
-- `db:push` (this project's dev flow) and idempotent on re-run.
CREATE INDEX IF NOT EXISTS "booking_pos_po_id_idx" ON "tracking"."booking_pos" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_customer_id_idx" ON "tracking"."bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_vendor_id_idx" ON "tracking"."bookings" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_forwarder_id_idx" ON "tracking"."bookings" USING btree ("forwarder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_email_review_status_idx" ON "tracking"."review_email" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_email_shipment_id_idx" ON "tracking"."review_email" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_email_message_id_idx" ON "tracking"."review_email" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_emails_graph_message_id_idx" ON "tracking"."shipment_emails" USING btree ("graph_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_milestones_shipment_id_idx" ON "tracking"."shipment_milestones" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_pos_po_id_idx" ON "tracking"."shipment_pos" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_leg_status_updated_idx" ON "tracking"."shipments" USING btree ("leg_status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_kind_idx" ON "tracking"."shipments" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_review_status_idx" ON "tracking"."shipments" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_state_idx" ON "tracking"."shipments" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_risk_level_idx" ON "tracking"."shipments" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_booking_id_idx" ON "tracking"."shipments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_forwarder_id_idx" ON "tracking"."shipments" USING btree ("forwarder_id");
