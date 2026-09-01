// Portao de acesso do painel: cadastro e login contra /api/auth no Worker.
// Cada cliente cria a propria conta (nome, email, senha); a senha vira hash
// PBKDF2 no servidor e a sessao e um token opaco guardado no localStorage.
import { useState, type FormEvent } from 'react'
import { getToken, setToken } from '../lib/session'

const API_BASE = import.meta.env.VITE_API_URL || ''

export function isUnlocked(): boolean {
  return getToken() !== null
}

type Mode = 'login' | 'register'

export function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setChecking(true)
    setError(null)
    try {
      const payload = mode === 'register' ? { name, email, password } : { email, password }
      const res = await fetch(`${API_BASE}/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success && json.data?.token) {
        setToken(json.data.token)
        onUnlock()
      } else {
        setError(json?.error || `Erro ${res.status}. Tente novamente.`)
        if (mode === 'login') setPassword('')
      }
    } catch {
      setError('Falha de conexao com o servidor. Tente novamente.')
    } finally {
      setChecking(false)
    }
  }

  const canSubmit =
    email.length > 0 && password.length > 0 && (mode === 'login' || name.trim().length >= 2)

  const inputClass =
    'w-full rounded-lg border border-dark-bg-border bg-dark-bg px-4 py-3 text-sm text-dark-text-primary transition-all placeholder:text-dark-text-dim focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20 focus:outline-none'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-dark-bg p-4">
      {/* ─── Fundo: orbes de luz + grade técnica ─── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-accent-blue/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-accent-green/10 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(rgba(59,130,246,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.07) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%)',
          }}
        />
      </div>

      {/* ─── Card de acesso ─── */}
      <div className="relative w-full max-w-md">
        <div className="card gradient-border-top p-8 sm:p-10 space-y-6 shadow-card-hover">
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-blue/40 bg-dark-bg-elevated shadow-[0_0_30px_rgba(59,130,246,0.25)]">
              <span className="text-2xl font-bold text-accent-blue">₿</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-dark-text-primary">BTC Radar</h1>
              <p className="mt-1.5 text-sm text-dark-text-muted">
                {mode === 'login'
                  ? 'Entre com seu email e senha para acessar o painel.'
                  : 'Crie sua conta para acessar o painel.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-lg border border-dark-bg-border bg-dark-bg p-1">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-accent-blue text-white'
                  : 'text-dark-text-muted hover:text-dark-text-primary'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'register'
                  ? 'bg-accent-blue text-white'
                  : 'text-dark-text-muted hover:text-dark-text-primary'
              }`}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label htmlFor="gate-name" className="text-xs font-medium uppercase tracking-wider text-dark-text-muted">
                  Nome
                </label>
                <input
                  id="gate-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  autoComplete="name"
                  className={inputClass}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="gate-email" className="text-xs font-medium uppercase tracking-wider text-dark-text-muted">
                Email
              </label>
              <input
                id="gate-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                autoFocus
                autoComplete="email"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="gate-password" className="text-xs font-medium uppercase tracking-wider text-dark-text-muted">
                Senha
              </label>
              <input
                id="gate-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Minimo 8 caracteres' : '••••••••'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className={`${inputClass} font-mono`}
              />
            </div>
            {error && (
              <p className="text-sm text-accent-red" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={checking || !canSubmit}
              className="w-full rounded-lg bg-accent-blue px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-blue-500 hover:shadow-[0_0_24px_rgba(59,130,246,0.4)] focus:outline-none focus:ring-2 focus:ring-accent-blue/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? 'Verificando...' : mode === 'login' ? 'Entrar no painel' : 'Criar conta e entrar'}
            </button>
          </form>

          <p className="text-center text-xs text-dark-text-dim">
            Preço, on-chain e sentimento em tempo real.
          </p>
        </div>
      </div>
    </div>
  )
}
