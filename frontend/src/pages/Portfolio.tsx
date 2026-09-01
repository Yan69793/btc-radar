import { useState, useCallback, useEffect } from 'react'
import { useApi } from '../hooks/useApi'
import { SkeletonCard } from '../components/Skeleton'
import { fmtPrice, fmtPct, fmtDateTime, pctColor } from '../lib/formatters'
import { apiSend } from '../lib/api'

interface Trade {
  id: string
  symbol: string
  direction: 'long' | 'short'
  entry_price: number
  exit_price: number | null
  quantity: number
  entry_date: string
  status: string
  pnl_usd: number | null
  pnl_pct: number | null
  strategy: string
  fees: number
}

interface PortfolioCurrent {
  btc_balance: number
  usd_balance: number
  btc_price: number
  total_value_usd: number
  allocation: { long: number; medium: number; short: number }
  unrealized_pnl_usd: number
  unrealized_pnl_pct: number
}

interface PortfolioSnapshot {
  timestamp: string
  btc_balance: number
  usd_balance: number
  btc_price: number
  total_value_usd: number
}

interface PortfolioData {
  current: PortfolioCurrent
  open_trades: Trade[]
  last_snapshot: PortfolioSnapshot | null
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

const STRATEGY_LABELS: Record<string, string> = {
  dca: 'DCA',
  trend_following: 'Trend Follow',
  fear_greed_contrarian: 'Fear & Greed',
  grid_trading: 'Grid',
  mvrv_based: 'MVRV',
  macd: 'MACD',
  rsi: 'RSI',
}

// ─── Snapshot Form ───

function SnapshotForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ btc_balance: '', usd_balance: '' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await apiSend('/api/portfolio/snapshot', 'POST', {
        btc_balance: parseFloat(form.btc_balance) || 0,
        usd_balance: parseFloat(form.usd_balance) || 0,
      })
      const json: ApiResponse<PortfolioSnapshot> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao salvar')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-dark-text-primary font-semibold">Registrar Saldo</h3>
          <button onClick={onClose} className="text-dark-text-dim hover:text-dark-text-primary text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-dark-text-dim text-xs mb-1">BTC</label>
            <input
              type="number" step="0.00000001"
              value={form.btc_balance}
              onChange={(e) => setForm({ ...form, btc_balance: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
              placeholder="Ex: 0.015"
            />
          </div>
          <div>
            <label className="block text-dark-text-dim text-xs mb-1">USD (caixa)</label>
            <input
              type="number" step="0.01"
              value={form.usd_balance}
              onChange={(e) => setForm({ ...form, usd_balance: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
              placeholder="Ex: 5000"
            />
          </div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <button
            type="submit" disabled={saving}
            className="w-full py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Salvando...' : 'Registrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ───

export function Portfolio() {
  const { data, loading, error, reload } = useApi<PortfolioData>('/api/portfolio', 60_000)
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([])
  const [showSnapshotForm, setShowSnapshotForm] = useState(false)

  const fetchSnapshots = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/portfolio/history?limit=30`)
      const json: ApiResponse<PortfolioSnapshot[]> = await res.json()
      if (json.success) setSnapshots(json.data)
    } catch (err) {
      console.error('Erro ao buscar snapshot:', err)
    }
  }, [])

  useEffect(() => {
    fetchSnapshots()
  }, [fetchSnapshots])

  function handleSaved() {
    setShowSnapshotForm(false)
    reload()
    fetchSnapshots()
  }

  const curr = data?.current
  const trades = data?.open_trades ?? []
  const hasHoldings = (curr?.btc_balance ?? 0) > 0 || (curr?.usd_balance ?? 0) > 0
  const hasTrades = trades.length > 0

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-xl h-28 sm:h-36 lg:h-[180px]">
        <img src="/assets/portfolio-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover hero-ken-burns" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/90 via-dark-bg/40 to-dark-bg/20" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 lg:p-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text-primary">Portfolio</h1>
            <p className="text-dark-text-dim text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">Posicao atual e historico de saldos</p>
          </div>
          <button onClick={() => setShowSnapshotForm(true)} className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
            Registrar Saldo
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : curr ? (
        <>
          {/* Portfolio Value Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-4">
              <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-1.5">Valor Total</div>
              <div className="text-dark-text-primary font-mono font-semibold text-xl tabular-nums">
                {fmtPrice(curr.total_value_usd)}
              </div>
              <div className="text-dark-text-dim text-xs mt-0.5">
                BTC {fmtPrice(curr.btc_price)} × {curr.btc_balance}
              </div>
            </div>

            <div className="card p-4">
              <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-1.5">BTC</div>
              <div className="text-dark-text-primary font-mono font-semibold text-xl tabular-nums">
                {curr.btc_balance.toFixed(8)}
              </div>
              <div className="text-dark-text-dim text-xs mt-0.5">
                {fmtPrice(curr.btc_balance * curr.btc_price)}
              </div>
            </div>

            <div className="card p-4">
              <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-1.5">USD (caixa)</div>
              <div className="text-dark-text-primary font-mono font-semibold text-xl tabular-nums">
                {fmtPrice(curr.usd_balance)}
              </div>
              <div className="text-dark-text-dim text-xs mt-0.5">
                {(curr.usd_balance / Math.max(curr.total_value_usd, 1) * 100).toFixed(1)}% do portfolio
              </div>
            </div>

            <div className="card p-4">
              <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-1.5">P&L Nao Realizado</div>
              <div className={`font-mono font-semibold text-xl tabular-nums ${pctColor(curr.unrealized_pnl_usd)}`}>
                {curr.unrealized_pnl_usd >= 0 ? '+' : ''}{curr.unrealized_pnl_usd.toFixed(2)}
              </div>
              <div className={`text-xs mt-0.5 ${pctColor(curr.unrealized_pnl_pct)}`}>
                {fmtPct(curr.unrealized_pnl_pct)}
              </div>
            </div>
          </div>

          {/* Allocation + Open Trades */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Allocation */}
            <div className="card p-5">
              <h3 className="text-dark-text-primary font-semibold text-sm mb-4">Alocacao por Estrategia</h3>
              {!hasTrades && !hasHoldings ? (
                <div className="text-dark-text-dim text-sm">Sem trades abertos. Registre saldo e trades para ver alocacao.</div>
              ) : (
                <div className="space-y-3">
                  {trades.length > 0 ? trades.map((t) => (
                    <div key={t.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${t.direction === 'long' ? 'bg-accent-green' : 'bg-accent-red'}`} />
                        <span className="text-dark-text-secondary text-sm">
                          {STRATEGY_LABELS[t.strategy] ?? t.strategy}
                        </span>
                        <span className="text-dark-text-dim text-xs">
                          {t.direction.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-dark-text-primary text-sm font-mono tabular-nums">
                        {t.quantity} BTC
                      </div>
                    </div>
                  )) : (
                    <div className="text-dark-text-dim text-sm">Nenhum trade aberto.</div>
                  )}
                  <div className="border-t border-dark-bg-border pt-2 mt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-dark-text-dim">BTC exposto</span>
                      <span className="text-dark-text-primary font-mono">{curr.btc_balance.toFixed(8)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-dark-text-dim">USD caixa</span>
                      <span className="text-dark-text-primary font-mono">{fmtPrice(curr.usd_balance)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Open Trades */}
            <div className="card p-5 lg:col-span-2">
              <h3 className="text-dark-text-primary font-semibold text-sm mb-4">
                Trades Abertos
                {trades.length > 0 && (
                  <span className="ml-2 text-dark-text-dim font-normal">{trades.length}</span>
                )}
              </h3>
              {trades.length === 0 ? (
                <div className="text-dark-text-dim text-sm">
                  Nenhum trade aberto. Va para <a href="/painel/trades" className="text-accent-blue hover:underline">Trades</a> para registrar.
                </div>
              ) : (
                <div className="space-y-2">
                  {trades.map((t) => {
                    const currentPnl = curr.btc_price > 0
                      ? t.direction === 'long'
                        ? (curr.btc_price - t.entry_price) * t.quantity - t.fees
                        : (t.entry_price - curr.btc_price) * t.quantity - t.fees
                      : 0
                    const currentPnlPct = t.entry_price * t.quantity > 0
                      ? (currentPnl / (t.entry_price * t.quantity)) * 100
                      : 0

                    return (
                      <div key={t.id} className="flex items-center justify-between bg-dark-bg rounded-lg p-3">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.direction === 'long' ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-red/15 text-accent-red'}`}>
                            {t.direction.toUpperCase()}
                          </span>
                          <div>
                            <div className="text-dark-text-primary text-sm font-mono">
                              {fmtPrice(t.entry_price)}
                            </div>
                            <div className="text-dark-text-dim text-xs">
                              {STRATEGY_LABELS[t.strategy] ?? t.strategy} · {t.quantity} BTC
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-mono font-medium ${pctColor(currentPnl)}`}>
                            {currentPnl >= 0 ? '+' : ''}{currentPnl.toFixed(2)}
                          </div>
                          <div className={`text-xs ${pctColor(currentPnlPct)}`}>
                            {fmtPct(currentPnlPct)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Historical Snapshots */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-dark-text-primary font-semibold text-sm">Historico de Saldos</h3>
              <span className="text-dark-text-dim text-xs">{snapshots.length} registros</span>
            </div>
            {snapshots.length === 0 ? (
              <div className="text-dark-text-dim text-sm">
                Nenhum snapshot registrado. Use "Registrar Saldo" para comecar a acompanhar o historico.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="border-b border-dark-bg-border text-dark-text-dim text-xs uppercase tracking-wider">
                      <th className="py-2 px-3 text-left font-medium">Data</th>
                      <th className="py-2 px-3 text-right font-medium">BTC</th>
                      <th className="py-2 px-3 text-right font-medium">USD</th>
                      <th className="py-2 px-3 text-right font-medium">Preco BTC</th>
                      <th className="py-2 px-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.timestamp} className="border-b border-dark-bg-border hover:bg-white/[0.02]">
                        <td className="py-2 px-3 text-dark-text-secondary text-xs">
                          {fmtDateTime(s.timestamp)}
                        </td>
                        <td className="py-2 px-3 text-right text-dark-text-primary font-mono text-sm">
                          {s.btc_balance.toFixed(8)}
                        </td>
                        <td className="py-2 px-3 text-right text-dark-text-primary font-mono text-sm">
                          {fmtPrice(s.usd_balance)}
                        </td>
                        <td className="py-2 px-3 text-right text-dark-text-dim font-mono text-sm">
                          {fmtPrice(s.btc_price)}
                        </td>
                        <td className="py-2 px-3 text-right text-dark-text-primary font-mono text-sm font-medium">
                          {fmtPrice(s.total_value_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {showSnapshotForm && <SnapshotForm onClose={() => setShowSnapshotForm(false)} onSaved={handleSaved} />}
    </div>
  )
}
