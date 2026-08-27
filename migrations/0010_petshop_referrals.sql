-- DOGFIT: cupons de indicação de pet shops e comissões
-- Mantém este sistema separado de club_coupons (cupons/benefícios do Clube).

CREATE TABLE IF NOT EXISTS partner_referral_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL UNIQUE REFERENCES club_partners(id) ON DELETE RESTRICT,
  code TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  customer_discount_type TEXT NOT NULL DEFAULT 'percentage'
    CHECK (customer_discount_type IN ('percentage', 'fixed')),
  customer_discount_bps INTEGER NOT NULL DEFAULT 500 CHECK (customer_discount_bps BETWEEN 0 AND 10000),
  customer_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (customer_discount_cents >= 0),
  event_commission_cents INTEGER NOT NULL DEFAULT 500 CHECK (event_commission_cents >= 0),
  club_commission_cents INTEGER NOT NULL DEFAULT 1000 CHECK (club_commission_cents >= 0),
  product_commission_bps INTEGER NOT NULL DEFAULT 1000 CHECK (product_commission_bps BETWEEN 0 AND 10000),
  per_customer_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_customer_limit >= 1),
  allow_stacking INTEGER NOT NULL DEFAULT 0 CHECK (allow_stacking IN (0, 1)),
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_referral_code_nocase
  ON partner_referral_settings(code COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_partner_referral_settings_partner
  ON partner_referral_settings(partner_id, active);

CREATE TABLE IF NOT EXISTS partner_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_setting_id INTEGER NOT NULL REFERENCES partner_referral_settings(id) ON DELETE RESTRICT,
  partner_id INTEGER NOT NULL REFERENCES club_partners(id) ON DELETE RESTRICT,
  code_snapshot TEXT NOT NULL,
  partner_name_snapshot TEXT NOT NULL,
  customer_id INTEGER REFERENCES customer_accounts(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL CHECK (source_type IN ('event', 'club', 'product')),
  source_reference TEXT NOT NULL,
  event_registration_id INTEGER REFERENCES event_registrations(id) ON DELETE SET NULL,
  club_member_id INTEGER REFERENCES club_members(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  original_amount_cents INTEGER NOT NULL CHECK (original_amount_cents >= 0),
  other_discount_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (other_discount_amount_cents >= 0),
  discount_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount_cents >= 0),
  final_amount_cents INTEGER NOT NULL CHECK (final_amount_cents >= 0),
  event_commission_cents_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (event_commission_cents_snapshot >= 0),
  club_commission_cents_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (club_commission_cents_snapshot >= 0),
  product_commission_bps_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (product_commission_bps_snapshot BETWEEN 0 AND 10000),
  commission_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (commission_amount_cents >= 0),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'approved', 'cancelled', 'refunded')),
  commission_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (commission_status IN ('pending', 'released', 'paid', 'cancelled')),
  payment_provider TEXT NOT NULL DEFAULT '',
  payment_transaction_id TEXT NOT NULL DEFAULT '',
  referred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_confirmed_at TEXT,
  commission_paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_referrals_source
  ON partner_referrals(source_type, source_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_referrals_payment_transaction
  ON partner_referrals(payment_provider, payment_transaction_id)
  WHERE payment_provider <> '' AND payment_transaction_id <> '';
CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner_date
  ON partner_referrals(partner_id, referred_at);
CREATE INDEX IF NOT EXISTS idx_partner_referrals_status
  ON partner_referrals(payment_status, commission_status, referred_at);
CREATE INDEX IF NOT EXISTS idx_partner_referrals_customer
  ON partner_referrals(referral_setting_id, customer_id, customer_email, customer_phone);
