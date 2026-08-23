-- DOGFIT Club: associados, parceiros, benefícios, cupons e utilizações

CREATE TABLE IF NOT EXISTS club_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_code TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  dog_name TEXT NOT NULL DEFAULT '',
  plan_name TEXT NOT NULL DEFAULT 'Clube DOGFIT CANICROSS',
  monthly_fee REAL NOT NULL DEFAULT 79.90,
  joined_on TEXT NOT NULL DEFAULT (date('now')),
  valid_until TEXT,
  payment_status TEXT NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid', 'pending', 'overdue')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  access_salt TEXT NOT NULL,
  access_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_benefits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER REFERENCES club_partners(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  benefit_type TEXT NOT NULL DEFAULT 'percentage'
    CHECK (benefit_type IN ('percentage', 'fixed', 'credit', 'item')),
  value REAL NOT NULL DEFAULT 0,
  period TEXT NOT NULL DEFAULT 'unlimited'
    CHECK (period IN ('monthly', 'annual', 'once', 'unlimited')),
  usage_limit INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  starts_on TEXT,
  ends_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'percentage'
    CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value REAL NOT NULL DEFAULT 0,
  partner_id INTEGER REFERENCES club_partners(id) ON DELETE SET NULL,
  member_id INTEGER REFERENCES club_members(id) ON DELETE CASCADE,
  total_limit INTEGER,
  per_member_limit INTEGER NOT NULL DEFAULT 1,
  starts_on TEXT,
  ends_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES club_members(id) ON DELETE CASCADE,
  partner_id INTEGER REFERENCES club_partners(id) ON DELETE SET NULL,
  benefit_id INTEGER REFERENCES club_benefits(id) ON DELETE SET NULL,
  coupon_id INTEGER REFERENCES club_coupons(id) ON DELETE SET NULL,
  amount_before REAL,
  discount_amount REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (benefit_id IS NOT NULL AND coupon_id IS NULL) OR
    (benefit_id IS NULL AND coupon_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS club_partner_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES club_partners(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_club_members_code
  ON club_members(member_code);
CREATE INDEX IF NOT EXISTS idx_club_members_token
  ON club_members(public_token);
CREATE INDEX IF NOT EXISTS idx_club_members_status
  ON club_members(status, payment_status, valid_until);
CREATE INDEX IF NOT EXISTS idx_club_benefits_partner
  ON club_benefits(partner_id, active);
CREATE INDEX IF NOT EXISTS idx_club_coupons_code
  ON club_coupons(code, active);
CREATE INDEX IF NOT EXISTS idx_club_redemptions_member_date
  ON club_redemptions(member_id, redeemed_at);
CREATE INDEX IF NOT EXISTS idx_club_redemptions_partner_date
  ON club_redemptions(partner_id, redeemed_at);
CREATE INDEX IF NOT EXISTS idx_club_sessions_hash
  ON club_partner_sessions(token_hash, expires_at);

INSERT INTO club_benefits (
  title, description, benefit_type, value, period, usage_limit
) SELECT
  'Eventos simples gratuitos',
  'Duas participações gratuitas em eventos simples de canicross por mês.',
  'credit', 0, 'monthly', 2
WHERE NOT EXISTS (
  SELECT 1 FROM club_benefits WHERE title = 'Eventos simples gratuitos'
);

INSERT INTO club_benefits (
  title, description, benefit_type, value, period, usage_limit
) SELECT
  'Eventos especiais',
  '25% de desconto nos eventos especiais da DOGFIT CANICROSS.',
  'percentage', 25, 'unlimited', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM club_benefits WHERE title = 'Eventos especiais'
);

INSERT INTO club_benefits (
  title, description, benefit_type, value, period, usage_limit
) SELECT
  'Produtos e serviços DOGFIT',
  'Até 20% de desconto em produtos e serviços DOGFIT.',
  'percentage', 20, 'unlimited', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM club_benefits WHERE title = 'Produtos e serviços DOGFIT'
);

INSERT INTO club_benefits (
  title, description, benefit_type, value, period, usage_limit
) SELECT
  'Camisas do Clube',
  'Três camisas exclusivas do Clube DOGFIT CANICROSS por ano.',
  'item', 0, 'annual', 3
WHERE NOT EXISTS (
  SELECT 1 FROM club_benefits WHERE title = 'Camisas do Clube'
);
