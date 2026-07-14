ALTER TABLE "categories" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_household_system_unique" ON "categories" USING btree ("household_id") WHERE "categories"."is_system";--> statement-breakpoint
INSERT INTO "categories" ("household_id", "name", "direction", "color", "sort_order", "is_system")
SELECT h."id", 'Uncategorized', 'expense', '#6B7280', 999, true
FROM "households" h
WHERE NOT EXISTS (
  SELECT 1 FROM "categories" c WHERE c."household_id" = h."id" AND c."is_system"
);
