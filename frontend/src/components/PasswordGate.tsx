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

  const tabClass = (active: boolean) =>
    `-mb-px border-b-2 pb-2 text-sm font-medium transition-colors ${
      active
        ? 'border-accent-yellow text-dark-text-primary'
        : 'border-transparent text-dark-text-muted hover:text-dark-text-primary'
    }`

  return (
    <div className="flex min-h-screen bg-dark-bg px-4 py-10 sm:px-8 sm:py-16">
      <div className="w-full max-w-sm sm:ml-[8vw] sm:mt-[6vh]">
        <div className="eyebrow">Painel</div>
        <h1 className="mt-2 text-2xl font-medium tracking-tight text-dark-text-primary">Aureus</h1>
        <p className="mt-1 text-sm text-dark-text-muted">Preço, on-chain e sentimento do Bitcoin.</p>

        <div className="card mt-8 space-y-6 p-5 sm:p-6">
          <div role="tablist" className="flex gap-6 border-b border-dark-bg-border">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => switchMode('login')}
              className={tabClass(mode === 'login')}
            >
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => switchMode('register')}
              className={tabClass(mode === 'register')}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label htmlFor="gate-name" className="eyebrow block">
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
              <label htmlFor="gate-email" className="eyebrow block">
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
              <label htmlFor="gate-password" className="eyebrow block">
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
              className="w-full rounded-md bg-accent-blue px-4 py-3 text-sm font-medium text-dark-bg transition-colors hover:brightness-110 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? 'Verificando...' : mode === 'login' ? 'Entrar no painel' : 'Criar conta e entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
