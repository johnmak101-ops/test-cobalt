ALTER TABLE `shipments` ADD `vendor_id` text REFERENCES vendors(id);--> statement-breakpoint
ALTER TABLE `shipments` ADD `booking_no` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `so_number` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `item_style_no` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `consignee_name` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `consignee_address` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `container_no` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `mbl_number` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `warehouse_start_date` integer;--> statement-breakpoint
ALTER TABLE `shipments` ADD `warehouse_end_date` integer;--> statement-breakpoint
ALTER TABLE `shipments` ADD `in_dc_date` integer;--> statement-breakpoint
ALTER TABLE `vendors` ADD `code` text;