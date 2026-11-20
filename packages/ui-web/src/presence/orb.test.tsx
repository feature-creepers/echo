// @vitest-environment jsdom
// jsdom has no graphics card, so every core here is refused one, as with the app started with `--disable-gpu`.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Orb } from './orb.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let page: HTMLDivElement
let root: Root
let frame: FrameRequestCallback | undefined

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  frame = undefined
  page = document.createElement('div')
  document.body.append(page)
  root = createRoot(page)
})

afterEach(() => {
  act(() => root.unmount())
  page.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a core the graphics card cannot draw', () => {
  it('is the eye, still, with no canvas and no frame asked for', () => {
    act(() =>
      root.render(
        <>
          <Orb size={64} mood="idle" />
          <Orb size={120} mood="thinking" />
        </>
      )
    )
    expect(page.querySelectorAll('svg')).toHaveLength(2)
    expect(page.querySelector('canvas')).toBeNull()
    expect(page.innerHTML).not.toMatch(/animate-eye/)
    expect(frame).toBeUndefined()
  })

  it('whose place and size follow its frames, is told a pose at rest and sized on each, and draws nothing', () => {
    const onFrame = vi.fn()
    act(() => root.render(<Orb size={280} mood="speaking" scale={() => 0.5} onFrame={onFrame} />))
    act(() => frame?.(16))
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ weights: expect.objectContaining({ idle: 1, speaking: 0 }) }))
    expect(page.querySelector<HTMLElement>('span > span')?.style.transform).toBe('scale(0.5)')
    expect(page.querySelector('canvas')).toBeNull()
  })
})
