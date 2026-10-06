import { useEffect, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { SkeletonCard } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import { fmtDateTime } from '../lib/formatters'

interface Snapshot { timestamp:string; nav:number; exposure:number; quantity:number; realized_pnl:number; unrealized_pnl:number; total_fees:number; cycle:number; drawdown_pct:number }
interface Data { available:boolean; reason:string|null; metrics:{nav:number|null;cumulative_return_pct:number|null;max_drawdown_pct:number|null;exposure_pct:number|null;realized_pnl:number|null;unrealized_pnl:number|null;total_fees:number|null;cycle:number|null}; series:Snapshot[]; recent_cycles:Array<Record<string,unknown>>; recent_events:Array<Record<string,unknown>>; benchmark:{available:false;series:null;reason:string} }
interface ApiResponse { success:boolean; data:Data|null; error?:string }
const usd=(v:number|null)=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v)
const pct=(v:number|null)=>v==null?'—':`${v>=0?'+':''}${v.toFixed(2)}%`
function Metric({label,value}:{label:string;value:string}){return <div className="card p-4"><div className="eyebrow mb-2">{label}</div><div className="font-mono text-xl font-semibold text-dark-text-primary tabular-nums">{value}</div></div>}

export function TrackRecord(){
  const [data,setData]=useState<Data|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState<string|null>(null)
  useEffect(()=>{let alive=true;apiFetch('/api/aureus-track-record').then(async r=>{const j:ApiResponse=await r.json();if(!j.success||!j.data)throw new Error(j.error||'Falha ao carregar Track Record');if(alive)setData(j.data)}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Falha ao carregar Track Record')}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[])
  if(loading)return <div className="space-y-4 max-w-7xl mx-auto"><SkeletonCard/><SkeletonCard/></div>
  return <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
    <PageHeader eyebrow="Aureus" title="Track Record" meta={data?.available?`Ciclo ${data.metrics.cycle??'—'} · ${data.series.length} snapshots`:'Aguardando histórico operacional'}/>
    <div className="card p-4 text-sm text-dark-text-secondary">Carteira simulada em USD, com NAV inicial de US$ 100. A política long-only mantém BTC comprado ou caixa, sem short ou alavancagem. Não representa patrimônio nem ordens executadas em conta real. Fees de 0,10% por lado e slippage adverso de 0,05% por execução entram no NAV. A métrica de fees soma as tarifas, enquanto o slippage já está incorporado nos preços simulados. Retorno e drawdown incluem a base inicial de US$ 100.</div>
    {error&&<div className="card p-4 border-red-500/20 text-red-400 text-sm">{error}</div>}
    {!error&&data&&!data.available&&<div className="card p-6 text-dark-text-secondary text-sm">{data.reason}</div>}
    {data?.available&&<>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="NAV" value={usd(data.metrics.nav)}/><Metric label="Retorno acumulado" value={pct(data.metrics.cumulative_return_pct)}/>
        <Metric label="Max drawdown" value={pct(data.metrics.max_drawdown_pct)}/><Metric label="Exposição BTC" value={pct(data.metrics.exposure_pct)}/>
        <Metric label="PnL realizado" value={usd(data.metrics.realized_pnl)}/><Metric label="PnL não realizado" value={usd(data.metrics.unrealized_pnl)}/>
        <Metric label="Fees acumuladas" value={usd(data.metrics.total_fees)}/><Metric label="Ciclo" value={String(data.metrics.cycle??'—')}/>
      </div>
      <div className="card p-5"><div className="mb-4 text-sm font-semibold text-dark-text-primary">Curva de NAV</div><div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data.series}><XAxis dataKey="timestamp" tickFormatter={v=>new Date(v).toLocaleDateString('pt-BR')}/><YAxis domain={['auto','auto']}/><Tooltip labelFormatter={v=>fmtDateTime(String(v))}/><Line type="monotone" dataKey="nav" stroke="currentColor" dot={false} strokeWidth={2}/></LineChart></ResponsiveContainer>
      </div><div className="mt-3 text-xs text-dark-text-dim">{data.benchmark.reason}</div></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5"><div className="mb-4 text-sm font-semibold text-dark-text-primary">Ciclos recentes</div>{data.recent_cycles.slice(0,10).map((c,i)=><div key={String(c.cycle_key??i)} className="flex justify-between border-b border-dark-bg-border py-2 text-xs"><span>{String(c.action??'—')}</span><span className="text-dark-text-dim">{String(c.evaluated_at??'')}</span></div>)}</div>
        <div className="card p-5"><div className="mb-4 text-sm font-semibold text-dark-text-primary">Eventos recentes</div>{data.recent_events.slice(0,10).map((e,i)=><div key={String(e.id??i)} className="flex justify-between border-b border-dark-bg-border py-2 text-xs"><span>{String(e.event_type??'—')}</span><span className="text-dark-text-dim">{String(e.created_at??'')}</span></div>)}</div>
      </div>
    </>}
  </div>
}
