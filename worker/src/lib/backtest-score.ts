// BTC Radar — Backtest Score Engine
// Baseado na metodologia QuantBrasil:
//   Score = media ponderada dos percentis de cada metrica
//   EV (3), Drawdown (2), Retorno (2), Ops/Dia (2), Win Rate (1)
//   Classificacao por percentil contra todos os backtests

import type { BacktestRun } from "../types";

// ─── Tipos ───

export interface MetricBreakdown {
  raw: number;            // valor bruto da metrica
  percentile: number;     // posicao percentil (0-100)
  weight: number;         // peso na formula
  contribution: number;   // (percentile * weight) / totalWeight
}

export interface BacktestScoreResult {
  score: number;                              // 0-100
  classification: ScoreClassification;        // label
  classification_percentile: number;          // percentil do score entre todos
  breakdown: {
    ev: MetricBreakdown;
    drawdown: MetricBreakdown;
    return_pct: MetricBreakdown;
    ops_per_day: MetricBreakdown;
    win_rate: MetricBreakdown;
  };
  gates_passed: boolean;
  gate_failures: string[];
  compared_against: number;                   // quantos backtests usados como referencia
}

export type ScoreClassification =
  | "Pessimo"
  | "Muito Ruim"
  | "Ruim"
  | "Bom"
  | "Muito Bom"
  | "Excelente";

// ─── Constantes ───

const WEIGHTS = {
  ev: 3,
  drawdown: 2,
  return_pct: 2,
  ops_per_day: 2,
  win_rate: 1,
} as const;

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

const CLASSIFICATION_THRESHOLDS: Array<{ maxPercentile: number; label: ScoreClassification }> = [
  { maxPercentile: 5, label: "Pessimo" },
  { maxPercentile: 25, label: "Muito Ruim" },
  { maxPercentile: 50, label: "Ruim" },
  { maxPercentile: 75, label: "Bom" },
  { maxPercentile: 95, label: "Muito Bom" },
  { maxPercentile: 100, label: "Excelente" },
];

// ─── Gates ───

const MIN_TRADES = 5;

function checkGates(run: BacktestRun): string[] {
  const failures: string[] = [];
  if ((run.n_trades ?? 0) < MIN_TRADES) {
    failures.push(`Minimo de ${MIN_TRADES} trades (atual: ${run.n_trades ?? 0})`);
  }
  return failures;
}

// ─── Metric extractors ───

interface RawMetrics {
  ev: number;
  drawdown: number;
  return_pct: number;
  ops_per_day: number;
  win_rate: number;
  trading_days: number;
}

function tradingDaysBetween(from: string, to: string): number {
  if (!from || !to) return 90; // fallback
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 90;

  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days++; // skip weekends
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(days, 1);
}

function extractMetrics(run: BacktestRun): RawMetrics {
  const n = run.n_trades ?? 0;
  const trading_days = tradingDaysBetween(run.date_from, run.date_to);
  const returnPct = run.total_return ?? 0;
  const ev = n > 0 ? returnPct / n : 0;
  // max_drawdown is stored as positive number (e.g. 15.5 means 15.5% drawdown)
  const drawdown = Math.abs(run.max_drawdown ?? 100);
  const opsPerDay = n > 0 ? n / trading_days : 0;
  const winRate = run.win_rate ?? 0;

  return { ev, drawdown, return_pct: returnPct, ops_per_day: opsPerDay, win_rate: winRate, trading_days };
}

// ─── Percentile helpers ───

/**
 * Retorna o percentil (0-100) de `value` dentro do array `sorted`, que DEVE
 * estar ordenado ascendentemente. Usa busca binaria (O(log n)) em vez de
 * percorrer a populacao inteira: o hot path do score chama isso 5x por run
 * qualificado, e ordenar/filtrar a cada chamada custava O(n) ~200x por request.
 * Semantica identica ao percentileRank: conta apenas valores estritamente menores
 * (empates nao elevam o percentil). Para "lower is better", inverte: 100 - percentile.
 */
function percentileRankSorted(value: number, sorted: number[], higherIsBetter: boolean): number {
  if (sorted.length === 0) return 50; // sem referencia, assume mediana

  // Busca binaria: primeiro indice com valor >= value, ou seja, quantidade de
  // valores estritamente menores que `value`.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const lower = lo;
  const pct = (lower / sorted.length) * 100;

  return higherIsBetter ? pct : 100 - pct;
}

/**
 * Retorna o percentil (0-100) de `value` dentro do array `population`.
 * Usa "percentile rank" (proporcao de valores estritamente menores).
 * Para "lower is better", inverte: 100 - percentile.
 */
export function percentileRank(value: number, population: number[], higherIsBetter: boolean): number {
  const sorted = [...population].sort((a, b) => a - b);
  return percentileRankSorted(value, sorted, higherIsBetter);
}

/**
 * Classifica um score (0-100) dentro da distribuicao de scores existentes.
 * `sortedScores` DEVE estar ordenado ascendentemente.
 */
function classifyScore(score: number, sortedScores: number[]): { label: ScoreClassification; percentile: number } {
  const percentile = percentileRankSorted(score, sortedScores, true);

  for (const threshold of CLASSIFICATION_THRESHOLDS) {
    if (percentile <= threshold.maxPercentile) {
      return { label: threshold.label, percentile };
    }
  }

  return { label: "Excelente", percentile: 100 };
}

// ─── Calculo principal ───

/**
 * Calcula o score de um unico backtest, comparando-o contra uma populacao de referencia.
 * Retorna null se os gates nao forem passados.
 */
export function calculateScore(
  run: BacktestRun,
  referencePopulation: BacktestRun[],
): BacktestScoreResult | null {
  // 1. Gates
  const gateFailures = checkGates(run);
  if (gateFailures.length > 0) {
    // Still compute raw score for display, but mark gates as failed
    // The score won't be classified meaningfully
    const metrics = extractMetrics(run);
    const emptyBreakdown = {
      ev: { raw: metrics.ev, percentile: 0, weight: WEIGHTS.ev, contribution: 0 },
      drawdown: { raw: metrics.drawdown, percentile: 0, weight: WEIGHTS.drawdown, contribution: 0 },
      return_pct: { raw: metrics.return_pct, percentile: 0, weight: WEIGHTS.return_pct, contribution: 0 },
      ops_per_day: { raw: metrics.ops_per_day, percentile: 0, weight: WEIGHTS.ops_per_day, contribution: 0 },
      win_rate: { raw: metrics.win_rate, percentile: 0, weight: WEIGHTS.win_rate, contribution: 0 },
    };

    return {
      score: 0,
      classification: "Pessimo",
      classification_percentile: 0,
      breakdown: emptyBreakdown,
      gates_passed: false,
      gate_failures: gateFailures,
      compared_against: referencePopulation.length,
    };
  }

  // 2. Filtrar populacao de referencia para apenas backtests que passam nos gates
  const qualifying = referencePopulation.filter(
    (r) => r.id !== run.id && (r.n_trades ?? 0) >= MIN_TRADES
  );

  // 3. Extrair metricas brutas do run e da populacao
  const metrics = extractMetrics(run);
  const popMetrics = qualifying.map(extractMetrics);

  // 3b. Ordenar cada populacao de metrica UMA unica vez: o passo 6 usa os mesmos
  // arrays para todos os runs qualifying, e percentil passa a ser busca binaria.
  const sortedEv = popMetrics.map((m) => m.ev).sort((a, b) => a - b);
  const sortedDd = popMetrics.map((m) => m.drawdown).sort((a, b) => a - b);
  const sortedRet = popMetrics.map((m) => m.return_pct).sort((a, b) => a - b);
  const sortedOps = popMetrics.map((m) => m.ops_per_day).sort((a, b) => a - b);
  const sortedWr = popMetrics.map((m) => m.win_rate).sort((a, b) => a - b);

  // 4. Calcular percentil de cada metrica
  const evPct = percentileRankSorted(metrics.ev, sortedEv, true);
  const ddPct = percentileRankSorted(metrics.drawdown, sortedDd, false); // lower drawdown = better
  const retPct = percentileRankSorted(metrics.return_pct, sortedRet, true);
  const opsPct = percentileRankSorted(metrics.ops_per_day, sortedOps, true);
  const wrPct = percentileRankSorted(metrics.win_rate, sortedWr, true);

  // 5. Calcular score ponderado (0-100)
  const score =
    (evPct * WEIGHTS.ev +
      ddPct * WEIGHTS.drawdown +
      retPct * WEIGHTS.return_pct +
      opsPct * WEIGHTS.ops_per_day +
      wrPct * WEIGHTS.win_rate) /
    TOTAL_WEIGHT;

  // 6. Classificar pelo percentil do score na distribuicao
  // Recalcula scores de todos os qualifying usando a mesma populacao de referencia
  const allScores = qualifying.map((r) => {
    const m = extractMetrics(r);
    return (
      (percentileRankSorted(m.ev, sortedEv, true) * WEIGHTS.ev +
        percentileRankSorted(m.drawdown, sortedDd, false) * WEIGHTS.drawdown +
        percentileRankSorted(m.return_pct, sortedRet, true) * WEIGHTS.return_pct +
        percentileRankSorted(m.ops_per_day, sortedOps, true) * WEIGHTS.ops_per_day +
        percentileRankSorted(m.win_rate, sortedWr, true) * WEIGHTS.win_rate) /
      TOTAL_WEIGHT
    );
  });
  allScores.sort((a, b) => a - b);

  const { label, percentile: classPercentile } = classifyScore(score, allScores);

  // 7. Montar breakdown
  const breakdown = {
    ev: { raw: metrics.ev, percentile: evPct, weight: WEIGHTS.ev, contribution: (evPct * WEIGHTS.ev) / TOTAL_WEIGHT },
    drawdown: { raw: metrics.drawdown, percentile: ddPct, weight: WEIGHTS.drawdown, contribution: (ddPct * WEIGHTS.drawdown) / TOTAL_WEIGHT },
    return_pct: { raw: metrics.return_pct, percentile: retPct, weight: WEIGHTS.return_pct, contribution: (retPct * WEIGHTS.return_pct) / TOTAL_WEIGHT },
    ops_per_day: { raw: metrics.ops_per_day, percentile: opsPct, weight: WEIGHTS.ops_per_day, contribution: (opsPct * WEIGHTS.ops_per_day) / TOTAL_WEIGHT },
    win_rate: { raw: metrics.win_rate, percentile: wrPct, weight: WEIGHTS.win_rate, contribution: (wrPct * WEIGHTS.win_rate) / TOTAL_WEIGHT },
  };

  return {
    score,
    classification: label,
    classification_percentile: classPercentile,
    breakdown,
    gates_passed: true,
    gate_failures: [],
    compared_against: qualifying.length,
  };
}

/**
 * Calcula scores para todos os backtests de uma lista.
 * Cada score e calculado contra todos os outros (leave-one-out).
 */
export function calculateAllScores(runs: BacktestRun[]): Map<string, BacktestScoreResult | null> {
  const results = new Map<string, BacktestScoreResult | null>();
  for (const run of runs) {
    results.set(run.id, calculateScore(run, runs));
  }
  return results;
}
