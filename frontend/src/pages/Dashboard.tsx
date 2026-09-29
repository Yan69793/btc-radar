import { useApi } from '../hooks/useApi'
import { TechHero } from '../components/TechHero'
import { DashboardWorkbench } from '../components/DashboardWorkbench'
import type { PriceSnapshot, FearGreedData } from '../types'

export function Dashboard() {
  const { data: price, loading: priceLoading, error: priceError } = useApi<PriceSnapshot>(
    '/api/price/latest',
    30_000
  )
  const { data: fearGreed } = useApi<FearGreedData>(
    '/api/sentiment/fear-greed',
    120_000
  )

  return (
    <div className="btc-overview-page animate-fade-in">
      <TechHero
        price={price ?? null}
        fearGreed={fearGreed ?? null}
        loading={priceLoading}
      />

      {priceError && (
        <div className="btc-system-alert">
          Mercado em modo degradado: {priceError}
        </div>
      )}

      <DashboardWorkbench />
    </div>
  )
}
