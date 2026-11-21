import { describe, expect, it } from 'vitest'
import { onTop, type ShownView, STREAM_LENGTH } from './views.ts'

const view = (id: string, more: Partial<ShownView> = {}): ShownView => ({
  id,
  title: id,
  spec: { root: 'a', elements: { a: { type: 'Divider', props: {}, children: [] } } },
  ...more
})
const ids = (stream: readonly ShownView[]) => stream.map((one) => one.id)

describe('the stream', () => {
  it('puts the newest view first and keeps every earlier one', () => {
    let stream: ShownView[] = []
    for (const id of ['a', 'b', 'c']) stream = onTop(stream, view(id, { thread: 'same' }))
    expect(ids(stream)).toEqual(['c', 'b', 'a'])
  })

  it('moves a view shown again to the top, once', () => {
    const stream = onTop(onTop(onTop([], view('a')), view('b')), view('a'))
    expect(ids(stream)).toEqual(['a', 'b'])
  })

  it("keeps one aside card per thread, and one per saved widget: each one's latest", () => {
    let stream: ShownView[] = []
    stream = onTop(stream, view('topic', { thread: 'x' }))
    stream = onTop(stream, view('card-1', { aside: true, thread: 'side' }))
    stream = onTop(stream, view('radio-1', { widget: 'radio' }))
    stream = onTop(stream, view('card-2', { aside: true, thread: 'side' }))
    stream = onTop(stream, view('radio-2', { widget: 'radio' }))
    expect(ids(stream)).toEqual(['radio-2', 'card-2', 'topic'])
  })

  it.each<[string, Partial<ShownView>, string[]]>([
    ['the same name in the same turn', { thread: 'x', turn: 't1', card: 'chart' }, ['chart-2', 'map']],
    ['another name', { thread: 'x', turn: 't1', card: 'news' }, ['chart-2', 'map', 'chart-1']],
    ['the same name in another turn', { thread: 'x', turn: 't2', card: 'chart' }, ['chart-2', 'map', 'chart-1']],
    ['the same name in another thread', { thread: 'y', turn: 't1', card: 'chart' }, ['chart-2', 'map', 'chart-1']],
    ['the same name outside any turn', { thread: 'x', card: 'chart' }, ['chart-2', 'map', 'chart-1']],
    ['no name', { thread: 'x', turn: 't1' }, ['chart-2', 'map', 'chart-1']]
  ])('keeps one card of each name per answer: a card shown with %s', (_case, more, expected) => {
    let stream: ShownView[] = []
    stream = onTop(stream, view('chart-1', { thread: 'x', turn: 't1', card: 'chart' }))
    stream = onTop(stream, view('map', { thread: 'x', turn: 't1', card: 'map' }))
    stream = onTop(stream, view('chart-2', more))
    expect(ids(stream)).toEqual(expected)
  })

  it("keeps a thread's view on the stage beside its aside card", () => {
    let stream: ShownView[] = []
    stream = onTop(stream, view('card', { aside: true, thread: 'side' }))
    stream = onTop(stream, view('full', { thread: 'side' }))
    expect(ids(stream)).toEqual(['full', 'card'])
  })

  it('holds a bounded number of views', () => {
    let stream: ShownView[] = []
    for (let index = 0; index < STREAM_LENGTH + 3; index++) stream = onTop(stream, view(`v${index}`))
    expect(stream).toHaveLength(STREAM_LENGTH)
    expect(stream[0]?.id).toBe(`v${STREAM_LENGTH + 2}`)
  })
})
