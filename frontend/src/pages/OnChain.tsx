import { useApi } from '../hooks/useApi'
import { SkeletonCard } from '../components/Skeleton'
import { PageHeader } from '../components/PageHeader'
import { fmtTimeAgo } from '../lib/formatters'

interface OnChainSnapshot {
  timestamp: string
  hash_rate: number | null     // TH/s
  difficulty: number | null    // T
  active_addresses: number | null
  transaction_count: number | null
  transaction_volume_usd: number | null
  avg_fee_sats: number | null
  block_height: number | null
  circulating_supply: number | null
  source: string
}

function MetricCard({ label, value, unit, detail }: {
  label: string
  value: string | null
  unit?: string
  detail?: string
}) {
  return (
    <div className="card p-4 hover:border-dark-text-dim transition-colors duration-200">
      <div className="text-dark-text-dim text-[11px] tracking-wide uppercase mb-1.5">{label}</div>
      {value ? (
        <>
          <div className="text-dark-text-primary font-mono font-semibold text-lg tabular-nums">
            {value}
            {unit && <span className="text-dark-text-dim text-sm font-normal ml-1">{unit}</span>}
          </div>
          {detail && (
            <div className="text-dark-text-dim text-xs mt-0.5">{detail}</div>
          )}
        </>
      ) : (
        <div className="text-dark-text-muted text-sm">Indisponível</div>
      )}
    </div>
  )
}

function NetworkHealth({ hashRate, difficulty, blockHeight, feeRate, txPending }: {
  hashRate: number | null
  difficulty: number | null
  blockHeight: number | null
  feeRate: number | null
  txPending: number | null
}) {
  // Indicador de saúde: hash rate alto + blocos recentes = rede saudável
  const isHealthy = hashRate != null && hashRate > 200 && blockHeight != null

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-dark-text-primary font-semibold text-sm">Saúde da Rede</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-accent-green' : 'bg-accent-yellow'} shadow-[0_0_6px_currentColor]`} />
          <span className={`text-xs font-medium ${isHealthy ? 'text-accent-green' : 'text-accent-yellow'}`}>
            {isHealthy ? 'Saudável' : 'Verificando'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-dark-bg rounded-lg p-3">
          <div className="text-dark-text-dim text-[10px] tracking-wide uppercase mb-1">Hash Rate</div>
          <div className="font-mono text-dark-text-primary font-medium">
            {hashRate != null ? `${hashRate.toLocaleString()} TH/s` : '---'}
          </div>
        </div>
        <div className="bg-dark-bg rounded-lg p-3">
          <div className="text-dark-text-dim text-[10px] tracking-wide uppercase mb-1">Dificuldade</div>
          <div className="font-mono text-dark-text-primary font-medium">
            {difficulty != null ? `${difficulty.toFixed(1)}T` : '---'}
          </div>
        </div>
        <div className="bg-dark-bg rounded-lg p-3">
          <div className="text-dark-text-dim text-[10px] tracking-wide uppercase mb-1">Bloco Atual</div>
          <div className="font-mono text-dark-text-primary font-medium">
            {blockHeight != null ? blockHeight.toLocaleString() : '---'}
          </div>
        </div>
        <div className="bg-dark-bg rounded-lg p-3">
          <div className="text-dark-text-dim text-[10px] tracking-wide uppercase mb-1">Taxa Média</div>
          <div className="font-mono text-dark-text-primary font-medium">
            {feeRate != null ? `${feeRate} sat/vB` : '---'}
          </div>
        </div>
      </div>

      {txPending != null && (
        <div className="mt-3 pt-3 border-t border-dark-bg-border">
          <div className="flex items-center justify-between">
            <span className="text-dark-text-dim text-xs">Transações pendentes (mempool)</span>
            <span className="font-mono text-dark-text-secondary text-sm font-medium">{txPending.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Bloco didático: explica o que é on-chain para quem nunca viu a rede Bitcoin.
function OnChainExplainer() {
  const concepts = [
    {
      term: 'Hash Rate',
      analogy: 'É a força total das máquinas que mineram Bitcoin no mundo. Quanto maior, mais gente trabalhando e mais difícil enganar a rede.',
    },
    {
      term: 'Dificuldade',
      analogy: 'É a trava da rede. Quando entra muita máquina, a trava fica mais difícil de abrir, para um bloco continuar saindo a cada 10 minutos.',
    },
    {
      term: 'Mempool e taxas',
      analogy: 'Mempool é a fila de espera das transações. A taxa é o pedágio para entrar na fila. Fila cheia, pedágio sobe.',
    },
    {
      term: 'Bloco atual',
      analogy: 'É o número da página em que o livro-razão do Bitcoin está agora. Cada página guarda cerca de 10 minutos de transações.',
    },
  ]

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="text-dark-text-primary font-semibold text-sm sm:text-base mb-3">O que é On-Chain?</h2>
      <p className="text-sm leading-relaxed text-dark-text-secondary">
        O termo on-chain designa os dados registrados na blockchain do Bitcoin, um
        livro-razão público no qual toda transação executada desde a origem da rede
        permanece armazenada de forma permanente e auditável por qualquer pessoa.
        As métricas apresentadas nesta página são extraídas diretamente desse
        registro, sem depender de corretoras ou intermediários.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-dark-text-secondary">
        Esses indicadores são relevantes por refletirem a atividade real dos
        participantes da rede, independentemente de notícias ou opiniões de mercado.
        O aumento da atividade de mineração, o acúmulo de transações na fila de
        espera e a elevação das taxas de confirmação antecedem, com frequência,
        os movimentos de preço. Constituem, portanto, uma leitura objetiva do
        estado da rede que o preço ainda não precificou.
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {concepts.map((c) => (
          <div key={c.term} className="rounded-lg border border-dark-bg-border bg-dark-bg p-3.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent-blue mb-1">{c.term}</div>
            <p className="text-xs leading-relaxed text-dark-text-muted">{c.analogy}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function OnChain() {
  const { data, loading, error, reload } = useApi<OnChainSnapshot>('/api/onchain', 600_000)

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        eyebrow="Rede"
        title="On-chain"
        poster="/assets/film-cover.png"
        meta={
          <>
            Metricas da rede Bitcoin
            {data && <span className="ml-2">atualizado {fmtTimeAgo(data.timestamp)}</span>}
          </>
        }
        actions={
          <button
            onClick={reload}
            className="rounded-md border border-dark-bg-border bg-transparent px-3 py-1.5 text-sm text-dark-text-muted transition-colors hover:border-white/15 hover:text-dark-text-primary"
          >
            Atualizar
          </button>
        }
      />

      {/* Explicação didática: o que é on-chain para quem nunca viu a rede */}
      <OnChainExplainer />

      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">
          Erro ao carregar dados on-chain: {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : data ? (
        <>
          {/* Network Health */}
          <NetworkHealth
            hashRate={data.hash_rate}
            difficulty={data.difficulty}
            blockHeight={data.block_height}
            feeRate={data.avg_fee_sats}
            txPending={data.transaction_count}
          />

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Hash Rate"
              value={data.hash_rate != null ? data.hash_rate.toLocaleString() : null}
              unit="TH/s"
              detail="Poder computacional da rede"
            />
            <MetricCard
              label="Dificuldade"
              value={data.difficulty != null ? `${data.difficulty.toFixed(1)}T` : null}
              detail="Ajustada a cada 2016 blocos"
            />
            <MetricCard
              label="Bloco"
              value={data.block_height != null ? `#${data.block_height.toLocaleString()}` : null}
              detail="Altura atual da blockchain"
            />
            <MetricCard
              label="Taxa Média"
              value={data.avg_fee_sats != null ? `${data.avg_fee_sats} sat/vB` : null}
              detail="Prioridade baixa ~2, alta ~20+"
            />
          </div>

          {/* Contexto para trading */}
          <div className="card p-5">
            <h3 className="text-dark-text-primary font-semibold text-sm mb-3">Interpretação para Trading</h3>
            <div className="space-y-2 text-sm">
              <InterpretationRow
                condition={data.hash_rate != null && data.hash_rate > 600}
                text="Hash rate elevado (600+ TH/s): rede segura e mineradores confiantes, positivo para longo prazo"
              />
              <InterpretationRow
                condition={data.avg_fee_sats != null && data.avg_fee_sats < 5}
                text="Taxas baixas (< 5 sat/vB): baixa demanda por espaço de bloco, mercado lateral ou bearish"
              />
              <InterpretationRow
                condition={data.avg_fee_sats != null && data.avg_fee_sats > 20}
                text="Taxas altas (> 20 sat/vB): alta atividade on-chain, pode indicar acumulação ou pânico"
              />
              <InterpretationRow
                condition={data.transaction_count != null && data.transaction_count > 50000}
                text="Mempool cheia (> 50k tx): congestionamento, taxas sobem e aumenta a urgência em transações"
              />
            </div>
          </div>

          {/* Data source */}
          <div className="text-dark-text-dim text-xs">
            Fonte: {data.source}
            {data.timestamp && ` · ${new Date(data.timestamp).toLocaleString('pt-BR')}`}
          </div>
        </>
      ) : null}
    </div>
  )
}

function InterpretationRow({ condition, text }: { condition: boolean; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${condition ? 'bg-accent-green' : 'bg-dark-bg-border'}`} />
      <span className={condition ? 'text-dark-text-secondary' : 'text-dark-text-dim'}>
        {text}
      </span>
    </div>
  )
}
