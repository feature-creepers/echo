import { useEffect, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { readAccent } from './color.ts'
import { COVER, compile, link, sampleSmoothly } from './glsl.ts'
import { GROUND_FRAGMENT } from './ground-shader.ts'
import { ECHO_LENGTH } from './life.ts'
import { useCoreLight } from './light.ts'

/**
 * The ground's light is drawn this many times a second at most while only its pools drift: they are slow, and the
 * core's light is soft. While the core's voice travels through the ground, every frame is drawn.
 */
const FRAMES_A_SECOND = 30

const UNIFORMS = ['size', 'ratio', 'time', 'live', 'accent', 'core', 'glow', 'spot', 'voice', 'voiceShift', 'fine', 'voices', 'travel'] as const

/** Sets the ground up on a canvas, or gives nothing, its context let go, where the graphics card cannot draw it. */
function setUp(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    // Drawn by the processor, a light over the whole window would cost more than it gives: the CSS ground stays.
    failIfMajorPerformanceCaveat: true
  })
  if (!gl) return undefined
  const vertex = compile(gl, gl.VERTEX_SHADER, COVER)
  const program = vertex ? link(gl, vertex, GROUND_FRAGMENT, 'The ground') : undefined
  if (vertex) gl.deleteShader(vertex)
  // The voice's recent past, as the core's own drawing keeps it: one texel a sample, blended between neighbours.
  const voice = gl.createTexture()
  if (!program || !voice) {
    // A context left alive would count against the few the page may hold until it is collected.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return undefined
  }
  gl.useProgram(program)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, voice)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, ECHO_LENGTH, 1)
  sampleSmoothly(gl)
  const at = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, `u_${name}`)])) as Record<
    (typeof UNIFORMS)[number],
    WebGLUniformLocation | null
  >
  gl.uniform1i(at.voice, 0)
  return { gl, program, at, voice }
}

/**
 * The ground of every screen: fine, faint dots under a light that lives. Pools of light drift over them, the core
 * lights the dots round it, where it looks a pool of its light falls, and its voice goes on through the dots round
 * it (`ground-shader.ts`). Where the graphics card cannot draw it, the still CSS ground is drawn instead; with less
 * motion asked for, it is drawn only when the core's light changes. Nothing is drawn while the window is hidden.
 */
export function LivingGround() {
  const box = useRef<HTMLDivElement>(null)
  const light = useCoreLight()
  const [flat, setFlat] = useState(false)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    const ready = setUp(canvas)
    if (!ready) {
      setFlat(true)
      return
    }
    element.append(canvas)
    const { gl, program, at, voice } = ready
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    let accent: [number, number, number] = [0.64, 0.68, 0.73]
    let target = accent
    let readAt = -Infinity
    let time = 0
    let previous = performance.now()
    let drawnAt = -Infinity
    let dirty = true
    let frame = 0
    let lost = false
    let lastLight = ''
    const heard = new Uint8Array(ECHO_LENGTH * 2)

    // The canvas has exactly the window's device pixels, so every dot lands on whole ones.
    let pixels = { width: 0, height: 0, ratio: 1 }
    const measure = (entry?: ResizeObserverEntry) => {
      const ratio = window.devicePixelRatio || 1
      const exact = entry?.devicePixelContentBoxSize?.[0]
      const width = exact ? exact.inlineSize : Math.round(element.clientWidth * ratio)
      const height = exact ? exact.blockSize : Math.round(element.clientHeight * ratio)
      pixels = { width, height, ratio: width / Math.max(1, element.clientWidth) }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      dirty = true
      run()
    }
    const watch = new ResizeObserver(([entry]) => measure(entry))
    try {
      watch.observe(element, { box: 'device-pixel-content-box' })
    } catch {
      watch.observe(element)
    }

    const draw = (now: number) => {
      frame = 0
      const delta = Math.min(0.1, (now - previous) / 1000)
      previous = now
      const moving = !still.matches
      if (now - readAt > 250) {
        const [red, green, blue] = readAccent(element)
        target = [red / 255, green / 255, blue / 255]
        readAt = now
      }
      const ease = 1 - Math.exp(-delta * 8)
      accent = accent.map((value, channel) => value + ((target[channel] ?? value) - value) * ease) as [number, number, number]
      const power = light?.power ?? 0.3
      // The pools drift a little faster as the computer works harder, never so fast that the ground seems to stir.
      if (moving) time += delta * (0.85 + 0.35 * power)
      const core = light?.core
      const spot = light?.spot
      const field = light?.field
      // While the core's voice travels through the ground, every frame counts.
      const fielded = moving && core !== undefined && field !== undefined && field.speaking + field.listening > 0.001
      const shown = `${core?.x.toFixed(1)} ${core?.y.toFixed(1)} ${core?.radius.toFixed(1)} ${light?.glow.toFixed(3)} ${spot?.x.toFixed(1)} ${spot?.y.toFixed(1)} ${spot?.strength.toFixed(3)} ${accent.map((value) => value.toFixed(3)).join()}`
      // Moving, a frame is drawn at a steady, low pace; held still, only when the core's light or the size changes.
      const due = fielded || (moving ? now - drawnAt >= 1000 / FRAMES_A_SECOND - 2 : dirty || shown !== lastLight)
      if (due && pixels.width > 0) {
        drawnAt = now
        dirty = false
        lastLight = shown
        gl.viewport(0, 0, pixels.width, pixels.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(program)
        gl.uniform2f(at.size, pixels.width, pixels.height)
        gl.uniform1f(at.ratio, pixels.ratio)
        gl.uniform1f(at.time, time)
        gl.uniform1f(at.live, moving ? 1 : 0)
        gl.uniform3f(at.accent, accent[0], accent[1], accent[2])
        gl.uniform3f(at.core, core?.x ?? 0, core?.y ?? 0, core?.radius ?? 0)
        gl.uniform1f(at.glow, light?.glow ?? 0)
        gl.uniform4f(at.spot, spot?.x ?? 0, spot?.y ?? 0, spot?.radius ?? 1, spot?.strength ?? 0)
        if (fielded && field) {
          // The voice goes up halved, so a loud voice still fits in a byte, as the core's own drawing sends it.
          const voiced = light?.voice
          for (let index = 0; index < heard.length; index++) heard[index] = Math.round(Math.min(1, (voiced?.[index] ?? 0) / 2) * 255)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, voice)
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ECHO_LENGTH, 1, gl.RG, gl.UNSIGNED_BYTE, heard)
          gl.uniform1f(at.voiceShift, light?.voiceShift ?? 0)
          gl.uniform1f(at.fine, field.fine)
          gl.uniform2f(at.voices, field.speaking, field.listening)
          gl.uniform1f(at.travel, field.travel)
        } else {
          gl.uniform2f(at.voices, 0, 0)
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      run()
    }
    const run = () => {
      if (!frame && !lost && document.visibilityState === 'visible') frame = requestAnimationFrame(draw)
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        cancelAnimationFrame(frame)
        frame = 0
        return
      }
      previous = performance.now()
      run()
    }
    // A lost context (the graphics card reset) leaves the still CSS ground, rather than a blank one, for good: a resize
    // or the window shown again must not start drawing on it.
    const onLost = () => {
      lost = true
      cancelAnimationFrame(frame)
      frame = 0
      canvas.remove()
      setFlat(true)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    document.addEventListener('visibilitychange', onVisibility)
    run()
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteTexture(voice)
      gl.deleteProgram(program)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [light])

  return <div ref={box} aria-hidden="true" className={cn('pointer-events-none absolute inset-0', flat && 'dot-ground')} />
}
