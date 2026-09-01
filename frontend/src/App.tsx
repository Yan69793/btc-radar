import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { Footer } from './components/layout/Footer'
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
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
        <div className="flex items-center justify-center min-h-screen bg-dark-bg text-dark-text-primary p-4">
          <div className="card p-6 sm:p-8 max-w-md w-full text-center space-y-4">
            <div className="text-xl sm:text-2xl font-bold text-accent-red">Erro</div>
            <p className="text-dark-text-muted text-sm">
              {this.state.error || 'Erro inesperado ao renderizar a aplicacao.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="px-4 py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unlocked, setUnlocked] = useState(isUnlocked)
  const closeSidebar = () => setSidebarOpen(false)

  // Valida o token no servidor; sessao expirada ou forjada volta ao login.
  // Falha de rede nao tranca (o painel ja lida com API fora do ar).
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
      .catch(() => { /* rede indisponivel */ })
  }, [])

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />
  }

  return (
    <ErrorBoundary>
      <BrowserRouter basename="/painel">
        <div className="flex h-dvh-safe overflow-hidden bg-dark-bg">
          {/* Mobile overlay backdrop */}
          <div
            className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
              sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onClick={closeSidebar}
            aria-hidden="true"
          />

          {/* Sidebar: fixed overlay on mobile, static on desktop */}
          <div
            className={`fixed lg:relative inset-y-0 left-0 z-50 w-56 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <Sidebar onNavigate={closeSidebar} />
          </div>

          {/* Main content */}
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <TopBar onMenuClick={() => setSidebarOpen(true)} />
            <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
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
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Suspense>
            </main>
            <Footer />
          </div>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
