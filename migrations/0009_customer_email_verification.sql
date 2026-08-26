-- DOGFIT: verificação real de e-mail para contas de clientes

ALTER TABLE customer_accounts ADD COLUMN email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS customer_email_verifications (
  customer_id INTEGER PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_email_verifications_expiry
  ON customer_email_verifications(expires_at);
