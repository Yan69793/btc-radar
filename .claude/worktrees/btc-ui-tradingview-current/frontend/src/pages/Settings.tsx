import { useState, useEffect, useCallback } from 'react'
import { SkeletonCard } from '../components/Skeleton'
import type { ApiResponse, WhatsAppSubscriber } from '../types'
import { apiSend } from '../lib/api'
import { PageHeader } from '../components/PageHeader'

export function Settings() {
  // ─── WhatsApp subscription state ───
  const [phone, setPhone] = useState('')
  const [subscriber, setSubscriber] = useState<WhatsAppSubscriber | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testSending, setTestSending] = useState(false)

  // Preferences toggles
  const [prefs, setPrefs] = useState({
    signals: true,
    alerts: true,
    briefing: false,
  })

  const fetchSubscriber = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/whatsapp/subscribers`)
      const json: ApiResponse<WhatsAppSubscriber[]> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao carregar')
      // Load first (most recent) subscriber as this is single-user
      const sub = json.data[0] ?? null
      setSubscriber(sub)
      if (sub) {
        setPhone(sub.phone)
        setPrefs(sub.preferences)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSubscriber()
  }, [fetchSubscriber])

  // ─── Subscribe / Update ───
  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)

    const normalized = phone.replace(/[\s+()\-]/g, '')
    if (!/^\d{10,15}$/.test(normalized)) {
      setError('Numero de telefone invalido. Use DDI + DDD + numero (ex: 5511999999999)')
      setSaving(false)
      return
    }

    try {
      const res = await apiSend('/api/whatsapp/subscribe', 'POST', { phone: normalized, preferences: prefs })
      const json: ApiResponse<{ phone: string; active: boolean }> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao cadastrar')
      setSuccess('Assinatura WhatsApp ativada com sucesso.')
      fetchSubscriber()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar')
    } finally {
      setSaving(false)
    }
  }

  // ─── Unsubscribe ───
  async function handleUnsubscribe() {
    if (!subscriber) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiSend(`/api/whatsapp/subscribe/${subscriber.phone}`, 'DELETE')
      const json: ApiResponse<{ deleted: boolean }> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao remover')
      setSubscriber(null)
      setPhone('')
      setSuccess('Assinatura WhatsApp removida.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover')
    } finally {
      setSaving(false)
    }
  }

  // ─── Send test ───
  async function handleTest() {
    if (!subscriber) return
    setTestSending(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await apiSend('/api/whatsapp/test', 'POST', { phone: subscriber.phone })
      const json: ApiResponse<{ messageId: string }> = await res.json()
      if (!json.success) throw new Error(json.error || 'Erro ao enviar teste')
      setSuccess('Mensagem de teste enviada. Verifique seu WhatsApp.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar teste')
    } finally {
      setTestSending(false)
    }
  }

  // ─── Update preferences ───
  async function handlePrefToggle(key: 'signals' | 'alerts' | 'briefing') {
    const updated = { ...prefs, [key]: !prefs[key] }
    setPrefs(updated)

    if (subscriber) {
      try {
        await apiSend('/api/whatsapp/subscribe', 'POST', { phone: subscriber.phone, preferences: updated })
      } catch { /* silent */ }
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Conta"
        title="Configurações"
        poster="/assets/film-acao.png"
        meta="Preferências de notificação e canais"
        context="SETTINGS"
      />

      {/* Status messages */}
      {error && (
        <div className="card p-4 border-red-500/20 text-red-400 text-sm">{error}</div>
      )}
      {success && (
        <div className="card p-4 border-accent-green/20 text-accent-green text-sm">{success}</div>
      )}

      {/* WhatsApp Section */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <div>
            <h2 className="text-dark-text-primary font-semibold text-base">WhatsApp</h2>
            <p className="text-dark-text-dim text-xs">
              Receba sinais de trading e alertas direto no WhatsApp
            </p>
          </div>
        </div>

        {loading ? (
          <SkeletonCard />
        ) : subscriber?.active ? (
          <>
            {/* Active subscription */}
            <div className="bg-accent-green/[0.06] border border-accent-green/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-dark-text-primary text-sm font-medium">
                    Assinatura Ativa
                  </div>
                  <div className="text-dark-text-dim text-xs mt-0.5">
                    {subscriber.phone}
                  </div>
                </div>
                <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-dark-text-dim">
                <div>
                  <span className="block text-dark-text-muted">Desde</span>
                  {new Date(subscriber.subscribed_at).toLocaleDateString('pt-BR')}
                </div>
                <div>
                  <span className="block text-dark-text-muted">Enviadas</span>
                  {subscriber.notification_count} notificacoes
                </div>
              </div>
            </div>

            {/* Preferences toggles */}
            <div className="space-y-2">
              <h3 className="text-dark-text-primary text-sm font-medium">Preferencias de Notificacao</h3>
              {[
                { key: 'signals' as const, label: 'Sinais de Trading', desc: 'Sinais de alta conviccao (COMPRAR/VENDER, conviccao >= 6)' },
                { key: 'alerts' as const, label: 'Alertas de Preco', desc: 'Quando o preco atingir seus limites configurados' },
                { key: 'briefing' as const, label: 'Briefing Diario', desc: 'Resumo diario do mercado gerado por IA (19h BRT)' },
              ].map((item) => (
                <label key={item.key} className="flex items-center justify-between p-3 rounded-lg bg-dark-bg-hover/50 hover:bg-dark-bg-hover transition-colors cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="text-dark-text-primary text-sm">{item.label}</div>
                    <div className="text-dark-text-dim text-xs mt-0.5">{item.desc}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs[item.key]}
                    onClick={() => handlePrefToggle(item.key)}
                    className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
                      prefs[item.key] ? 'bg-accent-green' : 'bg-dark-text-dim/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                        prefs[item.key] ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </label>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleTest}
                disabled={testSending}
                className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {testSending ? 'Enviando...' : 'Enviar Teste'}
              </button>
              <button
                onClick={handleUnsubscribe}
                disabled={saving}
                className="px-4 py-2 border border-red-500/30 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/10 disabled:opacity-50 transition-colors"
              >
                {saving ? '...' : 'Desativar'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Subscribe form */}
            <form onSubmit={handleSubscribe} className="space-y-4">
              <div>
                <label htmlFor="wa-phone" className="block text-dark-text-muted text-xs font-medium mb-1.5">
                  Numero do WhatsApp
                </label>
                <input
                  id="wa-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="5511999999999"
                  className="w-full px-3 py-2.5 bg-dark-bg-hover border border-dark-bg-border rounded-lg text-dark-text-primary text-sm placeholder-dark-text-dim/50 focus:outline-none focus:border-accent-blue transition-colors"
                />
                <div className="text-dark-text-dim text-[11px] mt-1">
                  Formato: DDI + DDD + numero. Ex: 5511999999999
                </div>
              </div>

              {/* Prefs on subscribe */}
              <div className="space-y-1.5">
                <div className="text-dark-text-muted text-xs font-medium">O que voce quer receber?</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'signals' as const, label: 'Sinais' },
                    { key: 'alerts' as const, label: 'Alertas' },
                    { key: 'briefing' as const, label: 'Briefing' },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center gap-2 p-2 rounded-lg bg-dark-bg-hover/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={prefs[item.key]}
                        onChange={() => setPrefs((p) => ({ ...p, [item.key]: !p[item.key] }))}
                        className="w-3.5 h-3.5 rounded accent-accent-blue"
                      />
                      <span className="text-dark-text-primary text-xs">{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || phone.length < 10}
                className="w-full px-4 py-2.5 text-white rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50"
                style={{
                  background: saving ? undefined : 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
                }}
              >
                {saving ? 'Ativando...' : 'Ativar WhatsApp'}
              </button>
            </form>

            <div className="text-dark-text-dim text-xs space-y-1">
              <p>Ao ativar, voce recebera uma mensagem de confirmacao no WhatsApp.</p>
              <p>Comandos disponiveis: ATIVAR, SINAIS, STATUS, PAUSAR, RETOMAR, AJUDA.</p>
            </div>
          </>
        )}
      </div>

      {/* Info card */}
      <div className="card p-5 border-accent-blue/20 bg-accent-blue/[0.02]">
        <div className="flex items-start gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            className="text-accent-blue mt-0.5 shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <div className="text-sm">
            <div className="text-dark-text-primary font-medium mb-1">
              Como funciona
            </div>
            <div className="text-dark-text-dim space-y-1">
              <p>Os sinais sao gerados a cada hora com base em 6 estrategias tecnicas em 3 horizontes.</p>
              <p>Voce recebe apenas sinais de alta conviccao (COMPRAR/VENDER ou conviccao 6+/10) para evitar ruido.</p>
              <p>Responda *SINAIS* no WhatsApp a qualquer momento para receber os sinais atuais.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
