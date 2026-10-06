// BTC Radar — Tipos do frontend (espelho do worker/src/types.ts)

export interface PriceSnapshot {
  symbol: string
  price: number
  change_24h: number
  high_24h: number
  low_24h: number
  volume_24h: number
  market_cap: number
  btc_dominance: number
  timestamp: string
}

export interface FearGreedData {
  value: number
  classification: string
  timestamp: string
}

export interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  published_at: string
  sentiment: 'positive' | 'neutral' | 'negative' | null
  summary: string | null
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
  timestamp: string
}

export interface OHLCV {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  interval: string
  source: string
}

export interface WhatsAppSubscriber {
  phone: string
  subscribed_at: string
  active: boolean
  last_notification_at: string | null
  notification_count: number
  preferences: {
    signals: boolean
    alerts: boolean
    briefing: boolean
  }
}

// ─── Backtest Score ───

export type ScoreClassification =
  | 'Pessimo'
  | 'Muito Ruim'
  | 'Ruim'
  | 'Bom'
  | 'Muito Bom'
  | 'Excelente'

export interface MetricBreakdown {
  raw: number
  percentile: number
  weight: number
  contribution: number
}

export interface BacktestScoreResult {
  score: number
  classification: ScoreClassification
  classification_percentile: number
  breakdown: {
    ev: MetricBreakdown
    drawdown: MetricBreakdown
    return_pct: MetricBreakdown
    ops_per_day: MetricBreakdown
    win_rate: MetricBreakdown
  }
  gates_passed: boolean
  gate_failures: string[]
  compared_against: number
}

export interface ScoreDistribution {
  count: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
}
