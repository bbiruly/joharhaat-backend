ALTER TABLE "categories"
  ADD COLUMN "name_hi" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "description_hi" TEXT,
  ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "products"
  ALTER COLUMN "district" DROP NOT NULL,
  ALTER COLUMN "weekly_haat_day" DROP NOT NULL;

UPDATE "categories"
SET
  "name_hi" = CASE "slug"
    WHEN 'forest-foods' THEN 'वन उपज'
    WHEN 'tribal-crafts' THEN 'आदिवासी शिल्प'
    WHEN 'handloom' THEN 'हथकरघा'
    WHEN 'natural-wellness' THEN 'प्राकृतिक सेहत'
    ELSE "name_hi"
  END,
  "description" = CASE "slug"
    WHEN 'forest-foods' THEN 'Honey, mahua, millets and forest produce'
    WHEN 'tribal-crafts' THEN 'Dokra metalwork, bamboo, wood and stone'
    WHEN 'handloom' THEN 'Tussar silk, cotton weaves and tribal textiles'
    WHEN 'natural-wellness' THEN 'Cold-pressed oils, herbs and traditional remedies'
    ELSE "description"
  END,
  "description_hi" = CASE "slug"
    WHEN 'forest-foods' THEN 'शहद, महुआ, मोटा अनाज और वन उपज'
    WHEN 'tribal-crafts' THEN 'ढोकरा धातु, बाँस, लकड़ी और पत्थर'
    WHEN 'handloom' THEN 'तसर रेशम, सूती बुनाई और आदिवासी वस्त्र'
    WHEN 'natural-wellness' THEN 'तेल, जड़ी-बूटियाँ और पारंपरिक नुस्ख़े'
    ELSE "description_hi"
  END,
  "display_order" = CASE "slug"
    WHEN 'forest-foods' THEN 10
    WHEN 'tribal-crafts' THEN 20
    WHEN 'handloom' THEN 30
    WHEN 'natural-wellness' THEN 40
    ELSE "display_order"
  END,
  "is_featured" = CASE
    WHEN "slug" IN ('forest-foods', 'tribal-crafts', 'handloom', 'natural-wellness') THEN true
    ELSE "is_featured"
  END;

CREATE INDEX "categories_is_active_display_order_idx"
  ON "categories"("is_active", "display_order");
