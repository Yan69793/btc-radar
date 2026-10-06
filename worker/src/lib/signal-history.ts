// Aureus — Histórico prospectivo de sinais
// Tipos de signals/signals_outcomes e resolvedor baseado em OHLCV.
// Preserva simulateWithFees intacto para backtest. Este arquivo implementa
// somente o resolvedor PROSPECTIVO para o placar público.
//
// Versão: HISTORY_RESOLVER_VERSION = "1.0.0"
// Convenções:
//   • signals é append-only (nunca UPDATE)
//   • signal_outcomes guarda 1..N registros de resolução por oportunidade
//   • target_1 encerra 50%, target_2 encerra os outros 50%
//   • Se no mesmo candle toca stop e alvo → STOP PRIMEIRO, marca ambiguous=1
//   • VENDER/REDUZIR → posição short (retorno simétrico: 1 - entry/exit)
//   • Vencimento por tempo (timeframe_hours) fecha no close próximo após o vencimento
//   • Dado ausente → status=data_gap, não inventa preço

import type { D1Database } from "@cloudflare/workers-types";
import type { SignalDocument, Timeframe, Verdict, OHLCV } from "../types";

export const HISTORY_STRATEGY_VERSION = "1.0.0";
export const HISTORY_ENGINE_VERSION = "1.0.0";
export const HISTORY_RESOLVER_VERSION = "1.0.0";
export const DEFAULT_FEE_PER_SIDE = 0.001; // 0.1% por lado
export const DEFAULT_SLIPPAGE_PCT = 0.0;    // explicitamente parametrizado

export const TIMEFRAME_EXPIRATION_HOURS: Record<Timeframe, number> = {
  short: 72,
  medium: 720,
  long: 4320,
};

export type Direction = "long" | "short" | "flat";
export type OutcomeStatus = "target_1" | "target_2" | "stop_loss" | "expired" | "data_gap";

export interface SignalOutcomeRecord {
  signal_id: string;
  status: OutcomeStatus;
  resolved_at: string;
  resolved_price: number;
  price_source?: string;
  price_interval?: string;
  price_timestamp?: string;
  gross_return_pct?: number | null;
  net_return_pct?: number | null;
  position_fraction: number;
  ambiguous_resolution: 0 | 1;
  ambiguous_triggers?: string | null;
  data_gap: 0 | 1;
  gap_detail?: string | null;
  fee_per_side: number;
  slippage_pct: number;
  raw_candle_payload?: string | null;
  resolved_by_version: string;
  created_at: string;
}

// ─── Helpers puros (independente de DB, testáveis sem mock) ────────────────

/** Direção da operação a partir do verdict. */
export function verdictToDirection(verdict: Verdict): Direction {
  if (verdict === "COMPRAR") return "long";
  if (verdict === "VENDER" || verdict === "REDUZIR") return "short";
  return "flat";
}

/** Identidade do sinal com garantia de idempotência.
 *  Inclui: estratégia, timeframe, direção, data do dia de abertura e versão.
 *  NOTA: a decisão de produto nº 7 (não reabrir enquanto estratégia/tf/direção
 *  permanecem iguais) É aplicada em uma camada superior que consulta os
 *  últimos sinais abertos. Este signal_id identifica um ponto de abertura
 *  distinto e não impede reabertura mecânica.
 */
export function buildSignalId(opts: {
  strategy: string;
  timeframe: Timeframe;
  direction: Direction;
  generatedAt: string; // ISO-8601 UTC
  strategyVersion: string;
}): string {
  const d = new Date(opts.generatedAt);
  const yyyymmddhhmm =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0") +
    String(d.getUTCHours()).padStart(2, "0") +
    String(d.getUTCMinutes()).padStart(2, "0");
  const v = opts.strategyVersion.replace(/[^\w.-]/g, "_");
  return `sig-${opts.strategy}-${opts.timeframe}-${opts.direction}-${yyyymmddhhmm}-${v}`;
}

/** Retorna o vencimento (ISO UTC) somando timeframe_hours ao generatedAt. */
export function computeExpiresAt(generatedAt: string, timeframe: Timeframe): string {
  const d = new Date(generatedAt);
  const add = TIMEFRAME_EXPIRATION_HOURS[timeframe] ?? 72;
  d.setUTCHours(d.getUTCHours() + add);
  return d.toISOString();
}

/** Calcula retorno bruto e líquido de uma fatia.
 *  direction="long": (exitPrice / entryPrice - 1) * 100
 *  direction="short": (1 - exitPrice / entryPrice) * 100
 */
export function computeReturnPct(opts: {
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  feePerSide: number;
  slippagePct: number;
}): { gross_pct: number; net_pct: number } {
  const { direction, entryPrice, exitPrice, feePerSide, slippagePct } = opts;
  let gross_pct: number;
  if (direction === "long") {
    gross_pct = (exitPrice / entryPrice - 1) * 100;
  } else {
    // short simétrico: lucra se preço cai
    gross_pct = (1 - exitPrice / entryPrice) * 100;
  }
  // custos aplicados bilateralmente em %: fee_per_side * 2 + slippage * 2
  const cost_bp = (feePerSide + slippagePct) * 2 * 100;
  const net_pct = gross_pct - cost_bp;
  return { gross_pct, net_pct };
}

// ─── Resolvedor prospectivo (OHLCV) ───────────────────────────────────────
//
// Observações importantes sobre look-ahead (regra 10):
//   • A resolução recebe `series`: array de OHLCV ORDENADO ASC por timestamp.
//   • entry_ts = primeiro candle FECHADO cujo timestamp > signal.generated_at
//     (primeiro executável após a geração do sinal).
//   • Resolução começa no segundo candle APÓS entry_ts (candle subseqüente)
//     para não olhar para trás.
//   • vencimento = signal.expires_at: a partir desse horário, fecha no
//     primeiro close disponível.

export interface ResolverInput {
  signal: {
    signal_id: string;
    direction: Direction;
    entry_price: number | null;
    stop_loss: number | null;
    target_1: number | null;
    target_2: number | null;
    generated_at: string;
    expires_at: string;
    strategy: string;
    timeframe: Timeframe;
    strategy_version: string;
    engine_version: string;
  };
  /** Série de OHLCV. Deve cobrir desde antes do generated_at até depois do expires_at. */
  series: OHLCV[];
  feePerSide?: number;
  slippagePct?: number;
  resolverVersion?: string;
}

export interface ResolverResult {
  outcomes: SignalOutcomeRecord[];
  notes: string[];
  /** Entry real usado (primeiro candle após generated_at) */
  entry_candle: OHLCV | null;
  /** Porção já fechada ao final da resolução */
  closed_fraction: number;
  /** Houve alguma etapa de dados faltando? */
  has_gap: boolean;
}

export function resolveProspectively(input: ResolverInput): ResolverResult {
  const outcomes: SignalOutcomeRecord[] = [];
  const notes: string[] = [];
  let entryCandle: OHLCV | null = null;
  let closedFraction = 0;
  let hasGap = false;

  const feePerSide = input.feePerSide ?? DEFAULT_FEE_PER_SIDE;
  const slippagePct = input.slippagePct ?? DEFAULT_SLIPPAGE_PCT;
  const resolverVersion = input.resolverVersion ?? HISTORY_RESOLVER_VERSION;

  const { signal, series } = input;

  // Filtra e ordena (nunca confia na ordem de entrada)
  const sorted = [...series].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length === 0) {
    outcomes.push(gapOutcome(signal.signal_id, "series vazia", feePerSide, slippagePct, resolverVersion));
    return { outcomes, notes: ["sem série de preços"], entry_candle: null, closed_fraction: 0, has_gap: true };
  }

  // Requisitos: entry_price existir, direção acionável
  if (signal.direction === "flat" || signal.entry_price == null || !isFinite(signal.entry_price)) {
    return { outcomes, notes: ["sinal flat ou sem entry_price — não é oportunidade acionável (regra 7)"], entry_candle: null, closed_fraction: 0, has_gap: false };
  }

  // 1) Encontra o primeiro candle cujo FECHAMENTO ocorreu APÓS generated_at.
  //    Convenção: usamos close deste candle como preço executável prospectivo
  //    (entrada no fechamento do primeiro candle disponível após o sinal).
  const generatedTs = new Date(signal.generated_at).getTime();
  const entryIdx = sorted.findIndex(c => new Date(c.timestamp).getTime() > generatedTs);
  if (entryIdx < 0) {
    outcomes.push(gapOutcome(signal.signal_id, "sem candle posterior ao generated_at (dado insuficiente)", feePerSide, slippagePct, resolverVersion));
    return { outcomes, notes: ["nenhum candle executável após generated_at"], entry_candle: null, closed_fraction: 0, has_gap: true };
  }
  const entryCandleNonNil = sorted[entryIdx];
  if (!entryCandleNonNil) {
    outcomes.push(gapOutcome(signal.signal_id, "candle de entrada inesperadamente nulo", feePerSide, slippagePct, resolverVersion));
    return { outcomes, notes: ["candle de entrada inválido"], entry_candle: null, closed_fraction: 0, has_gap: true };
  }
  entryCandle = entryCandleNonNil;

  // Alvos e stop parciais em memória, conforme regra 5 (50%/50%):
  // target_1 → 50%, target_2 → 50%. Se um alvo for nulo, o outro fecha 100%.
  const fractions: { kind: "t1" | "t2"; price: number; fraction: number }[] = [];
  if (signal.target_1 != null && isFinite(signal.target_1)) {
    if (signal.target_2 != null && isFinite(signal.target_2)) {
      fractions.push({ kind: "t1", price: signal.target_1, fraction: 0.5 });
      fractions.push({ kind: "t2", price: signal.target_2, fraction: 0.5 });
    } else {
      fractions.push({ kind: "t1", price: signal.target_1, fraction: 1.0 });
    }
  } else if (signal.target_2 != null && isFinite(signal.target_2)) {
    fractions.push({ kind: "t2", price: signal.target_2, fraction: 1.0 });
  }

  // Ordena os alvos: para long primeiro o menor preço, para short primeiro o maior.
  fractions.sort((a, b) => signal.direction === "long" ? a.price - b.price : b.price - a.price);

  const stopPrice = signal.stop_loss ?? null;
  const expiresAtTs = new Date(signal.expires_at).getTime();

  // 2) Itera candles A PARTIR do candle SEGUINTE ao de entrada.
  //    O stop/alvo NUNCA é checado no mesmo candle da entrada (evita look-ahead
  //    ou back-fitting instantâneo).
  //    A cada candle: verifica stop, target_1 (se ainda não atingido),
  //    target_2 (se target_1 já foi e t2 ainda pendente).
  //    Regra 4 (candle ambíguo): se no mesmo candle tocaram STOP e um TARGET,
  //    considera STOP primeiro na porção remanescente. Marca ambiguous=1.

  const pendentes = new Set<string>(["t1", "t2", "stop"]);
  if (!fractions.some(f => f.kind === "t1")) pendentes.delete("t1");
  if (!fractions.some(f => f.kind === "t2")) pendentes.delete("t2");
  if (stopPrice == null) pendentes.delete("stop");

  const entryPriceReal = entryCandle.close;

  for (let i = entryIdx + 1; i < sorted.length; i++) {
    if (closedFraction >= 1 - 1e-9) break;

    const candle = sorted[i];
    if (!candle) continue;
    const candleTs = new Date(candle.timestamp).getTime();

    // Checagem de GAP: salto esperado de intervalo (em ms) em relação ao candle anterior?
    // Aqui só flagamos se houver gap por ausência explícita. A detecção rigorosa
    // de gaps baseada em intervalo fica para o caller (preencher gaps explicitamente
    // com 'data_gap' ou preencher série de preços antes).

    // VENCIMENTO (regra 11): se candleTs >= expiresAtTs e ainda não fechou tudo,
    // fecha o restante no close atual.
    if (candleTs >= expiresAtTs && closedFraction < 1 - 1e-9) {
      const remaining = 1 - closedFraction;
      const { gross_pct, net_pct } = computeReturnPct({
        direction: signal.direction,
        entryPrice: entryPriceReal,
        exitPrice: candle.close,
        feePerSide,
        slippagePct,
      });
      outcomes.push({
        signal_id: signal.signal_id,
        status: "expired",
        resolved_at: new Date(candleTs).toISOString(),
        resolved_price: candle.close,
        price_source: candle.source,
        price_interval: candle.interval,
        price_timestamp: candle.timestamp,
        gross_return_pct: gross_pct,
        net_return_pct: net_pct,
        position_fraction: round4(remaining),
        ambiguous_resolution: 0,
        data_gap: 0,
        fee_per_side: feePerSide,
        slippage_pct: slippagePct,
        raw_candle_payload: JSON.stringify({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }),
        resolved_by_version: resolverVersion,
        created_at: new Date().toISOString(),
      });
      closedFraction = 1;
      pendentes.clear();
      break;
    }

    // Testa eventos neste candle. Para long: low ≤ stop / high ≥ target.
    // Para short: high ≥ stop / low ≤ target.
    const events: { kind: "stop" | "t1" | "t2"; price: number }[] = [];

    // STOP
    if (pendentes.has("stop") && stopPrice != null) {
      const hit = signal.direction === "long"
        ? candle.low <= stopPrice
        : candle.high >= stopPrice;
      if (hit) events.push({ kind: "stop", price: stopPrice });
    }
    // TARGETS
    for (const f of fractions) {
      if (!pendentes.has(f.kind)) continue;
      const hit = signal.direction === "long"
        ? candle.high >= f.price
        : candle.low <= f.price;
      if (hit) events.push({ kind: f.kind, price: f.price });
    }

    if (events.length === 0) continue;

    const hasStop = events.some(e => e.kind === "stop");
    const hasTargets = events.some(e => e.kind === "t1" || e.kind === "t2");
    const ambiguous = hasStop && hasTargets ? 1 : 0;
    if (ambiguous === 1) notes.push(`candle ambíguo em ${candle.timestamp}: stop e alvo tocaram — aplicado stop primeiro (regra 4)`);

    const triggers = events.map(e => e.kind).sort().join("+");

    if (ambiguous === 1) {
      // STOP PRIMEIRO: fecha todo o restante em stop, ignora o alvo neste candle.
      const stopEv = events.find(e => e.kind === "stop")!;
      const remaining = 1 - closedFraction;
      const { gross_pct, net_pct } = computeReturnPct({
        direction: signal.direction,
        entryPrice: entryPriceReal,
        exitPrice: stopEv.price,
        feePerSide,
        slippagePct,
      });
      outcomes.push({
        signal_id: signal.signal_id,
        status: "stop_loss",
        resolved_at: new Date(candleTs).toISOString(),
        resolved_price: stopEv.price,
        price_source: candle.source,
        price_interval: candle.interval,
        price_timestamp: candle.timestamp,
        gross_return_pct: gross_pct,
        net_return_pct: net_pct,
        position_fraction: round4(remaining),
        ambiguous_resolution: 1,
        ambiguous_triggers: triggers,
        data_gap: 0,
        fee_per_side: feePerSide,
        slippage_pct: slippagePct,
        raw_candle_payload: JSON.stringify({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }),
        resolved_by_version: resolverVersion,
        created_at: new Date().toISOString(),
      });
      closedFraction = 1;
      pendentes.clear();
      break;
    }

    // Não ambíguo: processa eventos por ordem de atingimento (alvos crescentes
    // de ganho, ou stop isolado).
    // Para garantir 50%/50% correto: se houver t1 pendente, processa t1
    // primeiro; se houver t2 pendente E t1 já tiver sido removido em iteração
    // anterior, processa t2; se stop sozinho, fecha o que restar.

    if (hasStop) {
      const stopEv = events.find(e => e.kind === "stop")!;
      const remaining = 1 - closedFraction;
      const { gross_pct, net_pct } = computeReturnPct({
        direction: signal.direction,
        entryPrice: entryPriceReal,
        exitPrice: stopEv.price,
        feePerSide,
        slippagePct,
      });
      outcomes.push({
        signal_id: signal.signal_id,
        status: "stop_loss",
        resolved_at: new Date(candleTs).toISOString(),
        resolved_price: stopEv.price,
        price_source: candle.source,
        price_interval: candle.interval,
        price_timestamp: candle.timestamp,
        gross_return_pct: gross_pct,
        net_return_pct: net_pct,
        position_fraction: round4(remaining),
        ambiguous_resolution: 0,
        data_gap: 0,
        fee_per_side: feePerSide,
        slippage_pct: slippagePct,
        raw_candle_payload: JSON.stringify({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }),
        resolved_by_version: resolverVersion,
        created_at: new Date().toISOString(),
      });
      closedFraction = 1;
      pendentes.clear();
      break;
    }

    // Processa t1 e t2 em ordem (fractions já ordenado por proximidade).
    for (const f of fractions) {
      if (!pendentes.has(f.kind)) continue;
      const ev = events.find(e => e.kind === f.kind);
      if (!ev) continue;
      const { gross_pct, net_pct } = computeReturnPct({
        direction: signal.direction,
        entryPrice: entryPriceReal,
        exitPrice: ev.price,
        feePerSide,
        slippagePct,
      });
      outcomes.push({
        signal_id: signal.signal_id,
        status: f.kind === "t1" ? "target_1" : "target_2",
        resolved_at: new Date(candleTs).toISOString(),
        resolved_price: ev.price,
        price_source: candle.source,
        price_interval: candle.interval,
        price_timestamp: candle.timestamp,
        gross_return_pct: gross_pct,
        net_return_pct: net_pct,
        position_fraction: round4(f.fraction),
        ambiguous_resolution: 0,
        data_gap: 0,
        fee_per_side: feePerSide,
        slippage_pct: slippagePct,
        raw_candle_payload: JSON.stringify({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }),
        resolved_by_version: resolverVersion,
        created_at: new Date().toISOString(),
      });
      closedFraction = round4(closedFraction + f.fraction);
      pendentes.delete(f.kind);
    }
  } // fim for candles

  // Se após varrer tudo ainda sobrou fração e não atingiu vencimento → dado insuficiente?
  // Regra 11: não inventa preço. Marca como data_gap se não há candles até expirar.
  if (closedFraction < 1 - 1e-9) {
    const lastCandle = sorted[sorted.length - 1];
    const expiredByClock = expiresAtTs <= Date.now();
    if (!lastCandle) {
      hasGap = true;
      if (expiredByClock) {
        const remaining = round4(1 - closedFraction);
        outcomes.push(gapOutcome(signal.signal_id, "vencimento alcan?ado sem candle suficiente para resolu??o", feePerSide, slippagePct, resolverVersion, remaining, signal.expires_at));
        closedFraction = 1;
      }
    } else {
      const lastTs = new Date(lastCandle.timestamp).getTime();
      if (lastTs < expiresAtTs) {
        hasGap = true;
        notes.push(`s?rie acaba antes do vencimento (last=${lastCandle.timestamp} < expires_at=${signal.expires_at})`);
        if (expiredByClock) {
          const remaining = round4(1 - closedFraction);
          outcomes.push(gapOutcome(signal.signal_id, `s?rie n?o alcan?ou o vencimento; ?ltimo candle=${lastCandle.timestamp}`, feePerSide, slippagePct, resolverVersion, remaining, signal.expires_at));
          closedFraction = 1;
        }
      }
    }
  }

  return {
    outcomes,
    notes,
    entry_candle: entryCandle,
    closed_fraction: closedFraction,
    has_gap: hasGap,
  };
}

function gapOutcome(
  signal_id: string,
  detail: string,
  feePerSide: number,
  slippagePct: number,
  resolverVersion: string,
  positionFraction = 1,
  resolvedAt?: string,
): SignalOutcomeRecord {
  return {
    signal_id,
    status: "data_gap",
    resolved_at: resolvedAt ?? new Date().toISOString(),
    resolved_price: 0,
    gross_return_pct: null,
    net_return_pct: null,
    position_fraction: round4(positionFraction),
    ambiguous_resolution: 0,
    data_gap: 1,
    gap_detail: detail,
    fee_per_side: feePerSide,
    slippage_pct: slippagePct,
    resolved_by_version: resolverVersion,
    created_at: new Date().toISOString(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
