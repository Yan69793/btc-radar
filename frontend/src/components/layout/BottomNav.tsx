// Navegação mobile (abaixo de lg): quatro destinos diretos e um "Mais" que abre
// um sheet com o restante. O sheet fecha no Escape e devolve o foco ao botão.
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { navItems } from './navItems'

const primaryItems = navItems.filter((item) => item.primary)
const secondaryItems = navItems.filter((item) => !item.primary)

const tabClass = (active: boolean) =>
  `flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
    active ? 'text-accent-yellow' : 'text-dark-text-muted hover:text-dark-text-primary'
  }`

export function BottomNav() {
  const [open, setOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const secondaryActive = secondaryItems.some((item) => pathname.startsWith(item.to))

  const close = () => {
    setOpen(false)
    moreRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    sheetRef.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="flex shrink-0 border-t border-dark-bg-border bg-dark-bg pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {primaryItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => tabClass(isActive)}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <button
          ref={moreRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={tabClass(secondaryActive)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
          Mais
        </button>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={close} aria-hidden="true" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mais seções"
            className="absolute inset-x-0 bottom-0 rounded-t-lg border-t border-dark-bg-border bg-dark-bg-card pb-[env(safe-area-inset-bottom)] animate-slide-up"
          >
            <div className="eyebrow px-5 pt-4 pb-2">Mais seções</div>
            <ul className="pb-2">
              {secondaryItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex min-h-[48px] items-center gap-3 px-5 text-sm ${
                        isActive ? 'text-accent-yellow' : 'text-dark-text-secondary hover:text-dark-text-primary'
                      }`
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
