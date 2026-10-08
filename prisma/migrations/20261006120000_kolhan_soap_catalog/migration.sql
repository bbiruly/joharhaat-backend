-- Preserve historical product/order rows while taking listings in the old
-- marketplace taxonomy out of the customer catalog.
UPDATE "products" AS product
SET
  "is_published" = false,
  "lifecycle_status" = 'ARCHIVED',
  "updated_at" = CURRENT_TIMESTAMP
WHERE product."is_published" = true
  AND product."category_id" IN (
    SELECT category."id"
    FROM "categories" AS category
    WHERE category."slug" IN ('forest-foods', 'tribal-crafts', 'handloom', 'natural-wellness', 'organic-produce')
  );

INSERT INTO "categories" (
  "id", "slug", "name", "name_hi", "display_order", "is_featured", "is_active", "created_at", "updated_at"
)
VALUES
  ('kolhan-cat-clay-soaps', 'clay-soaps', 'Clay Soaps', 'क्ले साबुन', 10, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('kolhan-cat-honey-soaps', 'honey-soaps', 'Honey Soaps', 'शहद वाले साबुन', 20, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('kolhan-cat-goat-milk-soaps', 'goat-milk-soaps', 'Goat Milk Soaps', 'बकरी के दूध वाले साबुन', 30, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('kolhan-cat-herbal-soaps', 'herbal-soaps', 'Herbal Soaps', 'हर्बल साबुन', 40, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('kolhan-cat-botanical-soaps', 'botanical-soaps', 'Botanical Soaps', 'बॉटनिकल साबुन', 50, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('kolhan-cat-gift-sets', 'gift-sets', 'Gift Sets', 'उपहार सेट', 60, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('kolhan-cat-handmade-soaps', 'handmade-soaps', 'Handmade Soaps', 'हस्तनिर्मित साबुन', 70, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "name_hi" = EXCLUDED."name_hi",
  "display_order" = EXCLUDED."display_order",
  "is_featured" = EXCLUDED."is_featured",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = CURRENT_TIMESTAMP;
