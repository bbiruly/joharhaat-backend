CREATE TYPE "BooksCashFlowActivity" AS ENUM ('OPERATING', 'INVESTING', 'FINANCING', 'TRANSFER');

ALTER TABLE "books_entry_lines"
  ADD COLUMN "cash_flow_activity" "BooksCashFlowActivity",
  ADD COLUMN "cash_flow_particular" TEXT;
