-- The checkout tax snapshot migration was already applied without these two
-- components. Add them in a forward-only migration so existing records remain
-- valid and Prisma can reconcile the deployed schema.
ALTER TABLE "order_items"
ADD COLUMN IF NOT EXISTS "cgst" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "sgst" DECIMAL(14,2);
