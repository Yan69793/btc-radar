export function Footer() {
  return (
    <footer className="h-8 border-t border-dark-bg-border flex items-center px-3 sm:px-4 lg:px-6 bg-dark-bg-card shrink-0 gap-2">
      <div className="text-dark-text-dim text-[10px] sm:text-xs truncate">
        BTC Radar · CoinPaprika, Alternative.me
      </div>
      <div className="ml-auto text-dark-text-dim text-[10px] sm:text-xs shrink-0">
        {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </footer>
  )
}
