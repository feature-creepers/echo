import { describe, expect, it } from 'vitest'
import { FIRST_SHEET_PLACE, moveSheet, type SheetMove, type SheetPlace } from './sheet-place.ts'

const at = (place: Partial<SheetPlace>): SheetPlace => ({ ...FIRST_SHEET_PLACE, ...place })

describe('where the side sheet goes', () => {
  it.each<{ name: string; from: SheetPlace; move: SheetMove; to: SheetPlace }>([
    {
      name: 'the title row opens it on the tab it showed last',
      from: at({ last: 'inspector' }),
      move: { to: 'toggle' },
      to: at({ open: 'inspector', last: 'inspector' })
    },
    {
      name: 'the title row closes it, whatever it shows',
      from: at({ open: 'threads', last: 'threads', thread: 'project' }),
      move: { to: 'toggle' },
      to: at({ last: 'threads', thread: 'project' })
    },
    {
      name: 'the transcript key opens it on the transcript from another tab',
      from: at({ open: 'threads', last: 'threads' }),
      move: { to: 'toggle', tab: 'transcript' },
      to: at({ open: 'transcript', last: 'transcript' })
    },
    {
      name: 'the transcript key closes it on the transcript',
      from: at({ open: 'transcript' }),
      move: { to: 'toggle', tab: 'transcript' },
      to: at({})
    },
    {
      name: 'another tab keeps the thread opened in the threads',
      from: at({ open: 'threads', last: 'threads', thread: 'project' }),
      move: { to: 'tab', tab: 'inspector' },
      to: at({ open: 'inspector', last: 'inspector', thread: 'project' })
    },
    {
      name: 'the threads tab chosen again goes back to the list',
      from: at({ open: 'threads', last: 'threads', thread: 'project' }),
      move: { to: 'tab', tab: 'threads' },
      to: at({ open: 'threads', last: 'threads' })
    },
    {
      name: 'the threads tab chosen again leaves the project form',
      from: at({ open: 'threads', last: 'threads', opening: true }),
      move: { to: 'tab', tab: 'threads' },
      to: at({ open: 'threads', last: 'threads' })
    },
    {
      name: 'the transcript tab chosen again goes back to the log',
      from: at({ open: 'transcript', answer: 'turn-1' }),
      move: { to: 'tab', tab: 'transcript' },
      to: at({ open: 'transcript' })
    },
    {
      name: 'closed, it keeps where each tab stood',
      from: at({ open: 'transcript', answer: 'turn-1', thread: 'project' }),
      move: { to: 'close' },
      to: at({ answer: 'turn-1', thread: 'project' })
    },
    {
      name: 'a thread at work opens it on its work, from any tab',
      from: at({ open: 'inspector', last: 'inspector' }),
      move: { to: 'thread', thread: 'project' },
      to: at({ open: 'threads', last: 'threads', thread: 'project', lastThread: 'project' })
    },
    {
      name: 'a thread opens it closed, over the project form',
      from: at({ opening: true }),
      move: { to: 'thread', thread: 'project' },
      to: at({ open: 'threads', last: 'threads', thread: 'project', lastThread: 'project' })
    },
    {
      name: 'back from a thread shows the list, the thread marked in it',
      from: at({ open: 'threads', last: 'threads', thread: 'project', lastThread: 'project' }),
      move: { to: 'thread', thread: undefined },
      to: at({ open: 'threads', last: 'threads', lastThread: 'project' })
    },
    {
      name: 'all threads opens it on the list, from a thread kept in another tab',
      from: at({ open: 'transcript', thread: 'project', lastThread: 'project' }),
      move: { to: 'thread', thread: undefined },
      to: at({ open: 'threads', last: 'threads', lastThread: 'project' })
    },
    {
      name: 'a full answer opens it on the transcript',
      from: at({ open: 'threads', last: 'threads' }),
      move: { to: 'answer', turn: 'turn-1' },
      to: at({ open: 'transcript', last: 'transcript', answer: 'turn-1' })
    },
    {
      name: 'back from a full answer shows the log',
      from: at({ open: 'transcript', answer: 'turn-1' }),
      move: { to: 'answer', turn: undefined },
      to: at({ open: 'transcript' })
    },
    {
      name: 'the project form opens on the threads',
      from: at({ open: 'transcript' }),
      move: { to: 'opening', opening: true },
      to: at({ open: 'threads', last: 'threads', opening: true })
    }
  ])('$name', ({ from, move, to }) => {
    expect(moveSheet(from, move)).toEqual(to)
  })
})
