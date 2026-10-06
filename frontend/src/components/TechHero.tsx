import { useEffect, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { asset } from '../lib/assets'
import { getScrollParent, readScrollTop } from '../lib/scroll'
import { MobileGlobe } from './MobileGlobe'
import { fmtPct, fmtPrice, fmtTimeAgo } from '../lib/formatters'
import type { FearGreedData, PriceSnapshot } from '../types'

interface Props {
  price: PriceSnapshot | null
  fearGreed: FearGreedData | null
  loading?: boolean
}

interface ScenarioResponse {
  current_regime?: {
    trend?: 'bull' | 'neutral' | 'bear'
    volatility?: 'low' | 'normal' | 'high'
    key?: string
    return_30d_pct?: number
    realized_vol_30d_pct?: number
  } | null
}

interface SignalsResponse {
  consensus?: {
    verdict?: 'COMPRAR' | 'VENDER' | 'REDUZIR' | 'AGUARDAR'
    conviction?: number
    agreement?: number
  }
}

interface DerivativesSnapshot {
  funding_rate_annualized: number | null
  open_interest_usd: number | null
  long_short_ratio: number | null
}

interface OnChainSnapshot {
  hash_rate: number | null
  block_height: number | null
}

interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  published_at: string
  sentiment: 'positive' | 'neutral' | 'negative' | null
  summary: string | null
}

function regimeLabel(key?: string) {
  if (!key) return 'Calculando'
  const [trend] = key.split(':')
  if (trend === 'bull') return 'Expansão'
  if (trend === 'bear') return 'Contração'
  return 'Equilíbrio'
}

function compactHashRate(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return '—'
  const v = Number(value)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)} EH/s`
  return `${v.toLocaleString('pt-BR')} TH/s`
}

export function TechHero({ price, fearGreed, loading = false }: Props) {
  const heroRef = useRef<HTMLElement | null>(null)
  const { data: scenarios } = useApi<ScenarioResponse>('/api/scenarios', 300_000)
  const { data: signals } = useApi<SignalsResponse>('/api/signals', 300_000)
  const { data: derivatives } = useApi<DerivativesSnapshot>('/api/derivatives', 300_000)
  const { data: onchain } = useApi<OnChainSnapshot>('/api/onchain', 600_000)
  const { data: news } = useApi<NewsItem[]>('/api/news?filter=hot&limit=4', 300_000)

  const regime = scenarios?.current_regime

  // O painel rola dentro de `.btc-platform-main`, não no documento: escutar a
  // janela deixava `is-scrolling` permanentemente falso. O container real é
  // resolvido a partir do próprio hero.
  useEffect(() => {
    const hero = heroRef.current
    if (!hero) return
    const scroller = getScrollParent(hero)
    const target: HTMLElement | Window = scroller ?? window
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => hero.classList.toggle('is-scrolling', readScrollTop(scroller) > 24))
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      cancelAnimationFrame(raf)
      target.removeEventListener('scroll', onScroll)
    }
  }, [])
  const consensus = signals?.consensus
  const positive = (price?.change_24h ?? 0) >= 0
  const regimeTone = regime?.trend === 'bull' ? 'positive' : regime?.trend === 'bear' ? 'negative' : ''
  // A leitura narrativa do regime saiu do corpo do card (os quatro cards do
  // hero passaram a ter a mesma anatomia de quatro linhas) e virou descrição
  // do próprio card, para o texto continuar no documento.
  const regimeNote =
    regime?.trend === 'bull'
      ? 'Momentum e estrutura favorecem continuidade de alta, com risco condicionado pela volatilidade.'
      : regime?.trend === 'bear'
        ? 'Estrutura de preço pede cautela e preservação de capital enquanto o regime seguir contracionista.'
        : 'Mercado sem tendência dominante. Convicção deve vir da convergência entre sinais, derivativos e macro.'

  return (
    <section ref={heroRef} className="btc-cinematic-hero" aria-labelledby="btc-cinematic-title">
      <div className="btc-cinematic-earth" aria-hidden="true">
        <img src={asset('/assets/btc-tech-globe-user.png')} alt="" />
        <MobileGlobe />
        <div className="btc-cinematic-network" />
        <div className="btc-cinematic-orbit orbit-one" />
        <div className="btc-cinematic-orbit orbit-two" />
      </div>

      <div className="btc-cinematic-copy">
        <div className="btc-cinematic-kicker"><i /> FLUXO DE MERCADO</div>
        <div className="btc-news-brief">
          <div className="btc-news-brief-head">
            <h1 id="btc-cinematic-title">Notícias que movem o Bitcoin</h1>
            <span>{news?.length ? 'AO VIVO' : 'ATUALIZANDO'}</span>
          </div>
          <div className="btc-news-list">
            {news?.slice(0, 4).map((item, index) => (
              <a
                key={`${item.id}-${index}`}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className={`btc-news-row ${item.sentiment ?? 'neutral'}`}
              >
                <div className="btc-news-meta">
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  <span>{item.source}</span>
                  <time>{fmtTimeAgo(item.published_at)}</time>
                </div>
                <strong>{item.title}</strong>
              </a>
            ))}
            {!news?.length && (
              <div className="btc-news-empty">
                <span />
                Sincronizando manchetes...
              </div>
            )}
          </div>
        </div>
        <div className="btc-cinematic-price">
          <span>BTC / USD</span>
          <strong>{loading || !price ? '—' : fmtPrice(price.price)}</strong>
          {price && <em className={positive ? 'positive' : 'negative'}>{fmtPct(price.change_24h)} · 24h</em>}
        </div>
        <small>{price?.timestamp ? `Atualizado ${fmtTimeAgo(price.timestamp)}` : 'Atualizando mercado'}</small>
      </div>

      <div className="btc-float-card btc-float-hash">
        <span>HASH RATE</span>
        <strong>{compactHashRate(onchain?.hash_rate)}</strong>
        <small>{onchain?.block_height ? `bloco #${onchain.block_height.toLocaleString('pt-BR')}` : 'aguardando rede'}</small>
        <small className="btc-float-foot">mempool.space</small>
      </div>

      <div className="btc-float-card btc-float-price">
        <span>PREÇO</span>
        <strong>{price ? fmtPrice(price.price) : '—'}</strong>
        <small className={positive ? 'positive' : 'negative'}>{price ? fmtPct(price.change_24h) : '—'} em 24h</small>
        <small className="btc-float-foot">OKX · tempo real</small>
      </div>

      <div className="btc-float-card btc-float-sentiment">
        <span>SENTIMENTO</span>
        <strong>{fearGreed?.classification ?? '—'}</strong>
        <small>{fearGreed ? `${fearGreed.value}/100` : '—'}</small>
        <small className="btc-float-foot">Alternative.me</small>
      </div>

      <div className="btc-float-card btc-float-regime" title={regimeNote}>
        <span>REGIME ATUAL</span>
        <strong>{regimeLabel(regime?.key)}</strong>
        <small className={regimeTone}>
          30d {regime?.return_30d_pct == null ? '—' : fmtPct(regime.return_30d_pct)}
          {' · '}vol {regime?.realized_vol_30d_pct == null ? '—' : `${regime.realized_vol_30d_pct.toFixed(1)}%`}
        </small>
        <small className="btc-float-foot">
          CONSENSO {consensus?.verdict ?? 'AGUARDAR'}
          {consensus?.conviction == null ? '' : ` · ${consensus.conviction.toFixed(1)}/10`}
        </small>
      </div>

      <div className="btc-hero-data-strip">
        <div><span>AO VIVO</span><strong>{price ? fmtPrice(price.price) : '—'}</strong><em>{price ? fmtPct(price.change_24h) : '—'}</em></div>
        <div><span>FUNDING</span><strong>{derivatives?.funding_rate_annualized == null ? '—' : `${derivatives.funding_rate_annualized.toFixed(2)}% a.a.`}</strong></div>
        <div><span>OPEN INTEREST</span><strong>{derivatives?.open_interest_usd == null ? '—' : `US$ ${(derivatives.open_interest_usd / 1e9).toFixed(2)}B`}</strong></div>
        <div><span>LONG / SHORT</span><strong>{derivatives?.long_short_ratio == null ? '—' : derivatives.long_short_ratio.toFixed(2)}</strong></div>
        <div><span>FEAR & GREED</span><strong>{fearGreed?.value ?? '—'}</strong><em>{fearGreed?.classification ?? '—'}</em></div>
      </div>
    </section>
  )
}
