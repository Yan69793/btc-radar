import { useEffect, useState } from 'react'
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

// Gráfico nativo (recharts) sobre /api/price/history. Substitui o widget
// TradingView, que era bloqueado por adblockers (Brave Shields) e exigia
// exceção no CSP. Zero dependência externa: funciona offline de terceiros.
const API_BASE = import.meta.env.VITE_API_URL || ''

const UP = '#3fb950'
const DOWN = '#f85149'

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

export function BtcChart() {
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
      <div className="card p-3 sm:p-5 h-full flex flex-col">
        <h3 className="text-dark-text-primary font-semibold text-sm mb-3">BTC/USD Chart</h3>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-dark-text-muted">
          <span>Histórico indisponível ({error})</span>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            Tentar de novo
          </button>
        </div>
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
    <div className="card p-3 sm:p-5 h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-dark-text-primary font-semibold text-sm">BTC/USD Chart</h3>
        <span className="text-dark-text-dim text-xs">90 dias · {last.label}</span>
      </div>
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
    </div>
  )
}
