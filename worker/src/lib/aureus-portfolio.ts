import type { Verdict } from "../types";

export const AUREUS_PORTFOLIO_VERSION = "1.0.0";

export interface PortfolioPolicy {
  initialNav: number;
  maxPortfolioExposure: number;
  maxNewEntryNotional: number;
  riskPerTrade: number;
  reduceFraction: number;
  feePerSide: number;
  slippagePct: number;
}

export const DEFAULT_AUREUS_POLICY: PortfolioPolicy = Object.freeze({
  initialNav: 100,
  maxPortfolioExposure: 1,
  maxNewEntryNotional: 0.25,
  riskPerTrade: 0.01,
  reduceFraction: 0.5,
  feePerSide: 0.001,
  slippagePct: 0.0005,
});

export interface LongPosition {
  quantity: number;
  originalQuantity: number;
  entryExecPrice: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  target1Done: boolean;
  openedAt: string;
}

export interface PortfolioState {
  cash: number;
  position: LongPosition | null;
  realizedPnl: number;
  totalFees: number;
  cycle: number;
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type PortfolioAction = Extract<Verdict, "COMPRAR" | "VENDER" | "REDUZIR" | "AGUARDAR">;

export interface CycleInput {
  timestamp: string;
  action: PortfolioAction;
  candle: MarketCandle;
  stopLoss?: number | null;
  target1?: number | null;
  target2?: number | null;
}

export interface ExecutionEvent {
  type: "BUY" | "SELL" | "REDUCE" | "STOP" | "TARGET_1" | "TARGET_2" | "HOLD" | "REJECTED";
  timestamp: string;
  quantity: number;
  marketPrice: number;
  executionPrice: number;
  grossValue: number;
  fee: number;
  reason: string;
}

export interface PortfolioSnapshot {
  timestamp: string;
  nav: number;
  cash: number;
  positionValue: number;
  exposure: number;
  quantity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalFees: number;
  cycle: number;
}

export interface CycleResult {
  state: PortfolioState;
  snapshot: PortfolioSnapshot;
  events: ExecutionEvent[];
}

export function initialPortfolioState(policy: PortfolioPolicy = DEFAULT_AUREUS_POLICY): PortfolioState {
  return { cash: policy.initialNav, position: null, realizedPnl: 0, totalFees: 0, cycle: 0 };
}

function finitePositive(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function round(v: number, digits = 12): number {
  const p = 10 ** digits;
  return Math.round((v + Number.EPSILON) * p) / p;
}

function cloneState(state: PortfolioState): PortfolioState {
  return { ...state, position: state.position ? { ...state.position } : null };
}

export function markToMarket(state: PortfolioState, price: number, timestamp: string): PortfolioSnapshot {
  const positionValue = state.position ? state.position.quantity * price : 0;
  const nav = state.cash + positionValue;
  const costBasis = state.position ? state.position.quantity * state.position.entryExecPrice : 0;
  const unrealizedPnl = state.position ? positionValue - costBasis : 0;
  return {
    timestamp,
    nav: round(nav),
    cash: round(state.cash),
    positionValue: round(positionValue),
    exposure: nav > 0 ? round(positionValue / nav) : 0,
    quantity: round(state.position?.quantity ?? 0),
    realizedPnl: round(state.realizedPnl),
    unrealizedPnl: round(unrealizedPnl),
    totalFees: round(state.totalFees),
    cycle: state.cycle,
  };
}

function sellQuantity(
  state: PortfolioState,
  quantity: number,
  marketPrice: number,
  timestamp: string,
  type: ExecutionEvent["type"],
  reason: string,
  policy: PortfolioPolicy,
): ExecutionEvent | null {
  if (!state.position || quantity <= 0) return null;
  const q = Math.min(quantity, state.position.quantity);
  const executionPrice = marketPrice * (1 - policy.slippagePct);
  const grossValue = q * executionPrice;
  const fee = grossValue * policy.feePerSide;
  const netProceeds = grossValue - fee;
  const basis = q * state.position.entryExecPrice;
  state.cash += netProceeds;
  state.realizedPnl += netProceeds - basis;
  state.totalFees += fee;
  state.position.quantity = round(state.position.quantity - q);
  if (state.position.quantity <= 1e-12) state.position = null;
  return {
    type, timestamp, quantity: round(q), marketPrice, executionPrice: round(executionPrice),
    grossValue: round(grossValue), fee: round(fee), reason,
  };
}

function processProtectiveLevels(
  state: PortfolioState,
  candle: MarketCandle,
  policy: PortfolioPolicy,
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  const p = state.position;
  if (!p) return events;

  const stopHit = candle.low <= p.stopLoss;
  const t1Hit = !p.target1Done && finitePositive(p.target1) && candle.high >= p.target1;
  const t2Hit = finitePositive(p.target2) && candle.high >= p.target2;

  if (stopHit) {
    const ev = sellQuantity(
      state, p.quantity, p.stopLoss, candle.timestamp, "STOP",
      t1Hit || t2Hit ? "stop-first em candle ambíguo" : "stop_loss", policy,
    );
    if (ev) events.push(ev);
    return events;
  }

  if (t1Hit && state.position) {
    const q = Math.min(state.position.originalQuantity * 0.5, state.position.quantity);
    const ev = sellQuantity(
      state, q, p.target1!, candle.timestamp, "TARGET_1",
      "T1 realiza 50% da quantidade original", policy,
    );
    if (ev) events.push(ev);
    if (state.position) state.position.target1Done = true;
  }

  if (t2Hit && state.position) {
    const ev = sellQuantity(
      state, state.position.quantity, p.target2!, candle.timestamp, "TARGET_2",
      "T2 encerra o saldo remanescente", policy,
    );
    if (ev) events.push(ev);
  }
  return events;
}

function openLong(state: PortfolioState, input: CycleInput, policy: PortfolioPolicy): ExecutionEvent {
  const marketPrice = input.candle.close;
  if (state.position) {
    return {
      type: "REJECTED", timestamp: input.timestamp, quantity: 0, marketPrice,
      executionPrice: marketPrice, grossValue: 0, fee: 0,
      reason: "COMPRAR ignorado: já existe posição agregada em BTC",
    };
  }
  if (!finitePositive(input.stopLoss) || input.stopLoss >= marketPrice) {
    return {
      type: "REJECTED", timestamp: input.timestamp, quantity: 0, marketPrice,
      executionPrice: marketPrice, grossValue: 0, fee: 0,
      reason: "COMPRAR rejeitado: stop_loss inválido para posição long",
    };
  }

  const pre = markToMarket(state, marketPrice, input.timestamp);
  const stopDistancePct = (marketPrice - input.stopLoss) / marketPrice;
  const riskBudget = pre.nav * policy.riskPerTrade;
  const riskSizedNotional = riskBudget / stopDistancePct;
  const entryCap = pre.nav * policy.maxNewEntryNotional;
  const exposureCap = pre.nav * policy.maxPortfolioExposure;
  const maxByCashWithCosts = state.cash / (1 + policy.feePerSide) / (1 + policy.slippagePct);
  const notional = Math.max(0, Math.min(riskSizedNotional, entryCap, exposureCap, maxByCashWithCosts));

  if (!(notional > 0)) {
    return {
      type: "REJECTED", timestamp: input.timestamp, quantity: 0, marketPrice,
      executionPrice: marketPrice, grossValue: 0, fee: 0,
      reason: "COMPRAR rejeitado: capital disponível insuficiente",
    };
  }

  const executionPrice = marketPrice * (1 + policy.slippagePct);
  const quantity = notional / executionPrice;
  const grossValue = quantity * executionPrice;
  const fee = grossValue * policy.feePerSide;
  state.cash -= grossValue + fee;
  state.totalFees += fee;
  state.position = {
    quantity, originalQuantity: quantity, entryExecPrice: executionPrice,
    stopLoss: input.stopLoss,
    target1: finitePositive(input.target1) ? input.target1 : null,
    target2: finitePositive(input.target2) ? input.target2 : null,
    target1Done: false,
    openedAt: input.timestamp,
  };

  return {
    type: "BUY", timestamp: input.timestamp, quantity: round(quantity), marketPrice,
    executionPrice: round(executionPrice), grossValue: round(grossValue), fee: round(fee),
    reason: "sizing=min(risco 1% NAV, 25% NAV por entrada, exposição 100%, caixa)",
  };
}

export function evaluatePortfolioCycle(
  previous: PortfolioState,
  input: CycleInput,
  policy: PortfolioPolicy = DEFAULT_AUREUS_POLICY,
): CycleResult {
  const state = cloneState(previous);
  state.cycle += 1;
  const events: ExecutionEvent[] = [];

  if (!finitePositive(input.candle.close) || !finitePositive(input.candle.high) || !finitePositive(input.candle.low)) {
    throw new Error("candle inválido");
  }

  events.push(...processProtectiveLevels(state, input.candle, policy));

  if (input.action === "VENDER") {
    if (state.position) {
      const ev = sellQuantity(
        state, state.position.quantity, input.candle.close, input.timestamp,
        "SELL", "VENDER encerra 100% da posição long existente; nunca abre short", policy,
      );
      if (ev) events.push(ev);
    } else {
      events.push({
        type: "HOLD", timestamp: input.timestamp, quantity: 0, marketPrice: input.candle.close,
        executionPrice: input.candle.close, grossValue: 0, fee: 0,
        reason: "VENDER sem posição: permanece em caixa",
      });
    }
  } else if (input.action === "REDUZIR") {
    if (state.position) {
      const ev = sellQuantity(
        state, state.position.quantity * policy.reduceFraction, input.candle.close,
        input.timestamp, "REDUCE", "REDUZIR realiza 50% da posição corrente", policy,
      );
      if (ev) events.push(ev);
    } else {
      events.push({
        type: "HOLD", timestamp: input.timestamp, quantity: 0, marketPrice: input.candle.close,
        executionPrice: input.candle.close, grossValue: 0, fee: 0,
        reason: "REDUZIR sem posição: permanece em caixa",
      });
    }
  } else if (input.action === "COMPRAR") {
    events.push(openLong(state, input, policy));
  } else {
    events.push({
      type: "HOLD", timestamp: input.timestamp, quantity: 0, marketPrice: input.candle.close,
      executionPrice: input.candle.close, grossValue: 0, fee: 0, reason: "AGUARDAR",
    });
  }

  const snapshot = markToMarket(state, input.candle.close, input.timestamp);
  if (snapshot.exposure > policy.maxPortfolioExposure + 1e-9) {
    throw new Error("exposição acima do limite: " + snapshot.exposure);
  }
  if (state.cash < -1e-8) {
    throw new Error("caixa negativo: " + state.cash);
  }
  return { state, snapshot, events };
}
