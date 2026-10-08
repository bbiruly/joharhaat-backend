ALTER TABLE "payment_intents"
  ADD COLUMN "provider_order_id" TEXT,
  ADD COLUMN "provider_payment_id" TEXT,
  ADD COLUMN "verified_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "payment_intents_provider_order_id_key" ON "payment_intents"("provider_order_id");
CREATE UNIQUE INDEX "payment_intents_provider_payment_id_key" ON "payment_intents"("provider_payment_id");

ALTER TABLE "email_outbox"
  ADD COLUMN "provider_message_id" TEXT,
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "terminal_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "email_outbox_provider_message_id_key" ON "email_outbox"("provider_message_id");
CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");
