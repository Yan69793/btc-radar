// Faixa fina com o filme do Higgsfield (candles reais da OKX). Fica separada do
// título da página e não carrega texto por cima além do próprio rótulo.
import { AutoplayVideo } from './AutoplayVideo'
import { asset } from '../lib/assets'

export function MarketPulse() {
  return (
    <section aria-label="Pulso de mercado" className="space-y-2">
      <div className="eyebrow">Pulso de mercado</div>
      <div className="relative h-16 overflow-hidden rounded-lg border border-dark-bg-border sm:h-20">
        <AutoplayVideo
          src={asset('/assets/film-pulso.mp4')}
          poster={asset('/assets/film-pulso.png')}
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      </div>
    </section>
  )
}
