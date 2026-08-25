-- DOGFIT: clientes, pré-inscrições e diretório público de parceiros

CREATE TABLE IF NOT EXISTS customer_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  birth_date TEXT,
  phone TEXT NOT NULL DEFAULT '',
  dog_name TEXT NOT NULL DEFAULT '',
  dog_breed TEXT NOT NULL DEFAULT '',
  dog_count INTEGER NOT NULL DEFAULT 1,
  sociability TEXT NOT NULL DEFAULT 'social'
    CHECK (sociability IN ('social', 'selective', 'reactive', 'unknown')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  privacy_accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_code TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customer_accounts(id) ON DELETE SET NULL,
  event_title TEXT NOT NULL,
  event_date TEXT,
  event_time TEXT NOT NULL DEFAULT '',
  event_location TEXT NOT NULL DEFAULT '',
  event_price TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  dog_name TEXT NOT NULL,
  dog_breed TEXT NOT NULL,
  dog_count INTEGER NOT NULL DEFAULT 1,
  sociability TEXT NOT NULL,
  recreational_terms_accepted INTEGER NOT NULL DEFAULT 0,
  muzzle_terms_accepted INTEGER NOT NULL DEFAULT 0,
  privacy_accepted INTEGER NOT NULL DEFAULT 0,
  terms_version TEXT NOT NULL DEFAULT '2026-08-25',
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE club_members ADD COLUMN customer_id INTEGER;
ALTER TABLE club_partners ADD COLUMN category TEXT NOT NULL DEFAULT 'Pet shop';
ALTER TABLE club_partners ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE club_partners ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE club_partners ADD COLUMN instagram TEXT NOT NULL DEFAULT '';
ALTER TABLE club_partners ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE club_partners ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_customer_accounts_email
  ON customer_accounts(email);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_hash
  ON customer_sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_event_registrations_email
  ON event_registrations(email, created_at);
CREATE INDEX IF NOT EXISTS idx_event_registrations_status
  ON event_registrations(payment_status, created_at);
CREATE INDEX IF NOT EXISTS idx_event_registrations_customer
  ON event_registrations(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_club_members_customer
  ON club_members(customer_id);

-- Mantém o parceiro já cadastrado visível no diretório.
UPDATE club_partners
SET category = CASE
      WHEN lower(name) LIKE '%clinic%' OR lower(name) LIKE '%vet%' THEN 'Clínica veterinária'
      ELSE 'Pet shop'
    END,
    public_visible = 1
WHERE category = '' OR category IS NULL;
