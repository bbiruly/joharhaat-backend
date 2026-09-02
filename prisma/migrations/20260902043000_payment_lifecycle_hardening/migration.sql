ALTER TABLE "orders"
  ADD COLUMN "coupon_code" TEXT,
  ADD COLUMN "coupon_finalized" BOOLEAN NOT NULL DEFAULT false;
