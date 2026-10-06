// O painel roda dentro de um scroller interno (`.btc-platform-main`), não no
// documento: `window.scrollY` fica permanentemente em 0 e qualquer coreografia
// de scroll amarrada à janela nunca dispara. Este helper devolve o container
// que realmente rola, com a janela como último recurso.
export function getScrollParent(node: Element | null): HTMLElement | null {
  let el: HTMLElement | null = node?.parentElement ?? null
  while (el) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const { overflowY } = window.getComputedStyle(el)
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return el
    }
    el = el.parentElement
  }
  return null
}

export function readScrollTop(scroller: HTMLElement | null): number {
  if (scroller) return scroller.scrollTop
  return window.scrollY || document.documentElement.scrollTop || 0
}
