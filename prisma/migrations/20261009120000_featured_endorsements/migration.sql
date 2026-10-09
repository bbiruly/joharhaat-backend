-- CreateEnum
CREATE TYPE "FeaturedEndorsementType" AS ENUM ('CELEBRITY', 'GOVERNMENT_OFFICIAL');

-- CreateEnum
CREATE TYPE "FeaturedEndorsementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "featured_endorsements" (
    "id" TEXT NOT NULL,
    "type" "FeaturedEndorsementType" NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "role" VARCHAR(160) NOT NULL,
    "organization" VARCHAR(160),
    "quote" VARCHAR(1200) NOT NULL,
    "image_object_key" TEXT,
    "image_url" TEXT,
    "image_alt_text" VARCHAR(200),
    "video_object_key" TEXT,
    "video_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "FeaturedEndorsementStatus" NOT NULL DEFAULT 'DRAFT',
    "identity_confirmed_at" TIMESTAMP(3),
    "consent_confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "featured_endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "featured_endorsements_status_display_order_created_at_idx" ON "featured_endorsements"("status", "display_order", "created_at");

-- AddForeignKey
ALTER TABLE "featured_endorsements" ADD CONSTRAINT "featured_endorsements_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_endorsements" ADD CONSTRAINT "featured_endorsements_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
