CREATE TABLE "tracking"."email_read" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_by" uuid
);
--> statement-breakpoint
ALTER TABLE "tracking"."email_read" ADD CONSTRAINT "email_read_read_by_users_id_fk" FOREIGN KEY ("read_by") REFERENCES "tracking"."users"("id") ON DELETE no action ON UPDATE no action;