// Resolve caminho de asset estático do painel.
//
// O painel é servido em `/painel/` (base do Vite) e os arquivos de `public/`
// vão para `/painel/assets/`. Referência absoluta a `/assets/...` cai no
// fallback de SPA do Pages, que devolve HTML com status 200, e o browser
// desenha o ícone de imagem quebrada em vez do arquivo. BASE_URL resolve os
// dois casos sem hardcode de prefixo.
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
