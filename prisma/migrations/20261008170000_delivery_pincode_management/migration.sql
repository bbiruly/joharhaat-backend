-- Widen only customer delivery destinations; preserve every historical district.
ALTER TABLE "addresses"
ALTER COLUMN "district" TYPE TEXT USING "district"::text;

ALTER TABLE "orders"
ALTER COLUMN "district" TYPE TEXT USING "district"::text;

-- Destination analytics follow order districts, including districts outside Jharkhand.
ALTER TABLE "product_district_daily_aggregates"
ALTER COLUMN "district" TYPE TEXT USING "district"::text;

CREATE TABLE "delivery_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "is_pin_pricing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "free_delivery_threshold" DECIMAL(12,2) NOT NULL DEFAULT 1500,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_pincodes" (
    "postal_code" VARCHAR(6) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "district" VARCHAR(120) NOT NULL,
    "is_serviceable" BOOLEAN NOT NULL DEFAULT true,
    "delivery_fee" DECIMAL(12,2) NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_pincodes_pkey" PRIMARY KEY ("postal_code")
);

CREATE INDEX "delivery_pincodes_state_district_idx" ON "delivery_pincodes"("state", "district");
CREATE INDEX "delivery_pincodes_is_serviceable_state_idx" ON "delivery_pincodes"("is_serviceable", "state");

-- Existing OPERATIONS members receive the requested default permission.
INSERT INTO "role_permissions" ("id", "role", "permission", "created_at", "updated_at")
VALUES ('shipping-manage-operations', 'OPERATIONS', 'shipping:manage', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
