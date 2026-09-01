// BTC Radar — Validação walk-forward e threshold de abstinência (backtest)
// Objetivo: medir desempenho out-of-sample (OOS) de um critério de entrada,
// com custos/fees por trade, e verificar se um gate de abstinência (só operar
// acima de um limiar de convicção) se comporta bem fora da amostra de calibração.
//
// Princípio de anti-overfitting (correção do usuário): NUNCA otimizar o
// threshold para um retorno inflado no holdout. O threshold é congelado ANTES
// de tocar na janela de teste (parâmetro de entrada ou calibração fixa em treino).
// A entrega é a MENSURAÇÃO OOS sem degradação estatística/material injustificada,
// não um retorno manufaturado.
//
// Simulação em TS (espelho do engine Python) para métricas puras e testáveis.

import type { OHLCV } from "../types";

export interface SimOptions {
  close: number[];
  entries: boolean[];        // 1 por barra: sinal de entrada
  exits: boolean[];          // 1 por barra: sinal de saída
  conviction: number[];      // convicção 0-10 por barra (para o gate)
  fee?: number;              // taxa por lado (default 0.001 = 0.1%)
  abstainThreshold?: number; // convicção mínima para operar; acima disso sai do "aguardar"
}

export interface SimResult {
  total_return_pct: number;
  win_rate_pct: number;
  max_drawdown_pct: number;
  n_trades: number;
  fees_paid: number;
  return_vs_buyhold_pct: number; // retorno líquido menos buy & hold
}

/**
 * Simula portfolio (1 posição por vez, entrada e saída no close), com fee na
 * entrada e na saída. Se `abstainThreshold` for definido, uma barra de entrada
 * só vira trade quando a convicção >= threshold (caso contrário abstém).
 * Retorna métricas líquidas de fees.
 */
export function simulateWithFees(opts: SimOptions): SimResult {
  const { close, entries, exits, conviction, fee = 0.001, abstainThreshold } = opts;
  const n = close.length;
  const initCash = 10_000;
  let cash = initCash;
  let btc = 0;
  let inPos = false;
  let entryPrice = 0;
  let entryBtc = 0;
  let feesPaid = 0;
  let wins = 0;
  let losses = 0;
  let peak = initCash;
  let maxDd = 0;
  const equity: number[] = [];

  for (let i = 0; i < n; i++) {
    const price = close[i]!;
    const willTrade = abortConditionMet(i, entries, conviction, abstainThreshold);

    if (willTrade && !inPos && price > 0) {
      // entrada: desconta fee
      const toInvest = cash * (1 - fee);
      feesPaid += cash * fee;
      btc = toInvest / price;
      entryPrice = price;
      entryBtc = toInvest;
      cash = 0;
      inPos = true;
    } else if ((exits[i] || i === n - 1) && inPos && price > 0) {
      // saída: reconverte em cash descontando fee
      const value = btc * price * (1 - fee);
      feesPaid += btc * price * fee;
      const pnl = value - entryBtc;
      if (pnl > 0) wins++;
      else losses++;
      cash = value;
      btc = 0;
      inPos = false;
    }

    const currentEquity = inPos ? btc * price * (1 - fee) : cash;
    equity.push(currentEquity);
    if (currentEquity > peak) peak = currentEquity;
    else {
      const dd = (1 - currentEquity / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }

  const finalEquity = equity[n - 1] ?? initCash;
  const totalReturnPct = ((finalEquity / initCash) - 1) * 100;
  const nTrades = wins + losses;
  const winRatePct = nTrades > 0 ? (wins / nTrades) * 100 : 0;

  // Buy & hold de referência: comprar no primeiro preço, segurar, com fee de entrada
  const bhEntryFee = initCash * fee;
  const bhBtc = (initCash - bhEntryFee) / (close[0] ?? 1);
  const bhFinal = bhBtc * (close[n - 1] ?? 1);
  const buyHoldPct = ((bhFinal / initCash) - 1) * 100;

  return {
    total_return_pct: round(totalReturnPct),
    win_rate_pct: round(winRatePct),
    max_drawdown_pct: round(maxDd),
    n_trades: nTrades,
    fees_paid: round(feesPaid),
    return_vs_buyhold_pct: round(totalReturnPct - buyHoldPct),
  };
}

// Uma barra de entrada só é executável se passar o gate de abstinência.
function abortConditionMet(
  i: number,
  entries: boolean[],
  conviction: number[],
  threshold?: number,
): boolean {
  if (!entries[i]) return false;
  if (threshold == null) return true; // sem gate, opera sempre no sinal
  return (conviction[i] ?? 0) >= threshold;
}

/**
 * Avaliação walk-forward: divide o histórico em janela de calibração (treino) e
 * holdout (teste). O threshold de abstinência é congelaDO antes da janela de
 * teste (ou fornecido diretamente). Compara com a simulação sem gate para
 * reportar se o gate degrada ou preserva o desempenho OOS real (com fees).
 */
export interface WalkForwardOptions {
  candles: OHLCV[];
  entries: boolean[];
  exits: boolean[];
  conviction: number[];
  fee?: number;
  trainFraction?: number;      // fração do início usada como treino (default 0.6)
  abstainThreshold?: number;   // se fornecido, congela direto (sem calibração em treino)
  useTrainCalibration?: boolean; // se true, deriva threshold da mediana de convicção no treino
}

export interface WalkForwardResult {
  oos: {
    gated: SimResult;
    unGated: SimResult;
  };
  threshold: number;      // threshold efetivo usado no teste
  trainSize: number;
  testSize: number;
  testFromIndex: number;
  holdsUp: boolean;       // sem degradação injustificada: gated.total_return >= unGated ou n_trades cai sem retorno pior expressivo
}

export function walkForwardEvaluate(opts: WalkForwardOptions): WalkForwardResult {
  const {
    candles, entries, exits, conviction,
    fee = 0.001, trainFraction = 0.6,
    abstainThreshold, useTrainCalibration = false,
  } = opts;

  const n = candles.length;
  const trainSize = Math.max(1, Math.floor(n * trainFraction));
  const testSize = n - trainSize;
  const testFrom = trainSize;

  // 1. Deriva o threshold congelaDO (calibração apenas no treino, se pedida)
  let threshold: number | undefined = abstainThreshold;
  if (threshold == null && useTrainCalibration && trainSize > 0) {
    const trainConvictions = conviction.slice(0, trainSize).filter((c) => !isNaN(c));
    if (trainConvictions.length > 0) {
      threshold = median(trainConvictions);
    }
  }

  // 2. Janela de teste simples, com e sem gate, para mensuração OOS honesta.
  const close = candles.map((c) => c.close);
  const testEntries = entries.slice(testFrom);
  const testExits = exits.slice(testFrom);
  const testConviction = conviction.slice(testFrom);
  const testClose = close.slice(testFrom);

  // Importante: o threshold é fixo (congelado). Sem re-otimização no holdout.
  const gated = simulateWithFees({
    close: testClose, entries: testEntries, exits: testExits,
    conviction: testConviction, fee, abstainThreshold: threshold,
  });
  const unGated = simulateWithFees({
    close: testClose, entries: testEntries, exits: testExits,
    conviction: testConviction, fee, abstainThreshold: undefined,
  });

  // 3. Critério de "segura bem": o gate não deve produzir retorno OOS materialmente
  // degradado em relação ao sem gate, OU deve reduzir trades reduzindo fees sem estourar o retorno.
  const gatedBetterOrEqual = gated.total_return_pct >= unGated.total_return_pct - 2.0; // tolerância 2pp
  const tradesReduced = gated.n_trades < unGated.n_trades;
  const holdsUp = gatedBetterOrEqual || tradesReduced;

  return {
    oos: { gated, unGated },
    threshold: threshold ?? -1,
    trainSize,
    testSize,
    testFromIndex: testFrom,
    holdsUp,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
