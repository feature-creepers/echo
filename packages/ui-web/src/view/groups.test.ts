import { onTop, type ShownView } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { columnsFor, groupStream, inColumns } from './groups.ts'

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

describe('the cards of an answer in columns', () => {
  it.each([
    [880, 2],
    [648, 2],
    [647, 1],
    [300, 1],
    [1600, 2]
  ])('a board %i wide holds %i', (width, columns) => {
    expect(columnsFor(width)).toBe(columns)
  })

  it.each([
    ['one card across the whole width', ['a'], 2, [['a']]],
    ['two cards side by side', ['a', 'b'], 2, [['a'], ['b']]],
    [
      'more cards in reading order',
      ['a', 'b', 'c', 'd', 'e'],
      2,
      [
        ['a', 'c', 'e'],
        ['b', 'd']
      ]
    ],
    ['one column where two would be too narrow', ['a', 'b', 'c'], 1, [['a', 'b', 'c']]],
    ['no card as one empty column', [], 2, [[]]]
  ])('lays %s', (_case, cards, columns, stacks) => {
    expect(inColumns(cards, columns)).toEqual(stacks)
  })
})
