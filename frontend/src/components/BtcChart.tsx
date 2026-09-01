import { useEffect, useRef } from 'react'

// TradingView widget — usa o script oficial, sem dependência npm
declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => unknown
    }
  }
}

export function BtcChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current || !containerRef.current) return
    initialized.current = true

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.async = true
    script.onload = () => {
      if (window.TradingView && containerRef.current) {
        new window.TradingView.widget({
          container_id: 'tv-chart-container',
          symbol: 'BITSTAMP:BTCUSD',
          interval: 'D',
          theme: 'dark',
          style: '1', // candles
          locale: 'en',
          toolbar_bg: '#1e293b',
          enable_publishing: false,
          // Toolbar lateral rouba largura util em telas estreitas (mobile/iPad retrato)
          hide_side_toolbar: window.matchMedia('(max-width: 1023px)').matches,
          allow_symbol_change: true,
          studies: [
            'MASimple@tv-basicstudies',
            'RSI@tv-basicstudies',
            'MACD@tv-basicstudies',
          ],
          width: '100%',
          height: '100%',
        })
      }
    }
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [])

  return (
    <div className="card p-3 sm:p-5 h-full flex flex-col">
      <h3 className="text-dark-text-primary font-semibold text-sm mb-3">BTC/USD Chart</h3>
      <div className="flex-1 min-h-0">
        <div id="tv-chart-container" ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  )
}
