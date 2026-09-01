import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { SkeletonCard } from '../components/Skeleton'
import { fmtPrice, fmtTimeAgo } from '../lib/formatters'

interface SignalDocument {
  signal_id: string
  symbol: string
  timeframe: 'short' | 'medium' | 'long'
  verdict: 'COMPRAR' | 'AGUARDAR' | 'VENDER' | 'REDUZIR'
  market_date: string
  generated_at: string
  entry_price: number | null
  stop_loss: number | null
  target_1: number | null
  target_2: number | null
  risk_reward: number | null
  conviction: number
  strategy: string
  payload: {
    rationale: string
    technical_indicators: Record<string, number>
    on_chain_context: string
    sentiment_context: string
    risk_notes: string
    atr_value: number
    atr_multiplier_stop: number
    timeframe_hours: number
  }
}

interface SignalsResponse {
  signals: SignalDocument[]
  generated_at: string
}

const TIMEFRAME_LABELS: Record<string, string> = {
  short: 'Curto (1-3d)',
  medium: 'Médio (3-30d)',
  long: 'Longo (6m+)',
}

const TIMEFRAME_DESC: Record<string, string> = {
  short: 'Trades de 1 a 3 dias',
  medium: 'Posições de 3 a 30 dias',
  long: 'Investimento de 6 meses ou mais',
}

const VERDICT_STYLE: Record<string, { bg: string; text: string; border: string; badge: string; glow: string }> = {
  COMPRAR: {
    bg: 'bg-[#0a2818]',
    text: 'text-accent-green',
    border: 'border-accent-green/20 hover:border-accent-green/40',
    badge: 'bg-accent-green/15 text-accent-green border-accent-green/30',
    glow: 'shadow-glow-green',
  },
  AGUARDAR: {
    bg: 'bg-dark-bg-card',
    text: 'text-dark-text-muted',
    border: 'border-dark-bg-border hover:border-dark-text-dim',
    badge: 'bg-dark-bg-hover text-dark-text-muted border-dark-bg-border',
    glow: '',
  },
  VENDER: {
    bg: 'bg-[#280a0a]',
    text: 'text-accent-red',
    border: 'border-accent-red/20 hover:border-accent-red/40',
    badge: 'bg-accent-red/15 text-accent-red border-accent-red/30',
    glow: 'shadow-glow-red',
  },
  REDUZIR: {
    bg: 'bg-[#281a0a]',
    text: 'text-accent-yellow',
    border: 'border-accent-yellow/20 hover:border-accent-yellow/40',
    badge: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
    glow: '',
  },
}

const STRATEGY_LABELS: Record<string, string> = {
  dca: 'DCA',
  fear_greed_contrarian: 'Fear & Greed',
  grid_trading: 'Grid Trading',
  trend_following: 'Trend Following',
  macd: 'MACD',
  rsi: 'RSI',
  mvrv_based: 'MVRV',
}

const STRATEGY_ICONS: Record<string, string> = {
  dca: 'D',
  fear_greed_contrarian: 'F',
  grid_trading: 'G',
  trend_following: 'T',
  macd: 'M',
  rsi: 'R',
  mvrv_based: 'V',
}

function ConvictionBar({ value }: { value: number }) {
  const pct = (value / 10) * 100
  const color =
    value >= 8 ? 'bg-accent-green' :
    value >= 6 ? 'bg-accent-green/70' :
    value >= 4 ? 'bg-accent-yellow' :
    'bg-accent-red'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-dark-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
          style={{
            width: `${pct}%`,
            boxShadow: value >= 6 ? `0 0 8px currentColor` : 'none',
          }}
        />
      </div>
      <span className="text-xs font-mono font-medium text-dark-text-muted w-5 text-right tabular-nums">
        {value}
      </span>
    </div>
  )
}

function SignalCard({ signal }: { signal: SignalDocument }) {
  const style = VERDICT_STYLE[signal.verdict] ?? VERDICT_STYLE['AGUARDAR']!
  const strategyLabel = STRATEGY_LABELS[signal.strategy] ?? signal.strategy
  const strategyIcon = STRATEGY_ICONS[signal.strategy] ?? '?'
  const isActionable = signal.verdict === 'COMPRAR' || signal.verdict === 'VENDER'

  return (
    <div
      className={`card p-0 overflow-hidden transition-all duration-200 ${style.border} ${style.glow} ${
        isActionable ? 'ring-1 ring-inset' : ''
      }`}
      style={isActionable ? { borderColor: signal.verdict === 'COMPRAR' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' } : {}}
    >
      {/* Top strip: Strategy + Verdict */}
      <div className={`px-4 py-3 flex items-center justify-between ${style.bg}`}
        style={{
          background: signal.verdict === 'COMPRAR'
            ? 'linear-gradient(180deg, rgba(34,197,94,0.08) 0%, transparent 100%)'
            : signal.verdict === 'VENDER'
              ? 'linear-gradient(180deg, rgba(239,68,68,0.08) 0%, transparent 100%)'
              : undefined,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
            signal.verdict === 'COMPRAR' ? 'bg-accent-green/15 text-accent-green' :
            signal.verdict === 'VENDER' ? 'bg-accent-red/15 text-accent-red' :
            'bg-dark-bg-hover text-dark-text-muted'
          }`}>
            {strategyIcon}
          </div>
          <span className="text-dark-text-primary font-semibold text-sm">{strategyLabel}</span>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${style.badge}`}>
          {signal.verdict}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Rationale */}
        <p className="text-dark-text-secondary text-xs leading-relaxed">
          {signal.payload.rationale}
        </p>

        {/* Conviction */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-dark-text-dim text-[11px] tracking-wide uppercase">Convicção</span>
            <span className="text-dark-text-muted text-[11px]">
              {signal.conviction >= 8 ? 'Alta' : signal.conviction >= 5 ? 'Moderada' : 'Baixa'}
            </span>
          </div>
          <ConvictionBar value={signal.conviction} />
        </div>

        {/* Price levels — only if actionable */}
        {(signal.entry_price != null || signal.stop_loss != null || signal.target_1 != null) && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 border-t border-dark-bg-border">
            {signal.entry_price != null && (
              <div>
                <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">Entrada</span>
                <div className="font-mono text-sm font-medium text-dark-text-primary tabular-nums">
                  {fmtPrice(signal.entry_price)}
                </div>
              </div>
            )}
            {signal.stop_loss != null && (
              <div>
                <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">Stop Loss</span>
                <div className="font-mono text-sm font-medium text-accent-red tabular-nums">
                  {fmtPrice(signal.stop_loss)}
                </div>
              </div>
            )}
            {signal.target_1 != null && (
              <div>
                <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">Alvo 1</span>
                <div className="font-mono text-sm font-medium text-accent-green tabular-nums">
                  {fmtPrice(signal.target_1)}
                </div>
              </div>
            )}
            {signal.target_2 != null && (
              <div>
                <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">Alvo 2</span>
                <div className="font-mono text-sm font-medium text-accent-green/80 tabular-nums">
                  {fmtPrice(signal.target_2)}
                </div>
              </div>
            )}
            {signal.risk_reward != null && (
              <div>
                <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">Risco/Retorno</span>
                <div className={`font-mono text-sm font-bold tabular-nums ${
                  signal.risk_reward >= 2 ? 'text-accent-green' :
                  signal.risk_reward >= 1 ? 'text-dark-text-primary' :
                  'text-accent-red'
                }`}>
                  {signal.risk_reward.toFixed(1)}
                </div>
              </div>
            )}
            <div>
              <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">ATR</span>
              <div className="font-mono text-sm font-medium text-dark-text-muted tabular-nums">
                ${signal.payload.atr_value.toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* Technical indicators */}
        {Object.keys(signal.payload.technical_indicators).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-dark-bg-border">
            {Object.entries(signal.payload.technical_indicators).map(([k, v]) => (
              <span key={k} className="text-dark-text-dim text-[11px]">
                <span className="text-dark-text-muted">{k}</span>{' '}
                <span className="font-mono text-dark-text-secondary tabular-nums">
                  {typeof v === 'number' && v % 1 !== 0 ? v.toFixed(2) : v}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Signals() {
  const { data, loading, error, reload } = useApi<SignalsResponse>(
    '/api/signals',
    300_000
  )
  const [timeframeFilter, setTimeframeFilter] = useState<string>('all')
  const [verdictFilter, setVerdictFilter] = useState<string>('all')

  const allSignals = data?.signals ?? []

  const filtered = allSignals.filter((s) => {
    if (timeframeFilter !== 'all' && s.timeframe !== timeframeFilter) return false
    if (verdictFilter !== 'all' && s.verdict !== verdictFilter) return false
    return true
  })

  // Agrupa por timeframe
  const grouped: Record<string, SignalDocument[]> = {}
  for (const s of filtered) {
    if (!grouped[s.timeframe]) grouped[s.timeframe] = []
    grouped[s.timeframe]!.push(s)
  }

  const timeframeOrder = ['long', 'medium', 'short']

  const counts = {
    total: allSignals.length,
    comprar: allSignals.filter((s) => s.verdict === 'COMPRAR').length,
    aguardar: allSignals.filter((s) => s.verdict === 'AGUARDAR').length,
    vender: allSignals.filter((s) => s.verdict === 'VENDER').length,
    reduzir: allSignals.filter((s) => s.verdict === 'REDUZIR').length,
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-xl h-28 sm:h-36 lg:h-[180px]">
        <img src="/assets/signals-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover hero-pulse-glow" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/90 via-dark-bg/40 to-dark-bg/20" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 lg:p-5">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text-primary">Sinais</h1>
          <p className="text-dark-text-dim text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">
            6 estrategias · 3 horizontes · {counts.total} sinais
            {data?.generated_at && (
              <span className="ml-2 text-dark-text-dim/60">
                atualizado {fmtTimeAgo(data.generated_at)}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-2">
          <select
            value={timeframeFilter}
            onChange={(e) => setTimeframeFilter(e.target.value)}
            className="bg-dark-bg-card border border-dark-bg-border rounded-lg text-dark-text-primary text-sm px-3 py-1.5 focus:outline-none focus:border-accent-blue/50 transition-colors"
          >
            <option value="all">Todos horizontes</option>
            <option value="long">Longo (6m+)</option>
            <option value="medium">Médio (3-30d)</option>
            <option value="short">Curto (1-3d)</option>
          </select>
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value)}
            className="bg-dark-bg-card border border-dark-bg-border rounded-lg text-dark-text-primary text-sm px-3 py-1.5 focus:outline-none focus:border-accent-blue/50 transition-colors"
          >
            <option value="all">Todos vereditos</option>
            <option value="COMPRAR">Comprar ({counts.comprar})</option>
            <option value="AGUARDAR">Aguardar ({counts.aguardar})</option>
            <option value="VENDER">Vender ({counts.vender})</option>
            <option value="REDUZIR">Reduzir ({counts.reduzir})</option>
          </select>
          <button
            onClick={reload}
            className="px-3 py-1.5 text-sm bg-dark-bg-card border border-dark-bg-border rounded-lg text-dark-text-muted hover:text-dark-text-primary hover:border-dark-text-dim transition-colors"
          >
            Atualizar
          </button>
        </div>

      {/* Quick stats bar */}
      <div className="flex gap-3 flex-wrap">
        <div className="card px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-green shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
          <span className="text-dark-text-secondary text-xs font-medium">{counts.comprar} Comprar</span>
        </div>
        <div className="card px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-yellow shadow-[0_0_6px_rgba(234,179,8,0.4)]" />
          <span className="text-dark-text-secondary text-xs font-medium">{counts.reduzir} Reduzir</span>
        </div>
        <div className="card px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent-red shadow-[0_0_6px_rgba(239,68,68,0.4)]" />
          <span className="text-dark-text-secondary text-xs font-medium">{counts.vender} Vender</span>
        </div>
        <div className="card px-3 py-1.5 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-dark-bg-border" />
          <span className="text-dark-text-muted text-xs">{counts.aguardar} Aguardar</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">
          Erro ao carregar sinais: {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && !error && (
        <div className="card p-8 text-center">
          <div className="text-dark-text-dim text-sm">Nenhum sinal encontrado com os filtros atuais.</div>
        </div>
      )}

      {/* Signals grid by timeframe */}
      {!loading && timeframeOrder.map((tf) => {
        const signals = grouped[tf]
        if (!signals || signals.length === 0) return null
        return (
          <div key={tf} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-dark-text-primary font-semibold text-base">
                {TIMEFRAME_LABELS[tf]}
              </h2>
              <span className="text-dark-text-dim text-xs">{TIMEFRAME_DESC[tf]}</span>
              <span className="text-dark-text-dim text-xs">{signals.length} sinais</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {signals.map((s) => (
                <SignalCard key={s.signal_id} signal={s} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
