import { onTop, type ShownView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { groupStream, inRows, type ViewWidth } from './groups.ts'

const view = (id: string, more: Partial<ShownView> = {}): ShownView => ({ id, title: id, spec: { root: 'r', elements: {} }, ...more })

/** The stream after these views were shown, in this order. */
const shown = (...views: ShownView[]) => views.reduce<ShownView[]>((stream, one) => onTop(stream, one), [])

/** The groups as words: each group's key, then each version as its cards. */
const read = (stream: ShownView[]) =>
  groupStream(stream).map((group) => [group.key, ...group.versions.map((version) => version.views.map((one) => one.id).join(' '))])

describe('the stream as groups', () => {
  it.each([
    {
      name: 'the cards of one answer together, in the order they were shown',
      stream: shown(view('today', { thread: 'weather', turn: 't1', card: 'today' }), view('week', { thread: 'weather', turn: 't1', card: 'week' })),
      groups: [['thread:weather', 'today week']]
    },
    {
      name: 'an answer that updates a topic in its place, the earlier one behind it',
      stream: shown(
        view('week', { thread: 'weather', turn: 't1', card: 'week' }),
        view('radio', { thread: 'radio', turn: 't2' }),
        view('month', { thread: 'weather', turn: 't3', card: 'week' })
      ),
      groups: [
        ['thread:weather', 'month', 'week'],
        ['thread:radio', 'radio']
      ]
    },
    {
      name: 'a card shown again under its name in the same turn once',
      stream: shown(view('draft', { thread: 'weather', turn: 't1', card: 'week' }), view('final', { thread: 'weather', turn: 't1', card: 'week' })),
      groups: [['thread:weather', 'final']]
    },
    {
      name: 'a saved widget the person showed, and a view of no thread, each alone',
      stream: shown(view('ci', { widget: 'w1' }), view('loose')),
      groups: [
        ['view:loose', 'loose'],
        ['widget:w1', 'ci']
      ]
    },
    {
      name: 'a view shown outside a turn as a version of its own',
      stream: shown(view('first', { thread: 'plan', turn: 't1' }), view('changed', { thread: 'plan' })),
      groups: [['thread:plan', 'changed', 'first']]
    },
    { name: 'nothing as no group', stream: [], groups: [] }
  ])('puts $name', ({ stream, groups }) => {
    expect(read(stream)).toEqual(groups)
  })
})

/** Cards of these widths, a dash for one the assistant gave none, laid out and read back as each row's spans. */
const spans = (widths: string, stacked = false) =>
  inRows(
    widths.split(' ').map((width) => (width === '-' ? {} : { width: width as ViewWidth })),
    stacked
  ).map((row) => row.map((placed) => placed.span).join('+'))

describe('the cards of an answer in rows', () => {
  it.each([
    ['one card across the whole row', '-', ['12']],
    ['two cards half each', '- -', ['6+6']],
    ['three cards a third each', '- - -', ['4+4+4']],
    ['four cards two by two', '- - - -', ['6+6', '6+6']],
    ['five cards in thirds, the last row filled', '- - - - -', ['4+4+4', '4+8']],
    ['a main card and what supports it', 'two-thirds third', ['8+4']],
    ['a full card on a row of its own', 'third full third', ['12', '12', '12']],
    ['what does not fit on the next row', 'two-thirds half', ['12', '12']],
    ['a card with no width as a half beside one that has', 'half -', ['6+6']],
    ['the last card grown to fill its row', 'third third', ['4+8']],
    ['thirds then a main card', 'third third third two-thirds', ['4+4+4', '12']]
  ])('lays %s', (_case, widths, rows) => {
    expect(spans(widths)).toEqual(rows)
  })

  it('stacks every card on a row of its own in a narrow window', () => {
    expect(spans('two-thirds third -', true)).toEqual(['12', '12', '12'])
  })

  it('lays no card as no row', () => {
    expect(inRows([], false)).toEqual([])
  })
})
