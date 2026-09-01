-- BTC Radar — Migracao 0005: usuarios do demo comercial
-- Cadastro proprio por cliente (nome, email, senha) para identificar quem
-- acessa o painel. Senha guardada so como hash PBKDF2, nunca em texto puro.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  login_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
