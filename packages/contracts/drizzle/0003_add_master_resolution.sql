CREATE TABLE "tracking"."master_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"lhs" text NOT NULL,
	"rhs" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source" text DEFAULT 'curator' NOT NULL,
	"reason" text,
	"evidence" jsonb,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_resolution_uq" UNIQUE("kind","lhs","rhs")
);
--> statement-breakpoint
ALTER TABLE "tracking"."master_resolution" ADD CONSTRAINT "master_resolution_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking"."master_resolution" ADD CONSTRAINT "master_resolution_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;