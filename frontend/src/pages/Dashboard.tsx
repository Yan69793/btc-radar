import { useApi } from '../hooks/useApi'
import { PriceHeader } from '../components/PriceHeader'
import { FearGreedMeter } from '../components/FearGreedMeter'
import { NewsFeed } from '../components/NewsFeed'
import { BtcChart } from '../components/BtcChart'
import { SkeletonCard } from '../components/Skeleton'
import { RecommendationPanel } from '../components/RecommendationPanel'
import { AutoplayVideo } from '../components/AutoplayVideo'
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-xl h-32 sm:h-44 lg:h-[220px]">
        <AutoplayVideo
          src="/assets/dashboard-hero.mp4"
          poster="/assets/dashboard-hero.png"
          className="absolute inset-0 w-full h-full object-cover hero-ken-burns"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/90 via-dark-bg/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark-bg/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 lg:p-6">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text-primary">Dashboard</h1>
          <p className="text-dark-text-dim text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">Bitcoin analytics, trading signals e monitoramento em tempo real</p>
        </div>
      </div>

      {/* Painel de Recomendacao */}
      <RecommendationPanel />

      {/* Preço + Métricas */}
      <div className="relative rounded-xl overflow-hidden">
        <AutoplayVideo
          src="/assets/particles-bg.mp4"
          className="absolute inset-0 w-full h-full object-cover opacity-[0.06] pointer-events-none"
        />
        <div className="relative space-y-6">
          {priceLoading ? <SkeletonCard /> : price ? <PriceHeader data={price} /> : null}
          {priceError && (
            <div className="card p-4 border-red-500/50 bg-red-900/20 text-red-400 text-sm">
              Erro ao carregar preço: {priceError}
            </div>
          )}
        </div>
      </div>

      {/* Grid: Chart + Fear & Greed + News */}
      <div className="relative rounded-xl overflow-hidden">
        <AutoplayVideo
          src="/assets/particles-bg.mp4"
          className="absolute inset-0 w-full h-full object-cover opacity-[0.06] pointer-events-none"
        />
        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart ocupa 2 colunas */}
        <div className="lg:col-span-2 h-[320px] sm:h-[400px] lg:h-[500px]">
          <BtcChart />
        </div>

        {/* Coluna direita: Fear & Greed + Notícias */}
        <div className="space-y-6">
          {fgLoading ? <SkeletonCard /> : fearGreed ? <FearGreedMeter data={fearGreed} /> : null}
          {fgError && !fearGreed && (
            <div className="card p-3 border-red-500/20 text-red-400/60 text-xs">Fear & Greed indisponivel</div>
          )}

          {newsLoading ? (
            <SkeletonCard />
          ) : news ? (
            <NewsFeed items={news} />
          ) : null}
          {newsError && !news && (
            <div className="card p-3 border-red-500/20 text-red-400/60 text-xs">Noticias indisponiveis</div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
