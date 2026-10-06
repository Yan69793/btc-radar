// BTC Radar — Motor de sinais
// Avalia 6 estratégias em 3 horizontes temporais usando indicadores técnicos

import type { OHLCV, FearGreedData, SignalDocument, Timeframe, Verdict, StrategyType } from "../types";
import {
  ema, rsi as calcRSI, macd as calcMACD, atr as calcATR,
  bollinger, closes, crossOver, crossUnder, last, lastValid,
} from "./indicators";
import { computeConsensus, type ConsensusResult } from "./consensus";

// ─── Configuração por timeframe ───

interface TimeframeConfig {
  emaFast: number;
  emaSlow: number;
  rsiOversold: number;
  rsiOverbought: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  atrPeriod: number;
  convictionBase: number;
}

const TIMEFRAME_CONFIG: Record<Timeframe, TimeframeConfig> = {
  short: {
    emaFast: 9, emaSlow: 21, rsiOversold: 25, rsiOverbought: 75,
    macdFast: 6, macdSlow: 13, macdSignal: 5, atrPeriod: 7, convictionBase: 4,
  },
  medium: {
    emaFast: 20, emaSlow: 50, rsiOversold: 35, rsiOverbought: 65,
    macdFast: 12, macdSlow: 26, macdSignal: 9, atrPeriod: 14, convictionBase: 6,
  },
  long: {
    emaFast: 50, emaSlow: 200, rsiOversold: 30, rsiOverbought: 70,
    macdFast: 12, macdSlow: 26, macdSignal: 9, atrPeriod: 14, convictionBase: 8,
  },
};

// ─── Gerador principal ───

export interface SignalInput {
  candles: OHLCV[];
  fearGreed: FearGreedData | null;
  timeframe: Timeframe;
}

export function generateSignals(input: SignalInput): SignalDocument[] {
  const { candles, fearGreed, timeframe } = input;
  if (candles.length < 50) return [];

  const cfg = TIMEFRAME_CONFIG[timeframe];
  const c = closes(candles);
  const currentPrice = c[c.length - 1]!;
  const now = new Date().toISOString();
  const marketDate = new Date().toISOString().slice(0, 10);

  // Pré-calcular indicadores compartilhados
  const emaFast = ema(c, cfg.emaFast);
  const emaSlow = ema(c, cfg.emaSlow);
  const rsiVals = calcRSI(c, 14);
  const macdRes = calcMACD(c, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
  const atrVals = calcATR(candles, cfg.atrPeriod);
  const bb = bollinger(c, 20);

  const currentATR = lastValid(atrVals) ?? currentPrice * 0.02;
  const currentRSI = lastValid(rsiVals) ?? 50;
  const currentEmaFast = lastValid(emaFast);
  const currentEmaSlow = lastValid(emaSlow);

  const signals: SignalDocument[] = [];

  // ─── 1. DCA (Dollar Cost Average) ───
  signals.push(evaluateDCA({ timeframe, currentPrice, currentEmaFast, cfg, now, marketDate, currentATR }));

  // ─── 2. Fear & Greed Contrarian ───
  if (fearGreed) {
    signals.push(evaluateFearGreed({ timeframe, fearGreed, currentPrice, now, marketDate, currentATR }));
  }

  // ─── 3. EMA Cross (Trend Following) ───
  if (currentEmaFast != null && currentEmaSlow != null && emaFast.length >= 2 && emaSlow.length >= 2) {
    signals.push(evaluateEMACross({
      timeframe, currentPrice, currentEmaFast, currentEmaSlow,
      prevEmaFast: emaFast[emaFast.length - 2], prevEmaSlow: emaSlow[emaSlow.length - 2],
      cfg, now, marketDate, currentATR,
    }));
  }

  // ─── 4. MACD ───
  const mLine = lastValid(macdRes.macdLine);
  const sLine = lastValid(macdRes.signalLine);
  if (mLine != null && sLine != null && macdRes.macdLine.length >= 2 && macdRes.signalLine.length >= 2) {
    signals.push(evaluateMACD({
      timeframe, currentPrice,
      macdLine: mLine, signalLine: sLine,
      prevMacdLine: lastValidN(macdRes.macdLine, 2),
      prevSignalLine: lastValidN(macdRes.signalLine, 2),
      histogram: lastValid(macdRes.histogram) ?? 0,
      cfg, now, marketDate, currentATR,
    }));
  }

  // ─── 5. RSI ───
  signals.push(evaluateRSI({ timeframe, currentPrice, currentRSI, cfg, now, marketDate, currentATR }));

  // ─── 6. Grid Trading ───
  if (bb && currentEmaFast != null && currentEmaSlow != null) {
    signals.push(evaluateGrid({
      timeframe, currentPrice, bb, currentEmaFast, currentEmaSlow,
      now, marketDate, currentATR,
    }));
  }

  return signals; // Retorna todos os sinais, incluindo AGUARDAR
}

// ─── Consenso multi-timeframe ───
// Gera sinais para os 3 horizontes e computa o veredito agregado.
// Nao altera generateSignals (por timeframe): e uma camada que consome os
// sinais já gerados. Retorna os sinais planos + o ConsensusResult (ou null).

export interface SignalsWithConsensus {
  signals: SignalDocument[];
  consensus: ConsensusResult | null;
}

export function generateSignalsWithConsensus(
  inputs: Record<Timeframe, SignalInput>,
): SignalsWithConsensus {
  const signals: SignalDocument[] = [];
  for (const tf of ["short", "medium", "long"] as Timeframe[]) {
    const input = inputs[tf];
    if (input && input.candles.length >= 50) {
      signals.push(...generateSignals(input));
    }
  }
  const consensus = computeConsensus(signals);
  return { signals, consensus };
}

// ─── Avaliadores por estratégia ───

function makeSignal(
  strategy: StrategyType,
  timeframe: Timeframe,
  verdict: Verdict,
  conviction: number,
  currentPrice: number,
  atr: number,
  entryPrice: number | null,
  stopLoss: number | null,
  target1: number | null,
  target2: number | null,
  rationale: string,
  technicalIndicators: Record<string, number>,
  now: string,
  marketDate: string,
): SignalDocument {
  const riskReward = (stopLoss != null && target1 != null && entryPrice != null)
    ? Math.abs(target1 - entryPrice) / Math.abs(entryPrice - stopLoss)
    : null;

  return {
    signal_id: `sig-${strategy}-${timeframe}-${marketDate}`,
    symbol: "BTC-USD",
    timeframe,
    verdict,
    market_date: marketDate,
    generated_at: now,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    target_1: target1,
    target_2: target2,
    risk_reward: riskReward != null ? Math.round(riskReward * 100) / 100 : null,
    conviction: Math.min(10, Math.max(1, Math.round(conviction))),
    strategy,
    payload: {
      rationale,
      technical_indicators: technicalIndicators,
      on_chain_context: "Indisponível (Fase 2)",
      sentiment_context: "",
      risk_notes: `ATR: ${Math.round(atr)} USD | Stop: ${stopLoss != null ? Math.round(stopLoss) : 'N/A'} USD`,
      atr_value: Math.round(atr),
      atr_multiplier_stop: stopLoss != null ? Math.round(Math.abs(currentPrice - stopLoss) / atr * 10) / 10 : 0,
      timeframe_hours: timeframe === "short" ? 72 : timeframe === "medium" ? 720 : 4320,
    },
  };
}

// ─── DCA: compra recorrente ───

function evaluateDCA(args: {
  timeframe: Timeframe;
  currentPrice: number;
  currentEmaFast: number | null;
  cfg: TimeframeConfig;
  now: string;
  marketDate: string;
  currentATR: number;
}): SignalDocument {
  const { timeframe, currentPrice, currentEmaFast, cfg, now, marketDate, currentATR } = args;

  if (timeframe === "short") {
    return makeSignal("dca", "short", "AGUARDAR", 1, currentPrice, currentATR,
      null, null, null, null,
      "DCA é estratégia de acumulação de longo prazo. Curto prazo: não aplicável.",
      {}, now, marketDate);
  }

  const belowTrend = currentEmaFast != null && currentPrice < currentEmaFast;
  const entry = belowTrend ? currentPrice : null;
  const rationale = timeframe === "long"
    ? "DCA Longo Prazo: acumular Bitcoin independente do preço. Disciplina supera timing. Se abaixo da EMA, oportunidade de acelerar compra."
    : "DCA Médio Prazo: comprar se preço abaixo da tendência (EMA). Aguardar se acima.";

  return makeSignal("dca", timeframe, "COMPRAR", timeframe === "long" ? 9 : 6,
    currentPrice, currentATR, entry, null, null, null, rationale,
    currentEmaFast != null ? { [`ema_${cfg.emaFast}`]: Math.round(currentEmaFast) } : {},
    now, marketDate);
}

// ─── Fear & Greed Contrarian ───

function evaluateFearGreed(args: {
  timeframe: Timeframe;
  fearGreed: FearGreedData;
  currentPrice: number;
  now: string;
  marketDate: string;
  currentATR: number;
}): SignalDocument {
  const { timeframe, fearGreed, currentPrice, now, marketDate, currentATR } = args;
  const fg = fearGreed.value;
  const classification = fearGreed.classification;

  let verdict: Verdict;
  let conviction: number;
  let rationale: string;
  let entry: number | null = currentPrice;
  let stop: number | null = null;
  let target1: number | null = null;

  if (fg <= 20) {
    verdict = "COMPRAR";
    conviction = timeframe === "long" ? 9 : timeframe === "medium" ? 7 : 6;
    rationale = `Fear & Greed em ${fg} (${classification}). Contrarian: momento de comprar quando há sangue nas ruas.`;
    stop = currentPrice - currentATR * 2;
    target1 = currentPrice + currentATR * 4;
  } else if (fg <= 30) {
    verdict = timeframe === "short" ? "AGUARDAR" : "COMPRAR";
    conviction = 6;
    rationale = `Fear & Greed em ${fg} (${classification}). Medo elevado: bom ponto de entrada para ${timeframe === 'long' ? 'longo' : 'médio'} prazo.`;
    entry = currentPrice;
    stop = currentPrice - currentATR * 1.5;
    target1 = currentPrice + currentATR * 3;
  } else if (fg >= 80) {
    verdict = timeframe === "short" ? "VENDER" : "REDUZIR";
    conviction = fg >= 90 ? 8 : 6;
    rationale = `Fear & Greed em ${fg} (${classification}). Ganância extrema: sinal de topo. Realizar lucros.`;
    entry = null;
  } else if (fg >= 65) {
    verdict = timeframe === "long" ? "REDUZIR" : "AGUARDAR";
    conviction = 4;
    rationale = `Fear & Greed em ${fg} (${classification}). Zona de ganância: cautela.`;
  } else if (fg >= 40) {
    verdict = "AGUARDAR";
    conviction = 3;
    rationale = `Fear & Greed em ${fg} (${classification}). Zona neutra: sem sinal claro.`;
  } else {
    verdict = "AGUARDAR";
    conviction = 3;
    rationale = `Fear & Greed em ${fg} (${classification}).`;
  }

  // Para venda, alvo é o preço atual (já está alto)
  if (verdict === "VENDER" || verdict === "REDUZIR") {
    target1 = currentPrice;
    stop = currentPrice + currentATR * 1.5; // stop acima para proteger
  }

  return makeSignal("fear_greed_contrarian", timeframe, verdict, conviction,
    currentPrice, currentATR, entry, stop, target1, target1 != null ? target1 * 1.05 : null,
    rationale, { fear_greed_value: fg }, now, marketDate);
}

// ─── EMA Cross (Trend Following) ───

function evaluateEMACross(args: {
  timeframe: Timeframe;
  currentPrice: number;
  currentEmaFast: number;
  currentEmaSlow: number;
  prevEmaFast: number | undefined;
  prevEmaSlow: number | undefined;
  cfg: TimeframeConfig;
  now: string;
  marketDate: string;
  currentATR: number;
}): SignalDocument {
  const { timeframe, currentPrice, currentEmaFast, currentEmaSlow,
    prevEmaFast, prevEmaSlow, cfg, now, marketDate, currentATR } = args;

  const crossedUp = crossOver(currentEmaFast, currentEmaSlow, prevEmaFast ?? NaN, prevEmaSlow ?? NaN);
  const crossedDown = crossUnder(currentEmaFast, currentEmaSlow, prevEmaFast ?? NaN, prevEmaSlow ?? NaN);
  const isBullish = currentEmaFast > currentEmaSlow;

  let verdict: Verdict;
  let conviction: number;
  let rationale: string;
  let entry: number | null = currentPrice;
  let stop: number | null;
  let target1: number | null;

  if (crossedUp) {
    verdict = "COMPRAR";
    conviction = timeframe === "long" ? 8 : 7;
    rationale = `Cruzamento de alta: EMA ${cfg.emaFast} cruzou acima da EMA ${cfg.emaSlow}. Tendência de alta confirmada.`;
    stop = currentPrice - currentATR * 3;
    target1 = currentPrice + currentATR * 4;
  } else if (crossedDown) {
    verdict = timeframe === "long" ? "REDUZIR" : "VENDER";
    conviction = 7;
    rationale = `Cruzamento de baixa: EMA ${cfg.emaFast} cruzou abaixo da EMA ${cfg.emaSlow}. Tendência de baixa.`;
    entry = null;
    stop = currentPrice + currentATR * 1.5;
    target1 = currentPrice;
  } else if (isBullish) {
    verdict = "AGUARDAR";
    conviction = 5;
    rationale = `EMA ${cfg.emaFast} acima da EMA ${cfg.emaSlow}: tendência de alta. Manter posição ou aguardar pullback.`;
    entry = currentPrice;
    stop = currentEmaSlow - currentATR;
    target1 = currentPrice + currentATR * 3;
  } else {
    verdict = "AGUARDAR";
    conviction = 3;
    rationale = `EMA ${cfg.emaFast} abaixo da EMA ${cfg.emaSlow}: tendência de baixa. Aguardar reversão.`;
    entry = null;
    stop = null;
    target1 = null;
  }

  return makeSignal("trend_following", timeframe, verdict, conviction,
    currentPrice, currentATR, entry, stop, target1,
    target1 != null ? target1 * 1.08 : null,
    rationale, {
      [`ema_${cfg.emaFast}`]: Math.round(currentEmaFast),
      [`ema_${cfg.emaSlow}`]: Math.round(currentEmaSlow),
    }, now, marketDate);
}

// ─── MACD ───

function evaluateMACD(args: {
  timeframe: Timeframe;
  currentPrice: number;
  macdLine: number;
  signalLine: number;
  prevMacdLine: number | undefined;
  prevSignalLine: number | undefined;
  histogram: number;
  cfg: TimeframeConfig;
  now: string;
  marketDate: string;
  currentATR: number;
}): SignalDocument {
  const { timeframe, currentPrice, macdLine, signalLine,
    prevMacdLine, prevSignalLine, histogram, cfg, now, marketDate, currentATR } = args;

  const crossedUp = crossOver(macdLine, signalLine, prevMacdLine ?? NaN, prevSignalLine ?? NaN);
  const crossedDown = crossUnder(macdLine, signalLine, prevMacdLine ?? NaN, prevSignalLine ?? NaN);
  const isBullish = macdLine > signalLine;

  let verdict: Verdict;
  let conviction: number;
  let rationale: string;
  let entry: number | null = currentPrice;
  let stop: number | null;
  let target1: number | null;

  if (crossedUp && histogram > 0) {
    verdict = "COMPRAR";
    conviction = timeframe === "long" ? 7 : 6;
    rationale = `MACD cruzou acima do sinal com histograma positivo. Momentum de alta.`;
    stop = currentPrice - currentATR * 2;
    target1 = currentPrice + currentATR * 3;
  } else if (crossedDown && histogram < 0) {
    verdict = timeframe === "short" ? "VENDER" : "REDUZIR";
    conviction = 6;
    rationale = `MACD cruzou abaixo do sinal com histograma negativo. Momentum de baixa.`;
    entry = null;
    stop = currentPrice + currentATR * 1.5;
    target1 = currentPrice;
  } else if (isBullish) {
    verdict = "AGUARDAR";
    conviction = 4;
    rationale = `MACD acima do sinal: momentum positivo. Aguardar confirmação.`;
    stop = currentPrice - currentATR * 2;
    target1 = currentPrice + currentATR * 2;
  } else {
    verdict = "AGUARDAR";
    conviction = 3;
    rationale = `MACD abaixo do sinal: momentum negativo.`;
    stop = null;
    target1 = null;
  }

  return makeSignal("macd", timeframe, verdict, conviction,
    currentPrice, currentATR, entry, stop, target1,
    target1 != null ? target1 * 1.06 : null,
    rationale, {
      macd_line: Math.round(macdLine * 100) / 100,
      signal_line: Math.round(signalLine * 100) / 100,
      histogram: Math.round(histogram * 100) / 100,
    }, now, marketDate);
}

// ─── RSI ───

function evaluateRSI(args: {
  timeframe: Timeframe;
  currentPrice: number;
  currentRSI: number;
  cfg: TimeframeConfig;
  now: string;
  marketDate: string;
  currentATR: number;
}): SignalDocument {
  const { timeframe, currentPrice, currentRSI, cfg, now, marketDate, currentATR } = args;

  let verdict: Verdict;
  let conviction: number;
  let rationale: string;
  let entry: number | null = currentPrice;
  let stop: number | null;
  let target1: number | null;

  if (currentRSI <= cfg.rsiOversold) {
    verdict = "COMPRAR";
    conviction = currentRSI <= 20 ? 8 : 6;
    rationale = `RSI ${Math.round(currentRSI)}: sobrevendido. Potencial de reversão para cima.`;
    stop = currentPrice - currentATR * 1.5;
    target1 = currentPrice + currentATR * 3;
  } else if (currentRSI >= cfg.rsiOverbought) {
    verdict = timeframe === "short" ? "VENDER" : "REDUZIR";
    conviction = currentRSI >= 80 ? 8 : 6;
    rationale = `RSI ${Math.round(currentRSI)}: sobrecomprado. Hora de realizar lucros.`;
    entry = null;
    stop = currentPrice + currentATR * 1.5;
    target1 = currentPrice;
  } else if (currentRSI < 45) {
    verdict = "AGUARDAR";
    conviction = 3;
    rationale = `RSI ${Math.round(currentRSI)}: zona baixa, mas não extrema.`;
    stop = currentPrice - currentATR * 2;
    target1 = currentPrice + currentATR * 2;
  } else if (currentRSI > 55) {
    verdict = "AGUARDAR";
    conviction = 3;
    rationale = `RSI ${Math.round(currentRSI)}: zona alta, mas não extrema.`;
    stop = currentPrice - currentATR * 1.5;
    target1 = currentPrice + currentATR * 1.5;
  } else {
    verdict = "AGUARDAR";
    conviction = 2;
    rationale = `RSI ${Math.round(currentRSI)}: zona neutra.`;
    stop = null;
    target1 = null;
  }

  return makeSignal("rsi", timeframe, verdict, conviction,
    currentPrice, currentATR, entry, stop, target1,
    target1 != null ? target1 * 1.05 : null,
    rationale, { rsi: Math.round(currentRSI) }, now, marketDate);
}

// ─── Grid Trading ───

function evaluateGrid(args: {
  timeframe: Timeframe;
  currentPrice: number;
  bb: ReturnType<typeof bollinger>;
  currentEmaFast: number;
  currentEmaSlow: number;
  now: string;
  marketDate: string;
  currentATR: number;
}): SignalDocument {
  const { timeframe, currentPrice, bb, currentEmaFast, currentEmaSlow, now, marketDate, currentATR } = args;

  if (!bb) {
    return makeSignal("grid_trading", timeframe, "AGUARDAR", 1, currentPrice, currentATR,
      null, null, null, null, "Grid trading: dados insuficientes.", {}, now, marketDate);
  }

  const isRanging = bb.bandwidth < 6;
  const nearLowerBand = currentPrice <= bb.lower * 1.02;
  const nearUpperBand = currentPrice >= bb.upper * 0.98;

  // Grid funciona melhor em mercado lateral
  if (timeframe === "short") {
    return makeSignal("grid_trading", timeframe, "AGUARDAR", 1, currentPrice, currentATR,
      null, null, null, null,
      "Grid trading não é adequado para curto prazo (1-3 dias). Use médio ou longo.",
      {}, now, marketDate);
  }

  if (!isRanging && !nearLowerBand) {
    return makeSignal("grid_trading", timeframe, "AGUARDAR", 2, currentPrice, currentATR,
      null, null, null, null,
      `Bollinger bandwidth ${bb.bandwidth.toFixed(1)}%: mercado em tendência. Grid não recomendado.`,
      { bollinger_bandwidth: Math.round(bb.bandwidth * 10) / 10 }, now, marketDate);
  }

  if (nearLowerBand) {
    const entry = currentPrice;
    const stop = bb.lower - currentATR;
    const target1 = bb.middle;
    const target2 = bb.upper;
    return makeSignal("grid_trading", timeframe, "COMPRAR", 6,
      currentPrice, currentATR, entry, stop, target1, target2,
      `Preço próximo à banda inferior de Bollinger (${Math.round(bb.lower)}). Setup de grid: comprar na baixa, vender no meio/banda superior.`,
      {
        bollinger_lower: Math.round(bb.lower),
        bollinger_middle: Math.round(bb.middle),
        bollinger_upper: Math.round(bb.upper),
        bandwidth: Math.round(bb.bandwidth * 10) / 10,
      }, now, marketDate);
  }

  if (nearUpperBand) {
    return makeSignal("grid_trading", timeframe, "REDUZIR", 5,
      currentPrice, currentATR, null, bb.upper + currentATR, currentPrice, bb.lower,
      `Preço próximo à banda superior de Bollinger (${Math.round(bb.upper)}). Realizar venda parcial do grid.`,
      {
        bollinger_lower: Math.round(bb.lower),
        bollinger_middle: Math.round(bb.middle),
        bollinger_upper: Math.round(bb.upper),
        bandwidth: Math.round(bb.bandwidth * 10) / 10,
      }, now, marketDate);
  }

  return makeSignal("grid_trading", timeframe, "AGUARDAR", 3, currentPrice, currentATR,
    null, null, null, null,
    `Bollinger bandwidth ${bb.bandwidth.toFixed(1)}%: lateral, mas sem extremo. Aguardar toque nas bandas para operar grid.`,
    {
      bollinger_lower: Math.round(bb.lower),
      bollinger_middle: Math.round(bb.middle),
      bollinger_upper: Math.round(bb.upper),
      bandwidth: Math.round(bb.bandwidth * 10) / 10,
    }, now, marketDate);
}

// ─── Helpers ───

function lastValidN(arr: number[], nFromEnd: number): number | undefined {
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== undefined && !isNaN(v)) {
      count++;
      if (count === nFromEnd) return v;
    }
  }
  return undefined;
}
