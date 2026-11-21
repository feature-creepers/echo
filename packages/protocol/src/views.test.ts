import { describe, expect, it } from 'vitest'
import { type ShownView, withCard } from './views.ts'

const view = (id: string, more: Partial<ShownView> = {}): ShownView => ({
  id,
  title: id,
  spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } },
  ...more
})
const ids = (cards: readonly ShownView[]) => cards.map((one) => one.id)
const shown = (...views: ShownView[]) => views.reduce<ShownView[]>(withCard, [])

describe('the cards of an answer', () => {
  it.each<[string, ShownView[], string[]]>([
    ['stand in the order they were shown', [view('a'), view('b'), view('c')], ['a', 'b', 'c']],
    ['keep the place of a view shown again', [view('a'), view('b'), view('a', { title: 'again' })], ['a', 'b']],
    [
      'show a card in place of the one of its name',
      [view('chart-1', { card: 'chart' }), view('map', { card: 'map' }), view('chart-2', { card: 'chart' })],
      ['chart-2', 'map']
    ],
    ['show a card of another name beside the others', [view('chart', { card: 'chart' }), view('news', { card: 'news' })], ['chart', 'news']],
    ['keep cards that have no name, each one', [view('asked'), view('written'), view('chart', { card: 'chart' })], ['asked', 'written', 'chart']],
    [
      'show a saved widget in place of its earlier version',
      [view('radio-1', { widget: 'radio' }), view('other'), view('radio-2', { widget: 'radio' })],
      ['radio-2', 'other']
    ]
  ])('%s', (_case, views, expected) => {
    expect(ids(shown(...views))).toEqual(expected)
  })

  it('shows a view as it was last shown', () => {
    expect(shown(view('a'), view('a', { title: 'again' }))[0]?.title).toBe('again')
  })
})
