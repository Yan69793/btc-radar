-- BTC Radar — Migracao 0004: heartbeat das execucoes do cron
-- Registra cada rodada do handleScheduled para operacao saber que a coleta
-- realmente aconteceu (evita inferir por ausencia de dado).
-- Successos_erros: JSON com { coletor: "OK"|"ERRO: msg" } por bloco.

CREATE TABLE IF NOT EXISTS cron_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  successos_erros TEXT,
  freshness_json TEXT,
  has_errors INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cron_exec_run_at ON cron_executions(run_at DESC);
