import { NavLink } from 'react-router-dom'
import { navItems } from './navItems'

export function Sidebar() {
  return (
    <aside className="w-56 bg-sidebar flex flex-col shrink-0 border-r border-sidebar-border h-full">
      {/* Wordmark */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="text-sidebar-text-active font-semibold text-sm leading-tight">
          Aureus
        </div>
        <div className="text-sidebar-text text-[11px] font-mono">v0.8.0</div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-sidebar-active-bg text-sidebar-text-active font-medium'
                  : 'text-sidebar-text hover:text-sidebar-text-active hover:bg-white/[0.04]'
              }`
            }
          >
            <span className="shrink-0">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="text-sidebar-text text-[11px] leading-relaxed">
          <div>BTC/USD via OKX</div>
          <div className="mt-0.5 opacity-60">OKX · Alternative.me</div>
        </div>
      </div>
    </aside>
  )
}
