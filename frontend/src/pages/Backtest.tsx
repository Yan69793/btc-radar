import { useState, useEffect, useCallback } from 'react'
import { SkeletonCard } from '../components/Skeleton'
import { PageHeader } from '../components/PageHeader'
import { ScoreGauge } from '../components/ScoreGauge'
import { fmtPct, fmtDateTime } from '../lib/formatters'
import type { ApiResponse, BacktestScoreResult, ScoreDistribution } from '../types'

interface BacktestRun {
  id: string
  strategy: string
  params: Record<string, unknown>
  date_from: string
  date_to: string
  run_at: string
  total_return: number | null
  sharpe_ratio: number | null
  max_drawdown: number | null
  win_rate: number | null
  n_trades: number | null
  payload: Record<string, unknown> | null
  score_data?: BacktestScoreResult | null
}

const STRATEGY_LABELS: Record<string, string> = {
  trend_following: 'Trend Following',
  rsi: 'RSI Extremos',
  macd: 'MACD Cross',
  dca: 'DCA',
  bollinger: 'Bollinger Mean Reversion',
  fear_greed_contrarian: 'Fear & Greed',
  grid_trading: 'Grid Trading',
  mvrv_based: 'MVRV',
}

function MetricBadge({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const color = good === undefined
    ? 'text-dark-text-secondary'
    : good ? 'text-accent-green' : 'text-accent-red'

  return (
    <div className="bg-dark-bg rounded-lg p-3 text-center">
      <div className="text-dark-text-dim text-[10px] tracking-wide uppercase mb-1">{label}</div>
      <div className={`font-mono font-semibold text-sm ${color}`}>{value}</div>
    </div>
  )
}

function BacktestCard({ run, distribution }: { run: BacktestRun; distribution: ScoreDistribution | null }) {
  const [expanded, setExpanded] = useState(false)

  const hasData = run.total_return != null && run.n_trades != null
  const alpha = hasData && run.payload?.buy_hold_return != null
    ? (run.total_return ?? 0) - (run.payload.buy_hold_return as number)
    : null

  return (
    <div className="card overflow-hidden hover:border-dark-text-dim transition-colors duration-200">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
          <div>
            <div className="text-dark-text-primary font-medium text-sm">
              {STRATEGY_LABELS[run.strategy] ?? run.strategy}
            </div>
            <div className="text-dark-text-dim text-xs mt-0.5">
              {fmtDateTime(run.run_at)}
            </div>
          </div>
          {hasData ? (
            <div className="flex items-center gap-3">
              <span className={`text-sm font-mono font-medium ${(run.total_return ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {fmtPct(run.total_return)}
              </span>
              <span className="text-dark-text-dim text-xs">
                {run.n_trades} trades | WR {run.win_rate?.toFixed(1)}%
              </span>
              {/* Score badge compacto */}
              {run.score_data?.gates_passed && (
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: run.score_data.score >= 75 ? 'rgba(34,197,94,0.15)' :
                                     run.score_data.score >= 50 ? 'rgba(234,179,8,0.15)' :
                                     run.score_data.score >= 25 ? 'rgba(249,115,22,0.15)' : 'rgba(239,68,68,0.15)',
                    color: run.score_data.score >= 75 ? '#4ade80' :
                           run.score_data.score >= 50 ? '#facc15' :
                           run.score_data.score >= 25 ? '#fb923c' : '#f87171',
                  }}
                >
                  {run.score_data.score.toFixed(0)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-dark-text-muted text-sm">Erro na execucao</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {run.params && Object.keys(run.params).length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              {Object.entries(run.params).slice(0, 3).map(([k, v]) => (
                <span key={k} className="text-dark-text-dim text-[10px] bg-dark-bg px-1.5 py-0.5 rounded">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`text-dark-text-dim transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && hasData && (
        <div className="px-5 pb-4 border-t border-dark-bg-border pt-4 space-y-4">
          {/* Score Gauge (se disponivel) */}
          {run.score_data && (
            <ScoreGauge scoreData={run.score_data} distribution={distribution} />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 sm:gap-3">
            <MetricBadge label="Retorno" value={fmtPct(run.total_return)} good={(run.total_return ?? 0) > 0} />
            <MetricBadge label="Sharpe" value={run.sharpe_ratio?.toFixed(2) ?? '---'} good={(run.sharpe_ratio ?? 0) > 1} />
            <MetricBadge label="Max DD" value={run.max_drawdown != null ? `${run.max_drawdown.toFixed(1)}%` : '---'} good={(run.max_drawdown ?? 100) < 20} />
            <MetricBadge label="Win Rate" value={run.win_rate != null ? `${run.win_rate.toFixed(1)}%` : '---'} good={(run.win_rate ?? 0) > 50} />
            <MetricBadge label="Trades" value={`${run.n_trades}`} />
            <MetricBadge label="B&H" value={run.payload?.buy_hold_return != null ? fmtPct(run.payload.buy_hold_return as number) : '---'} />
            <MetricBadge label="Alpha" value={alpha != null ? fmtPct(alpha) : '---'} good={alpha != null && alpha > 0} />
          </div>

          {run.payload?.best_trade_pct != null && (
            <div className="grid grid-cols-3 gap-3">
              <MetricBadge label="Melhor Trade" value={fmtPct(run.payload.best_trade_pct as number)} good={true} />
              <MetricBadge label="Pior Trade" value={fmtPct(run.payload.worst_trade_pct as number)} good={false} />
              <MetricBadge label="Profit Factor" value={run.payload.profit_factor != null ? String(run.payload.profit_factor) : '---'} />
            </div>
          )}
        </div>
      )}

      {expanded && !hasData && (
        <div className="px-5 pb-4 border-t border-dark-bg-border pt-4">
          <div className="text-dark-text-muted text-sm">Dados insuficientes para exibir metricas.</div>
        </div>
      )}
    </div>
  )
}

export function Backtest() {
  const [runs, setRuns] = useState<BacktestRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [strategyFilter, setStrategyFilter] = useState<string>('all')
  const [distribution, setDistribution] = useState<ScoreDistribution | null>(null)

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const params = strategyFilter !== 'all' ? `?strategy=${strategyFilter}` : ''
      const res = await fetch(`${baseUrl}/api/backtest${params}`)
      const json: ApiResponse<BacktestRun[]> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao carregar')
      setRuns(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar backtests')
    } finally {
      setLoading(false)
    }
  }, [strategyFilter])

  // Buscar distribuicao de scores para o gauge
  const fetchDistribution = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/backtest/score/distribution`)
      const json: ApiResponse<ScoreDistribution> = await res.json()
      if (json.success) setDistribution(json.data)
    } catch {
      // silencioso — gauge funciona sem distribuicao
    }
  }, [])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  useEffect(() => {
    fetchDistribution()
  }, [fetchDistribution])

  // Strategias disponiveis para filtrar
  const availableStrategies = [...new Set(runs.map((r) => r.strategy))]

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        eyebrow="Analise"
        title="Backtest"
        poster="/assets/film-pulso.png"
        meta={
          <>
            Motor proprio (pandas/numpy)
            {runs.length > 0 && <span className="ml-2">{runs.length} run{runs.length !== 1 ? 's' : ''}</span>}
          </>
        }
      />

      {/* Filtros */}
      {availableStrategies.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStrategyFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              strategyFilter === 'all'
                ? 'bg-accent-blue/15 text-accent-blue font-medium'
                : 'text-dark-text-dim hover:text-dark-text-primary'
            }`}
          >
            Todas
          </button>
          {availableStrategies.map((s) => (
            <button
              key={s}
              onClick={() => setStrategyFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                strategyFilter === s
                  ? 'bg-accent-blue/15 text-accent-blue font-medium'
                  : 'text-dark-text-dim hover:text-dark-text-primary'
              }`}
            >
              {STRATEGY_LABELS[s] ?? s}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* Run list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : runs.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-dark-text-dim text-sm">
            Nenhum backtest executado ainda. Execute o script Python localmente para gerar resultados.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <BacktestCard key={run.id} run={run} distribution={distribution} />
          ))}
        </div>
      )}
    </div>
  )
}
