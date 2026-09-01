import { useState, useEffect, useCallback } from 'react'
import { SkeletonCard } from '../components/Skeleton'
import { fmtDateTime } from '../lib/formatters'
import { apiSend } from '../lib/api'

interface BriefingItem {
  id: number
  date: string
  generated_at: string
  model: string
  prompt_version?: string
  summary: string
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
  source?: string
}

function BriefingCard({ briefing, isLatest }: { briefing: BriefingItem; isLatest?: boolean }) {
  const [expanded, setExpanded] = useState(isLatest ?? false)

  const paragraphs = briefing.summary
    .split(/\n\n+/)
    .filter((p) => p.trim().length > 0)

  const dateFormatted = new Date(briefing.date + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className={`card overflow-hidden transition-colors duration-200 ${
      isLatest ? 'border-accent-blue/30 bg-accent-blue/[0.02]' : 'hover:border-dark-text-dim'
    }`}>
      <div
        className="px-5 py-4 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div>
            <div className="text-dark-text-primary font-medium text-sm capitalize">
              {dateFormatted}
            </div>
            <div className="text-dark-text-dim text-xs mt-0.5">
              Gerado {fmtDateTime(briefing.generated_at)}
              {briefing.model && (
                <span className="ml-2 opacity-60">{briefing.model.split('/').pop()}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLatest && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue font-medium">
              HOJE
            </span>
          )}
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`text-dark-text-dim transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-dark-bg-border pt-4">
          <div className="prose prose-invert prose-sm max-w-none text-dark-text-secondary leading-relaxed space-y-3">
            {paragraphs.map((p, i) => (
              <p key={i}>{p.trim()}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Briefing() {
  const [briefings, setBriefings] = useState<BriefingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateSuccess, setGenerateSuccess] = useState(false)

  const fetchBriefings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/briefing?limit=15`)
      const json: ApiResponse<BriefingItem[]> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao carregar')
      setBriefings(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar briefings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBriefings()
  }, [fetchBriefings])

  async function handleGenerate() {
    setGenerating(true)
    setGenerateError(null)
    setGenerateSuccess(false)
    try {
      const res = await apiSend('/api/briefing/generate', 'POST')
      const json: ApiResponse<BriefingItem> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao gerar')
      setGenerateSuccess(true)
      fetchBriefings()
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Erro ao gerar briefing')
    } finally {
      setGenerating(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const hasToday = briefings.some((b) => b.date === today)

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-fade-in">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-xl h-28 sm:h-36 lg:h-[180px]">
        <img src="/assets/briefing-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover hero-parallax-drift" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/90 via-dark-bg/40 to-dark-bg/20" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 lg:p-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text-primary">Briefing Diario</h1>
            <p className="text-dark-text-dim text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">
              Analise diaria de Bitcoin gerada por IA (OpenRouter DeepSeek V4 Pro)
              {briefings.length > 0 && (
                <span className="ml-2 text-dark-text-dim/60">
                  {briefings.length} edicao{briefings.length !== 1 ? 'es' : ''}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
          >
            {generating ? 'Gerando...' : 'Gerar Agora'}
          </button>
        </div>
      </div>

      {/* Status messages */}
      {generateError && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">{generateError}</div>
      )}
      {generateSuccess && (
        <div className="card p-4 border-accent-green/20 text-accent-green text-sm">
          Briefing gerado com sucesso.
        </div>
      )}

      {/* Info card */}
      {!hasToday && !loading && (
        <div className="card p-5 border-accent-blue/20 bg-accent-blue/[0.02]">
          <div className="flex items-start gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              className="text-accent-blue mt-0.5 shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div className="text-sm">
              <div className="text-dark-text-primary font-medium mb-1">
                Nenhum briefing hoje
              </div>
              <div className="text-dark-text-dim">
                O briefing e gerado automaticamente as 19h (horario de Brasilia).
                Clique em "Gerar Agora" para criar manualmente.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : briefings.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-dark-text-dim text-sm">
            Nenhum briefing gerado ainda.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {briefings.map((b, idx) => (
            <BriefingCard
              key={b.id}
              briefing={b}
              isLatest={idx === 0 && b.date === today}
            />
          ))}
        </div>
      )}
    </div>
  )
}
