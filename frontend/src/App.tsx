import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { PlatformHeader } from './components/layout/PlatformHeader'
import { Footer } from './components/layout/Footer'
import { BottomNav } from './components/layout/BottomNav'
import { SkeletonCard } from './components/Skeleton'
import { PasswordGate, isUnlocked } from './components/PasswordGate'
import { getToken, clearToken } from './lib/session'

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Signals = lazy(() => import('./pages/Signals').then((m) => ({ default: m.Signals })))
const OnChain = lazy(() => import('./pages/OnChain').then((m) => ({ default: m.OnChain })))
const Trades = lazy(() => import('./pages/Trades').then((m) => ({ default: m.Trades })))
const Alerts = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.Alerts })))
const Backtest = lazy(() => import('./pages/Backtest').then((m) => ({ default: m.Backtest })))
const Portfolio = lazy(() => import('./pages/Portfolio').then((m) => ({ default: m.Portfolio })))
const Briefing = lazy(() => import('./pages/Briefing').then((m) => ({ default: m.Briefing })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

function PageFallback() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-dark-bg p-4 text-dark-text-primary">
          <div className="card w-full max-w-md space-y-4 p-6 text-center sm:p-8">
            <div className="text-xl font-bold text-accent-red sm:text-2xl">Erro</div>
            <p className="text-sm text-dark-text-muted">{this.state.error || 'Erro inesperado ao renderizar a aplicaÃ§Ã£o.'}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-dark-bg"
            >
              Recarregar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    const baseUrl = import.meta.env.VITE_API_URL || ''
    fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401) {
          clearToken()
          setUnlocked(false)
        }
      })
      .catch(() => {})
  }, [])

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  return (
    <ErrorBoundary>
      <BrowserRouter basename="/painel">
        <div className="btc-platform-shell">
          <PlatformHeader />
          <main className="btc-platform-main">
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/signals" element={<Signals />} />
                <Route path="/onchain" element={<OnChain />} />
                <Route path="/trades" element={<Trades />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/backtest" element={<Backtest />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/briefing" element={<Briefing />} />
                <Route path="/settings" element={<Settings />} />`r`n
              </Routes>
            </Suspense>
          </main>
          <div className="hidden lg:block"><Footer /></div>
          <BottomNav />
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  )
}


