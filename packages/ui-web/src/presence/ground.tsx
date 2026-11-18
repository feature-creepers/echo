import { useEffect, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { GROUND_FRAGMENT, GROUND_VERTEX } from './ground-shader.ts'
import { ECHO_LENGTH } from './life.ts'
import { useCoreLight } from './light.ts'

/**
 * The ground's light is drawn this many times a second at most while only its pools drift: they are slow, and the
 * core's light is soft. While the core's field shows, something travels through the ground, and every frame is drawn.
 */
const FRAMES_A_SECOND = 30

const UNIFORMS = ['size', 'ratio', 'time', 'live', 'accent', 'core', 'glow', 'spot', 'voice', 'voiceShift', 'fine', 'phase', 'phaseAt'] as const

/** Reads a CSS colour as red, green and blue from 0 to 1. */
function readColor(probe: CanvasRenderingContext2D, value: string): [number, number, number] {
  probe.fillStyle = '#000'
  probe.fillStyle = value
  probe.clearRect(0, 0, 1, 1)
  probe.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data
  return [r / 255, g / 255, b / 255]
}

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
  const shader = (type: number, source: string) => {
    const made = gl.createShader(type)
    if (!made) return undefined
    gl.shaderSource(made, source)
    gl.compileShader(made)
    return made
  }
  const vertex = shader(gl.VERTEX_SHADER, GROUND_VERTEX)
  const fragment = shader(gl.FRAGMENT_SHADER, GROUND_FRAGMENT)
  const program = gl.createProgram()
  // The voice's recent past, as the core's own drawing keeps it: one texel a sample, blended between neighbours.
  const voice = gl.createTexture()
  if (!vertex || !fragment || !program || !voice) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('The ground could not be drawn on the graphics card:', gl.getShaderInfoLog(fragment) || gl.getProgramInfoLog(program))
    return undefined
  }
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  gl.useProgram(program)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, voice)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, ECHO_LENGTH, 1)
  for (const [name, value] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]
  ] as const)
    gl.texParameteri(gl.TEXTURE_2D, name, value)
  const at = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, `u_${name}`)])) as Record<
    (typeof UNIFORMS)[number],
    WebGLUniformLocation | null
  >
  gl.uniform1i(at.voice, 0)
  return { gl, program, at, voice }
}

/**
 * The ground of every screen: fine, faint dots under a light that lives. Pools of light drift over them, the core
 * lights the dots round it, where it looks a pool of its light falls, and what the core does goes on through the
 * dots round it: its voice, its sweep, its beat, its waking (`ground-shader.ts`). Where the graphics card cannot
 * draw it, or less motion is asked for and nothing would move, the still CSS ground is drawn instead. Nothing is
 * drawn while the window is hidden.
 */
export function LivingGround({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const light = useCoreLight()
  const [flat, setFlat] = useState(false)

  useEffect(() => {
    const element = box.current
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!element || !probe) return
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

    let accent: [number, number, number] = [0.64, 0.68, 0.73]
    let target = accent
    let readAt = -Infinity
    let time = 0
    let previous = performance.now()
    let drawnAt = -Infinity
    let dirty = true
    let frame = 0
    let lastLight = ''
    const heard = new Uint8Array(ECHO_LENGTH * 2)

    const draw = (now: number) => {
      frame = 0
      const delta = Math.min(0.1, (now - previous) / 1000)
      previous = now
      const moving = !still.matches
      if (now - readAt > 250) {
        target = readColor(probe, getComputedStyle(element).getPropertyValue('--accent').trim() || '#a4adbb')
        readAt = now
      }
      const ease = 1 - Math.exp(-delta * 8)
      accent = accent.map((value, channel) => value + ((target[channel] ?? value) - value) * ease) as [number, number, number]
      const power = light?.power ?? 0.3
      if (moving) time += delta * (0.75 + 0.7 * power)
      const core = light?.core
      const spot = light?.spot
      const field = light?.field
      // While something of the core's field travels through the ground, every frame counts.
      const fielded =
        moving && core !== undefined && field !== undefined && (field.speaking + field.listening + field.sweep + field.beat > 0.001 || field.wave < 0.999)
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
          gl.uniform4f(at.phase, field.speaking, field.listening, field.sweep, field.beat)
          gl.uniform4f(at.phaseAt, field.sweepAt, field.beatAt, field.wave, field.travel)
        } else {
          gl.uniform4f(at.phase, 0, 0, 0, 0)
          gl.uniform4f(at.phaseAt, 0, 1, 1, 0)
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      run()
    }
    const run = () => {
      if (!frame && document.visibilityState === 'visible') frame = requestAnimationFrame(draw)
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
    // A lost context (the graphics card reset) leaves the still CSS ground, rather than a blank one.
    const onLost = () => {
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

  return <div ref={box} aria-hidden="true" className={cn('pointer-events-none absolute inset-0', flat && 'dot-ground', className)} />
}
