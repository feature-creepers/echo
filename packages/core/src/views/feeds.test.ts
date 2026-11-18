import { validateView } from '@repo/catalog'
import { describe, expect, it } from 'vitest'
import type { Web } from '../ports/web.ts'
import { createFeeds } from './feeds.ts'

const ODDS = 'https://example.org/odds.json'
const pages: Record<string, string> = {
  [ODDS]: JSON.stringify([{ markets: [{ name: 'A', outcomePrices: '["0.41", "0.59"]' }] }]),
  'https://example.org/page.html': '<html></html>',
  'https://example.org/history.json': JSON.stringify({ history: [{ t: 'Mon', p: 1 }] })
}

function setup() {
  const asked: string[] = []
  let time = 0
  const web: Web = {
    async read(url) {
      asked.push(url)
      const text = pages[url]
      return text === undefined ? { ok: false, reason: 'the address answered 404 Not Found.' } : { ok: true, text }
    }
  }
  const feeds = createFeeds(web, () => new Date(time))
  return { feeds, asked, later: (ms: number) => (time += ms) }
}

const spec = (type: string, props: Record<string, unknown>) => {
  const checked = validateView({ root: 'a', elements: { a: { type, props } } })
  if (!checked.ok) throw new Error(checked.problems.join('\n'))
  return checked.spec
}

describe('feeds', () => {
  it('reads an address once in half a minute, then again', async () => {
    const { feeds, asked, later } = setup()
    await feeds.read(ODDS)
    later(29_000)
    await feeds.read(ODDS)
    expect(asked).toEqual([ODDS])
    later(2_000)
    await feeds.read(ODDS)
    expect(asked).toEqual([ODDS, ODDS])
  })

  it('reads again at once an address that failed', async () => {
    const { feeds, asked } = setup()
    expect(await feeds.read('https://example.org/missing.json')).toEqual({ ok: false, problem: 'the address answered 404 Not Found.' })
    await feeds.read('https://example.org/missing.json')
    expect(asked).toHaveLength(2)
  })

  it.each([
    ['Metric', { label: 'A', value: '41', feed: { url: ODDS, path: '0.markets.0.outcomePrices.0', scale: 100 } }, []],
    ['Progress', { value: 0.4, feed: { url: ODDS, path: '0.markets.0.outcomePrices.0' } }, []],
    [
      'Progress',
      { value: 0.4, feed: { url: ODDS, path: '0.markets.0.outcomePrices.0', scale: 100 } },
      ['"a" (Progress): feed: it gives 41, which is not a number from 0 to 1: set its scale.']
    ],
    [
      'Metric',
      { label: 'A', value: '41', feed: { url: ODDS, path: '0.markets.0.price' } },
      [`"a" (Metric): feed: nothing is at "0.markets.0.price" in what ${ODDS} answers.`]
    ],
    [
      'Metric',
      { label: 'A', value: '41', feed: { url: 'https://example.org/page.html', path: 'a' } },
      ['"a" (Metric): feed: https://example.org/page.html could not be read: it is not JSON. A feed names an address that answers JSON (an API), not a page.']
    ],
    [
      'Chart',
      {
        kind: 'line',
        series: [{ name: 'P', points: [{ x: 'Mon', y: 1 }], feed: { url: 'https://example.org/history.json', path: 'history', x: 't', y: 'q' } }]
      },
      ['"a" (Chart), series 1: feed: no item of "history" has a label at "t" and a number at "q" in what https://example.org/history.json answers.']
    ]
  ])('checks a %s fed with %o', async (type, props, problems) => {
    const { feeds } = setup()
    expect(await feeds.check(spec(type, props))).toEqual(problems)
  })
})
