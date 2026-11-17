import { describe, expect, it } from 'vitest'
import { onTop, type ShownView, STREAM_LENGTH } from './views.ts'

const view = (id: string, more: Partial<ShownView> = {}): ShownView => ({
  id,
  title: id,
  slot: 'stage',
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

  it("keeps one card per aside, and one per saved widget: each one's latest", () => {
    let stream: ShownView[] = []
    stream = onTop(stream, view('topic', { thread: 'x' }))
    stream = onTop(stream, view('card-1', { slot: 'margin', thread: 'aside' }))
    stream = onTop(stream, view('radio-1', { widget: 'radio' }))
    stream = onTop(stream, view('card-2', { slot: 'margin', thread: 'aside' }))
    stream = onTop(stream, view('radio-2', { widget: 'radio' }))
    expect(ids(stream)).toEqual(['radio-2', 'card-2', 'topic'])
  })

  it('holds a bounded number of views', () => {
    let stream: ShownView[] = []
    for (let index = 0; index < STREAM_LENGTH + 3; index++) stream = onTop(stream, view(`v${index}`))
    expect(stream).toHaveLength(STREAM_LENGTH)
    expect(stream[0]?.id).toBe(`v${STREAM_LENGTH + 2}`)
  })
})
