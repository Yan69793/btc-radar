import { useApi } from '../../hooks/useApi'
import { fmtPrice, fmtPct, pctColor } from '../../lib/formatters'
import type { PriceSnapshot } from '../../types'

interface Props {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: Props) {
  const { data: price, loading } = useApi<PriceSnapshot>('/api/price/latest', 30_000)

  return (
    <header
      className="h-12 border-b border-dark-bg-border flex items-center px-3 sm:px-4 lg:px-6 bg-dark-bg shrink-0 gap-2 sm:gap-4 lg:gap-6"
      style={{ background: 'linear-gradient(180deg, rgba(19, 27, 46, 0.95) 0%, rgba(11, 17, 32, 0.98) 100%)' }}
    >
      {/* Hamburger (mobile only) */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 -ml-1 rounded-lg text-dark-text-muted hover:text-dark-text-primary hover:bg-white/[0.06] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Abrir menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {loading || !price ? (
        <>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-dark-bg-border animate-pulse" />
            <span className="text-dark-text-dim text-xs sm:text-sm">BTC/USD</span>
          </div>
          <div className="h-4 w-20 sm:w-24 rounded shimmer-loading" />
        </>
      ) : (
        <>
          {/* Pair indicator */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className="relative hidden sm:block">
              <div className="w-2 h-2 rounded-full bg-accent-green" />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-accent-green animate-ping opacity-30" />
            </div>
            <span className="text-dark-text-secondary font-medium text-xs sm:text-sm tracking-wide">BTC/USD</span>
          </div>

          {/* Price */}
          <span className="font-mono text-sm font-semibold text-dark-text-primary tabular-nums shrink-0">
            {fmtPrice(price.price)}
          </span>

          {/* 24h change */}
          <span className={`text-xs sm:text-sm font-semibold tabular-nums shrink-0 ${pctColor(price.change_24h)}`}>
            {fmtPct(price.change_24h)}
          </span>

          {/* Stats: progressively visible */}
          <div className="ml-auto hidden sm:flex gap-3 lg:gap-6">
            <div className="text-dark-text-muted text-[10px] lg:text-[11px] tracking-wide uppercase">
              <span className="hidden lg:inline">Dominancia </span>
              <span className="text-dark-text-secondary font-medium">{price.btc_dominance.toFixed(1)}%</span>
            </div>
            <div className="text-dark-text-muted text-[10px] lg:text-[11px] tracking-wide uppercase hidden md:block">
              <span className="hidden lg:inline">Vol 24h </span>
              <span className="text-dark-text-secondary font-medium">
                ${(price.volume_24h / 1e9).toFixed(1)}B
              </span>
            </div>
            <div className="text-dark-text-muted text-[10px] lg:text-[11px] tracking-wide uppercase hidden lg:block">
              Market Cap{' '}
              <span className="text-dark-text-secondary font-medium">
                ${(price.market_cap / 1e12).toFixed(2)}T
              </span>
            </div>
          </div>
        </>
      )}
    </header>
  )
}
