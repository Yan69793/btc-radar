import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { BtcChart } from './BtcChart'

interface SignalsPayload {
  consensus?: {
    verdict?: string
    conviction?: number
    agreement?: number
    per_timeframe?: Record<string, { verdict: string; conviction: number }>
  }
}

interface DerivativesPayload {
  funding_rate_annualized: number | null
  open_interest_usd: number | null
  open_interest_btc: number | null
  long_short_ratio: number | null
  timestamp: string
  source: string
}

interface OnChainPayload {
  hash_rate: number | null
  difficulty: number | null
  avg_fee_sats: number | null
  block_height: number | null
  source: string
}

interface MacroPayload {
  features?: {
    selic_target_pct?: number | null
    usdbrl_ptax?: number | null
    treasury10y_pct?: number | null
  }
  market?: {
    sp500?: { value?: number | null; change_pct?: number | null }
    ibov?: { value?: number | null; change_pct?: number | null }
    ibovespa?: { value?: number | null; change_pct?: number | null }
    wti?: { value?: number | null; change_pct?: number | null }
  }
}

function moneyB(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return '—'
  return `US$ ${(Number(value) / 1e9).toFixed(2)}B`
}

function pct(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

function MetricLine({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="btc-dash-metric-line">
      <span>{label}</span>
      <strong className={tone ?? 'neutral'}>{value}</strong>
    </div>
  )
}

function ConsensusCard({ data }: { data: SignalsPayload | null }) {
  const consensus = data?.consensus
  const rows = [
    ['Curto', consensus?.per_timeframe?.short],
    ['Médio', consensus?.per_timeframe?.medium],
    ['Longo', consensus?.per_timeframe?.long],
  ] as const

  return (
    <section className="btc-dash-card btc-consensus-card">
      <div className="btc-dash-card-head">
        <div><span>SIGNAL ENGINE</span><h3>Consenso Aureus</h3></div>
        <Link to="/signals">Abrir sinais ↗</Link>
      </div>
      <div className="btc-consensus-main">
        <div className="btc-consensus-score">
          <strong>{consensus?.conviction == null ? '—' : consensus.conviction.toFixed(1)}</strong>
          <span>/10</span>
        </div>
        <div>
          <b className={consensus?.verdict === 'COMPRAR' ? 'positive' : consensus?.verdict === 'VENDER' ? 'negative' : ''}>
            {consensus?.verdict ?? 'AGUARDAR'}
          </b>
          <small>{consensus?.agreement == null ? 'sem consenso' : `${Math.round(consensus.agreement * 100)}% de alinhamento`}</small>
        </div>
      </div>
      <div className="btc-consensus-rows">
        {rows.map(([label, row]) => (
          <div key={label}>
            <span>{label}</span>
            <div className="btc-consensus-bar"><i style={{ width: `${Math.max(0, Math.min(100, (row?.conviction ?? 0) * 10))}%` }} /></div>
            <strong>{row?.verdict ?? '—'}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

function DerivativesCard({ data }: { data: DerivativesPayload | null }) {
  return (
    <section className="btc-dash-card btc-derivatives-card">
      <div className="btc-dash-card-head">
        <div><span>OKX</span><h3>Derivativos</h3></div>
        <Link to="/signals">Detalhes ↗</Link>
      </div>
      <div className="btc-card-feature">
        <span>OPEN INTEREST</span>
        <strong>{moneyB(data?.open_interest_usd)}</strong>
      </div>
      <MetricLine label="Funding anualizado" value={data?.funding_rate_annualized == null ? '—' : `${data.funding_rate_annualized.toFixed(2)}%`} tone={(data?.funding_rate_annualized ?? 0) >= 0 ? 'up' : 'down'} />
      <MetricLine label="Long / Short" value={data?.long_short_ratio == null ? '—' : data.long_short_ratio.toFixed(2)} />
      <MetricLine label="OI em BTC" value={data?.open_interest_btc == null ? '—' : `${Math.round(data.open_interest_btc).toLocaleString('pt-BR')} BTC`} />
    </section>
  )
}

function OnChainCard({ data }: { data: OnChainPayload | null }) {
  const hash = data?.hash_rate == null ? '—' : `${(data.hash_rate / 1_000_000).toFixed(0)} EH/s`
  return (
    <section className="btc-dash-card btc-onchain-card">
      <div className="btc-dash-card-head">
        <div><span>MEMPOOL.SPACE</span><h3>Dados on-chain</h3></div>
        <Link to="/onchain">Detalhes ↗</Link>
      </div>
      <div className="btc-card-feature">
        <span>HASH RATE</span>
        <strong>{hash}</strong>
      </div>
      <MetricLine label="Dificuldade" value={data?.difficulty == null ? '—' : `${data.difficulty.toFixed(2)}T`} />
      <MetricLine label="Taxa média" value={data?.avg_fee_sats == null ? '—' : `${data.avg_fee_sats} sat/vB`} />
      <MetricLine label="Bloco atual" value={data?.block_height == null ? '—' : `#${data.block_height.toLocaleString('pt-BR')}`} />
    </section>
  )
}

function MacroCard({ data }: { data: MacroPayload | null }) {
  const ibov = data?.market?.ibov ?? data?.market?.ibovespa
  return (
    <section className="btc-dash-card btc-macro-card">
      <div className="btc-dash-card-head">
        <div><span>MULTI ASSETS</span><h3>Macro Lens</h3></div>
        <a href="https://multi-assets.com/#mercado" target="_blank" rel="noreferrer">Abrir ↗</a>
      </div>
      <div className="btc-card-feature">
        <span>SELIC</span>
        <strong>{data?.features?.selic_target_pct == null ? '—' : `${data.features.selic_target_pct.toFixed(2)}%`}</strong>
      </div>
      <MetricLine label="PTAX" value={data?.features?.usdbrl_ptax == null ? '—' : data.features.usdbrl_ptax.toFixed(4)} />
      <MetricLine label="Treasury 10Y" value={data?.features?.treasury10y_pct == null ? '—' : `${data.features.treasury10y_pct.toFixed(2)}%`} />
      <MetricLine label="S&P 500" value={pct(data?.market?.sp500?.change_pct)} tone={(data?.market?.sp500?.change_pct ?? 0) >= 0 ? 'up' : 'down'} />
      <MetricLine label="Ibovespa" value={pct(ibov?.change_pct)} tone={(ibov?.change_pct ?? 0) >= 0 ? 'up' : 'down'} />
      <MetricLine label="WTI" value={pct(data?.market?.wti?.change_pct)} tone={(data?.market?.wti?.change_pct ?? 0) >= 0 ? 'up' : 'down'} />
    </section>
  )
}

const highlights = [
  { to: '/signals', eyebrow: 'Regime e sinais', title: 'Leitura multi-timeframe', copy: 'Consenso, convicção e estratégias por horizonte.' },
  { to: '/onchain', eyebrow: 'On-chain', title: 'Saúde da rede', copy: 'Hash rate, dificuldade, blocos e taxas.' },
  { to: '/briefing', eyebrow: 'Briefing', title: 'Nosso take', copy: 'Síntese diária dos dados coletados pelo Radar.' },
  { to: '/backtest', eyebrow: 'Backtest', title: 'Validação', copy: 'Histórico de estratégias e métricas de robustez.' },
  { to: '/portfolio', eyebrow: 'Portfólio', title: 'Posicionamento', copy: 'Acompanhe exposição, risco e evolução do portfólio.' },
]

export function DashboardWorkbench() {
  const { data: signals } = useApi<SignalsPayload>('/api/signals', 300_000)
  const { data: derivatives } = useApi<DerivativesPayload>('/api/derivatives', 300_000)
  const { data: onchain } = useApi<OnChainPayload>('/api/onchain', 600_000)
  const { data: macro } = useApi<MacroPayload>('/api/macro-context', 300_000)

  return (
    <>
      <section className="btc-workstation-grid">
        <div className="btc-chart-zone"><BtcChart /></div>
        <ConsensusCard data={signals} />
        <DerivativesCard data={derivatives} />
        <MacroCard data={macro} />
        <OnChainCard data={onchain} />
      </section>

      <section className="btc-highlight-zone">
        <div className="btc-highlight-title">ANÁLISES EM DESTAQUE</div>
        <div className="btc-highlight-grid">
          {highlights.map((item) => (
            <Link key={item.to} to={item.to} className="btc-highlight-card">
              <span>{item.eyebrow}</span>
              <strong>{item.title}</strong>
              <p>{item.copy}</p>
              <i>↗</i>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
