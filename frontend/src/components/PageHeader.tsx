// Cabeçalho de página do painel.
//
// Tratamento: faixa baixa com o filme do Higgsfield (candles reais da OKX) por
// trás de um véu pesado. O título carrega a hierarquia, a imagem entra como
// textura em movimento. Sem glow, sem ken-burns, sem gradiente decorativo: em
// superfície Monitor, densidade e leitura ganham de enfeite.
import type { ReactNode } from 'react'
import { AutoplayVideo } from './AutoplayVideo'
import { asset } from '../lib/assets'

interface PageHeaderProps {
  eyebrow: string
  title: string
  meta?: ReactNode
  actions?: ReactNode
  poster?: string
  clip?: string
}

export function PageHeader({ eyebrow, title, meta, actions, poster, clip }: PageHeaderProps) {
  return (
    <header className="relative overflow-hidden rounded-lg border border-dark-bg-border">
      {clip ? (
        <AutoplayVideo
          src={asset(clip)}
          poster={poster ? asset(poster) : undefined}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        poster && (
          <img
            src={asset(poster)}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        )
      )}
      {poster && <div className="absolute inset-0 bg-dark-bg/88" aria-hidden="true" />}

      <div className="relative flex flex-wrap items-end justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <div className="eyebrow">{eyebrow}</div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-medium tracking-tight text-dark-text-primary sm:text-[1.6rem]">
              {title}
            </h1>
            {meta && <div className="text-xs text-dark-text-dim">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
