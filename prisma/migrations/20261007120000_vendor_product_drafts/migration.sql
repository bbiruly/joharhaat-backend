-- CreateTable
CREATE TABLE "vendor_product_drafts" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_product_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_product_drafts_vendor_id_updated_at_idx" ON "vendor_product_drafts"("vendor_id", "updated_at");

-- AddForeignKey
ALTER TABLE "vendor_product_drafts" ADD CONSTRAINT "vendor_product_drafts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
