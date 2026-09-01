import type { BacktestScoreResult, ScoreClassification, ScoreDistribution } from '../types'

// ─── Constantes visuais ───

const CLASSIFICATION_COLORS: Record<ScoreClassification, { bar: string; text: string; bg: string }> = {
  Pessimo:      { bar: '#ef4444', text: 'text-red-400',       bg: 'bg-red-500/10' },
  'Muito Ruim': { bar: '#f97316', text: 'text-orange-400',    bg: 'bg-orange-500/10' },
  Ruim:         { bar: '#eab308', text: 'text-yellow-400',    bg: 'bg-yellow-500/10' },
  Bom:          { bar: '#22c55e', text: 'text-green-400',     bg: 'bg-green-500/10' },
  'Muito Bom':  { bar: '#10b981', text: 'text-emerald-400',   bg: 'bg-emerald-500/10' },
  Excelente:    { bar: '#06b6d4', text: 'text-cyan-400',      bg: 'bg-cyan-500/10' },
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`
}

// ─── Score Gauge ───

interface ScoreGaugeProps {
  scoreData: BacktestScoreResult
  distribution?: ScoreDistribution | null
  compact?: boolean
}

export function ScoreGauge({ scoreData, distribution, compact = false }: ScoreGaugeProps) {
  const { score, classification, classification_percentile, breakdown, gates_passed, gate_failures, compared_against } = scoreData

  if (!gates_passed) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-dark-text-muted text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-500 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="font-medium">Score indisponivel</span>
        </div>
        <ul className="text-dark-text-dim text-xs space-y-0.5 ml-6 list-disc">
          {gate_failures.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </div>
    )
  }

  const colors = CLASSIFICATION_COLORS[classification]

  // Se temos distribuicao, usamos P5 e P95 como range do gauge
  const distMin = distribution ? distribution.p5 : 0
  const distMax = distribution ? distribution.p95 : 100
  const range = distMax - distMin || 1

  // Posicao do score na barra (0-100%)
  const position = Math.max(0, Math.min(100, ((score - distMin) / range) * 100))

  // Posicao dos marcadores de percentil
  const p25pos = distribution ? Math.max(0, Math.min(100, ((distribution.p25 - distMin) / range) * 100)) : 25
  const p50pos = distribution ? Math.max(0, Math.min(100, ((distribution.p50 - distMin) / range) * 100)) : 50
  const p75pos = distribution ? Math.max(0, Math.min(100, ((distribution.p75 - distMin) / range) * 100)) : 75

  const showDistribution = distribution && distribution.count >= 3

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* Mini gauge */}
        <div className="flex-1 h-2 bg-dark-bg rounded-full relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{
              width: `${position}%`,
              backgroundColor: colors.bar,
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-dark-bg shadow-md transition-all duration-500"
            style={{ left: `calc(${position}% - 5px)` }}
          />
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-mono font-bold text-dark-text-primary">{score.toFixed(1)}</div>
          <div className={`text-[10px] font-medium ${colors.text}`}>{classification}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Score number + classification */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-dark-text-dim text-xs uppercase tracking-wide mb-0.5">Backtest Score</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-dark-text-primary">{score.toFixed(1)}</span>
            <span className="text-dark-text-dim text-sm">/100</span>
          </div>
        </div>
        <div className={`text-sm font-semibold px-3 py-1.5 rounded-lg ${colors.bg} ${colors.text}`}>
          {classification}
        </div>
      </div>

      {/* Gauge bar */}
      <div className="space-y-2">
        {/* Gradient bar */}
        <div className="relative h-4 rounded-full overflow-hidden"
          style={{ background: 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #10b981, #06b6d4)' }}
        >
          {/* Position marker (triangle) */}
          <div
            className="absolute top-0 -translate-x-1/2 transition-all duration-500"
            style={{ left: `${position}%` }}
          >
            <svg width="14" height="16" viewBox="0 0 14 16" className="drop-shadow-md">
              <polygon points="7,16 0,0 14,0" fill="white" stroke="#1a1d2e" strokeWidth="1" />
            </svg>
          </div>
        </div>

        {/* Percentile markers */}
        {showDistribution && (
          <div className="relative h-5">
            {/* P5 */}
            <div className="absolute -translate-x-1/2 text-dark-text-dim text-[9px]" style={{ left: '0%' }}>
              <div className="h-2 w-px bg-dark-text-dim/40 mx-auto mb-0.5" />
              <span>P5 {distribution.p5.toFixed(0)}</span>
            </div>
            {/* P25 */}
            <div className="absolute -translate-x-1/2 text-dark-text-dim text-[9px]" style={{ left: `${p25pos}%` }}>
              <div className="h-1.5 w-px bg-dark-text-dim/30 mx-auto mb-0.5" />
              <span>{distribution.p25.toFixed(0)}</span>
            </div>
            {/* P50 */}
            <div className="absolute -translate-x-1/2 text-dark-text-dim text-[9px]" style={{ left: `${p50pos}%` }}>
              <div className="h-1.5 w-px bg-dark-text-dim/30 mx-auto mb-0.5" />
              <span>{distribution.p50.toFixed(0)}</span>
            </div>
            {/* P75 */}
            <div className="absolute -translate-x-1/2 text-dark-text-dim text-[9px]" style={{ left: `${p75pos}%` }}>
              <div className="h-1.5 w-px bg-dark-text-dim/30 mx-auto mb-0.5" />
              <span>{distribution.p75.toFixed(0)}</span>
            </div>
            {/* P95 */}
            <div className="absolute -translate-x-1/2 text-dark-text-dim text-[9px]" style={{ left: '100%' }}>
              <div className="h-2 w-px bg-dark-text-dim/40 mx-auto mb-0.5" />
              <span>P95 {distribution.p95.toFixed(0)}</span>
            </div>
          </div>
        )}

        {/* Classification zones fallback */}
        {!showDistribution && (
          <div className="flex justify-between text-dark-text-dim text-[9px] px-0.5">
            <span>Pessimo</span>
            <span>Ruim</span>
            <span>Bom</span>
            <span>Excelente</span>
          </div>
        )}
      </div>

      {/* Classification percentile info */}
      <div className="flex items-center gap-2 text-dark-text-dim text-xs">
        <span>
          No topo <strong className="text-dark-text-primary">{fmtPct(100 - classification_percentile)}</strong> dos backtests
          {compared_against > 0 && <> (contra {compared_against})</>}
        </span>
      </div>

      {/* Metric breakdown */}
      <div className="space-y-2 pt-1">
        <div className="text-dark-text-muted text-xs font-medium uppercase tracking-wide">Contribuicao por Metrica</div>
        <div className="space-y-1.5">
          {[
            { key: 'ev', label: 'Valor Esperado (EV)', data: breakdown.ev },
            { key: 'return_pct', label: 'Retorno %', data: breakdown.return_pct },
            { key: 'drawdown', label: 'Drawdown (invertido)', data: breakdown.drawdown },
            { key: 'ops_per_day', label: 'Operacoes por Dia', data: breakdown.ops_per_day },
            { key: 'win_rate', label: 'Taxa de Acerto', data: breakdown.win_rate },
          ].map(({ key, label, data }) => (
            <div key={key} className="flex items-center gap-3">
              <div className="w-28 sm:w-36 text-dark-text-dim text-xs truncate" title={label}>{label}</div>
              <div className="flex-1 h-1.5 bg-dark-bg rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${data.percentile}%`,
                    backgroundColor: data.percentile >= 75 ? '#22c55e' : data.percentile >= 50 ? '#eab308' : data.percentile >= 25 ? '#f97316' : '#ef4444',
                  }}
                />
              </div>
              <div className="w-16 text-right text-dark-text-muted text-[11px] font-mono">
                {fmtPct(data.percentile)}
              </div>
              <div className="w-8 text-right text-dark-text-dim text-[11px]" title={`Peso ${data.weight}`}>
                x{data.weight}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Raw values */}
      <div className="grid grid-cols-5 gap-2 pt-1 border-t border-dark-bg-border">
        {[
          { label: 'EV', value: breakdown.ev.raw.toFixed(2) + '%' },
          { label: 'Retorno', value: breakdown.return_pct.raw.toFixed(1) + '%' },
          { label: 'Drawdown', value: breakdown.drawdown.raw.toFixed(1) + '%' },
          { label: 'Ops/Dia', value: breakdown.ops_per_day.raw.toFixed(2) },
          { label: 'Win Rate', value: breakdown.win_rate.raw.toFixed(1) + '%' },
        ].map(({ label, value }) => (
          <div key={label} className="text-center bg-dark-bg rounded-lg p-2">
            <div className="text-dark-text-dim text-[9px] mb-0.5">{label}</div>
            <div className="text-dark-text-primary text-xs font-mono">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
