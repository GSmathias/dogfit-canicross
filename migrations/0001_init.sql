CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL,
  old_price REAL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO site_content (key, value) VALUES
('hero_eyebrow', 'CANICROSS • AVENTURA • PERFORMANCE'),
('hero_title', 'VOCÊ E SEU CÃO FORAM FEITOS PARA IR MAIS LONGE.'),
('hero_text', 'Experiências esportivas, trilhas, equipamentos e atividades para fortalecer a conexão entre você e seu cão.'),
('about_text', 'A DOGFIT CANICROSS nasceu para aproximar tutores e cães através de experiências esportivas, atividades ao ar livre e equipamentos pensados para movimento.'),
('event_title', 'DOGFIT CANICROSS EXPERIENCE'),
('event_location', 'Anápolis - GO'),
('event_date', ''),
('event_time', ''),
('event_slots', '18'),
('event_price', ''),
('event_whatsapp_message', 'Olá! Quero saber mais sobre o próximo evento da DOGFIT CANICROSS.'),
('event_image_url', '');
