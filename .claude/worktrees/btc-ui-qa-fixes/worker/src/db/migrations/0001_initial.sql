-- BTC Radar — Migração 0001: schema inicial completo
-- Aplicar com: npx wrangler d1 migrations apply btc-radar

-- Preços OHLCV históricos
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL DEFAULT 'BTC-USD',
  timestamp TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  interval TEXT NOT NULL CHECK(interval IN ('1h','4h','1d','1w')),
  source TEXT NOT NULL DEFAULT 'CoinPaprika',
  UNIQUE(timestamp, interval)
);
CREATE INDEX IF NOT EXISTS idx_prices_interval_ts ON prices(interval, timestamp DESC);

-- Snapshots on-chain
CREATE TABLE IF NOT EXISTS onchain_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  hash_rate REAL,
  difficulty REAL,
  active_addresses INTEGER,
  transaction_count INTEGER,
  transaction_volume_usd REAL,
  avg_fee_sats REAL,
  block_height INTEGER,
  circulating_supply REAL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_onchain_ts ON onchain_snapshots(timestamp DESC);

-- Fear & Greed Index histórico
CREATE TABLE IF NOT EXISTS fear_greed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  value INTEGER NOT NULL CHECK(value >= 1 AND value <= 100),
  classification TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Alternative.me'
);
CREATE INDEX IF NOT EXISTS idx_fear_greed_date ON fear_greed(date DESC);

-- Sinais gerados
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL DEFAULT 'BTC-USD',
  timeframe TEXT NOT NULL CHECK(timeframe IN ('short','medium','long')),
  verdict TEXT NOT NULL CHECK(verdict IN ('COMPRAR','AGUARDAR','VENDER','REDUZIR')),
  market_date TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  entry_price REAL,
  stop_loss REAL,
  target_1 REAL,
  target_2 REAL,
  risk_reward REAL,
  conviction REAL CHECK(conviction >= 0 AND conviction <= 10),
  strategy TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(market_date DESC);
CREATE INDEX IF NOT EXISTS idx_signals_verdict ON signals(verdict);

-- Trades realizados
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  signal_id TEXT REFERENCES signals(signal_id) ON DELETE SET NULL,
  symbol TEXT NOT NULL DEFAULT 'BTC-USD',
  direction TEXT NOT NULL CHECK(direction IN ('long','short')),
  entry_price REAL NOT NULL,
  exit_price REAL,
  quantity REAL NOT NULL,
  entry_date TEXT NOT NULL,
  exit_date TEXT,
  status TEXT NOT NULL CHECK(status IN ('open','closed','partial','cancelled')),
  pnl_usd REAL,
  pnl_pct REAL,
  exit_reason TEXT,
  fees REAL DEFAULT 0,
  strategy TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_entry ON trades(entry_date DESC);

-- Portfolio snapshots
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  btc_balance REAL NOT NULL,
  usd_balance REAL NOT NULL,
  btc_price REAL NOT NULL,
  total_value_usd REAL NOT NULL,
  allocation_long_pct REAL,
  allocation_medium_pct REAL,
  allocation_short_pct REAL
);
CREATE INDEX IF NOT EXISTS idx_portfolio_ts ON portfolio_snapshots(timestamp DESC);

-- Alertas
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('price','technical','onchain','news','system')),
  condition TEXT NOT NULL,
  triggered_at TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(acknowledged, created_at DESC);

-- Cache de notícias
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  published_at TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  source TEXT NOT NULL,
  sentiment TEXT CHECK(sentiment IN ('positive','neutral','negative')),
  summary TEXT,
  UNIQUE(url)
);
CREATE INDEX IF NOT EXISTS idx_news_date ON news(published_at DESC);

-- Briefings diários
CREATE TABLE IF NOT EXISTS briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  r2_key TEXT,
  summary TEXT
);

-- Resultados de backtest
CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  strategy TEXT NOT NULL,
  params TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  run_at TEXT NOT NULL,
  total_return REAL,
  sharpe_ratio REAL,
  max_drawdown REAL,
  win_rate REAL,
  n_trades INTEGER,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backtest_strategy ON backtest_runs(strategy);
CREATE INDEX IF NOT EXISTS idx_backtest_run_at ON backtest_runs(run_at DESC);
