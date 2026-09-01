import { fmtPrice, fmtPct, pctColor, fmtCompact, fmtTimeAgo } from '../lib/formatters'
import type { PriceSnapshot } from '../types'

interface Props {
  data: PriceSnapshot
}

export function PriceHeader({ data }: Props) {
  const changeColor = pctColor(data.change_24h)
  const isPositive = data.change_24h > 0

  return (
    <div className="card p-4 sm:p-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-8">
        {/* Left: Identity + Price */}
        <div className="shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #f7931a 0%, #e87d0e 100%)',
                boxShadow: '0 4px 16px rgba(247, 147, 26, 0.3)',
              }}
            >
              <span className="text-black font-bold text-lg">B</span>
            </div>
            <div>
              <h2 className="text-dark-text-primary font-semibold text-lg leading-tight">Bitcoin</h2>
              <span className="text-dark-text-dim text-[13px]">BTC/USD</span>
            </div>
          </div>

          {/* Price line */}
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl sm:text-4xl font-bold font-mono text-dark-text-primary tabular-nums tracking-tight">
              {fmtPrice(data.price)}
            </span>
            <span className={`text-lg font-semibold tabular-nums ${changeColor}`}>
              {fmtPct(data.change_24h)}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isPositive ? 'bg-accent-green' : 'bg-accent-red'}`} />
            <span className="text-dark-text-dim text-xs">
              Atualizado {fmtTimeAgo(data.timestamp)}
            </span>
          </div>
        </div>

        {/* Right: Stats grid */}
        <div className="grid grid-cols-2 gap-x-4 sm:gap-x-8 gap-y-3 text-left sm:text-right">
          <StatItem label="Market Cap" value={`$${fmtCompact(data.market_cap)}`} />
          <StatItem label="Dominância" value={`${data.btc_dominance.toFixed(1)}%`} />
          <StatItem label="Volume 24h" value={`$${fmtCompact(data.volume_24h)}`} />
          <StatItem
            label="Variação 24h"
            value={fmtPct(data.change_24h)}
            highlight={data.change_24h >= 0 ? 'positive' : 'negative'}
          />
        </div>
      </div>
    </div>
  )
}

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: 'positive' | 'negative'
}) {
  return (
    <div>
      <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-0.5">{label}</div>
      <div
        className={`text-sm font-mono font-medium tabular-nums ${
          highlight === 'positive'
            ? 'text-accent-green'
            : highlight === 'negative'
              ? 'text-accent-red'
              : 'text-dark-text-primary'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
