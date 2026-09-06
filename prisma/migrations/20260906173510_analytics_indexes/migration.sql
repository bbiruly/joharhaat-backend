-- CreateIndex
CREATE INDEX "carts_created_at_idx" ON "carts"("created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "vendor_orders_status_created_at_idx" ON "vendor_orders"("status", "created_at");
