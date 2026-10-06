import type { FearGreedData } from '../types'

interface Props {
  data: FearGreedData
}

// Semântico por faixa de sentimento. A cor comunica o estado; sem brilho, que
// em dark vira ruído. Os tons são os do mercado (vermelho medo, verde ganância).
const colorMap: Record<string, { bar: string; text: string }> = {
  'Extreme Fear': { bar: '#f85149', text: 'text-accent-red' },
  'Fear': { bar: '#d29922', text: 'text-accent-orange' },
  'Neutral': { bar: '#8a8f98', text: 'text-dark-text-muted' },
  'Greed': { bar: '#3fb950', text: 'text-accent-green' },
  'Extreme Greed': { bar: '#2ea043', text: 'text-accent-green-soft' },
}

const emojiMap: Record<string, string> = {
  'Extreme Fear': 'Extreme Fear',
  'Fear': 'Fear',
  'Neutral': 'Neutral',
  'Greed': 'Greed',
  'Extreme Greed': 'Extreme Greed',
}

export function FearGreedMeter({ data }: Props) {
  const colors = colorMap[data.classification] ?? colorMap['Neutral']!

  return (
    <div className="card p-4 sm:p-5 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-dark-text-primary font-semibold text-sm">Fear & Greed Index</h3>
        <span className="text-dark-text-dim text-[11px] tracking-wide uppercase">Alternative.me</span>
      </div>

      {/* Value + Classification */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className={`text-3xl sm:text-4xl font-bold font-mono tabular-nums ${colors.text}`}>
          {data.value}
        </span>
        <div>
          <span className={`text-sm font-semibold ${colors.text} block`}>
            {data.classification}
          </span>
          <span className="text-dark-text-dim text-xs">índice 0-100</span>
        </div>
      </div>

      {/* Gauge bar */}
      <div className="relative mb-2">
        <div className="w-full h-2.5 bg-dark-bg rounded-full overflow-hidden">
          {/* Gradient background: red -> orange -> yellow -> green */}
          <div
            className="absolute inset-0 rounded-full opacity-20"
            style={{
              background: 'linear-gradient(90deg, #f85149 0%, #d29922 50%, #3fb950 100%)',
            }}
          />
          {/* Active bar */}
          <div
            className="relative h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.max(data.value, 3)}%`,
              backgroundColor: colors.bar,
              boxShadow: `0 0 10px ${colors.bar}40`,
            }}
          />
        </div>

        {/* Pointer */}
        <div
          className="absolute top-full mt-1 transition-all duration-700 ease-out"
          style={{ left: `${Math.min(Math.max(data.value, 2), 98)}%`, transform: 'translateX(-50%)' }}
        >
          <div
            className="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[6px] border-l-transparent border-r-transparent"
            style={{ borderBottomColor: colors.bar }}
          />
        </div>
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-3 text-[10px] tracking-wide text-dark-text-dim">
        <span>0 Extreme Fear</span>
        <span>50 Neutral</span>
        <span>100 Extreme Greed</span>
      </div>
    </div>
  )
}
