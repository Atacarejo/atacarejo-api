-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "stores" (
	"store_id" bigint NOT NULL,
	"access_token" text NOT NULL,
	"scope" text NOT NULL,
	"installed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_config" (
	"store_id" bigint NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_prices" (
	"store_id" bigint NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"price" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_config" ADD CONSTRAINT "store_config_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "wholesale_prices" ADD CONSTRAINT "wholesale_prices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE cascade ON UPDATE cascade;
*/