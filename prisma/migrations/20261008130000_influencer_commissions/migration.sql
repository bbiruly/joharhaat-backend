-- CreateEnum
CREATE TYPE "InfluencerCommissionLedgerType" AS ENUM ('REFUND_REVERSAL', 'SETTLEMENT');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "influencer_id" TEXT,
ADD COLUMN     "influencer_rate" DECIMAL(5,4);

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "commission_rate" DECIMAL(5,4),
ADD COLUMN     "influencer_id" TEXT;

-- CreateTable
CREATE TABLE "influencers" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "default_rate" DECIMAL(5,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "influencers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "influencer_commissions" (
    "id" TEXT NOT NULL,
    "influencer_id" TEXT NOT NULL,
    "vendor_order_id" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "product_subtotal" DECIMAL(14,2) NOT NULL,
    "allocated_discount" DECIMAL(14,2) NOT NULL,
    "refunded_merchandise" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "earned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "influencer_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "influencer_commission_ledger" (
    "id" TEXT NOT NULL,
    "influencer_id" TEXT NOT NULL,
    "commission_id" TEXT NOT NULL,
    "type" "InfluencerCommissionLedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "request_key" TEXT,
    "refund_amount" DECIMAL(14,2),
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "influencer_commission_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "influencers_is_active_name_idx" ON "influencers"("is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "influencer_commissions_vendor_order_id_key" ON "influencer_commissions"("vendor_order_id");

-- CreateIndex
CREATE INDEX "influencer_commissions_influencer_id_created_at_idx" ON "influencer_commissions"("influencer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "influencer_commission_ledger_request_key_key" ON "influencer_commission_ledger"("request_key");

-- CreateIndex
CREATE INDEX "influencer_commission_ledger_influencer_id_created_at_idx" ON "influencer_commission_ledger"("influencer_id", "created_at");

-- CreateIndex
CREATE INDEX "influencer_commission_ledger_commission_id_created_at_idx" ON "influencer_commission_ledger"("commission_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "influencers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "influencers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencers" ADD CONSTRAINT "influencers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commissions" ADD CONSTRAINT "influencer_commissions_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "influencers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commissions" ADD CONSTRAINT "influencer_commissions_vendor_order_id_fkey" FOREIGN KEY ("vendor_order_id") REFERENCES "vendor_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commission_ledger" ADD CONSTRAINT "influencer_commission_ledger_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "influencers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commission_ledger" ADD CONSTRAINT "influencer_commission_ledger_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "influencer_commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commission_ledger" ADD CONSTRAINT "influencer_commission_ledger_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
