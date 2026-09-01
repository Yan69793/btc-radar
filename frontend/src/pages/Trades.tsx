import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { SkeletonCard } from '../components/Skeleton'
import { fmtPrice, fmtPct, fmtDate, fmtDateTime, pctColor } from '../lib/formatters'
import { apiSend } from '../lib/api'

// ─── Types ───

interface Trade {
  id: string
  signal_id: string | null
  symbol: string
  direction: 'long' | 'short'
  entry_price: number
  exit_price: number | null
  quantity: number
  entry_date: string
  exit_date: string | null
  status: 'open' | 'closed' | 'partial' | 'cancelled'
  pnl_usd: number | null
  pnl_pct: number | null
  exit_reason: string | null
  fees: number
  strategy: string
}

interface Performance {
  total_pnl: number
  win_rate: number
  sharpe_ratio: number | null
  n_trades: number
  avg_hold_days: number | null
  best_trade_pct: number
  worst_trade_pct: number
  profit_factor: number
  open_trades: number
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

// ─── Strategy labels ───

const STRATEGY_LABELS: Record<string, string> = {
  dca: 'DCA',
  fear_greed_contrarian: 'Fear & Greed',
  grid_trading: 'Grid',
  trend_following: 'Trend Follow',
  mvrv_based: 'MVRV',
  macd: 'MACD',
  rsi: 'RSI',
  ichimoku: 'Ichimoku',
  breakout: 'Breakout',
  mean_reversion: 'Mean Reversion',
}

const EXIT_REASON_LABELS: Record<string, string> = {
  target_1: 'Alvo 1',
  target_2: 'Alvo 2',
  stop_loss: 'Stop Loss',
  trailing_stop: 'Trailing Stop',
  manual: 'Manual',
  signal_reversed: 'Sinal Revertido',
}

// ─── Performance Card ───

function PerfCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="card p-4 hover:border-dark-text-dim transition-colors duration-200">
      <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-1.5">{label}</div>
      <div className="text-dark-text-primary font-mono font-semibold text-lg tabular-nums">{value}</div>
      {subtitle && <div className="text-dark-text-dim text-xs mt-0.5">{subtitle}</div>}
    </div>
  )
}

// ─── Trade Form Modal ───

function TradeForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    direction: 'long' as 'long' | 'short',
    entry_price: '',
    quantity: '',
    strategy: 'dca',
    fees: '0',
    entry_date: new Date().toISOString().slice(0, 16),
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const res = await apiSend('/api/trades', 'POST', {
        direction: form.direction,
        entry_price: parseFloat(form.entry_price),
        quantity: parseFloat(form.quantity),
        strategy: form.strategy,
        fees: parseFloat(form.fees) || 0,
        entry_date: new Date(form.entry_date).toISOString(),
      })

      const json: ApiResponse<Trade> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao salvar')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar trade')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-dark-text-primary font-semibold">Registrar Trade</h3>
          <button onClick={onClose} className="text-dark-text-dim hover:text-dark-text-primary text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Direction */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, direction: 'long' })}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                form.direction === 'long'
                  ? 'bg-accent-green/15 text-accent-green border border-accent-green/40'
                  : 'bg-dark-bg text-dark-text-muted border border-dark-bg-border hover:border-dark-text-dim'
              }`}
            >
              Long
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, direction: 'short' })}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                form.direction === 'short'
                  ? 'bg-accent-red/15 text-accent-red border border-accent-red/40'
                  : 'bg-dark-bg text-dark-text-muted border border-dark-bg-border hover:border-dark-text-dim'
              }`}
            >
              Short
            </button>
          </div>

          {/* Price and Quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-dark-text-dim text-xs mb-1">Preco Entrada (USD)</label>
              <input
                type="number"
                step="0.01"
                required
                value={form.entry_price}
                onChange={(e) => setForm({ ...form, entry_price: e.target.value })}
                className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
                placeholder="Ex: 97500"
              />
            </div>
            <div>
              <label className="block text-dark-text-dim text-xs mb-1">Quantidade (BTC)</label>
              <input
                type="number"
                step="0.0001"
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
                placeholder="Ex: 0.01"
              />
            </div>
          </div>

          {/* Strategy */}
          <div>
            <label className="block text-dark-text-dim text-xs mb-1">Estrategia</label>
            <select
              value={form.strategy}
              onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm focus:border-accent-blue focus:outline-none transition-colors"
            >
              {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Date and Fees */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-dark-text-dim text-xs mb-1">Data Entrada</label>
              <input
                type="datetime-local"
                required
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm focus:border-accent-blue focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-dark-text-dim text-xs mb-1">Taxas (USD)</label>
              <input
                type="number"
                step="0.01"
                value={form.fees}
                onChange={(e) => setForm({ ...form, fees: e.target.value })}
                className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
                placeholder="0"
              />
            </div>
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Salvando...' : 'Registrar Trade'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Close Trade Modal ───

function CloseTradeForm({ trade, onClose, onSaved }: { trade: Trade; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    exit_price: '',
    exit_reason: 'manual' as string,
    exit_date: new Date().toISOString().slice(0, 16),
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const res = await apiSend(`/api/trades/${trade.id}`, 'PUT', {
        exit_price: parseFloat(form.exit_price),
        exit_reason: form.exit_reason,
        exit_date: new Date(form.exit_date).toISOString(),
        status: 'closed',
      })

      const json: ApiResponse<Trade> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao fechar')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fechar trade')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-dark-text-primary font-semibold">Fechar Trade</h3>
          <button onClick={onClose} className="text-dark-text-dim hover:text-dark-text-primary text-lg leading-none">&times;</button>
        </div>

        <div className="mb-4 p-3 bg-dark-bg rounded-lg text-sm space-y-1">
          <div className="text-dark-text-dim">
            {trade.direction.toUpperCase()} {trade.quantity} BTC @ {fmtPrice(trade.entry_price)}
          </div>
          <div className="text-dark-text-dim">Estrategia: {STRATEGY_LABELS[trade.strategy] ?? trade.strategy}</div>
          <div className="text-dark-text-dim">Entrada: {fmtDateTime(trade.entry_date)}</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-dark-text-dim text-xs mb-1">Preco Saida (USD)</label>
            <input
              type="number"
              step="0.01"
              required
              value={form.exit_price}
              onChange={(e) => setForm({ ...form, exit_price: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
              placeholder="Ex: 98500"
            />
          </div>

          <div>
            <label className="block text-dark-text-dim text-xs mb-1">Motivo Saida</label>
            <select
              value={form.exit_reason}
              onChange={(e) => setForm({ ...form, exit_reason: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm focus:border-accent-blue focus:outline-none transition-colors"
            >
              {Object.entries(EXIT_REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-dark-text-dim text-xs mb-1">Data Saida</label>
            <input
              type="datetime-local"
              required
              value={form.exit_date}
              onChange={(e) => setForm({ ...form, exit_date: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm focus:border-accent-blue focus:outline-none transition-colors"
            />
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Salvando...' : 'Fechar Trade'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Trade Row ───

function TradeRow({ trade, onAction }: { trade: Trade; onAction: () => void }) {
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function handleCancel() {
    try {
      const res = await apiSend(`/api/trades/${trade.id}`, 'DELETE')
      const json: ApiResponse<{ id: string; status: string }> = await res.json()
      if (json.success) onAction()
    } catch (err) {
      console.error('Erro ao cancelar trade:', err)
    }
    setConfirmCancel(false)
  }

  const isOpen = trade.status === 'open'
  const isProfit = (trade.pnl_usd ?? 0) >= 0
  const directionColor = trade.direction === 'long' ? 'text-accent-green' : 'text-accent-red'

  return (
    <tr className="border-b border-dark-bg-border hover:bg-white/[0.02] transition-colors">
      {/* Status */}
      <td className="py-3 px-3">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
          trade.status === 'open' ? 'bg-accent-yellow/15 text-accent-yellow' :
          trade.status === 'closed' ? 'bg-dark-text-dim/15 text-dark-text-dim' :
          'bg-dark-text-dim/10 text-dark-text-muted'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            trade.status === 'open' ? 'bg-accent-yellow' : 'bg-dark-text-dim'
          }`} />
          {trade.status === 'open' ? 'Aberto' : trade.status === 'closed' ? 'Fechado' : 'Cancelado'}
        </span>
      </td>

      {/* Direction */}
      <td className="py-3 px-3">
        <span className={`text-sm font-medium ${directionColor}`}>
          {trade.direction.toUpperCase()}
        </span>
      </td>

      {/* Strategy */}
      <td className="py-3 px-3 text-dark-text-secondary text-sm">
        {STRATEGY_LABELS[trade.strategy] ?? trade.strategy}
      </td>

      {/* Entry / Exit */}
      <td className="py-3 px-3">
        <div className="text-dark-text-primary text-sm font-mono tabular-nums">
          {fmtPrice(trade.entry_price)}
        </div>
        {trade.exit_price != null && (
          <div className="text-dark-text-dim text-xs font-mono tabular-nums">{fmtPrice(trade.exit_price)}</div>
        )}
      </td>

      {/* Qty */}
      <td className="py-3 px-3 text-dark-text-secondary text-sm font-mono tabular-nums">
        {trade.quantity}
      </td>

      {/* Dates */}
      <td className="py-3 px-3">
        <div className="text-dark-text-secondary text-xs">{fmtDate(trade.entry_date)}</div>
        {trade.exit_date && (
          <div className="text-dark-text-dim text-xs">{fmtDate(trade.exit_date)}</div>
        )}
      </td>

      {/* P&L */}
      <td className="py-3 px-3 text-right">
        {trade.pnl_usd != null ? (
          <div>
            <div className={`text-sm font-mono font-medium tabular-nums ${pctColor(trade.pnl_usd)}`}>
              {isProfit ? '+' : ''}{trade.pnl_usd.toFixed(2)}
            </div>
            <div className={`text-xs font-mono ${pctColor(trade.pnl_pct)}`}>
              {fmtPct(trade.pnl_pct)}
            </div>
          </div>
        ) : (
          <span className="text-dark-text-dim text-xs">---</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 px-3 text-right">
        {isOpen ? (
          <div className="flex items-center gap-1.5 justify-end">
            <button
              onClick={onAction}
              className="px-2.5 py-1 bg-accent-blue/15 text-accent-blue text-xs rounded hover:bg-accent-blue/25 transition-colors"
            >
              Fechar
            </button>
            {confirmCancel ? (
              <div className="flex items-center gap-1">
                <button onClick={handleCancel} className="text-accent-red text-xs font-medium hover:underline">Sim</button>
                <button onClick={() => setConfirmCancel(false)} className="text-dark-text-dim text-xs hover:underline">Nao</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmCancel(true)}
                className="px-2 py-1 text-dark-text-dim text-xs hover:text-accent-red transition-colors"
              >
                X
              </button>
            )}
          </div>
        ) : trade.pnl_usd != null && (
          <span className="text-dark-text-dim text-xs">
            {EXIT_REASON_LABELS[trade.exit_reason ?? ''] ?? trade.exit_reason ?? '---'}
          </span>
        )}
      </td>
    </tr>
  )
}

// ─── Main Page ───

export function Trades() {
  const { data: perfData, loading: perfLoading, error: perfError, reload: reloadPerf } = useApi<Performance>('/api/trades/performance', 60_000)
  const [trades, setTrades] = useState<Trade[]>([])
  const [tradesLoading, setTradesLoading] = useState(true)
  const [tradesError, setTradesError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [closeTarget, setCloseTarget] = useState<Trade | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const fetchTrades = useCallback(async () => {
    setTradesLoading(true)
    setTradesError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const res = await fetch(`${baseUrl}/api/trades${params}`)
      const json: ApiResponse<Trade[]> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao carregar')
      setTrades(json.data)
    } catch (err) {
      setTradesError(err instanceof Error ? err.message : 'Erro ao carregar trades')
    } finally {
      setTradesLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades])

  function handleSaved() {
    setShowForm(false)
    setCloseTarget(null)
    fetchTrades()
    reloadPerf()
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-xl h-28 sm:h-36 lg:h-[180px]">
        <img src="/assets/trades-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover hero-pulse-glow" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/90 via-dark-bg/40 to-dark-bg/20" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 lg:p-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text-primary">Trades</h1>
            <p className="text-dark-text-dim text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">Registro manual de operacoes e acompanhamento de P&L</p>
          </div>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
            Novo Trade
          </button>
        </div>
      </div>

      {/* Performance Summary */}
      {perfError && !perfData && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">Erro ao carregar performance: {perfError}</div>
      )}
      {perfLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : perfData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-4">
          <PerfCard
            label="P&L Total"
            value={fmtPrice(perfData.total_pnl)}
            subtitle={perfData.n_trades > 0 ? `${perfData.n_trades} trades fechados` : 'Sem trades fechados'}
          />
          <PerfCard
            label="Win Rate"
            value={`${perfData.win_rate.toFixed(1)}%`}
            subtitle={perfData.n_trades > 0 ? undefined : '---'}
          />
          <PerfCard
            label="Profit Factor"
            value={perfData.n_trades === 0 ? '---' :
              perfData.profit_factor == null ? '∞' : perfData.profit_factor.toFixed(2)}
            subtitle={perfData.n_trades === 0 ? 'Sem trades fechados' :
              perfData.profit_factor == null ? 'Sem perdas' :
              perfData.profit_factor > 1.5 ? 'Excelente' :
              perfData.profit_factor > 1 ? 'Positivo' : 'Prejuizo'}
          />
          <PerfCard
            label="Abertos"
            value={`${perfData.open_trades}`}
            subtitle="Trades em andamento"
          />
          <PerfCard
            label="Melhor Trade"
            value={perfData.n_trades > 0 ? fmtPct(perfData.best_trade_pct) : '---'}
          />
          <PerfCard
            label="Pior Trade"
            value={perfData.n_trades > 0 ? fmtPct(perfData.worst_trade_pct) : '---'}
          />
          <PerfCard
            label="Hold Medio"
            value={perfData.avg_hold_days != null ? `${perfData.avg_hold_days}d` : '---'}
          />
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {[
          { key: 'all', label: 'Todos' },
          { key: 'open', label: 'Abertos' },
          { key: 'closed', label: 'Fechados' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              filter === f.key
                ? 'bg-accent-blue/15 text-accent-blue font-medium'
                : 'text-dark-text-dim hover:text-dark-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Trade List */}
      {tradesError && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">
          {tradesError}
        </div>
      )}

      {tradesLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : trades.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-dark-text-dim text-sm">
            {filter === 'all'
              ? 'Nenhum trade registrado. Clique em "Novo Trade" para comecar.'
              : filter === 'open'
                ? 'Nenhum trade aberto no momento.'
                : 'Nenhum trade fechado.'}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px]">
              <thead>
                <tr className="border-b border-dark-bg-border text-dark-text-dim text-xs uppercase tracking-wider">
                  <th className="py-3 px-3 text-left font-medium">Status</th>
                  <th className="py-3 px-3 text-left font-medium">Dir</th>
                  <th className="py-3 px-3 text-left font-medium">Estrategia</th>
                  <th className="py-3 px-3 text-left font-medium">Entrada / Saida</th>
                  <th className="py-3 px-3 text-left font-medium">Qtd</th>
                  <th className="py-3 px-3 text-left font-medium">Datas</th>
                  <th className="py-3 px-3 text-right font-medium">P&L</th>
                  <th className="py-3 px-3 text-right font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <TradeRow
                    key={trade.id}
                    trade={trade}
                    onAction={() => setCloseTarget(trade)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {showForm && <TradeForm onClose={() => setShowForm(false)} onSaved={handleSaved} />}
      {closeTarget && (
        <CloseTradeForm
          trade={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
