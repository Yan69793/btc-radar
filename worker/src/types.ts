// BTC Radar — Tipos do sistema

import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

// ─── Environment ───

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  CORS_ORIGINS?: string;
  ADMIN_EMAILS?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
}

// ─── Mercado / Preço ───

export interface PriceSnapshot {
  symbol: string; // "BTC-USD"
  price: number;
  change_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  market_cap: number;
  btc_dominance: number;
  timestamp: string; // ISO 8601 UTC
}

export interface OHLCV {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  interval: "1h" | "4h" | "1d" | "1w";
  source: string;
}

// ─── On-Chain ───

export interface OnChainSnapshot {
  timestamp: string;
  hash_rate: number | null; // TH/s
  difficulty: number | null;
  active_addresses: number | null;
  transaction_count: number | null;
  transaction_volume_usd: number | null;
  avg_fee_sats: number | null;
  block_height: number | null;
  circulating_supply: number | null;
  source: string;
}

// ─── Sentimento ───

export interface FearGreedData {
  value: number; // 1-100
  classification: "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";
  timestamp: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  sentiment: "positive" | "neutral" | "negative" | null;
  summary: string | null;
}

// ─── Sinais ───

export type Timeframe = "short" | "medium" | "long";
export type Verdict = "COMPRAR" | "AGUARDAR" | "VENDER" | "REDUZIR";
export type StrategyType =
  | "dca"
  | "fear_greed_contrarian"
  | "grid_trading"
  | "trend_following"
  | "mvrv_based"
  | "macd"
  | "rsi"
  | "ichimoku"
  | "breakout"
  | "mean_reversion"
  | "consensus";

export interface SignalDocument {
  signal_id: string;
  symbol: string; // "BTC-USD"
  timeframe: Timeframe;
  verdict: Verdict;
  market_date: string; // YYYY-MM-DD
  generated_at: string; // ISO 8601
  entry_price: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  risk_reward: number | null;
  conviction: number; // 0-10
  strategy: StrategyType;
  payload: SignalPayload;
}

export interface SignalPayload {
  rationale: string;
  technical_indicators: Record<string, number>;
  on_chain_context: string;
  sentiment_context: string;
  risk_notes: string;
  atr_value: number;
  atr_multiplier_stop: number;
  timeframe_hours: number;
}

// ─── Trades ───

export type TradeDirection = "long" | "short";
export type TradeStatus = "open" | "closed" | "partial" | "cancelled";
export type ExitReason = "target_1" | "target_2" | "stop_loss" | "trailing_stop" | "manual" | "signal_reversed";

export interface Trade {
  id: string;
  signal_id: string | null;
  symbol: string;
  direction: TradeDirection;
  entry_price: number;
  exit_price: number | null;
  quantity: number; // em BTC
  entry_date: string;
  exit_date: string | null;
  status: TradeStatus;
  pnl_usd: number | null;
  pnl_pct: number | null;
  exit_reason: ExitReason | null;
  fees: number;
  strategy: StrategyType;
}

export interface TradePerformance {
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number | null;
  n_trades: number;
  avg_hold_days: number | null;
  best_trade_pct: number;
  worst_trade_pct: number;
  profit_factor: number | null; // null = lucro sem nenhuma perda (frontend trata como infinito)
}

// ─── Portfolio ───

export interface PortfolioSnapshot {
  timestamp: string;
  btc_balance: number;
  usd_balance: number;
  btc_price: number;
  total_value_usd: number;
  allocation_long_pct: number | null;
  allocation_medium_pct: number | null;
  allocation_short_pct: number | null;
}

export interface PortfolioCurrent {
  btc_balance: number;
  usd_balance: number;
  btc_price: number;
  total_value_usd: number;
  allocation: {
    long: number;
    medium: number;
    short: number;
  };
  unrealized_pnl_usd: number;
  unrealized_pnl_pct: number;
}

// ─── Alertas ───

export type AlertType = "price" | "technical" | "onchain" | "news" | "system";

export interface Alert {
  id: number;
  created_at: string;
  type: AlertType;
  condition: string;
  triggered_at: string | null;
  acknowledged: boolean;
  payload: Record<string, unknown> | null;
}

// ─── Backtest ───

export interface BacktestRun {
  id: string;
  strategy: StrategyType;
  params: Record<string, unknown>;
  date_from: string;
  date_to: string;
  run_at: string;
  total_return: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  n_trades: number | null;
  payload: Record<string, unknown> | null;
}

export type ScoreClassification =
  | "Pessimo"
  | "Muito Ruim"
  | "Ruim"
  | "Bom"
  | "Muito Bom"
  | "Excelente";

export interface MetricBreakdown {
  raw: number;
  percentile: number;
  weight: number;
  contribution: number;
}

export interface BacktestScoreResult {
  score: number;
  classification: ScoreClassification;
  classification_percentile: number;
  breakdown: {
    ev: MetricBreakdown;
    drawdown: MetricBreakdown;
    return_pct: MetricBreakdown;
    ops_per_day: MetricBreakdown;
    win_rate: MetricBreakdown;
  };
  gates_passed: boolean;
  gate_failures: string[];
  compared_against: number;
}

export interface BacktestRunWithScore extends BacktestRun {
  score_data: BacktestScoreResult | null;
}

// ─── Briefing ───

export interface Briefing {
  id: number;
  date: string; // YYYY-MM-DD
  generated_at: string;
  model: string;
  prompt_version: string;
  summary: string;
}

// ─── Requisições ───

export interface GenerateSignalRequest {
  symbol?: string; // default "BTC-USD"
  timeframe: Timeframe;
}

export interface CreateTradeRequest {
  direction: TradeDirection;
  entry_price: number;
  quantity: number;
  strategy: StrategyType;
  signal_id?: string;
  entry_date?: string;
}

export interface UpdateTradeRequest {
  exit_price: number;
  exit_reason: ExitReason;
  status?: TradeStatus;
  exit_date?: string;
}

export interface CreateAlertRequest {
  type: AlertType;
  condition: string;
  payload?: Record<string, unknown>;
}

export interface PortfolioSnapshotRequest {
  btc_balance: number;
  usd_balance: number;
  allocation_long_pct?: number;
  allocation_medium_pct?: number;
  allocation_short_pct?: number;
}

export interface BacktestRequest {
  strategy: StrategyType;
  params: Record<string, unknown>;
  date_from: string;
  date_to: string;
}

// ─── WhatsApp ───

export interface WhatsAppSubscriber {
  phone: string;
  subscribed_at: string;
  active: boolean;
  last_notification_at: string | null;
  notification_count: number;
  preferences: {
    signals: boolean;
    alerts: boolean;
    briefing: boolean;
  };
}

export interface WhatsAppMessage {
  id: number;
  phone: string;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string | null;
  timestamp: string;
  wa_message_id: string | null;
  status: string | null;
}

// ─── API Responses ───

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  limit: number;
  offset: number;
  total: number;
}
