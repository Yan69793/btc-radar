import { useState, useEffect, useCallback } from 'react'
import { SkeletonCard } from '../components/Skeleton'
import { PageHeader } from '../components/PageHeader'
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
      <PageHeader
        eyebrow="Analise"
        title="Briefing diario"
        poster="/assets/film-pulso.png"
        meta={
          <>
            Gerado por IA a partir dos dados coletados
            {briefings.length > 0 && (
              <span className="ml-2">
                {briefings.length} edicao{briefings.length !== 1 ? 'es' : ''}
              </span>
            )}
          </>
        }
        actions={
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-md bg-accent-blue px-3.5 py-2 text-sm font-medium text-dark-bg transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {generating ? 'Gerando...' : 'Gerar agora'}
          </button>
        }
      />

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
