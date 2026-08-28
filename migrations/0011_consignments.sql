-- DOGFIT CANICROSS - Controle de produtos consignados
-- Migration incremental. Não altera migrations anteriores e preserva histórico financeiro.

ALTER TABLE club_partners ADD COLUMN responsible_name TEXT NOT NULL DEFAULT '';
ALTER TABLE club_partners ADD COLUMN consignment_enabled INTEGER NOT NULL DEFAULT 0 CHECK (consignment_enabled IN (0, 1));
ALTER TABLE club_partners ADD COLUMN consignment_commission_bps INTEGER NOT NULL DEFAULT 3000 CHECK (consignment_commission_bps BETWEEN 0 AND 10000);
ALTER TABLE club_partners ADD COLUMN consignment_low_stock_threshold INTEGER NOT NULL DEFAULT 1 CHECK (consignment_low_stock_threshold >= 0);
ALTER TABLE club_partners ADD COLUMN consignment_notes TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS consignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL COLLATE NOCASE,
  partner_id INTEGER NOT NULL REFERENCES club_partners(id) ON DELETE RESTRICT,
  partner_name_snapshot TEXT NOT NULL,
  shipment_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ATIVA' CHECK (status IN ('ATIVA', 'ENCERRADA', 'CANCELADA')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consignments_code_nocase
  ON consignments(code COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_consignments_partner_date
  ON consignments(partner_id, shipment_date DESC);
CREATE INDEX IF NOT EXISTS idx_consignments_status
  ON consignments(status, shipment_date DESC);

CREATE TABLE IF NOT EXISTS consignment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER NOT NULL REFERENCES consignments(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL,
  variation TEXT NOT NULL DEFAULT '',
  quantity_sent INTEGER NOT NULL CHECK (quantity_sent > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  commission_bps INTEGER NOT NULL DEFAULT 3000 CHECK (commission_bps BETWEEN 0 AND 10000),
  low_stock_threshold INTEGER NOT NULL DEFAULT 1 CHECK (low_stock_threshold >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consignment_items_unique_variant
  ON consignment_items(consignment_id, product_id, variation COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_consignment_items_product
  ON consignment_items(product_id, variation COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS consignment_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL COLLATE NOCASE,
  partner_id INTEGER NOT NULL REFERENCES club_partners(id) ON DELETE RESTRICT,
  partner_name_snapshot TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_sales_cents INTEGER NOT NULL DEFAULT 0 CHECK (gross_sales_cents >= 0),
  commission_cents INTEGER NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  dogfit_net_cents INTEGER NOT NULL DEFAULT 0 CHECK (dogfit_net_cents >= 0),
  status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'PAGO', 'CANCELADO')),
  paid_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consignment_settlements_code_nocase
  ON consignment_settlements(code COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_consignment_settlements_partner_period
  ON consignment_settlements(partner_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_consignment_settlements_status
  ON consignment_settlements(status, created_at DESC);

CREATE TABLE IF NOT EXISTS consignment_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES club_partners(id) ON DELETE RESTRICT,
  consignment_id INTEGER REFERENCES consignments(id) ON DELETE RESTRICT,
  consignment_item_id INTEGER REFERENCES consignment_items(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name_snapshot TEXT NOT NULL,
  variation TEXT NOT NULL DEFAULT '',
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('ENVIADO', 'VENDA', 'REPOSICAO', 'DEVOLUCAO', 'AJUSTE', 'ESTORNO_VENDA')
  ),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  stock_delta INTEGER NOT NULL CHECK (stock_delta <> 0),
  movement_date TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  gross_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (gross_amount_cents >= 0),
  commission_bps_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps_snapshot BETWEEN 0 AND 10000),
  commission_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount_cents >= 0),
  dogfit_net_cents INTEGER NOT NULL DEFAULT 0 CHECK (dogfit_net_cents >= 0),
  commission_status TEXT NOT NULL DEFAULT 'NAO_APLICA'
    CHECK (commission_status IN ('NAO_APLICA', 'PENDENTE', 'PAGO', 'CANCELADA')),
  movement_status TEXT NOT NULL DEFAULT 'ATIVA'
    CHECK (movement_status IN ('ATIVA', 'ESTORNADA', 'CANCELADA')),
  settlement_id INTEGER REFERENCES consignment_settlements(id) ON DELETE RESTRICT,
  reversal_of_movement_id INTEGER REFERENCES consignment_movements(id) ON DELETE RESTRICT,
  responsible_user TEXT NOT NULL DEFAULT 'admin',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consignment_movements_stock
  ON consignment_movements(partner_id, product_id, variation COLLATE NOCASE, movement_date);
CREATE INDEX IF NOT EXISTS idx_consignment_movements_type_date
  ON consignment_movements(movement_type, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_consignment_movements_commission
  ON consignment_movements(commission_status, partner_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_consignment_movements_settlement
  ON consignment_movements(settlement_id);
