import { NavLink } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
import { fmtPct, fmtPrice, pctColor } from '../../lib/formatters'
import type { PriceSnapshot } from '../../types'

const nav = [
  { to: '/', label: 'Visão Geral' },
  { to: '/signals', label: 'Sinais' },
  { to: '/briefing', label: 'Briefing' },
  { to: '/backtest', label: 'Backtest' },
  { to: '/onchain', label: 'On-Chain' },
  { to: '/portfolio', label: 'Portfólio' },
  { to: '/alerts', label: 'Alertas' },
  { to: '/trades', label: 'Trades' },
]

export function PlatformHeader() {
  const { data: price } = useApi<PriceSnapshot>('/api/price/latest', 30_000)

  return (
    <header className="btc-platform-header">
      <div className="btc-platform-header-main">
        <NavLink to="/" className="btc-platform-brand" aria-label="Aureus — Visão Geral">
          <span className="btc-platform-mark">₿</span>
          <span className="btc-platform-wordmark">
            <strong>AUREUS</strong>
            <small>market intelligence</small>
          </span>
        </NavLink>

        <nav className="btc-platform-nav" aria-label="Navegação principal">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `btc-platform-nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="btc-platform-actions">
          <NavLink to="/settings" className="btc-platform-icon-button" aria-label="Configurações">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
          </NavLink>
        </div>
      </div>

      <div className="btc-platform-marketbar" aria-label="Mercado ao vivo">
        <span className="btc-platform-live"><i /> AO VIVO</span>
        <div className="btc-platform-marketitem">
          <span>BTC / USD</span>
          <strong>{price ? fmtPrice(price.price) : '—'}</strong>
          <em className={price ? pctColor(price.change_24h) : ''}>{price ? fmtPct(price.change_24h) : '—'}</em>
        </div>
        {price && (
          <>
            <div className="btc-platform-marketitem hide-mobile">
              <span>MARKET CAP</span>
              <strong>${(price.market_cap / 1e12).toFixed(2)}T</strong>
            </div>
            <div className="btc-platform-marketitem hide-tablet">
              <span>DOMINÂNCIA</span>
              <strong>{price.btc_dominance.toFixed(1)}%</strong>
            </div>
            <div className="btc-platform-marketitem hide-tablet">
              <span>VOLUME 24H</span>
              <strong>${(price.volume_24h / 1e9).toFixed(1)}B</strong>
            </div>
          </>
        )}
        <span className="btc-platform-source">OKX · Alternative.me · Multi Assets</span>
      </div>
    </header>
  )
}
