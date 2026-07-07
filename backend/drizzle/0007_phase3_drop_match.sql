DROP TABLE "match"."match_decision" CASCADE;--> statement-breakpoint
DROP TABLE "match"."match_request" CASCADE;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "scac_code" text;--> statement-breakpoint
ALTER TABLE "tracking"."shipments" ADD COLUMN "origin_country" text;--> statement-breakpoint
ALTER TABLE "alerts"."alert_rules" ADD COLUMN "country_thresholds" jsonb;--> statement-breakpoint
DROP SCHEMA "match";
--> statement-breakpoint
UPDATE "tracking"."shipments" s SET "origin_country" = p."country" FROM "tracking"."ports" p WHERE s."pol_id" = p."id" AND s."origin_country" IS NULL;
