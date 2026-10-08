-- Keep the database default consistent with Prisma's @updatedAt-only field.
ALTER TABLE "homepage_video" ALTER COLUMN "updated_at" DROP DEFAULT;
