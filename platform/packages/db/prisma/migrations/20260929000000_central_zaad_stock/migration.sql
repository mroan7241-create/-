-- Additive central Zaad quantity ledger. Historical association orders, shipments,
-- receipts and device units are intentionally not backfilled or debited.
CREATE TABLE "central_stock_balances" (
  "device_type" "DeviceType" NOT NULL,
  "contracted_qty" INTEGER NOT NULL DEFAULT 0,
  "received_qty" INTEGER NOT NULL DEFAULT 0,
  "distributed_qty" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "central_stock_balances_pkey" PRIMARY KEY ("device_type"),
  CONSTRAINT "central_stock_balances_nonnegative" CHECK ("contracted_qty" >= 0 AND "received_qty" >= 0 AND "distributed_qty" >= 0),
  CONSTRAINT "central_stock_balances_order" CHECK ("distributed_qty" <= "received_qty" AND "received_qty" <= "contracted_qty")
);

CREATE TABLE "central_stock_receipts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "device_type" "DeviceType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reference" TEXT NOT NULL,
  "recorded_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "central_stock_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "central_stock_receipts_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "central_stock_receipts_reference_not_empty" CHECK (length(btrim("reference")) > 0),
  CONSTRAINT "central_stock_receipts_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "accounts"("id") ON DELETE RESTRICT
);

CREATE INDEX "central_stock_receipts_device_type_created_at_idx" ON "central_stock_receipts"("device_type", "created_at");

CREATE TABLE "central_stock_dispatches" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "shipment_id" UUID NOT NULL,
  "device_type" "DeviceType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "central_stock_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "central_stock_dispatches_shipment_device_type_key" UNIQUE ("shipment_id", "device_type"),
  CONSTRAINT "central_stock_dispatches_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "central_stock_dispatches_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT
);

CREATE INDEX "central_stock_dispatches_device_type_released_at_idx" ON "central_stock_dispatches"("device_type", "released_at");

-- Never expose central counts to the public Supabase roles. Application access
-- continues through the ADMIN-only Nest controller and its existing DB role.
REVOKE ALL PRIVILEGES ON TABLE "central_stock_balances", "central_stock_receipts", "central_stock_dispatches" FROM anon, authenticated;
ALTER TABLE "central_stock_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "central_stock_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "central_stock_dispatches" ENABLE ROW LEVEL SECURITY;
