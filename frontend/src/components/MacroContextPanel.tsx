import { useEffect, useMemo, useState } from 'react'

interface SourceHealth {
  name: string
  state?: string
  observed_at?: string | null
  age_s?: number | null
  error?: string | null
}

interface MacroContextPayload {
  ok?: boolean
  generated_at?: string
  quality?: {
    score?: number
    state?: string
    issues?: string[]
  }
  sources?: SourceHealth[]
  data?: {
    features?: {
      selic_target_pct?: number | null
      usdbrl_ptax?: number | null
      treasury10y_pct?: number | null
    }
    market?: {
      sp500?: { value?: number | null; change_pct?: number | null }
      ibov?: { value?: number | null; change_pct?: number | null }
      ibovespa?: { value?: number | null; change_pct?: number | null }
      wti?: { value?: number | null; change_pct?: number | null }
    }
  }
}

function fmtNumber(value: number | null | undefined, digits = 2) {
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : 'n/d'
}

function fmtPct(value: number | null | undefined, digits = 2) {
  if (!Number.isFinite(Number(value))) return 'n/d'
  const n = Number(value)
  return `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`
}

function stateTone(state?: string) {
  if (state === 'fresh' || state === 'good') return 'text-accent-green'
  if (state === 'stale' || state === 'degraded') return 'text-accent-orange'
  if (state === 'missing' || state === 'expired' || state === 'poor') return 'text-accent-red'
  return 'text-dark-text-dim'
}

function qualityLabel(state?: string) {
  if (state === 'good') return 'boa'
  if (state === 'degraded') return 'atenção'
  if (state === 'poor') return 'ruim'
  return state || 'n/d'
}

export function MacroContextPanel() {
  const [payload, setPayload] = useState<MacroContextPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${baseUrl}/api/macro-context`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const json = (await res.json()) as MacroContextPayload
        if (!cancelled) {
          setPayload(json)
          setError(null)
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Contexto macro indisponível')
        }
      }
    }

    load()
    const timer = window.setInterval(load, 300_000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  const sourceSummary = useMemo(() => {
    const sources = payload?.sources ?? []
    const fresh = sources.filter((s) => s.state === 'fresh').length
    const attention = sources.length - fresh
    return { total: sources.length, fresh, attention }
  }, [payload])

  const features = payload?.data?.features
  const market = payload?.data?.market
  const quality = payload?.quality
  const ibovespa = market?.ibov ?? market?.ibovespa

  const rows = [
    { label: 'Selic', value: features?.selic_target_pct == null ? 'n/d' : `${fmtNumber(features.selic_target_pct)}%`, change: null },
    { label: 'PTAX', value: features?.usdbrl_ptax == null ? 'n/d' : fmtNumber(features.usdbrl_ptax, 4), change: null },
    { label: 'Treasury 10Y', value: features?.treasury10y_pct == null ? 'n/d' : `${fmtNumber(features.treasury10y_pct)}%`, change: null },
    { label: 'S&P 500', value: market?.sp500?.value == null ? 'n/d' : fmtNumber(market.sp500.value, 0), change: market?.sp500?.change_pct },
    { label: 'Ibovespa', value: ibovespa?.value == null ? 'n/d' : fmtNumber(ibovespa.value, 0), change: ibovespa?.change_pct },
    { label: 'WTI', value: market?.wti?.value == null ? 'n/d' : `$${fmtNumber(market.wti.value)}`, change: market?.wti?.change_pct },
  ]

  return (
    <section
      aria-labelledby="macro-context-title"
      className="border-y border-dark-bg-border py-4"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">Multi Assets</div>
          <h2 id="macro-context-title" className="mt-1 text-lg font-semibold text-dark-text-primary">
            Contexto macro
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dark-text-dim">
          {quality && (
            <span className={stateTone(quality.state)}>
              Qualidade {quality.score ?? '—'} · {qualityLabel(quality.state)}
            </span>
          )}
          {sourceSummary.total > 0 && (
            <span>
              {sourceSummary.fresh}/{sourceSummary.total} fontes frescas
              {sourceSummary.attention > 0 ? ` · ${sourceSummary.attention} requer atenção` : ''}
            </span>
          )}
          <a
            href="https://multi-assets.com/#mercado"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue underline decoration-accent-blue/40 underline-offset-4 hover:decoration-accent-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue"
          >
            Ver contexto completo ↗
          </a>
        </div>
      </div>

      {error && !payload ? (
        <p className="text-xs text-dark-text-dim">
          Contexto macro temporariamente indisponível. O painel BTC continua operacional.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 border-t border-dark-bg-border sm:grid-cols-3 xl:grid-cols-6">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={[
                  'min-w-0 py-3',
                  index % 2 === 0 ? 'pr-3' : 'pl-3',
                  index >= 2 ? 'border-t border-dark-bg-border sm:border-t-0' : '',
                  index >= 3 ? 'sm:border-t sm:border-dark-bg-border xl:border-t-0' : '',
                  index > 0 ? 'sm:px-3 sm:border-l sm:border-dark-bg-border' : 'sm:pr-3',
                ].join(' ')}
              >
                <div className="text-[10px] uppercase tracking-[0.12em] text-dark-text-muted">
                  {row.label}
                </div>
                <div className="metric mt-1 text-sm font-medium text-dark-text-primary">
                  {row.value}
                </div>
                {row.change != null && (
                  <div className={`metric mt-1 text-[10px] ${Number(row.change) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {fmtPct(row.change)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {(quality?.issues?.length ?? 0) > 0 && (
            <p className="mt-2 text-[10px] text-dark-text-dim">
              Atenção: {quality?.issues?.join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
