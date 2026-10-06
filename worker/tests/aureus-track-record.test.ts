import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { computeTrackRecord, aureusTrackRecordRoutes, type TrackSnapshotRow } from '../src/routes/aureus-track-record'
const row=(timestamp:string,nav:number,exposure=.5):TrackSnapshotRow=>({timestamp,nav,cash:nav*(1-exposure),position_value:nav*exposure,exposure,quantity:.01,realized_pnl:0,unrealized_pnl:0,total_fees:1,cycle:1})
function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE aureus_portfolio_snapshots (cycle_key TEXT PRIMARY KEY,timestamp TEXT,nav REAL,cash REAL,position_value REAL,exposure REAL,quantity REAL,realized_pnl REAL,unrealized_pnl REAL,total_fees REAL,cycle INTEGER);
CREATE TABLE aureus_portfolio_state (id INTEGER,cash REAL,position_json TEXT,realized_pnl REAL,total_fees REAL,cycle INTEGER,engine_version TEXT,updated_at TEXT);
CREATE TABLE aureus_portfolio_cycles (cycle_key TEXT,evaluated_at TEXT,candle_timestamp TEXT,action TEXT,engine_version TEXT,created_at TEXT);
CREATE TABLE aureus_portfolio_events (id INTEGER,cycle_key TEXT,event_index INTEGER,event_type TEXT,event_json TEXT,created_at TEXT);`)
  const db={prepare(sql:string){let values:unknown[]=[];return {bind(...args:unknown[]){values=args;return this}, async first(){return sqlite.prepare(sql).get(...values as any[])??null},async all(){return {success:true,results:sqlite.prepare(sql).all(...values as any[])}}}}}
  const request=()=>aureusTrackRecordRoutes.request('/',{}, {DB:db} as any)
  return {sqlite,request}
}
describe('aureus track record',()=>{
  it('calcula retorno e drawdown',()=>{const r=computeTrackRecord([row('2026-01-01T00:00:00Z',100),row('2026-01-02T00:00:00Z',120),row('2026-01-03T00:00:00Z',90),row('2026-01-04T00:00:00Z',110)]);expect(r.metrics.cumulative_return_pct).toBeCloseTo(10,8);expect(r.metrics.max_drawdown_pct).toBeCloseTo(-25,8)})
  it('inclui perda do primeiro trade contra NAV inicial 100',()=>{const r=computeTrackRecord([row('2026-01-01T00:00:00Z',99.97)]);expect(r.metrics.cumulative_return_pct).toBeCloseTo(-.03,8);expect(r.metrics.max_drawdown_pct).toBeCloseTo(-.03,8)})
  it('fica indisponível apenas quando não há snapshots',()=>{expect(computeTrackRecord([]).available).toBe(false)})
  it.each(['nav','cash','position_value','quantity','exposure','realized_pnl','unrealized_pnl','total_fees','cycle'])('não descarta silenciosamente campo inválido %s',key=>{expect(()=>computeTrackRecord([{...row('2026-01-01T00:00:00Z',100),[key]:NaN}])).toThrow()})
  it.each(['nav','cash','position_value','quantity','exposure','realized_pnl','unrealized_pnl','total_fees'])('F12 rejeita Infinity em %s',key=>{expect(()=>computeTrackRecord([{...row('2026-01-01T00:00:00Z',100),[key]:Number.POSITIVE_INFINITY}])).toThrow();expect(()=>computeTrackRecord([{...row('2026-01-01T00:00:00Z',100),[key]:Number.NEGATIVE_INFINITY}])).toThrow()})
  it.each([
    ['nav zero', {...row('2026-01-01T00:00:00Z',100),nav:0}],
    ['exposição acima de 100%', {...row('2026-01-01T00:00:00Z',100),exposure:1.5}],
    ['exposição negativa', {...row('2026-01-01T00:00:00Z',100),exposure:-0.1}],
    ['caixa negativo', {...row('2026-01-01T00:00:00Z',100),cash:-1}],
  ])('F12 recusa snapshot fora dos limites: %s',(_label,bad)=>{expect(()=>computeTrackRecord([bad as TrackSnapshotRow])).toThrow()})
  it('recusa timestamp inválido',()=>{expect(()=>computeTrackRecord([row('inválido',100)])).toThrow()})
  it('SQL real preserva o último ciclo depois de 2000 snapshots e desempata timestamps',async()=>{
    const {sqlite,request}=database()
    try {const insert=sqlite.prepare('INSERT INTO aureus_portfolio_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      for(let i=1;i<=2005;i++){const timestamp=new Date(Date.UTC(2026,0,1,0,Math.floor(i/2))).toISOString();const nav=i===2005?80:100;insert.run(String(i).padStart(5,'0'),timestamp,nav,nav,0,0,0,0,0,0,i)}
      const response=await request();expect(response.status).toBe(200);const body=await response.json() as any
      expect(body.data.series).toHaveLength(2005);expect(body.data.metrics.cycle).toBe(2005);expect(body.data.metrics.nav).toBe(80);expect(body.data.metrics.cumulative_return_pct).toBeCloseTo(-20);expect(body.data.metrics.max_drawdown_pct).toBeCloseTo(-20)
    }finally{sqlite.close()}
  })
  it.each(['{', '{}', '[]', '"bad"'])('recusa position_json corrompido %s sem expor mensagem interna',async json=>{
    const {sqlite,request}=database();const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try{sqlite.prepare('INSERT INTO aureus_portfolio_state VALUES(1,100,?,0,0,0,?,?)').run(json,'1.0','2026-01-01T00:00:00Z');const response=await request();expect(response.status).toBe(500);expect((await response.json() as any).error).toBe('Falha ao carregar Track Record.')}finally{sqlite.close();log.mockRestore()}
  })
  it('não silencia event_json inválido',async()=>{const {sqlite,request}=database();const log=vi.spyOn(console,'error').mockImplementation(()=>{});try{sqlite.exec(`INSERT INTO aureus_portfolio_events VALUES(1,'x',0,'BUY','{','2026-01-01T00:00:00Z')`);expect((await request()).status).toBe(500)}finally{sqlite.close();log.mockRestore()}})
  it('erro D1 fica somente no log interno',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});try{const response=await aureusTrackRecordRoutes.request('/',{}, {DB:{prepare(){throw new Error('D1_ERROR secret schema internals')}}} as any);expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('secret');expect(log).toHaveBeenCalled()}finally{log.mockRestore()}})
  it.each([
    ['updated_at inválido', 'not-a-time', '1.0', JSON.stringify({quantity:1,originalQuantity:1,entryExecPrice:100,stopLoss:90,target1:null,target2:null,target1Done:false,openedAt:'2026-01-01T00:00:00Z'})],
    ['engine_version vazia', '2026-01-01T00:00:00Z', '', JSON.stringify({quantity:1,originalQuantity:1,entryExecPrice:100,stopLoss:90,target1:null,target2:null,target1Done:false,openedAt:'2026-01-01T00:00:00Z'})],
    ['posição sem stopLoss', '2026-01-01T00:00:00Z', '1.0', JSON.stringify({quantity:1,originalQuantity:1,entryExecPrice:100,target1:null,target2:null,target1Done:false,openedAt:'2026-01-01T00:00:00Z'})],
    ['posição com quantity maior que original', '2026-01-01T00:00:00Z', '1.0', JSON.stringify({quantity:2,originalQuantity:1,entryExecPrice:100,stopLoss:90,target1:null,target2:null,target1Done:false,openedAt:'2026-01-01T00:00:00Z'})],
    ['alvo negativo', '2026-01-01T00:00:00Z', '1.0', JSON.stringify({quantity:1,originalQuantity:1,entryExecPrice:100,stopLoss:90,target1:-5,target2:null,target1Done:false,openedAt:'2026-01-01T00:00:00Z'})],
  ])('F12 recusa estado/posição com estrutura incompleta sem vazar detalhe: %s',async(_label,updatedAt,engine,positionJson)=>{
    const {sqlite,request}=database();const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try{sqlite.prepare('INSERT INTO aureus_portfolio_state VALUES(1,100,?,0,0,0,?,?)').run(positionJson,engine,updatedAt);const response=await request();expect(response.status).toBe(500);expect((await response.json() as any).error).toBe('Falha ao carregar Track Record.')}finally{sqlite.close();log.mockRestore()}
  })
  it('F12 evento com created_at inválido responde erro genérico',async()=>{const {sqlite,request}=database();const log=vi.spyOn(console,'error').mockImplementation(()=>{});try{sqlite.exec(`INSERT INTO aureus_portfolio_events VALUES(1,'x',0,'BUY','{"a":1}','not-a-time')`);const response=await request();expect(response.status).toBe(500);expect((await response.json() as any).error).toBe('Falha ao carregar Track Record.')}finally{sqlite.close();log.mockRestore()}})
})