import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { SkeletonCard } from './Skeleton'
import { fmtPrice, fmtPriceDetail } from '../lib/formatters'
import type { OHLCV } from '../types'

// Gráfico do painel em duas camadas:
//
// 1. Widget oficial do TradingView (external embedding, embed-widget-advanced-chart)
//    como fonte primária — candles, ferramentas de desenho e timeframes reais.
// 2. Histórico nativo da API (/api/price/history) como rede de segurança: o
//    widget era dispensado antes porque adblockers (Brave Shields) e CSP
//    bloqueiam s3.tradingview.com. Se o script não carregar, o painel mostra o
//    gráfico da própria API em vez de um card vazio.
const API_BASE = import.meta.env.VITE_API_URL || ''
const TRADINGVIEW_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
const TRADINGVIEW_SETTLE_MS = 1500
const TRADINGVIEW_TIMEOUT_MS = 9000

const UP = '#3fb950'
const DOWN = '#f85149'

interface TradingViewConfig {
  autosize: boolean
  symbol: string
  interval: string
  timezone: string
  theme: 'dark' | 'light'
  style: string
  locale: string
  enable_publishing: boolean
  allow_symbol_change: boolean
  hide_top_toolbar: boolean
  hide_legend: boolean
  save_image: boolean
  calendar: boolean
  hide_volume: boolean
  support_host: string
  withdateranges: boolean
  details: boolean
  backgroundColor: string
  gridLineColor: string
  fontColor: string
  toolbar_bg: string
}

// Config do widget. `container_id` não entra: no external embedding o script lê
// o próprio conteúdo da tag <script> e injeta o iframe no elemento pai.
const TRADINGVIEW_CONFIG: TradingViewConfig = {
  autosize: true,
  symbol: 'COINBASE:BTCUSD',
  interval: 'D',
  timezone: 'Etc/UTC',
  theme: 'dark',
  style: '1',
  locale: 'br',
  enable_publishing: false,
  allow_symbol_change: false,
  hide_top_toolbar: false,
  hide_legend: false,
  save_image: false,
  calendar: false,
  hide_volume: false,
  support_host: 'https://www.tradingview.com',
  withdateranges: true,
  details: false,
  // Sincroniza o widget com o near-black do painel em vez do cinza padrão.
  backgroundColor: 'rgba(5, 10, 14, 1)',
  gridLineColor: 'rgba(72, 122, 140, 0.16)',
  fontColor: '#8b98a3',
  toolbar_bg: 'rgba(4, 10, 14, 1)',
}

interface Point {
  t: string
  label: string
  close: number
  open: number
  high: number
  low: number
}

async function fetchHistory(path: string): Promise<OHLCV[]> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  const json = await res.json()
  if (json?.success === false || !Array.isArray(json?.data)) {
    throw new Error(json?.error || 'resposta inválida')
  }
  return json.data as OHLCV[]
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <div className="rounded-lg border border-dark-bg-border bg-dark-bg-elevated px-3 py-2 text-xs shadow-xl">
      <div className="text-dark-text-muted mb-1">{p.label}</div>
      <div className="text-dark-text-primary font-semibold font-mono">{fmtPriceDetail(p.close)}</div>
      <div className="text-dark-text-dim font-mono mt-0.5">
        {fmtPrice(p.high)} / {fmtPrice(p.low)}
      </div>
    </div>
  )
}

/** Widget oficial do TradingView. Chama onUnavailable quando o script é
 *  bloqueado (adblock/CSP) ou não monta o iframe a tempo. */
function TradingViewWidget({ onUnavailable }: { onUnavailable: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    const fail = () => {
      if (!cancelled) onUnavailable()
    }

    // O widget é montado uma única vez por host. O StrictMode do React roda o
    // efeito duas vezes em dev: recriar o container destruía o iframe que o
    // script do TradingView ainda estava inicializando ("contentWindow is not
    // available"), então a montagem é idempotente e a limpeza não mexe no DOM.
    let container = host.querySelector<HTMLDivElement>('.tradingview-widget-container')
    if (!container) {
      container = document.createElement('div')
      container.className = 'tradingview-widget-container'
      const widget = document.createElement('div')
      widget.className = 'tradingview-widget-container__widget'
      container.append(widget)

      const script = document.createElement('script')
      script.type = 'text/javascript'
      script.src = TRADINGVIEW_SCRIPT
      script.async = true
      // O external embedding lê a configuração do texto da própria tag.
      script.text = JSON.stringify(TRADINGVIEW_CONFIG)
      script.addEventListener('error', fail)
      script.addEventListener('load', () => {
        window.setTimeout(() => {
          if (!host.querySelector('iframe')) fail()
        }, TRADINGVIEW_SETTLE_MS)
      })
      container.append(script)
      host.append(container)
    }

    const timeout = window.setTimeout(() => {
      if (!host.querySelector('iframe')) fail()
    }, TRADINGVIEW_TIMEOUT_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [onUnavailable])

  return <div className="btc-tv-host" ref={hostRef} />
}

/** Histórico nativo da API: fallback do widget e retrato de 90 dias do mercado. */
function LocalHistoryChart() {
  const [data, setData] = useState<Point[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setError(null)
      // 90 dias diários; se falhar (502 transitório OKX+CP), tenta 48h em 1h
      const paths = ['/api/price/history?interval=1d&limit=90', '/api/price/history?interval=1h&limit=48']
      let lastErr = 'indisponível'
      for (const path of paths) {
        try {
          const bars = await fetchHistory(path)
          if (cancelled) return
          if (bars.length > 0) {
            setData(
              bars.map((b) => ({
                t: b.timestamp,
                label: new Date(b.timestamp).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                }),
                close: b.close,
                open: b.open,
                high: b.high,
                low: b.low,
              }))
            )
            return
          }
        } catch (err) {
          if (controller.signal.aborted) return
          lastErr = err instanceof Error ? err.message : 'erro'
        }
      }
      if (!cancelled) {
        setData(null)
        setError(lastErr)
      }
    }

    load()
    const timer = setInterval(load, 300_000)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [attempt])

  if (error && !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-dark-text-muted">
        <span>Histórico indisponível ({error})</span>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  if (!data) return <SkeletonCard />

  const first = data[0]
  const last = data[data.length - 1]
  if (!first || !last) return <SkeletonCard />
  const up = last.close >= first.close
  const color = up ? UP : DOWN
  const min = Math.min(...data.map((d) => d.low))
  const max = Math.max(...data.map((d) => d.high))
  const pad = (max - min) * 0.08 || 1

  return (
    <>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="btcFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1e2d4a" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#7c8aa5', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              orientation="right"
              tick={{ fill: '#7c8aa5', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="close"
              stroke={color}
              strokeWidth={2}
              fill="url(#btcFill)"
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 font-mono text-[10px] text-dark-text-dim">
        90 dias · {last.label} · histórico da API
      </div>
    </>
  )
}

export function BtcChart() {
  const [widgetUnavailable, setWidgetUnavailable] = useState(false)
  const handleUnavailable = useCallback(() => setWidgetUnavailable(true), [])

  return (
    <div className="card p-3 sm:p-5 h-full flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-dark-text-primary font-semibold text-sm">
          {widgetUnavailable ? 'BTC/USD Chart' : 'BTC/USD · TradingView'}
        </h3>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-dark-text-dim sm:inline">
            {widgetUnavailable ? '90 dias · histórico da API' : 'COINBASE:BTCUSD · tempo real'}
          </span>
          <a
            className="btc-tradingview-link"
            href="https://www.tradingview.com/chart/?symbol=COINBASE%3ABTCUSD"
            target="_blank"
            rel="noreferrer"
          >
            TradingView ↗
          </a>
        </div>
      </div>
      {widgetUnavailable ? <LocalHistoryChart /> : <TradingViewWidget onUnavailable={handleUnavailable} />}
    </div>
  )
}
