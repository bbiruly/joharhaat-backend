-- CreateEnum
CREATE TYPE "BooksAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BooksEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BooksPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BooksPartyType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'MANUFACTURER', 'OTHER');

-- CreateEnum
CREATE TYPE "StockItemType" AS ENUM ('FINISHED_GOOD', 'RAW_MATERIAL', 'PACKAGING');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'PRODUCTION', 'CONSUMPTION', 'SALE', 'RETURN', 'DAMAGE', 'SAMPLE', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BooksSalesChannel" AS ENUM ('DIRECT', 'WHOLESALE', 'RETAIL', 'MARKETPLACE', 'OTHER');

-- CreateEnum
CREATE TYPE "BooksReconciliationStatus" AS ENUM ('RECONCILED', 'DISCREPANCY');

-- CreateTable
CREATE TABLE "books_settings" (
    "id" TEXT NOT NULL DEFAULT 'kolhan',
    "start_date" DATE NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "books_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BooksAccountType" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_cash_account" BOOLEAN NOT NULL DEFAULT false,
    "is_cost_of_goods_sold" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_parties" (
    "id" TEXT NOT NULL,
    "type" "BooksPartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "tax_id" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_entries" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "document_number" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_reference" TEXT,
    "channel" "BooksSalesChannel",
    "memo" TEXT NOT NULL,
    "occurred_at" DATE NOT NULL,
    "status" "BooksEntryStatus" NOT NULL DEFAULT 'POSTED',
    "party_id" TEXT,
    "reversal_of_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "books_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_entry_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "item_id" TEXT,

    CONSTRAINT "books_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_periods" (
    "id" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "BooksPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books_bank_reconciliations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "statement_balance" DECIMAL(14,2) NOT NULL,
    "book_balance" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "status" "BooksReconciliationStatus" NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StockItemType" NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "hsn_code" TEXT,
    "tax_rate" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "batch_code" TEXT NOT NULL,
    "location" TEXT,
    "manufactured_at" DATE,
    "expires_at" DATE,
    "quantity_on_hand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "entry_id" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4),
    "reason" TEXT,
    "moved_at" DATE NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "books_accounts_code_key" ON "books_accounts"("code");

-- CreateIndex
CREATE INDEX "books_accounts_type_is_active_idx" ON "books_accounts"("type", "is_active");

-- CreateIndex
CREATE INDEX "books_parties_type_name_idx" ON "books_parties"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "books_entries_reference_key" ON "books_entries"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "books_entries_reversal_of_id_key" ON "books_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "books_entries_occurred_at_status_idx" ON "books_entries"("occurred_at", "status");

-- CreateIndex
CREATE INDEX "books_entries_source_source_reference_idx" ON "books_entries"("source", "source_reference");

-- CreateIndex
CREATE INDEX "books_entries_party_id_occurred_at_idx" ON "books_entries"("party_id", "occurred_at");

-- CreateIndex
CREATE INDEX "books_entry_lines_account_id_entry_id_idx" ON "books_entry_lines"("account_id", "entry_id");

-- CreateIndex
CREATE INDEX "books_entry_lines_item_id_entry_id_idx" ON "books_entry_lines"("item_id", "entry_id");

-- CreateIndex
CREATE INDEX "books_periods_status_starts_on_ends_on_idx" ON "books_periods"("status", "starts_on", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "books_periods_starts_on_ends_on_key" ON "books_periods"("starts_on", "ends_on");

-- CreateIndex
CREATE INDEX "books_bank_reconciliations_status_ends_on_idx" ON "books_bank_reconciliations"("status", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "books_bank_reconciliations_account_id_starts_on_ends_on_key" ON "books_bank_reconciliations"("account_id", "starts_on", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_sku_key" ON "stock_items"("sku");

-- CreateIndex
CREATE INDEX "stock_items_type_is_active_idx" ON "stock_items"("type", "is_active");

-- CreateIndex
CREATE INDEX "stock_batches_item_id_expires_at_idx" ON "stock_batches"("item_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_item_id_batch_code_key" ON "stock_batches"("item_id", "batch_code");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_moved_at_idx" ON "stock_movements"("item_id", "moved_at");

-- CreateIndex
CREATE INDEX "stock_movements_batch_id_moved_at_idx" ON "stock_movements"("batch_id", "moved_at");

-- AddForeignKey
ALTER TABLE "books_entries" ADD CONSTRAINT "books_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "books_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entries" ADD CONSTRAINT "books_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "books_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entry_lines" ADD CONSTRAINT "books_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "books_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entry_lines" ADD CONSTRAINT "books_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "books_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_entry_lines" ADD CONSTRAINT "books_entry_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books_bank_reconciliations" ADD CONSTRAINT "books_bank_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "books_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "books_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
