import type { NewsItem } from '../types'
import { fmtTimeAgo } from '../lib/formatters'

interface Props {
  items: NewsItem[]
}

const sentimentBadge: Record<string, string> = {
  positive: 'bg-accent-green/10 text-accent-green border-accent-green/30',
  negative: 'bg-accent-red/10 text-accent-red border-accent-red/30',
  neutral: 'bg-dark-bg-hover text-dark-text-muted border-dark-bg-border',
}

export function NewsFeed({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="text-dark-text-primary font-semibold text-sm mb-3">Notícias</h3>
        <div className="text-dark-text-dim text-sm">Nenhuma notícia recente</div>
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-dark-text-primary font-semibold text-sm">Notícias</h3>
        <span className="text-dark-text-dim text-xs">{items.length} recentes</span>
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {items.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-3 rounded hover:bg-dark-bg-hover transition-colors border border-transparent hover:border-dark-bg-border"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-dark-text-primary text-sm leading-snug line-clamp-2">
                {item.title}
              </span>
              {item.sentiment && (
                <span
                  className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${
                    sentimentBadge[item.sentiment] ?? sentimentBadge['neutral']
                  }`}
                >
                  {item.sentiment === 'positive' ? 'bullish' : item.sentiment === 'negative' ? 'bearish' : 'neutro'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-dark-text-dim">
              <span>{item.source}</span>
              <span>·</span>
              <span>{fmtTimeAgo(item.published_at)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
