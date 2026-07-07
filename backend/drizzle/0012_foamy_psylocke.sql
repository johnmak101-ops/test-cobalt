ALTER TABLE "tracking"."ports" ADD COLUMN "iata" text;--> statement-breakpoint
CREATE INDEX "ports_iata_idx" ON "tracking"."ports" USING btree ("iata");