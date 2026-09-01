// BTC Radar — Indicadores técnicos
// Implementações puras, sem dependências externas

import type { OHLCV } from "../types";

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

// ─── Médias Móveis ───

export function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j]!;
    }
    result.push(sum / period);
  }
  return result;
}

export function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  if (values.length === 0) return result;

  const multiplier = 2 / (period + 1);

  // Seed com SMA do primeiro período
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += values[j]!;
      }
      prev = sum / period;
    } else {
      prev = (values[i]! - prev) * multiplier + prev;
    }
    result.push(prev);
  }
  return result;
}

// ─── RSI (Wilder's smoothing) ───

export function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return result;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // Wilder's smoothing
  const avgGains: number[] = [];
  const avgLosses: number[] = [];

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i]!;
    avgLoss += losses[i]!;
  }
  avgGain /= period;
  avgLoss /= period;

  avgGains.push(avgGain);
  avgLosses.push(avgLoss);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
    avgGains.push(avgGain);
    avgLosses.push(avgLoss);
  }

  // RSI array (first entry aligns with index `period` of gains)
  for (let i = 0; i < avgGains.length; i++) {
    if (avgLosses[i] === 0) {
      result.push(100);
    } else {
      const rs = avgGains[i]! / avgLosses[i]!;
      result.push(100 - 100 / (1 + rs));
    }
  }

  // Pad with NaN for initial candles
  const padLength = closes.length - 1 - result.length;
  const pad: number[] = [];
  for (let i = 0; i < padLength; i++) pad.push(NaN);
  // RSI needs `period` price changes, so first `period` RSIs are valid
  // result already has gains.length - period + 1 entries
  // Pad at beginning: (closes.length - 1) - result.length = period - 1

  return [...pad, ...result];
}

// ─── MACD ───

export function macd(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (f === undefined || s === undefined || isNaN(f) || isNaN(s)) {
      macdLine.push(NaN);
    } else {
      macdLine.push(f - s);
    }
  }

  // Signal line: EMA of macdLine (9 periods)
  const validMacd: number[] = macdLine.filter((v) => !isNaN(v));
  const firstValidIdx = macdLine.findIndex((v) => !isNaN(v));
  const emaSignalRaw = ema(validMacd, signal);

  const signalLine: number[] = [];
  const histogram: number[] = [];
  let rawIdx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < firstValidIdx + signal - 1 || rawIdx >= emaSignalRaw.length) {
      signalLine.push(NaN);
      histogram.push(NaN);
    } else {
      const sigVal = emaSignalRaw[rawIdx]!;
      signalLine.push(sigVal);
      histogram.push(isNaN(macdLine[i]!) ? NaN : macdLine[i]! - sigVal);
      rawIdx++;
    }
  }

  return { macdLine, signalLine, histogram };
}

// ─── ATR ───

export function atr(candles: OHLCV[], period: number = 14): number[] {
  const trValues: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trValues.push(candles[i]!.high - candles[i]!.low);
    } else {
      const high = candles[i]!.high;
      const low = candles[i]!.low;
      const prevClose = candles[i - 1]!.close;
      trValues.push(
        Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
      );
    }
  }

  return ema(trValues, period);
}

// ─── Bollinger Bands ───

export function bollinger(
  values: number[],
  period: number = 20,
  stdDev: number = 2
): BollingerResult | null {
  if (values.length < period) return null;

  const lastN = values.slice(-period);
  const middle = lastN.reduce((a, b) => a + b, 0) / period;

  const variance =
    lastN.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: middle + stdDev * std,
    middle,
    lower: middle - stdDev * std,
    bandwidth: ((2 * stdDev * std) / middle) * 100,
  };
}

// ─── Utilitários ───

export function crossOver(
  fastCurr: number,
  slowCurr: number,
  fastPrev: number,
  slowPrev: number
): boolean {
  if (isNaN(fastCurr) || isNaN(slowCurr) || isNaN(fastPrev) || isNaN(slowPrev)) return false;
  return fastPrev <= slowPrev && fastCurr > slowCurr;
}

export function crossUnder(
  fastCurr: number,
  slowCurr: number,
  fastPrev: number,
  slowPrev: number
): boolean {
  if (isNaN(fastCurr) || isNaN(slowCurr) || isNaN(fastPrev) || isNaN(slowPrev)) return false;
  return fastPrev >= slowPrev && fastCurr < slowCurr;
}

export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

export function lastValid(arr: number[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== undefined && !isNaN(v)) return v;
  }
  return null;
}

// Extrai array de fechamento, máxima, mínima de candles OHLCV
export function closes(candles: OHLCV[]): number[] {
  return candles.map((c) => c.close);
}

export function highs(candles: OHLCV[]): number[] {
  return candles.map((c) => c.high);
}

export function lows(candles: OHLCV[]): number[] {
  return candles.map((c) => c.low);
}
