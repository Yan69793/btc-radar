// BTC Radar — Formatadores

export function fmtPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '---'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price)
}

export function fmtPriceDetail(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '---'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price)
}

export function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '---'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '---'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '---'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '---'
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function pctColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'text-dark-text-muted'
  if (value > 0) return 'text-accent-green'
  if (value < 0) return 'text-accent-red'
  return 'text-dark-text-muted'
}

export function pctBgColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'bg-dark-bg-hover text-dark-text-muted'
  if (value > 0) return 'bg-accent-green/10 text-accent-green'
  if (value < 0) return 'bg-accent-red/10 text-accent-red'
  return 'bg-dark-bg-hover text-dark-text-muted'
}
