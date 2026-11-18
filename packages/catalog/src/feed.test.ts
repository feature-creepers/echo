import { describe, expect, it } from 'vitest'
import { feedFigure, feedPoints, feedsOf, valueAt } from './feed.ts'
import { validateView } from './validate.ts'

const market = [{ title: 'Election', markets: [{ outcome: 'A', outcomePrices: '["0.2351", "0.7649"]', volume: 1200 }] }]

describe('valueAt', () => {
  it.each([
    ['0.title', 'Election'],
    ['0.markets.0.volume', 1200],
    ['0.markets.0.outcomePrices.0', '0.2351'],
    ['0.markets.1', undefined],
    ['0.title.0', undefined],
    ['0.nothing.deeper', undefined],
    ['title', undefined],
    ['0.markets.0.constructor', undefined],
    ['', market]
  ])('reads %s', (path, expected) => {
    expect(valueAt(market, path)).toEqual(expected)
  })
})

describe('feedFigure', () => {
  it.each([
    [
      { path: '0.markets.0.outcomePrices.0', scale: 100, decimals: 1 },
      { ok: true, value: { text: '23.5', number: 23.5 } }
    ],
    [{ path: '0.markets.0.volume' }, { ok: true, value: { text: '1200', number: 1200 } }],
    [
      { path: '0.markets.0.volume', decimals: 2 },
      { ok: true, value: { text: '1200.00', number: 1200 } }
    ],
    [{ path: '0.title' }, { ok: true, value: { text: 'Election' } }],
    [{ path: '0.markets' }, { ok: false, problem: '"0.markets" holds an array, not a figure: go one step further' }],
    [{ path: '0.price' }, { ok: false, problem: 'nothing is at "0.price"' }]
  ])('takes %o', (feed, expected) => {
    expect(feedFigure(market, feed)).toEqual(expected)
  })
})

describe('feedPoints', () => {
  const prices = { history: [{ t: 'Mon', p: '0.2' }, { t: 'Tue', p: 0.25 }, { t: 'Wed' }, { t: 'Thu', p: 0.3 }] }

  it('makes a point of each item with a label and a number, and skips the rest', () => {
    expect(feedPoints(prices, { path: 'history', x: 't', y: 'p', scale: 100 })).toEqual({
      ok: true,
      value: [
        { x: 'Mon', y: 20 },
        { x: 'Tue', y: 25 },
        { x: 'Thu', y: 30 }
      ]
    })
  })

  it('says what is wrong when nothing makes a point', () => {
    expect(feedPoints(prices, { path: 'history', x: 'date', y: 'p' })).toEqual({
      ok: false,
      problem: 'no item of "history" has a label at "date" and a number at "p"'
    })
    expect(feedPoints(prices, { path: 'history.0', x: 't', y: 'p' })).toEqual({ ok: false, problem: '"history.0" is not an array' })
  })

  it('keeps the latest points of a long array', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ t: String(index), p: index }))
    const read = feedPoints(many, { path: '', x: 't', y: 'p' })
    expect(read.ok && read.value.length).toBe(120)
    expect(read.ok && read.value[0]).toEqual({ x: '180', y: 180 })
  })
})

describe('feeds in views', () => {
  const view = (props: Record<string, unknown>, type = 'Metric') => validateView({ root: 'a', elements: { a: { type, props } } })

  it('accepts a feed on a Metric, a Progress and a Chart series, and lists them', () => {
    const feed = { url: 'https://example.org/data.json', path: '0.price' }
    const metric = view({ label: 'Price', value: '12', feed })
    const progress = view({ value: 0.2, feed: { ...feed, every: 120 } }, 'Progress')
    const chart = view({ kind: 'line', series: [{ name: 'A', points: [{ x: 'a', y: 1 }], feed: { url: feed.url, path: 'history', x: 't', y: 'p' } }] }, 'Chart')
    expect([metric.ok, progress.ok, chart.ok]).toEqual([true, true, true])
    if (chart.ok)
      expect(feedsOf(chart.spec.elements)).toEqual([{ id: 'a', type: 'Chart', series: 0, feed: { url: feed.url, path: 'history', x: 't', y: 'p' } }])
  })

  it.each([
    [{ url: 'http://example.org/data.json', path: 'a' }],
    [{ url: 'https://example.org/data.json', path: 'a', every: 10 }],
    [{ url: 'https://example.org/data.json', path: '' }]
  ])('refuses %o', (feed) => {
    expect(view({ label: 'Price', value: '12', feed }).ok).toBe(false)
  })
})
