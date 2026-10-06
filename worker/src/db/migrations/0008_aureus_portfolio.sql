-- Aureus Portfolio v1: estado persistente, ciclos idempotentes, eventos e snapshots de NAV.
CREATE TABLE IF NOT EXISTS aureus_portfolio_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  cash REAL NOT NULL,
  position_json TEXT,
  realized_pnl REAL NOT NULL,
  total_fees REAL NOT NULL,
  cycle INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aureus_portfolio_cycles (
  cycle_key TEXT PRIMARY KEY,
  evaluated_at TEXT NOT NULL,
  candle_timestamp TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('COMPRAR','VENDER','REDUZIR','AGUARDAR')),
  consensus_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aureus_portfolio_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_key TEXT NOT NULL REFERENCES aureus_portfolio_cycles(cycle_key) ON DELETE CASCADE,
  event_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(cycle_key, event_index)
);

CREATE TABLE IF NOT EXISTS aureus_portfolio_snapshots (
  cycle_key TEXT PRIMARY KEY REFERENCES aureus_portfolio_cycles(cycle_key) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  nav REAL NOT NULL,
  cash REAL NOT NULL,
  position_value REAL NOT NULL,
  exposure REAL NOT NULL,
  quantity REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  total_fees REAL NOT NULL,
  cycle INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aureus_snapshots_timestamp
  ON aureus_portfolio_snapshots(timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_aureus_events_cycle
  ON aureus_portfolio_events(cycle_key, event_index);
