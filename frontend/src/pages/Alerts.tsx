import { useState, useEffect, useCallback } from 'react'
import { SkeletonCard } from '../components/Skeleton'
import { fmtDateTime, fmtPrice } from '../lib/formatters'
import { apiSend } from '../lib/api'

// ─── Types ───

interface Alert {
  id: number
  created_at: string
  type: 'price' | 'technical' | 'onchain' | 'news' | 'system'
  condition: string
  triggered_at: string | null
  acknowledged: boolean
  payload: Record<string, unknown> | null
}

interface CheckResult {
  checked: number
  triggered: Array<{ id: number; condition: string }>
  current_price: number | null
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

// ─── Labels e formatacao ───

const TYPE_LABEL: Record<string, string> = {
  price: 'Preco',
  technical: 'Tecnico',
  onchain: 'On-Chain',
  news: 'Noticia',
  system: 'Sistema',
}

const TYPE_COLOR: Record<string, string> = {
  price: 'bg-accent-blue/15 text-accent-blue border-accent-blue/30',
  technical: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  onchain: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  news: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
  system: 'bg-dark-text-dim/15 text-dark-text-dim border-dark-text-dim/30',
}

function fmtCondition(type: string, condition: string): string {
  if (condition.startsWith('price_above_')) {
    const price = condition.replace('price_above_', '')
    return `BTC acima de ${fmtPrice(parseFloat(price))}`
  }
  if (condition.startsWith('price_below_')) {
    const price = condition.replace('price_below_', '')
    return `BTC abaixo de ${fmtPrice(parseFloat(price))}`
  }
  if (condition.startsWith('rsi_above_')) {
    return `RSI acima de ${condition.replace('rsi_above_', '')}`
  }
  if (condition.startsWith('rsi_below_')) {
    return `RSI abaixo de ${condition.replace('rsi_below_', '')}`
  }
  return condition
}

function AlertRow({ alert, onAck, onDelete }: {
  alert: Alert
  onAck: (id: number) => void
  onDelete: (id: number) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isTriggered = alert.triggered_at != null
  const isAcked = alert.acknowledged

  return (
    <tr className={`border-b border-dark-bg-border hover:bg-white/[0.02] transition-colors ${
      isTriggered && !isAcked ? 'bg-accent-yellow/[0.04]' : ''
    }`}>
      {/* Type */}
      <td className="py-3 px-3">
        <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border ${TYPE_COLOR[alert.type] ?? 'bg-dark-bg-hover text-dark-text-muted'}`}>
          {TYPE_LABEL[alert.type] ?? alert.type}
        </span>
      </td>

      {/* Condition */}
      <td className="py-3 px-3 text-dark-text-primary text-sm">
        {fmtCondition(alert.type, alert.condition)}
      </td>

      {/* Status */}
      <td className="py-3 px-3">
        {isTriggered ? (
          isAcked ? (
            <span className="text-dark-text-dim text-xs">Visto</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-yellow">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow animate-pulse" />
              Disparado
            </span>
          )
        ) : (
          <span className="text-dark-text-dim text-xs">Ativo</span>
        )}
      </td>

      {/* Date */}
      <td className="py-3 px-3">
        <div className="text-dark-text-secondary text-xs">
          {fmtDateTime(alert.created_at)}
        </div>
        {alert.triggered_at && (
          <div className="text-accent-yellow text-xs mt-0.5">
            Disparo: {fmtDateTime(alert.triggered_at)}
          </div>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 px-3 text-right">
        <div className="flex items-center gap-1.5 justify-end">
          {isTriggered && !isAcked && (
            <button
              onClick={() => onAck(alert.id)}
              className="px-2.5 py-1 bg-accent-blue/15 text-accent-blue text-xs rounded hover:bg-accent-blue/25 transition-colors"
            >
              OK
            </button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDelete(alert.id)}
                className="text-accent-red text-xs font-medium hover:underline"
              >
                Sim
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-dark-text-dim text-xs hover:underline"
              >
                Nao
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-dark-text-dim text-xs hover:text-accent-red transition-colors"
            >
              X
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Alert Form Modal ───

function AlertForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    type: 'price',
    condition_value: '',
    condition_dir: 'above' as 'above' | 'below',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    let condition = ''
    if (form.type === 'price') {
      condition = `price_${form.condition_dir}_${form.condition_value}`
    } else if (form.type === 'technical') {
      condition = `rsi_${form.condition_dir}_${form.condition_value}`
    } else {
      condition = form.condition_value
    }

    try {
      const res = await apiSend('/api/alerts', 'POST', { type: form.type, condition })
      const json: ApiResponse<Alert> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao criar')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-dark-text-primary font-semibold">Novo Alerta</h3>
          <button onClick={onClose} className="text-dark-text-dim hover:text-dark-text-primary text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type */}
          <div>
            <label className="block text-dark-text-dim text-xs mb-1.5">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'price', label: 'Preco' },
                { key: 'technical', label: 'Tecnico (RSI)' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setForm({ ...form, type: t.key })}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    form.type === t.key
                      ? `${TYPE_COLOR[t.key]}`
                      : 'bg-dark-bg text-dark-text-muted border-dark-bg-border hover:border-dark-text-dim'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div>
            <label className="block text-dark-text-dim text-xs mb-1.5">Condicao</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, condition_dir: 'above' })}
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  form.condition_dir === 'above'
                    ? 'bg-accent-green/15 text-accent-green border border-accent-green/40'
                    : 'bg-dark-bg text-dark-text-muted border border-dark-bg-border'
                }`}
              >
                Acima de
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, condition_dir: 'below' })}
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  form.condition_dir === 'below'
                    ? 'bg-accent-red/15 text-accent-red border border-accent-red/40'
                    : 'bg-dark-bg text-dark-text-muted border border-dark-bg-border'
                }`}
              >
                Abaixo de
              </button>
            </div>
          </div>

          {/* Value */}
          <div>
            <label className="block text-dark-text-dim text-xs mb-1">
              {form.type === 'price' ? 'Preco (USD)' : 'Valor RSI (0-100)'}
            </label>
            <input
              type="number"
              step={form.type === 'price' ? '1' : '1'}
              required
              value={form.condition_value}
              onChange={(e) => setForm({ ...form, condition_value: e.target.value })}
              className="w-full bg-dark-bg border border-dark-bg-border rounded-lg px-3 py-2 text-dark-text-primary text-sm font-mono focus:border-accent-blue focus:outline-none transition-colors"
              placeholder={form.type === 'price' ? 'Ex: 100000' : 'Ex: 70'}
            />
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Salvando...' : 'Criar Alerta'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ───

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/alerts`)
      const json: ApiResponse<Alert[]> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao carregar')
      setAlerts(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar alertas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  async function handleCheck() {
    try {
      const res = await apiSend('/api/alerts/check', 'POST')
      const json: ApiResponse<CheckResult> = await res.json()
      if (json.success) {
        setCheckResult(json.data)
        if (json.data.triggered.length > 0) fetchAlerts()
      }
    } catch (err) {
      console.error('Erro na operacao de alerta:', err)
    }
  }

  async function handleAck(id: number) {
    try {
      await apiSend(`/api/alerts/${id}`, 'PUT', { acknowledged: true })
      fetchAlerts()
    } catch (err) {
      console.error('Erro na operacao de alerta:', err)
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await apiSend(`/api/alerts/${id}`, 'DELETE')
      const json: ApiResponse<null> = await res.json()
      if (json.success) fetchAlerts()
    } catch (err) {
      console.error('Erro na operacao de alerta:', err)
    }
  }

  function handleSaved() {
    setShowForm(false)
    fetchAlerts()
  }

  const activeCount = alerts.filter((a) => !a.triggered_at).length
  const triggeredNotAcked = alerts.filter((a) => a.triggered_at && !a.acknowledged).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-xl h-28 sm:h-36 lg:h-[180px]">
        <img src="/assets/alerts-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover hero-parallax-drift" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/90 via-dark-bg/40 to-dark-bg/20" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 lg:p-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text-primary">Alertas</h1>
            <p className="text-dark-text-dim text-xs sm:text-sm mt-0.5 sm:mt-1 hidden sm:block">Notificacoes de preco e condicoes tecnicas</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleCheck} className="px-3 py-2 bg-dark-bg-card border border-dark-bg-border rounded-lg text-dark-text-muted text-sm hover:text-dark-text-primary hover:border-dark-text-dim transition-colors">
              Verificar Agora
            </button>
            <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
              Novo Alerta
            </button>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full bg-dark-text-dim" />
          <span className="text-dark-text-dim">
            {activeCount} ativo{activeCount !== 1 ? 's' : ''}
          </span>
        </div>
        {triggeredNotAcked > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-accent-yellow animate-pulse" />
            <span className="text-accent-yellow font-medium">
              {triggeredNotAcked} disparado{triggeredNotAcked !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Check Result Toast */}
      {checkResult && (
        <div className={`card p-4 border ${
          checkResult.triggered.length > 0
            ? 'border-accent-yellow/30 bg-accent-yellow/[0.03]'
            : 'border-accent-green/20 bg-accent-green/[0.02]'
        }`}>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {checkResult.current_price != null && (
                <span className="text-dark-text-dim">
                  BTC: <span className="text-dark-text-primary font-mono font-medium">{fmtPrice(checkResult.current_price)}</span>
                  <span className="mx-2 text-dark-bg-border">|</span>
                </span>
              )}
              <span className="text-dark-text-dim">
                {checkResult.checked} alerta{checkResult.checked !== 1 ? 's' : ''} verificado{checkResult.checked !== 1 ? 's' : ''}
              </span>
            </div>
            {checkResult.triggered.length > 0 ? (
              <span className="text-accent-yellow text-sm font-medium">
                {checkResult.triggered.length} disparado{checkResult.triggered.length !== 1 ? 's' : ''}
              </span>
            ) : (
              <span className="text-accent-green text-sm">Nenhum disparo</span>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* Alert List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : alerts.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-dark-text-dim text-sm">
            Nenhum alerta configurado. Clique em "Novo Alerta" para criar.
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-dark-bg-border text-dark-text-dim text-xs uppercase tracking-wider">
                  <th className="py-3 px-3 text-left font-medium">Tipo</th>
                  <th className="py-3 px-3 text-left font-medium">Condicao</th>
                  <th className="py-3 px-3 text-left font-medium">Status</th>
                  <th className="py-3 px-3 text-left font-medium">Data</th>
                  <th className="py-3 px-3 text-right font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onAck={handleAck}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showForm && <AlertForm onClose={() => setShowForm(false)} onSaved={handleSaved} />}
    </div>
  )
}
