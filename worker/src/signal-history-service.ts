// Aureus — Persistência e coordenação do histórico prospectivo
// Pontes entre: SignalDocument (atual, sem metadados novos) ↔ signals/signals_outcomes (D1)
// Coordena a regra 7 (não reabre oportunidades iguais).
// Preserva comportamento existente de geração de sinais — só adiciona escrita no D1.

import type { D1Database } from "@cloudflare/workers-types";
import {
  HISTORY_ENGINE_VERSION,
  HISTORY_STRATEGY_VERSION,
  HISTORY_RESOLVER_VERSION,
  CANDLE_INTERVAL_MS,
  candleCloseMs,
  buildSignalId,
  computeExpiresAt,
  resolveProspectively,
  verdictToDirection,
  type Direction,
  type SignalOutcomeRecord,
} from "./lib/signal-history";
import type { OHLCV, SignalDocument, Timeframe } from "./types";
import {
  getLastSignalByStrategyDirectionQuery,
  getPriceSeriesInRangeQuery,
  getSignalsPendingResolutionQuery,
  getTrackRecordSummaryQuery,
  insertSignalQuery,
  insertSignalOutcomeQuery,
  getSignalsListWithStatusQuery,
} from "./db/queries";
import { SERVICE_VERSION } from "./version";

export interface PersistedSignalRow {
  signal_id: string;
  symbol: string;
  timeframe: Timeframe;
  verdict: string;
  market_date: string;
  generated_at: string;
  entry_price: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  risk_reward: number | null;
  conviction: number;
  strategy: string;
  payload: string;
  strategy_version: string;
  engine_version: string;
  price_source: string | null;
  price_interval: string | null;
  direction: string | null;
  expires_at: string | null;
  params_snapshot: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
  closed_fraction?: number;
  overall_status?: string;
  outcomes?: string | null;
}

export interface WriteSignalsResult {
  attempted: number;
  inserted: number;
  skipped_same_direction_open: number;
  skipped_flat_or_no_entry: number;
}

/** Converte SignalDocument (gerado pelo motor atual) + metadados em linha do D1
 *  usando identidade nova e idempotente (buildSignalId). */
export function enrichSignalForPersist(opts: {
  signal: SignalDocument;
  priceSource?: string;
  priceInterval?: string;
  now: string;
  engineVersion?: string;
  strategyVersion?: string;
}): PersistedSignalRow {
  const { signal, priceSource, priceInterval, now, engineVersion, strategyVersion } = opts;
  const direction = verdictToDirection(signal.verdict);
  const strategyV = strategyVersion ?? HISTORY_STRATEGY_VERSION;
  const engineV = engineVersion ?? HISTORY_ENGINE_VERSION;

  const newId = buildSignalId({
    strategy: signal.strategy,
    timeframe: signal.timeframe,
    direction,
    generatedAt: signal.generated_at ?? now,
    strategyVersion: strategyV,
  });

  const expiresAt = direction !== "flat"
    ? computeExpiresAt(signal.generated_at ?? now, signal.timeframe)
    : null;

  const paramsSnapshot = JSON.stringify({
    verdict: signal.verdict,
    payload: signal.payload,
    risk_reward: signal.risk_reward,
    engine_service_version: SERVICE_VERSION,
  });

  return {
    signal_id: newId,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    verdict: signal.verdict,
    market_date: signal.market_date,
    generated_at: signal.generated_at ?? now,
    entry_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    target_1: signal.target_1,
    target_2: signal.target_2,
    risk_reward: signal.risk_reward,
    conviction: signal.conviction,
    strategy: signal.strategy,
    payload: typeof signal.payload === "string" ? signal.payload : JSON.stringify(signal.payload),
    strategy_version: strategyV,
    engine_version: engineV,
    price_source: priceSource ?? null,
    price_interval: priceInterval ?? null,
    direction,
    expires_at: expiresAt,
    params_snapshot: paramsSnapshot,
    prev_hash: null,
    entry_hash: null,
  };
}

/** Escreve sinais append-only com idempotência e regra 7 (não reabre enquanto aberto,
 *  mesma estratégia, timeframe e direção, mesma versão de estratégia). */
export async function persistSignals(DB: D1Database, enriched: PersistedSignalRow[]): Promise<WriteSignalsResult> {
  const result: WriteSignalsResult = {
    attempted: enriched.length,
    inserted: 0,
    skipped_same_direction_open: 0,
    skipped_flat_or_no_entry: 0,
  };

  for (const s of enriched) {
    // Regra 7: apenas oportunidades acionáveis entram. flat ou sem entry → pula.
    if (s.direction === "flat" || s.entry_price == null) {
      result.skipped_flat_or_no_entry += 1;
      continue;
    }

    const prev = await DB.prepare(getLastSignalByStrategyDirectionQuery())
      .bind(s.strategy, s.timeframe, s.direction, s.strategy_version)
      .first<PersistedSignalRow & { closed_fraction: number | null }>();

    const prevFraction = prev?.closed_fraction ?? 0;
    const prevIsOpen = !!prev && prevFraction < 0.9999;
    if (prevIsOpen) {
      result.skipped_same_direction_open += 1;
      continue;
    }

    const out = await DB.prepare(insertSignalQuery())
      .bind(
        s.signal_id, s.symbol, s.timeframe, s.verdict, s.market_date, s.generated_at,
        s.entry_price, s.stop_loss, s.target_1, s.target_2, s.risk_reward, s.conviction,
        s.strategy, s.payload,
        s.strategy_version, s.engine_version, s.price_source, s.price_interval,
        s.direction, s.expires_at, s.params_snapshot, s.prev_hash, s.entry_hash,
      )
      .run();

    if (out.success && (out.meta as { rows_written?: number }).rows_written === 1) {
      result.inserted += 1;
    } else if (!out.success) {
      // INSERT OR IGNORE: a restrição de UNIQUE ignora; idempotente.
      // Outros erros (DB indisponível) são raros — propagar? Aqui silent para não quebrar o cron.
      // TODO: P3 — logar em tabela de auditoria, fora do escopo desta task.
    }
  }

  return result;
}

/** Resolve em batch os sinais pendentes usando a série de preços no D1.
 *  Por padrão, busca preços no mesmo intervalo do sinal; se não houver preços
 *  disponíveis para o intervalo, devolve data_gap.
 */
export async function resolvePendingSignals(DB: D1Database, opts?: {
  feePerSide?: number;
  slippagePct?: number;
  resolverVersion?: string;
  nowMs?: number;
}): Promise<{
  resolved: number;
  with_gap: number;
  processed: number;
  errors: string[];
}> {
  const rows = await DB.prepare(getSignalsPendingResolutionQuery()).all<PersistedSignalRow>();
  const errors: string[] = [];
  let resolvedCount = 0;
  let withGap = 0;
  let processed = 0;

  if (!rows.success) return { resolved: 0, with_gap: 0, processed: 0, errors: ["query signals pending falhou"] };

  for (const s of rows.results ?? []) {
    processed += 1;
    try {
      // Busca série de preços: do horário do sinal até expires_at (mais 1 candle de margem).
      const interval = (s.price_interval as OHLCV["interval"]) || "1h";
      const duration = CANDLE_INTERVAL_MS[interval];
      const nowMs = opts?.nowMs ?? Date.now();
      const startIso = new Date(Date.parse(s.generated_at) - duration).toISOString();
      const endIso = new Date(Date.parse(s.expires_at ?? s.generated_at) + duration).toISOString();

      // Não misturar convenções temporais em sinais parcialmente resolvidos.
      // Outcomes completos são excluídos pela query de pendentes e ficam intactos.
      const previous = await DB.prepare("SELECT * FROM signal_outcomes WHERE signal_id = ? ORDER BY resolved_at ASC")
        .bind(s.signal_id).all<SignalOutcomeRecord>();
      if (!previous.success || previous.results?.some(o => o.resolved_by_version !== (opts?.resolverVersion ?? HISTORY_RESOLVER_VERSION))) {
          errors.push(`sinal parcial de metodologia anterior exige reconciliação explícita signal=${s.signal_id}`);
          continue;
      }

      const seriesRows = await DB.prepare(getPriceSeriesInRangeQuery())
        .bind(interval, startIso, endIso)
        .all<OHLCV>();

      if (!seriesRows.success) {
        errors.push(`preço query falhou signal=${s.signal_id}`);
        continue;
      }

      // Anti-veneno do cron: um sinal recém-gravado tem generated_at = agora e a
      // série disponível ainda não possui candle posterior a esse instante. Se
      // chamássemos o resolvedor agora, ele emitiria data_gap com fraction=1 e a
      // query de pendentes excluiria o sinal para sempre (falso gap terminal).
      // Só resolvemos quando existe ao menos um candle ESTRITAMENTE posterior a
      // generated_at. Se ainda não existe E o sinal não venceu, permanece pendente.
      const series = (seriesRows.results ?? []).filter(c => candleCloseMs(c) <= nowMs);
      const generatedTs = new Date(s.generated_at).getTime();
      const hasCandleAfterGenerated = series.some(c => candleCloseMs(c) > generatedTs);
      const expiresTs = s.expires_at ? new Date(s.expires_at).getTime() : Number.NEGATIVE_INFINITY;
      if (!hasCandleAfterGenerated && expiresTs > nowMs) {
        continue; // sem candle executável e sem vencimento: segue pendente, sem outcome
      }

      const res = resolveProspectively({
        signal: {
          signal_id: s.signal_id,
          direction: s.direction as Direction,
          entry_price: s.entry_price,
          stop_loss: s.stop_loss,
          target_1: s.target_1,
          target_2: s.target_2,
          generated_at: s.generated_at,
          expires_at: s.expires_at!,
          strategy: s.strategy,
          timeframe: s.timeframe,
          strategy_version: s.strategy_version,
          engine_version: s.engine_version,
        },
        series,
        feePerSide: opts?.feePerSide,
        slippagePct: opts?.slippagePct,
        resolverVersion: opts?.resolverVersion,
        priceInterval: interval,
        nowMs,
      });

      if (previous.results?.some(old => !res.outcomes.some(candidate =>
        candidate.status === old.status && candidate.resolved_at === old.resolved_at
        && candidate.position_fraction === old.position_fraction && candidate.resolved_price === old.resolved_price))) {
        errors.push(`trajetória diverge de outcome imutável signal=${s.signal_id}`);
        continue;
      }
      for (const outcome of res.outcomes) {
        await writeSignalOutcome(DB, outcome);
      }

      const terminalGap = res.outcomes.some(o => o.status === "data_gap");
      if (res.has_gap || terminalGap) withGap += 1;
      if (!terminalGap && res.closed_fraction >= 0.9999) resolvedCount += 1;
    } catch (err) {
      errors.push(`resolve signal=${s.signal_id}: ${(err as Error).message}`);
    }
  }

  return {
    resolved: resolvedCount,
    with_gap: withGap,
    processed,
    errors,
  };
}

/** Escreve 1 outcome. INSERT OR IGNORE garante idempotência. */
export async function writeSignalOutcome(DB: D1Database, o: SignalOutcomeRecord): Promise<void> {
  await DB.prepare(insertSignalOutcomeQuery())
    .bind(
      o.signal_id, o.status, o.resolved_at, o.resolved_price, o.price_source ?? null,
      o.price_interval ?? null, o.price_timestamp ?? null, o.gross_return_pct ?? null, o.net_return_pct ?? null,
      o.position_fraction, o.ambiguous_resolution, o.ambiguous_triggers ?? null,
      o.data_gap, o.gap_detail ?? null, o.fee_per_side, o.slippage_pct,
      o.raw_candle_payload ?? null, o.resolved_by_version, o.created_at,
    )
    .run();
}

/** Agregado para métricas públicas. Retorna nulos honestos em caso de amostra vazia. */
export interface TrackRecordSummary {
  methodology_version: string;
  total: number;
  resolved: number;
  data_gap: number;
  pending: number;
  period_start: string | null;
  period_end: string | null;
  n_strategy_versions: number;
  last_resolver_version: string | null;
  win_rate: number | null;
  avg_net_pct: number | null;
  avg_gross_pct: number | null;
  expectancy_pct: number | null;
  profit_factor: number | null;
  best_net_pct: number | null;
  worst_net_pct: number | null;
  strategy_version: string;
  engine_version: string;
}

/** Sumário do track record (métricas públicas).
 *  Observação (regra 12): usa apenas as oportunidades com closed_fraction = 1.
 *  Ausência de amostra → métricas numéricas = null (nunca 0 artificial). */
export async function getTrackRecordSummary(DB: D1Database): Promise<TrackRecordSummary> {
  const row = await DB.prepare(getTrackRecordSummaryQuery()).first<{
    total: number | null;
    resolved: number | null;
    data_gap: number | null;
    pending: number | null;
    period_start: string | null;
    period_end: string | null;
    n_strategy_versions: number | null;
    last_resolver_version: string | null;
  }>();

  const total = Number(row?.total ?? 0);
  const resolved = Number(row?.resolved ?? 0);
  const data_gap = Number(row?.data_gap ?? 0);
  const pending = Number(row?.pending ?? 0);

  let win_rate: number | null = null;
  let avg_net_pct: number | null = null;
  let avg_gross_pct: number | null = null;
  let best_net_pct: number | null = null;
  let worst_net_pct: number | null = null;
  let profit_factor: number | null = null;
  let expectancy_pct: number | null = null;

  if (resolved > 0) {
    // Métricas de retorno consideram SOMENTE sinais com pelo menos um outcome de
    // preço (target_1/target_2/stop_loss/expired). Um sinal puramente data_gap
    // NÃO entra: não pode virar "retorno 0" artificial. Por isso o gate abaixo
    // agrega só status de preço, e o CASE soma só eles.
    const tradesQ = `SELECT s.signal_id,
        COALESCE(SUM(CASE WHEN so.status IN ('target_1','target_2','expired','stop_loss')
            THEN (so.net_return_pct * so.position_fraction) ELSE 0 END), 0) AS weighted_net_pct,
        COALESCE(SUM(CASE WHEN so.status IN ('target_1','target_2','expired','stop_loss')
            THEN (so.gross_return_pct * so.position_fraction) ELSE 0 END), 0) AS weighted_gross_pct
      FROM signals s
      JOIN (
        SELECT signal_id, SUM(position_fraction) AS cf
        FROM signal_outcomes
        WHERE status IN ('target_1','target_2','stop_loss','expired')
        GROUP BY signal_id
        HAVING cf >= 0.9999
      ) closed ON closed.signal_id = s.signal_id
      LEFT JOIN signal_outcomes so ON so.signal_id = s.signal_id
      GROUP BY s.signal_id`;

    const rows = await DB.prepare(tradesQ).all<{ weighted_net_pct: number; weighted_gross_pct: number }>();
    const list = (rows.success ? rows.results : []) || [];
    if (list.length > 0) {
      const nets = list.map(r => r.weighted_net_pct);
      const gross = list.map(r => r.weighted_gross_pct);
      win_rate = nets.filter(v => v > 0).length / nets.length;
      avg_net_pct = nets.reduce((a, b) => a + b, 0) / nets.length;
      avg_gross_pct = gross.reduce((a, b) => a + b, 0) / gross.length;
      best_net_pct = Math.max(...nets);
      worst_net_pct = Math.min(...nets);
      const wins = nets.filter(v => v > 0).reduce((a, b) => a + b, 0);
      const losses = Math.abs(nets.filter(v => v < 0).reduce((a, b) => a + b, 0));
      profit_factor = losses > 0 ? wins / losses : wins > 0 ? Infinity : null;
      expectancy_pct = avg_net_pct; // expectancy = (RR * WR) - (1 - WR) → aproximação via média net.
    }
  }

  return {
    methodology_version: HISTORY_STRATEGY_VERSION + "/resolved-" + (row?.last_resolver_version ?? HISTORY_STRATEGY_VERSION),
    total,
    resolved,
    data_gap,
    pending,
    period_start: row?.period_start ?? null,
    period_end: row?.period_end ?? null,
    n_strategy_versions: Number(row?.n_strategy_versions ?? 0),
    last_resolver_version: row?.last_resolver_version ?? null,
    win_rate,
    avg_net_pct,
    avg_gross_pct,
    expectancy_pct,
    profit_factor,
    best_net_pct,
    worst_net_pct,
    strategy_version: HISTORY_STRATEGY_VERSION,
    engine_version: HISTORY_ENGINE_VERSION,
  };
}

/** Lista de sinais resolvidos/pendentes, com status agregado. */
export async function listTrackRecordSignals(DB: D1Database, limit = 100, offset = 0) {
  const rows = await DB.prepare(getSignalsListWithStatusQuery(limit, offset))
    .all<PersistedSignalRow & { closed_fraction: number; overall_status: string; outcomes: string | null }>();
  return rows.success ? (rows.results ?? []) : [];
}
