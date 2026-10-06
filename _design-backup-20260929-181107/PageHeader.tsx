// Cabeçalho de página do painel: só tipografia. Mídia de mercado, quando existe,
// fica em componente próprio (MarketPulse), nunca atrás do título.
import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow: string
  title: string
  meta?: ReactNode
  actions?: ReactNode
  context?: string
}

export function PageHeader({ eyebrow, title, meta, actions, context }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-dark-bg-border pb-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="eyebrow">{eyebrow}</div>
          {context && <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-dark-text-dim">{context}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-medium tracking-tight text-dark-text-primary sm:text-[1.6rem]">
            {title}
          </h1>
          {meta && <div className="text-xs text-dark-text-dim">{meta}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
