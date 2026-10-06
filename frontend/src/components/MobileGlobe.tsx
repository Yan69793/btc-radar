// Globo híbrido do hero mobile: Three.js quando o dispositivo suporta WebGL,
// PNG 2D estático como fallback determinístico em qualquer outro caso
// (viewport desktop, prefers-reduced-motion, sem WebGL, falha de import do
// chunk `three`, textura ausente ou perda de contexto WebGL).
//
// O 2D nunca sai do DOM: o 3D só o cobre (classe `is-3d` no container) depois
// do primeiro frame renderizado com sucesso. Se qualquer etapa falhar, o
// fallback simplesmente continua visível — não existe estado intermediário
// com o hero vazio.
import { useEffect, useRef, useState } from 'react'
import { asset } from '../lib/assets'
import { getScrollParent, readScrollTop } from '../lib/scroll'

const MOBILE_QUERY = '(max-width: 639px)'
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
const COARSE_QUERY = '(pointer: coarse)'
const MAX_PIXEL_RATIO = 1.6
const SCROLL_WINDOW = 240

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
  } catch {
    return false
  }
}

export function MobileGlobe() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const mobile = window.matchMedia(MOBILE_QUERY)
    const reduced = window.matchMedia(REDUCED_QUERY)
    // Janela de desktop estreitada não deve baixar o chunk do three.
    const coarse = window.matchMedia(COARSE_QUERY)

    let disposed = false
    let booting = false
    let teardown: (() => void) | null = null

    const earth = () => host.closest<HTMLElement>('.btc-cinematic-earth')

    const reset = () => {
      teardown?.()
      teardown = null
      host.replaceChildren()
      earth()?.classList.remove('is-3d')
      host.classList.remove('is-active')
      setActive(false)
    }

    const boot = async () => {
      if (disposed || booting || teardown) return
      if (!mobile.matches || !coarse.matches || reduced.matches || !webglAvailable()) return
      booting = true

      const THREE = await import('three').catch(() => null)
      booting = false
      if (disposed || !THREE) return

      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: (window.devicePixelRatio || 1) <= 1.5,
          powerPreference: 'high-performance',
        })
      } catch {
        return
      }

      const canvas = renderer.domElement
      canvas.setAttribute('aria-hidden', 'true')

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
      camera.position.set(0, 0, 3.35)

      // O eixo inclinado vive no grupo; a esfera só gira em y/x.
      const tilt = new THREE.Group()
      tilt.rotation.z = -0.41
      const geometry = new THREE.SphereGeometry(1, 64, 64)
      const material = new THREE.MeshStandardMaterial({ color: 0x0b2430, roughness: 0.92, metalness: 0.04 })
      const sphere = new THREE.Mesh(geometry, material)
      tilt.add(sphere)
      scene.add(tilt)

      scene.add(new THREE.HemisphereLight(0x6fe6d6, 0x050b12, 1.05))
      const key = new THREE.DirectionalLight(0xffb13b, 1.6)
      key.position.set(3, 1.4, 3.6)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0x41d9d0, 1.15)
      rim.position.set(-3.6, 0.4, 1.8)
      scene.add(rim)

      let texture: InstanceType<typeof THREE.Texture> | null = null
      new THREE.TextureLoader().load(
        asset('/assets/earth-night-nasa.png'),
        (loaded) => {
          if (disposed) {
            loaded.dispose()
            return
          }
          loaded.colorSpace = THREE.SRGBColorSpace
          loaded.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
          texture = loaded
          material.map = loaded
          material.color.set(0xffffff)
          material.needsUpdate = true
        },
        undefined,
        () => {
          // Sem textura o globo segue legível como esfera iluminada; não vale
          // derrubar o 3D por causa de um asset que pode chegar depois.
        }
      )

      // ── Estado de interação ────────────────────────────────────────────
      let spin = 0
      let dragY = 0
      let dragX = 0
      let hoverY = 0
      let hoverX = 0
      let scrollProgress = 0
      let scrollLean = 0
      let currentY = 0
      let currentX = 0
      let dragging = false
      let lastX = 0
      let lastY = 0

      let running = false
      let visible = true
      let frame = 0

      const scroller = getScrollParent(host)

      const resize = () => {
        const rect = host.getBoundingClientRect()
        const size = Math.max(1, Math.round(Math.min(rect.width || 0, rect.height || 0)))
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
        renderer.setSize(size, size, false)
        camera.aspect = 1
        camera.updateProjectionMatrix()
      }

      const frameLoop = () => {
        if (!running) return
        spin += 0.0016
        currentY += (spin + dragY + hoverY + scrollLean - currentY) * 0.08
        currentX += (dragX + hoverX - currentX) * 0.08
        sphere.rotation.y = currentY
        sphere.rotation.x = currentX
        sphere.scale.setScalar(1 - scrollProgress * 0.12)
        renderer.render(scene, camera)
        frame = requestAnimationFrame(frameLoop)
      }

      const start = () => {
        if (running || disposed || !visible || document.hidden) return
        running = true
        frame = requestAnimationFrame(frameLoop)
      }

      const pause = () => {
        running = false
        if (frame) cancelAnimationFrame(frame)
        frame = 0
      }

      const onScroll = () => {
        const top = clamp(readScrollTop(scroller), 0, SCROLL_WINDOW)
        scrollProgress = top / SCROLL_WINDOW
      }

      const onPointerDown = (event: PointerEvent) => {
        dragging = true
        lastX = event.clientX
        lastY = event.clientY
        try {
          host.setPointerCapture(event.pointerId)
        } catch {
          /* captura é opcional */
        }
      }

      const onPointerMove = (event: PointerEvent) => {
        if (dragging) {
          dragY = clamp(dragY + (event.clientX - lastX) * 0.008, -1.1, 1.1)
          dragX = clamp(dragX + (event.clientY - lastY) * 0.005, -0.5, 0.5)
          lastX = event.clientX
          lastY = event.clientY
          return
        }
        const rect = host.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        hoverY = ((event.clientX - rect.left) / rect.width - 0.5) * 0.3
        hoverX = ((event.clientY - rect.top) / rect.height - 0.5) * 0.18
      }

      const onPointerUp = (event: PointerEvent) => {
        dragging = false
        try {
          host.releasePointerCapture(event.pointerId)
        } catch {
          /* já liberado */
        }
      }

      const onVisibility = () => {
        if (document.hidden) pause()
        else start()
      }

      const onContextLost = (event: Event) => {
        event.preventDefault()
        reset()
      }

      const onMediaChange = () => {
        if (!mobile.matches || reduced.matches) reset()
      }

      const observer = new IntersectionObserver(
        (entries) => {
          visible = entries[0]?.isIntersecting ?? true
          if (visible) start()
          else pause()
        },
        { threshold: 0.01 }
      )

      host.appendChild(canvas)
      resize()
      onScroll()

      const hostEl = earth() ?? host
      observer.observe(hostEl)

      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(host)

      canvas.addEventListener('webglcontextlost', onContextLost, false)
      host.addEventListener('pointerdown', onPointerDown, { passive: true })
      host.addEventListener('pointermove', onPointerMove, { passive: true })
      host.addEventListener('pointerup', onPointerUp, { passive: true })
      host.addEventListener('pointercancel', onPointerUp, { passive: true })
      host.addEventListener('pointerleave', onPointerUp, { passive: true })
      scroller?.addEventListener('scroll', onScroll, { passive: true })
      if (!scroller) window.addEventListener('scroll', onScroll, { passive: true })
      document.addEventListener('visibilitychange', onVisibility)
      mobile.addEventListener('change', onMediaChange)
      reduced.addEventListener('change', onMediaChange)

      // Primeiro frame antes de revelar: sem flash de canvas vazio.
      renderer.render(scene, camera)
      host.classList.add('is-active')
      earth()?.classList.add('is-3d')
      setActive(true)
      start()

      teardown = () => {
        pause()
        observer.disconnect()
        resizeObserver.disconnect()
        canvas.removeEventListener('webglcontextlost', onContextLost)
        host.removeEventListener('pointerdown', onPointerDown)
        host.removeEventListener('pointermove', onPointerMove)
        host.removeEventListener('pointerup', onPointerUp)
        host.removeEventListener('pointercancel', onPointerUp)
        host.removeEventListener('pointerleave', onPointerUp)
        scroller?.removeEventListener('scroll', onScroll)
        if (!scroller) window.removeEventListener('scroll', onScroll)
        document.removeEventListener('visibilitychange', onVisibility)
        mobile.removeEventListener('change', onMediaChange)
        reduced.removeEventListener('change', onMediaChange)
        texture?.dispose()
        material.dispose()
        geometry.dispose()
        renderer.dispose()
        try {
          renderer.forceContextLoss()
        } catch {
          /* já perdido */
        }
        canvas.remove()
      }
    }

    const onMediaSync = () => {
      if (!mobile.matches || reduced.matches) reset()
      else void boot()
    }

    void boot()
    mobile.addEventListener('change', onMediaSync)
    reduced.addEventListener('change', onMediaSync)

    return () => {
      disposed = true
      mobile.removeEventListener('change', onMediaSync)
      reduced.removeEventListener('change', onMediaSync)
      reset()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className={`btc-mobile-globe3d ${active ? 'is-active' : ''}`}
      aria-hidden="true"
    />
  )
}
