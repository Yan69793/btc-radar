-- BTC Radar — isolamento de alertas e portfolio por usuario
-- Registros existentes ficam sem dono e portanto invisiveis ate atribuicao explicita.

ALTER TABLE alerts ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE portfolio_snapshots ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_alerts_user_created
  ON alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_user_ts
  ON portfolio_snapshots(user_id, timestamp DESC);
