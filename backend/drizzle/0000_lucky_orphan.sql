CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`state` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_reference` text NOT NULL,
	`threshold_days` integer NOT NULL,
	`severity` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`triggered_at` integer DEFAULT (unixepoch()) NOT NULL,
	`dismissed_at` integer,
	`snoozed_until` integer,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_integrations` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`mailbox_email` text,
	`is_active` integer DEFAULT false NOT NULL,
	`last_sync_at` integer,
	`last_sync_status` text,
	`last_sync_error` text,
	`last_sync_count` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `forwarders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`po_number` text NOT NULL,
	`customer_id` text,
	`vendor_id` text,
	`total_quantity` real,
	`quantity_unit` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_po_number_unique` ON `purchase_orders` (`po_number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipment_history` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`source_type` text NOT NULL,
	`source_id` text,
	`changed_by` text,
	`is_delay` integer DEFAULT false NOT NULL,
	`notes` text,
	`changed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipment_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`milestone_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`email_id` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`email_id`) REFERENCES `shipping_emails`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipment_pos` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`po_id` text NOT NULL,
	`quantity` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`po_numbers` text NOT NULL,
	`customer_id` text,
	`forwarder_id` text,
	`route` text,
	`status` text DEFAULT 'BOOKED' NOT NULL,
	`risk_level` text DEFAULT 'ON_TRACK' NOT NULL,
	`crd` integer,
	`cfs_cutoff` integer,
	`etd` integer,
	`eta` integer,
	`actual_departure` integer,
	`actual_arrival` integer,
	`hbl_number` text,
	`vessel_name` text,
	`voyage_number` text,
	`warehouse_address` text,
	`quantity_shipped` real,
	`quantity_unit` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`forwarder_id`) REFERENCES `forwarders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipping_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`subject` text NOT NULL,
	`sender` text NOT NULL,
	`received_at` integer NOT NULL,
	`body_text` text,
	`body_html` text,
	`email_type` text DEFAULT 'OTHER',
	`extracted_data` text,
	`extraction_confidence` real,
	`shipment_id` text,
	`is_matched` integer DEFAULT false NOT NULL,
	`processing_status` text DEFAULT 'PENDING' NOT NULL,
	`review_status` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`avatar_initials` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'factory' NOT NULL,
	`location` text,
	`contact_email` text,
	`contact_phone` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
