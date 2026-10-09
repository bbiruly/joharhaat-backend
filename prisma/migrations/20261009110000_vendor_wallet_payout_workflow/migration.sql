-- AlterTable
ALTER TABLE "vendor_orders" ADD COLUMN     "carrier_name" TEXT,
ADD COLUMN     "carrier_tracking_id" TEXT;

-- AlterTable
ALTER TABLE "wallet_ledgers" ADD COLUMN     "payout_request_id" TEXT,
ALTER COLUMN "vendor_order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payout_requests" ADD COLUMN     "decision_reason" TEXT,
ADD COLUMN     "processed_by_id" TEXT,
ADD COLUMN     "settlement_reference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledgers_payout_request_id_key" ON "wallet_ledgers"("payout_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_settlement_reference_key" ON "payout_requests"("settlement_reference");

-- AddForeignKey
ALTER TABLE "wallet_ledgers" ADD CONSTRAINT "wallet_ledgers_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
