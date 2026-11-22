import { describe, expect, it } from 'vitest'
import { FIRST_SHEET_PLACE, moveSheet, type SheetMove, type SheetPlace } from './sheet-place.ts'

const at = (place: Partial<SheetPlace>): SheetPlace => ({ ...FIRST_SHEET_PLACE, ...place })

describe('where the side panel goes', () => {
  it.each<{ name: string; from: SheetPlace; move: SheetMove; to: SheetPlace }>([
    {
      name: 'the title row opens it on the tab it showed last',
      from: at({ last: 'trace' }),
      move: { to: 'toggle' },
      to: at({ open: 'trace', last: 'trace' })
    },
    {
      name: 'the title row closes it, whatever it shows',
      from: at({ open: 'work', last: 'work', thread: 'project' }),
      move: { to: 'toggle' },
      to: at({ last: 'work', thread: 'project' })
    },
    {
      name: "the story's key opens it on the story from another tab",
      from: at({ open: 'work', last: 'work' }),
      move: { to: 'toggle', tab: 'story' },
      to: at({ open: 'story', last: 'story' })
    },
    {
      name: "the story's key closes it on the story",
      from: at({ open: 'story' }),
      move: { to: 'toggle', tab: 'story' },
      to: at({})
    },
    {
      name: 'another tab keeps the thread opened in the work',
      from: at({ open: 'work', last: 'work', thread: 'project' }),
      move: { to: 'tab', tab: 'trace' },
      to: at({ open: 'trace', last: 'trace', thread: 'project' })
    },
    {
      name: 'the work tab chosen again goes back to its start',
      from: at({ open: 'work', last: 'work', thread: 'project', away: true }),
      move: { to: 'tab', tab: 'work' },
      to: at({ open: 'work', last: 'work' })
    },
    {
      name: 'the work tab chosen again leaves the project form',
      from: at({ open: 'work', last: 'work', scope: 'everything', opening: true }),
      move: { to: 'tab', tab: 'work' },
      to: at({ open: 'work', last: 'work', scope: 'everything' })
    },
    {
      name: 'the story tab chosen again goes back to the story',
      from: at({ open: 'story', answer: 'turn-1' }),
      move: { to: 'tab', tab: 'story' },
      to: at({ open: 'story' })
    },
    {
      name: 'closed, it keeps where each tab stood',
      from: at({ open: 'story', answer: 'turn-1', thread: 'project' }),
      move: { to: 'close' },
      to: at({ answer: 'turn-1', thread: 'project' })
    },
    {
      name: 'everything takes the place of the topic in front, on the tab shown, at its start',
      from: at({ open: 'work', last: 'work', thread: 'project', answer: 'turn-1' }),
      move: { to: 'scope', scope: 'everything' },
      to: at({ open: 'work', last: 'work', scope: 'everything' })
    },
    {
      name: 'a thread at work opens it on its work, from any tab',
      from: at({ open: 'trace', last: 'trace' }),
      move: { to: 'thread', thread: 'project' },
      to: at({ open: 'work', last: 'work', thread: 'project', lastThread: 'project' })
    },
    {
      name: 'a thread opens it closed, over the project form',
      from: at({ scope: 'everything', opening: true }),
      move: { to: 'thread', thread: 'project' },
      to: at({ open: 'work', last: 'work', scope: 'everything', thread: 'project', lastThread: 'project' })
    },
    {
      name: 'back from a thread shows the work, the thread marked in it',
      from: at({ open: 'work', last: 'work', thread: 'project', lastThread: 'project' }),
      move: { to: 'thread', thread: undefined },
      to: at({ open: 'work', last: 'work', lastThread: 'project' })
    },
    {
      name: 'a full answer opens it on the story',
      from: at({ open: 'work', last: 'work' }),
      move: { to: 'answer', turn: 'turn-1' },
      to: at({ open: 'story', last: 'story', answer: 'turn-1' })
    },
    {
      name: 'back from a full answer shows the story',
      from: at({ open: 'story', answer: 'turn-1' }),
      move: { to: 'answer', turn: undefined },
      to: at({ open: 'story' })
    },
    {
      name: 'the project form opens on the work of everything',
      from: at({ open: 'story', thread: 'project' }),
      move: { to: 'opening', opening: true },
      to: at({ open: 'work', last: 'work', scope: 'everything', opening: true })
    },
    {
      name: 'the topics put away open on the work of everything',
      from: at({ open: 'story' }),
      move: { to: 'away', away: true },
      to: at({ open: 'work', last: 'work', scope: 'everything', away: true })
    },
    {
      name: 'back from the topics put away shows the work of everything',
      from: at({ open: 'work', last: 'work', scope: 'everything', away: true }),
      move: { to: 'away', away: false },
      to: at({ open: 'work', last: 'work', scope: 'everything' })
    }
  ])('$name', ({ from, move, to }) => {
    expect(moveSheet(from, move)).toEqual(to)
  })
})
