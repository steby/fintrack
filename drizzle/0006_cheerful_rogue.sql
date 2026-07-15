CREATE TABLE "fx_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"rate_to_sgd" numeric(14, 6) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_entries" ADD COLUMN "original_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "monthly_entries" ADD COLUMN "original_currency" text;--> statement-breakpoint
ALTER TABLE "monthly_entries" ADD COLUMN "fx_rate" numeric(14, 6);