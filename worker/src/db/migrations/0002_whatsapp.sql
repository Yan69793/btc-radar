-- BTC Radar — Migracao 0002: WhatsApp Subscribers + Messages

CREATE TABLE IF NOT EXISTS whatsapp_subscribers (
  phone TEXT PRIMARY KEY,
  subscribed_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_notification_at TEXT,
  notification_count INTEGER DEFAULT 0,
  preferences TEXT NOT NULL DEFAULT '{"signals":true,"alerts":true,"briefing":false}'
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  message_type TEXT NOT NULL,
  content TEXT,
  timestamp TEXT NOT NULL,
  wa_message_id TEXT,
  status TEXT
);

CREATE INDEX IF NOT EXISTS idx_wa_msg_phone ON whatsapp_messages(phone, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_status ON whatsapp_messages(wa_message_id);
