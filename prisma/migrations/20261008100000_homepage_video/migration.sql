CREATE TABLE "homepage_video" (
  "id" TEXT NOT NULL,
  "object_key" TEXT,
  "url" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updated_by_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "homepage_video_pkey" PRIMARY KEY ("id")
);
