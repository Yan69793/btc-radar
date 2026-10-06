// BTC Radar — Queries D1
// Funções tipadas para acesso ao banco

// ─── Prices ───

export function insertPriceQuery(): string {
  return `INSERT OR REPLACE INTO prices (symbol, timestamp, open, high, low, close, volume, interval, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

// ─── Fear & Greed ───

export function insertFearGreedQuery(): string {
  return `INSERT OR REPLACE INTO fear_greed (date, value, classification, timestamp, source)
          VALUES (?, ?, ?, ?, ?)`;
}

// ─── News ───

export function insertNewsQuery(): string {
  return `INSERT OR IGNORE INTO news (published_at, title, url, source, sentiment, summary)
          VALUES (?, ?, ?, ?, ?, ?)`;
}

// ─── Aureus: signals append-only e signal_outcomes ──────────────────────────

export function insertSignalQuery(): string {
  return `INSERT OR IGNORE INTO signals (
    signal_id, symbol, timeframe, verdict, market_date, generated_at,
    entry_price, stop_loss, target_1, target_2, risk_reward, conviction,
    strategy, payload,
    strategy_version, engine_version, price_source, price_interval,
    direction, expires_at, params_snapshot, prev_hash, entry_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

export function insertSignalOutcomeQuery(): string {
  return `INSERT OR IGNORE INTO signal_outcomes (
    signal_id, status, resolved_at, resolved_price, price_source,
    price_interval, price_timestamp, gross_return_pct, net_return_pct,
    position_fraction, ambiguous_resolution, ambiguous_triggers,
    data_gap, gap_detail, fee_per_side, slippage_pct,
    raw_candle_payload, resolved_by_version, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

export function getLastSignalByStrategyDirectionQuery(): string {
  // Último sinal (qualquer status) por (strategy, timeframe, direction).
  // Usado para aplicar regra 7: não reabrir diariamente a mesma oportunidade
  // enquanto (estratégia, timeframe, direção) continuarem iguais, a menos
  // que a oportunidade anterior esteja totalmente resolvida (closed=1.0).
  return `SELECT s.*,
      COALESCE((
        SELECT SUM(so.position_fraction)
        FROM signal_outcomes so
        WHERE so.signal_id = s.signal_id
      ), 0) AS closed_fraction
    FROM signals s
    WHERE s.strategy = ? AND s.timeframe = ? AND s.direction = ?
      AND s.strategy_version = ?
    ORDER BY s.generated_at DESC
    LIMIT 1`;
}

export function getSignalsPendingResolutionQuery(): string {
  // Sinais com entrada válida, sem estar 100% resolvidos, cujo expires_at já ocorreu
  // ou que simplesmente estejam pendentes (usado pelo batch do resolvedor).
  return `SELECT s.*
    FROM signals s
    WHERE s.direction IN ('long','short')
      AND s.entry_price IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM signal_outcomes so
        WHERE so.signal_id = s.signal_id
          AND so.status IN ('expired','stop_loss','data_gap')
          AND so.position_fraction = 1
      )
      AND COALESCE((
        SELECT SUM(so.position_fraction)
        FROM signal_outcomes so
        WHERE so.signal_id = s.signal_id
          AND so.status IN ('target_1','target_2','stop_loss','expired','data_gap')
      ), 0) < 0.9999
    ORDER BY s.generated_at ASC`;
}

export function getTrackRecordSummaryQuery(): string {
  // resolved = 100% encerrado por pre?o. data_gap ? terminal, mas fica separado.
  // last_resolver_version segue cronologia de outcomes, nunca MAX lexicogr?fico.
  return `SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN COALESCE(price_closed.closed_fraction, 0) >= 0.9999 THEN 1 ELSE 0 END) AS resolved,
    SUM(CASE WHEN COALESCE(price_closed.closed_fraction, 0) < 0.9999 AND COALESCE(gaps.gap_fraction, 0) > 0 THEN 1 ELSE 0 END) AS data_gap,
    SUM(CASE WHEN COALESCE(price_closed.closed_fraction, 0) < 0.9999 AND COALESCE(gaps.gap_fraction, 0) = 0 THEN 1 ELSE 0 END) AS pending,
    MIN(CASE WHEN COALESCE(price_closed.closed_fraction, 0) >= 0.9999 THEN s.generated_at ELSE NULL END) AS period_start,
    MAX(CASE WHEN COALESCE(price_closed.closed_fraction, 0) >= 0.9999 THEN COALESCE(last_price_outcome.resolved_at, s.expires_at) ELSE NULL END) AS period_end,
    COUNT(DISTINCT s.strategy_version) AS n_strategy_versions,
    (SELECT so.resolved_by_version FROM signal_outcomes so ORDER BY so.created_at DESC, so.id DESC LIMIT 1) AS last_resolver_version
  FROM signals s
  LEFT JOIN (
    SELECT signal_id, SUM(position_fraction) AS closed_fraction
    FROM signal_outcomes
    WHERE status IN ('target_1','target_2','stop_loss','expired')
    GROUP BY signal_id
  ) price_closed ON price_closed.signal_id = s.signal_id
  LEFT JOIN (
    SELECT signal_id, SUM(position_fraction) AS gap_fraction
    FROM signal_outcomes
    WHERE status = 'data_gap'
    GROUP BY signal_id
  ) gaps ON gaps.signal_id = s.signal_id
  LEFT JOIN (
    SELECT signal_id, MAX(resolved_at) AS resolved_at
    FROM signal_outcomes
    WHERE status IN ('target_1','target_2','stop_loss','expired')
    GROUP BY signal_id
  ) last_price_outcome ON last_price_outcome.signal_id = s.signal_id
  WHERE s.direction IN ('long','short')
    AND s.entry_price IS NOT NULL`;
}

export function getSignalsListWithStatusQuery(limit: number, offset: number): string {
  const l = Math.max(1, Math.min(1000, limit | 0));
  const o = Math.max(0, offset | 0);
  return `SELECT s.*,
      COALESCE(closed.closed_fraction, 0) AS closed_fraction,
      CASE WHEN EXISTS (SELECT 1 FROM signal_outcomes sg WHERE sg.signal_id = s.signal_id AND sg.status = 'data_gap') THEN 'data_gap' WHEN COALESCE(closed.closed_fraction, 0) >= 0.9999 THEN 'closed' ELSE 'open' END AS overall_status,
      (SELECT JSON_GROUP_ARRAY(JSON_OBJECT(
        'status', so.status,
        'resolved_at', so.resolved_at,
        'resolved_price', so.resolved_price,
        'net_return_pct', so.net_return_pct,
        'position_fraction', so.position_fraction,
        'ambiguous_resolution', so.ambiguous_resolution,
        'data_gap', so.data_gap
      )) FROM signal_outcomes so WHERE so.signal_id = s.signal_id ORDER BY so.resolved_at ASC) AS outcomes
    FROM signals s
    LEFT JOIN (
      SELECT signal_id, SUM(position_fraction) AS closed_fraction
      FROM signal_outcomes
      WHERE status IN ('target_1','target_2','stop_loss','expired','data_gap')
      GROUP BY signal_id
    ) closed ON closed.signal_id = s.signal_id
    WHERE s.direction IN ('long','short')
      AND s.entry_price IS NOT NULL
    ORDER BY s.generated_at DESC
    LIMIT ${l} OFFSET ${o}`;
}

export function getPriceSeriesInRangeQuery(): string {
  return `SELECT timestamp, open, high, low, close, volume, interval, source
    FROM prices
    WHERE interval = ?
      AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC`;
}
