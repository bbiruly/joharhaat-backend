CREATE TYPE "ProductLifecycleStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

ALTER TABLE "products"
  ADD COLUMN "lifecycle_status" "ProductLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "moderation_reason" TEXT,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewer_id" TEXT,
  ADD COLUMN "materials" TEXT,
  ADD COLUMN "dimensions" TEXT,
  ADD COLUMN "care_instructions" TEXT,
  ADD COLUMN "dispatch_estimate" TEXT,
  ADD COLUMN "return_policy" TEXT;

UPDATE "products"
SET "lifecycle_status" = CASE WHEN "is_published" THEN 'APPROVED'::"ProductLifecycleStatus" ELSE 'DRAFT'::"ProductLifecycleStatus" END,
    "reviewed_at" = CASE WHEN "is_published" THEN "updated_at" ELSE NULL END;

CREATE TABLE "product_media" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "alt_text" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_cover" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_media_object_key_key" ON "product_media"("object_key");
CREATE INDEX "product_media_product_id_sort_order_idx" ON "product_media"("product_id", "sort_order");
CREATE INDEX "products_lifecycle_status_submitted_at_idx" ON "products"("lifecycle_status", "submitted_at");
ALTER TABLE "products" ADD CONSTRAINT "products_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
