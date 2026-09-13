import { useApi } from '../hooks/useApi'
import { PriceHeader } from '../components/PriceHeader'
import { FearGreedMeter } from '../components/FearGreedMeter'
import { NewsFeed } from '../components/NewsFeed'
import { BtcChart } from '../components/BtcChart'
import { SkeletonCard } from '../components/Skeleton'
import { RecommendationPanel } from '../components/RecommendationPanel'
import { PageHeader } from '../components/PageHeader'
import { fmtTimeAgo } from '../lib/formatters'
import type { PriceSnapshot, FearGreedData, NewsItem } from '../types'

export function Dashboard() {
  const { data: price, loading: priceLoading, error: priceError } = useApi<PriceSnapshot>(
    '/api/price/latest',
    30_000
  )
  const { data: fearGreed, loading: fgLoading, error: fgError } = useApi<FearGreedData>(
    '/api/sentiment/fear-greed',
    120_000
  )
  const { data: news, loading: newsLoading, error: newsError } = useApi<NewsItem[]>(
    '/api/news',
    120_000
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Mercado"
        title="Dashboard"
        poster="/assets/film-pulso.png"
        clip="/assets/film-pulso.mp4"
        meta={
          <>
            Bitcoin
            {price?.timestamp && <span className="ml-2">dado de {fmtTimeAgo(price.timestamp)}</span>}
          </>
        }
      />

      {/* Recomendacao de trading por horizonte */}
      <RecommendationPanel />

      {/* Preco e metricas de mercado */}
      <section className="space-y-6">
        {priceLoading ? <SkeletonCard /> : price ? <PriceHeader data={price} /> : null}
        {priceError && (
          <div className="card border-accent-red/30 p-4 text-sm text-accent-red">
            Erro ao carregar preco: {priceError}
          </div>
        )}
      </section>

      {/* Grid: grafico + sentimento + noticias */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-[320px] sm:h-[400px] lg:col-span-2 lg:h-[500px]">
          <BtcChart />
        </div>

        <div className="space-y-6">
          {fgLoading ? <SkeletonCard /> : fearGreed ? <FearGreedMeter data={fearGreed} /> : null}
          {fgError && !fearGreed && (
            <div className="card p-3 text-xs text-dark-text-dim">Fear &amp; Greed indisponivel</div>
          )}

          {newsLoading ? <SkeletonCard /> : news ? <NewsFeed items={news} /> : null}
          {newsError && !news && (
            <div className="card p-3 text-xs text-dark-text-dim">Noticias indisponiveis</div>
          )}
        </div>
      </section>
    </div>
  )
}
