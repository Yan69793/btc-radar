-- BTC Radar — Migracao 0003: indice composto para performance de trades

CREATE INDEX IF NOT EXISTS idx_trades_status_exit ON trades(status, exit_date);
