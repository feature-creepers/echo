import { describe, expect, it } from 'vitest'
import { createMediaPlayer, DUCKED, type MediaElement, type MediaSource } from './player.ts'

/** An element that plays at once, or refuses, and lets the test fire its events. */
function fakeElement(refuse?: Error) {
  const listeners = new Map<string, (() => void)[]>()
  const log: string[] = []
  const element: MediaElement & { fire(type: string): void; failWith(code: number): void } = {
    src: '',
    volume: 1,
    muted: false,
    paused: true,
    currentTime: 0,
    duration: Number.NaN,
    error: null,
    play() {
      log.push(`play ${element.src}`)
      return refuse ? Promise.reject(refuse) : Promise.resolve()
    },
    pause: () => void log.push('pause'),
    load() {
      log.push('load')
      element.currentTime = 0
    },
    removeAttribute: (name) => void log.push(`remove ${name}`),
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    fire(type) {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    failWith(code) {
      ;(element as { error: { code: number } | null }).error = { code }
      element.fire('error')
    }
  }
  return { element, log }
}

const radio: MediaSource = { url: 'https://example.org/live.aac', kind: 'audio', title: 'A station', live: true }
const song: MediaSource = { url: 'https://example.org/song.mp3', kind: 'audio', title: 'A song', live: false }

/** Steps of a fade run at once. */
const now = (step: () => void) => step()

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('the media player', () => {
  it('plays one source at a time: a new one takes the place of the last', () => {
    const { element, log } = fakeElement()
    const player = createMediaPlayer({ element, later: now })
    player.play(radio)
    expect(player.current()).toMatchObject({ source: radio, status: 'loading' })
    element.fire('playing')
    expect(player.current().status).toBe('playing')

    player.play(song)
    expect(player.current().source).toBe(song)
    expect(log).toEqual(['load', `play ${radio.url}`, 'load', `play ${song.url}`])
  })

  it('resumes a file where it was, and a live stream from what is on now', () => {
    const { element, log } = fakeElement()
    const player = createMediaPlayer({ element, later: now })
    player.play(song)
    element.fire('playing')
    player.pause()
    player.play(song)
    expect(log.filter((line) => line === 'load')).toHaveLength(1)

    player.play(radio)
    element.fire('playing')
    player.toggle(radio)
    expect(player.current().status).toBe('paused')
    player.toggle(radio)
    expect(log.filter((line) => line === 'load')).toHaveLength(3)
  })

  it('stops and lets the source go', () => {
    const { element, log } = fakeElement()
    const player = createMediaPlayer({ element, later: now })
    player.play(radio)
    player.stop()
    element.fire('pause')
    expect(player.current()).toMatchObject({ source: undefined, status: 'idle' })
    expect(log.slice(-3)).toEqual(['pause', 'remove src', 'load'])
  })

  it('says why a stream failed, and tries again when asked', () => {
    const { element } = fakeElement()
    const player = createMediaPlayer({ element, later: now })
    player.play(radio)
    element.failWith(4)
    expect(player.current()).toMatchObject({ status: 'failed', problem: 'This address is not a stream this app can play.' })
    player.play(radio)
    expect(player.current()).toMatchObject({ status: 'loading', problem: undefined })
  })

  it('waits for the user when playing on its own is refused', async () => {
    const refused = Object.assign(new Error('No gesture'), { name: 'NotAllowedError' })
    const { element } = fakeElement(refused)
    const player = createMediaPlayer({ element, later: now })
    player.play(radio)
    await settled()
    expect(player.current().status).toBe('paused')
  })

  it('lowers the sound under the assistant’s voice until every reason is gone, and keeps the level the user set', () => {
    const { element } = fakeElement()
    const player = createMediaPlayer({ element, volume: 0.5, later: now })
    player.play(radio)
    expect(element.volume).toBe(0.5)
    player.duck('speaking', true)
    player.duck('listening', true)
    expect(element.volume).toBeCloseTo(0.5 * DUCKED)
    player.duck('speaking', false)
    expect(element.volume).toBeCloseTo(0.5 * DUCKED)
    player.duck('listening', false)
    expect(element.volume).toBeCloseTo(0.5)
    expect(player.current()).toMatchObject({ volume: 0.5, ducked: false })
  })

  it('starts a source by itself once for a key, however often it is drawn again', () => {
    const { element, log } = fakeElement()
    const player = createMediaPlayer({ element, later: now })
    player.autoplay('view-1', radio)
    player.stop()
    player.autoplay('view-1', radio)
    expect(log.filter((line) => line.startsWith('play'))).toHaveLength(1)
  })

  it('follows where a file is, and seeks in it, but not in a live stream', () => {
    const { element } = fakeElement()
    const player = createMediaPlayer({ element, later: now })
    player.play(song)
    ;(element as { duration: number }).duration = 200
    element.fire('durationchange')
    player.seek(90)
    expect(player.current()).toMatchObject({ position: 90, duration: 200 })
    player.play(radio)
    player.seek(30)
    expect(element.currentTime).toBe(0)
  })

  it('plays a queue in order, going on by itself at the end of each file', () => {
    const { element, log } = fakeElement()
    const player = createMediaPlayer({ element, later: () => undefined })
    const first: MediaSource = { url: 'https://example.org/1.mp3', kind: 'audio', title: 'One', live: false }
    const second: MediaSource = { url: 'https://example.org/2.mp3', kind: 'audio', title: 'Two', live: false }
    const third: MediaSource = { url: 'https://example.org/3.mp3', kind: 'audio', title: 'Three', live: false }
    player.enqueue(first)
    expect(player.current().source?.title).toBe('One')
    player.enqueue(second)
    player.enqueue(third)
    expect(player.current().queue.map((one) => one.title)).toEqual(['Two', 'Three'])
    element.fire('ended')
    expect(player.current().source?.title).toBe('Two')
    player.next()
    expect(player.current().source?.title).toBe('Three')
    expect(log.filter((line) => line.startsWith('play'))).toHaveLength(3)
    element.fire('ended')
    expect(player.current().status).toBe('paused')
    player.enqueue(first)
    player.clearQueue()
    expect(player.current().queue).toEqual([])
    player.enqueue(second)
    player.stop()
    expect(player.current().queue).toEqual([])
  })
})
