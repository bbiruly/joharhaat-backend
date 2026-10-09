-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gst_rate" DECIMAL(5,2),
ADD COLUMN     "tax_hsn_code" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_cgst" DECIMAL(12,2),
ADD COLUMN     "delivery_igst" DECIMAL(12,2),
ADD COLUMN     "delivery_sgst" DECIMAL(12,2),
ADD COLUMN     "delivery_tax_rate" DECIMAL(5,2),
ADD COLUMN     "delivery_taxable" DECIMAL(12,2),
ADD COLUMN     "igst" DECIMAL(14,2),
ADD COLUMN     "recipient_state" TEXT,
ADD COLUMN     "tax_breakdown" JSONB;

-- AlterTable
ALTER TABLE "vendor_orders" ADD COLUMN     "igst" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "discount_amount" DECIMAL(14,2),
ADD COLUMN     "gst_rate" DECIMAL(5,2),
ADD COLUMN     "igst" DECIMAL(14,2),
ADD COLUMN     "tax_hsn_code" TEXT,
ADD COLUMN     "taxable_value" DECIMAL(14,2);
