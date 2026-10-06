-- Aureus — Migração 0007: histórico prospectivo de sinais (append-only) e resolução
-- Altera tabela signals para registro imutável com metadados de auditoria.
-- Cria tabela signal_outcomes separada para a resolução (outcome) de cada oportunidade.
-- Princípios não negociáveis neste arquivo:
--   • signals é append-only (nenhum UPDATE nas colunas de sinal já gravado).
--   • Resolução (stop/target/expiração) vai SEMPRE para signal_outcomes.
--   • Uma oportunidade (signal) pode ter múltiplos outcomes (ex: target_1 parcial + stop posterior).
-- NÃO edite migrations já aplicadas. Esta é a 0007, nova.

-- ─── 1. Colunas novas em signals (append-only; preenchem-se no INSERT) ──────

ALTER TABLE signals ADD COLUMN strategy_version TEXT DEFAULT '1.0.0' NOT NULL;
ALTER TABLE signals ADD COLUMN engine_version TEXT DEFAULT '1.0.0' NOT NULL;
ALTER TABLE signals ADD COLUMN price_source TEXT;
ALTER TABLE signals ADD COLUMN price_interval TEXT;
ALTER TABLE signals ADD COLUMN direction TEXT CHECK(direction IN ('long','short','flat'));
ALTER TABLE signals ADD COLUMN expires_at TEXT;
ALTER TABLE signals ADD COLUMN params_snapshot TEXT;
ALTER TABLE signals ADD COLUMN prev_hash TEXT;
ALTER TABLE signals ADD COLUMN entry_hash TEXT;

-- Índices auxiliares para queries do track record e deduplicação
CREATE INDEX IF NOT EXISTS idx_signals_strat_tf_dir ON signals(strategy, timeframe, direction, market_date DESC);
CREATE INDEX IF NOT EXISTS idx_signals_expires ON signals(expires_at) WHERE expires_at IS NOT NULL;

-- ─── 2. Tabela signal_outcomes: resolução das oportunidades ───────────────
-- Cada registro representa um evento de resolução. Uma oportunidade pode ter
-- múltiplos outcomes (ex: 50% em target_1, 50% em stop posteriormente).
-- status do outcome:
--   • target_1  — primeira saída parcial (50%)
--   • target_2  — segunda saída (50% restantes)
--   • stop_loss — stop atingido (qualquer posição remanescente)
--   • expired   — vencimento por tempo sem stop/target
--   • data_gap  — impossível resolver por falta de preço (não inventa preço)

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('target_1','target_2','stop_loss','expired','data_gap')),
  resolved_at TEXT NOT NULL,
  resolved_price REAL NOT NULL,
  price_source TEXT,
  price_interval TEXT,
  price_timestamp TEXT,
  -- retorno do outcome em si (sobre a fatia): (exit/entry - 1) * 100 (long), simétrico para short
  gross_return_pct REAL,
  net_return_pct REAL,
  -- tamanho da fatia que este outcome encerra (0.5 = 50%, 1.0 = 100%)
  position_fraction REAL NOT NULL DEFAULT 1.0,
  -- flag de convenção: no mesmo candle tocaram stop e alvo → stop primeiro
  ambiguous_resolution INTEGER NOT NULL DEFAULT 0,
  -- qual(is) trigger(es) tocaram no candle ambíguo (ex: "stop+target_1")
  ambiguous_triggers TEXT,
  -- se houver gap de dado (candle faltando no intervalo da série)
  data_gap INTEGER NOT NULL DEFAULT 0,
  gap_detail TEXT,
  fee_per_side REAL,
  slippage_pct REAL,
  raw_candle_payload TEXT,
  resolved_by_version TEXT DEFAULT '1.0.0' NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_outcomes_unique
  ON signal_outcomes(signal_id, status, resolved_at, position_fraction);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal ON signal_outcomes(signal_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_status ON signal_outcomes(status, resolved_at);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_resolved ON signal_outcomes(resolved_at DESC);
