-- AlterTable
ALTER TABLE "addresses"
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "state" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "addresses_user_id_is_archived_is_default_idx" ON "addresses"("user_id", "is_archived", "is_default");
