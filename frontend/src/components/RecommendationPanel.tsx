import { useApi } from '../hooks/useApi'
import { fmtPrice } from '../lib/formatters'

interface SignalDoc {
  signal_id: string
  timeframe: 'short' | 'medium' | 'long'
  verdict: 'COMPRAR' | 'AGUARDAR' | 'VENDER' | 'REDUZIR'
  conviction: number
  strategy: string
  payload: { rationale: string; technical_indicators: Record<string, number> }
}

interface SignalsResponse {
  signals: SignalDoc[]
  generated_at: string
}

interface TimeframeVerdict {
  timeframe: 'short' | 'medium' | 'long'
  label: string
  description: string
  consensus: 'COMPRAR' | 'VENDER' | 'AGUARDAR' | 'MISTO'
  comprar: number
  vender: number
  aguardar: number
  reduzir: number
  total: number
  avgConviction: number
  topSignal: SignalDoc | null
  topRationale: string
}

const TIMEFRAME_CONFIG: Record<string, { label: string; description: string }> = {
  short: { label: 'Curto Prazo', description: '1 a 3 dias' },
  medium: { label: 'Medio Prazo', description: '3 a 30 dias' },
  long: { label: 'Longo Prazo', description: '6 meses ou mais' },
}

const CONSENSUS_STYLE: Record<string, { bg: string; border: string; text: string; label: string; dot: string }> = {
  COMPRAR: {
    bg: 'bg-accent-green/[0.07]',
    border: 'border-accent-green/30',
    text: 'text-accent-green',
    label: 'COMPRAR',
    dot: 'bg-accent-green',
  },
  VENDER: {
    bg: 'bg-accent-red/[0.07]',
    border: 'border-accent-red/30',
    text: 'text-accent-red',
    label: 'VENDER',
    dot: 'bg-accent-red',
  },
  AGUARDAR: {
    bg: 'bg-dark-bg-card',
    border: 'border-dark-bg-border',
    text: 'text-dark-text-muted',
    label: 'AGUARDAR',
    dot: 'bg-dark-text-dim',
  },
  MISTO: {
    bg: 'bg-accent-yellow/[0.05]',
    border: 'border-accent-yellow/25',
    text: 'text-accent-yellow',
    label: 'DIVERGENTE',
    dot: 'bg-accent-yellow',
  },
}

function aggregateTimeframe(signals: SignalDoc[], timeframe: string): TimeframeVerdict {
  const tfSignals = signals.filter((s) => s.timeframe === timeframe)
  const comprar = tfSignals.filter((s) => s.verdict === 'COMPRAR').length
  const vender = tfSignals.filter((s) => s.verdict === 'VENDER').length
  const aguardar = tfSignals.filter((s) => s.verdict === 'AGUARDAR').length
  const reduzir = tfSignals.filter((s) => s.verdict === 'REDUZIR').length
  const total = tfSignals.length
  const avgConviction = total > 0 ? tfSignals.reduce((sum, s) => sum + s.conviction, 0) / total : 0

  let consensus: TimeframeVerdict['consensus'] = 'AGUARDAR'
  const majority = Math.floor(total / 2) + 1
  if (total === 0) {
    consensus = 'AGUARDAR'
  } else if (comprar >= majority) {
    consensus = 'COMPRAR'
  } else if (vender + reduzir >= majority) {
    consensus = 'VENDER'
  } else if (comprar > 0 && (vender > 0 || reduzir > 0)) {
    consensus = 'MISTO'
  } else if (comprar > 0 && comprar + aguardar === total) {
    consensus = 'MISTO'
  }

  // Top signal by conviction among actionable ones
  const actionable = tfSignals.filter((s) => s.verdict === 'COMPRAR' || s.verdict === 'VENDER')
  const topSignal = actionable.length > 0
    ? actionable.reduce((a, b) => a.conviction > b.conviction ? a : b)
    : tfSignals.length > 0
      ? tfSignals.reduce((a, b) => a.conviction > b.conviction ? a : b)
      : null

  const config = TIMEFRAME_CONFIG[timeframe] ?? { label: timeframe, description: '' }

  return {
    timeframe: timeframe as TimeframeVerdict['timeframe'],
    label: config.label,
    description: config.description,
    consensus,
    comprar,
    vender,
    aguardar,
    reduzir,
    total,
    avgConviction,
    topSignal,
    topRationale: topSignal?.payload?.rationale ?? 'Nenhum sinal disponivel',
  }
}

function TimeframeCard({ tf }: { tf: TimeframeVerdict }) {
  const style = CONSENSUS_STYLE[tf.consensus]!

  return (
    <div className={`card overflow-hidden transition-colors duration-150 ${style.border} hover:border-opacity-60`}>
      {/* Top strip */}
      <div className={`px-4 py-3 ${style.bg} border-b ${style.border}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-dark-text-primary font-semibold text-sm">{tf.label}</div>
            <div className="text-dark-text-dim text-[11px] mt-0.5">{tf.description}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${style.dot} ${tf.consensus === 'COMPRAR' || tf.consensus === 'VENDER' ? 'animate-pulse' : ''}`} />
            <span className={`text-sm font-bold ${style.text}`}>{style.label}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Strategy breakdown pills */}
        {tf.total > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            {tf.comprar > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-green/10 text-accent-green border border-accent-green/20 font-medium">
                {tf.comprar} Comprar
              </span>
            )}
            {tf.vender > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-red/10 text-accent-red border border-accent-red/20 font-medium">
                {tf.vender} Vender
              </span>
            )}
            {tf.reduzir > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20 font-medium">
                {tf.reduzir} Reduzir
              </span>
            )}
            {tf.aguardar > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-bg-hover text-dark-text-dim border border-dark-bg-border font-medium">
                {tf.aguardar} Aguardar
              </span>
            )}
            <span className="text-dark-text-dim text-[10px] ml-auto">{tf.total} estrategias</span>
          </div>
        ) : (
          <div className="text-dark-text-dim text-xs italic">Nenhum sinal gerado para este horizonte</div>
        )}

        {/* Conviction bar */}
        {tf.total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-dark-text-dim text-[10px] tracking-wide uppercase">Conviccao media</span>
              <span className="text-dark-text-muted text-[10px] font-mono">{tf.avgConviction.toFixed(1)}/10</span>
            </div>
            <div className="h-1.5 bg-dark-bg rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  tf.avgConviction >= 7 ? 'bg-accent-green' :
                  tf.avgConviction >= 4 ? 'bg-accent-yellow' :
                  'bg-dark-text-dim'
                }`}
                style={{ width: `${tf.avgConviction * 10}%` }}
              />
            </div>
          </div>
        )}

        {/* Rationale snippet */}
        {tf.topRationale && (
          <p className="text-dark-text-dim text-xs leading-relaxed line-clamp-2">
            {tf.topRationale}
          </p>
        )}
      </div>
    </div>
  )
}

export function RecommendationPanel() {
  const { data, loading, error } = useApi<SignalsResponse>('/api/signals', 300_000)

  if (error) {
    return (
      <div className="card p-4 border-red-500/20 text-red-400/60 text-xs">
        Sinais indisponiveis: {error}
      </div>
    )
  }

  const signals = data?.signals ?? []
  const timeframes = [
    aggregateTimeframe(signals, 'short'),
    aggregateTimeframe(signals, 'medium'),
    aggregateTimeframe(signals, 'long'),
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-6 shimmer-loading" style={{ height: '180px' }} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-dark-text-primary font-semibold text-base">Recomendacao de Trading</h2>
        {data?.generated_at && (
          <span className="text-dark-text-dim text-[11px]">
            atualizado {new Date(data.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {timeframes.map((tf) => (
          <TimeframeCard key={tf.timeframe} tf={tf} />
        ))}
      </div>
    </div>
  )
}
