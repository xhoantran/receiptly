CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"receipt_id" text,
	"confidence" text NOT NULL,
	"delta_amount" double precision,
	"delta_days" integer,
	"matched_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_connections" (
	"user_id" text NOT NULL,
	"connector_key" text NOT NULL,
	"status" text DEFAULT 'unlinked' NOT NULL,
	"last_sync_at" bigint,
	"last_error" text,
	CONSTRAINT "merchant_connections_user_id_connector_key_pk" PRIMARY KEY("user_id","connector_key")
);
--> statement-breakpoint
CREATE TABLE "merchant_sessions" (
	"user_id" text NOT NULL,
	"connector_key" text NOT NULL,
	"encrypted_state" text,
	"expires_at" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "merchant_sessions_user_id_connector_key_pk" PRIMARY KEY("user_id","connector_key")
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"cursor" text,
	"institution_name" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"brand" text,
	"size" text,
	"category" text DEFAULT 'Other › Uncategorized' NOT NULL,
	"image_url" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"name" text NOT NULL,
	"qty" double precision DEFAULT 1 NOT NULL,
	"unit" text DEFAULT 'ea',
	"unit_price" double precision,
	"line_total" double precision NOT NULL,
	"saving" double precision DEFAULT 0,
	"upc" text,
	"image_url" text,
	"product_id" integer
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connector_key" text NOT NULL,
	"date" text NOT NULL,
	"store" text,
	"total" double precision NOT NULL,
	"subtotal" double precision,
	"tax" double precision,
	"raw" jsonb,
	"fetched_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"authorized_datetime" text,
	"amount" double precision NOT NULL,
	"merchant" text NOT NULL,
	"raw_name" text NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"account_id" text NOT NULL,
	"connector_key" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_connections" ADD CONSTRAINT "merchant_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_sessions" ADD CONSTRAINT "merchant_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_by_user" ON "matches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_by_receipt" ON "matches" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "plaid_items_by_user" ON "plaid_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plink_by_value" ON "product_links" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "plink_by_product" ON "product_links" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "prod_by_category" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "prod_by_brand" ON "products" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "item_by_user" ON "receipt_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "item_by_receipt" ON "receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "item_by_name" ON "receipt_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "item_by_product" ON "receipt_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "rcpt_by_user" ON "receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rcpt_by_user_connector" ON "receipts" USING btree ("user_id","connector_key");--> statement-breakpoint
CREATE INDEX "rcpt_by_user_date" ON "receipts" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "tx_by_user" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tx_by_user_date" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "tx_by_user_connector" ON "transactions" USING btree ("user_id","connector_key");--> statement-breakpoint
CREATE INDEX "tx_by_user_merchant" ON "transactions" USING btree ("user_id","merchant");