ALTER TABLE "tracking"."master_resolution" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- one-time: drop the stale seed-sourced canonical SEH fold so the new customer_group bootstrap (seed.ts) is authoritative
DELETE FROM "tracking"."master_resolution" WHERE "kind" = 'customer_canonical' AND "lhs" = 'SEH' AND "source" = 'seed';