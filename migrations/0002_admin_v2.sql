-- DOGFIT Admin v2
ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'Outros';
ALTER TABLE products ADD COLUMN stock_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE products ADD COLUMN badge TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO site_content (key, value) VALUES
('hero_image_url', ''),
('club_title', 'MAIS EXPERIÊNCIAS. MAIS BENEFÍCIOS.'),
('club_text', 'Um clube para quem quer viver a DOGFIT durante o ano todo, com benefícios exclusivos em eventos, produtos e experiências.'),
('club_benefits', 'Condições especiais em eventos
Descontos em produtos DOGFIT
Vantagens exclusivas para membros
Comunidade de tutores e cães ativos'),
('event_status', 'open');
