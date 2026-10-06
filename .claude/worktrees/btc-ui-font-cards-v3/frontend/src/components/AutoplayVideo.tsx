import { useEffect, useRef, useState } from 'react'

interface AutoplayVideoProps {
  src: string
  poster?: string
  className?: string
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Video decorativo com autoplay silencioso e fallback para o poster.
 *
 * Em WebView de app (WhatsApp, Instagram) e iOS em modo de baixo consumo o
 * autoplay e recusado e o browser desenha o botao de play nativo por cima. Aqui
 * o video e trocado pelo poster nesse caso, entao o botao nunca aparece.
 */
export function AutoplayVideo({ src, poster, className }: AutoplayVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [fallback, setFallback] = useState(prefersReducedMotion)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let settled = false
    const giveUp = () => {
      if (!settled) {
        settled = true
        setFallback(true)
      }
    }

    let stallTimer = 0

    const attempt = () => {
      if (settled || document.hidden) return
      video.play().catch(giveUp)

      // Alguns WebViews recusam o autoplay sem rejeitar a promise. So conta
      // como recusa se ficou parado: buffer lento mantem `paused` em false.
      window.clearTimeout(stallTimer)
      stallTimer = window.setTimeout(() => {
        if (!document.hidden && video.paused && video.currentTime === 0) giveUp()
      }, 4000)
    }

    attempt()
    document.addEventListener('visibilitychange', attempt)

    return () => {
      window.clearTimeout(stallTimer)
      document.removeEventListener('visibilitychange', attempt)
    }
  }, [src])

  if (fallback) {
    return poster ? <img src={poster} alt="" className={className} /> : null
  }

  return (
    <video
      ref={(el) => {
        videoRef.current = el
        if (el) {
          // React nao renderiza o atributo `muted`, so a propriedade. WebKit
          // exige a marca de mudo antes do primeiro load pra liberar autoplay.
          el.defaultMuted = true
          el.muted = true
        }
      }}
      src={src}
      poster={poster}
      className={className}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      controls={false}
    />
  )
}
