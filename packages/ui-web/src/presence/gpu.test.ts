// @vitest-environment jsdom
// jsdom has no graphics card: each canvas's contexts are stand-ins that count what is asked of them.
import { LOOKS } from '@repo/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLife } from './life.ts'

/** A WebGL2 context that builds every program it is given and counts each call by name. */
function fakeWebgl() {
  const calls = new Map<string, number>()
  const context = new Proxy(
    {},
    {
      get(_, name) {
        if (typeof name !== 'string') return undefined
        if (/^[A-Z0-9_]+$/.test(name)) return 1
        return (...args: unknown[]) => {
          calls.set(name, (calls.get(name) ?? 0) + 1)
          if (name === 'getProgramParameter') return true
          if (name === 'isContextLost') return false
          if (name === 'getExtension') return null
          if (name.startsWith('create') || name === 'getUniformLocation') return { args }
          return undefined
        }
      }
    }
  )
  return { context, count: (name: string) => calls.get(name) ?? 0 }
}

let webgl: ReturnType<typeof fakeWebgl>
let shared: HTMLCanvasElement | undefined
let refused: boolean
const flats = new Map<HTMLCanvasElement, { clearRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> }>()

beforeEach(() => {
  // The shared context lives as long as the page: each case starts with a page of its own.
  vi.resetModules()
  webgl = fakeWebgl()
  shared = undefined
  refused = false
  flats.clear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind === 'webgl2') {
      if (refused) return null
      shared = this
      return webgl.context as never
    }
    const flat = { clearRect: vi.fn(), drawImage: vi.fn() }
    flats.set(this, flat)
    return flat as never
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const pose = createLife('idle', 'hud').step({ mood: 'idle', look: 'hud', level: 0, delta: 1 / 60, still: false })
const accents = Object.fromEntries(LOOKS.map((look) => [look, [164, 173, 187]])) as never

/** Cores of these sides in device pixels, each with the canvas it is shown in. */
async function cores(...sides: number[]) {
  const { createGpuCore } = await import('./gpu.ts')
  return sides.map((side) => {
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const core = createGpuCore(canvas, false)
    return { side, canvas, core, paint: () => core?.paint(pose, accents, side, 1) }
  })
}

const webglAsked = () => vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.filter(([kind]) => kind === 'webgl2').length

describe('the cores drawn on the graphics card', () => {
  it('are all drawn in one context, whatever their number and size, and its programs built once', async () => {
    const drawn = await cores(128, 128, 144, 560)
    for (let frame = 0; frame < 3; frame++) for (const each of drawn) each.paint()
    expect(webglAsked()).toBe(1)
    // Two looks and the bloom's three passes.
    expect(webgl.count('createProgram')).toBe(5)
  })

  it('copy each core from the bottom left of the shared canvas into its own', async () => {
    const drawn = await cores(128, 560)
    for (let frame = 0; frame < 2; frame++) for (const each of drawn) each.paint()
    for (const { side, canvas } of drawn) {
      expect(flats.get(canvas)?.drawImage).toHaveBeenLastCalledWith(shared, 0, 560 - side, side, side, 0, 0, side, side)
    }
  })

  it('keep the bloom of each size from frame to frame, and let it go with the last core of that size', async () => {
    const [small, other, large] = await cores(128, 128, 560)
    for (const each of [small, other, large]) each?.paint()
    const made = webgl.count('createFramebuffer')
    for (let frame = 0; frame < 3; frame++) for (const each of [small, other, large]) each?.paint()
    expect(webgl.count('createFramebuffer')).toBe(made)
    small?.core?.dispose()
    expect(webgl.count('deleteFramebuffer')).toBe(0)
    other?.core?.dispose()
    expect(webgl.count('deleteFramebuffer')).toBeGreaterThan(0)
    // The shared canvas shrinks to the largest core left.
    large?.core?.dispose()
    const [again] = await cores(96)
    again?.paint()
    expect(shared?.width).toBe(96)
  })

  it('stop on their last picture while the context is lost, and go on once it is restored', async () => {
    const [core] = await cores(128)
    core?.paint()
    const flat = core && flats.get(core.canvas)
    shared?.dispatchEvent(new Event('webglcontextlost'))
    core?.paint()
    expect(flat?.clearRect).toHaveBeenCalledTimes(1)
    expect(flat?.drawImage).toHaveBeenCalledTimes(1)
    shared?.dispatchEvent(new Event('webglcontextrestored'))
    core?.paint()
    expect(flat?.drawImage).toHaveBeenCalledTimes(2)
    expect(webgl.count('createProgram')).toBe(10)
  })

  it('are refused where WebGL2 is, and the graphics card is asked only once', async () => {
    refused = true
    const drawn = await cores(64, 64, 72)
    expect(drawn.map(({ core }) => core)).toEqual([undefined, undefined, undefined])
    expect(webglAsked()).toBe(1)
  })
})
