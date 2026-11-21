// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PlaceMap } from './map.tsx'

// jsdom lays nothing out and draws nothing: the frame is given a width, and no canvas gives a context, so the street
// map cannot be drawn, as on a computer without WebGL.
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLCanvasElement.prototype.getContext = () => null
  globalThis.ResizeObserver = class {
    readonly heard: ResizeObserverCallback
    constructor(heard: ResizeObserverCallback) {
      this.heard = heard
    }
    observe(target: Element) {
      this.heard([{ target, contentRect: { width: 600 } } as ResizeObserverEntry], this)
    }
    unobserve() {}
    disconnect() {}
  }
})

describe('PlaceMap', () => {
  it('says when its street map cannot be drawn, and still shows its places', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const places = [
      { lat: 48.8566, lon: 2.3522, label: 'Paris', tone: 'accent' as const },
      { lat: 45.764, lon: 4.8357, label: 'Lyon', tone: 'accent' as const }
    ]
    await act(async () => root.render(<PlaceMap props={{ places, route: true, height: 'normal' }} />))
    await vi.waitFor(() => expect(host.textContent).toContain('The street map could not be drawn.'), { timeout: 10_000 })
    expect([...host.querySelectorAll('text')].map((label) => label.textContent)).toEqual(['Paris', 'Lyon'])
    expect(host.querySelector('a[href="https://www.openstreetmap.org/copyright"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
