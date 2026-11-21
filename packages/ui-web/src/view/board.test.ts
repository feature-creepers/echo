import { describe, expect, it } from 'vitest'
import { boardOf, columnsOf, keptOf } from './board.ts'

describe('the columns of the board', () => {
  const cases: [string, number, number, number][] = [
    ['keeps one column with no room at all', 0, 1, 0],
    ['keeps one column narrower than the least', 300, 1, 300],
    ['keeps one column until two fit', 647, 1, 647],
    ['takes two once two fit with the gap between them', 648, 2, 320],
    ['shares the width between the columns', 1000, 3, 328],
    ['takes four once four fit', 1304, 4, 320],
    ['never takes more than four', 2600, 4, 644],
    ['gives each column whole pixels', 1001, 3, 328]
  ]
  it.each(cases)('%s', (_name, width, count, column) => {
    expect(columnsOf(width)).toEqual({ count, width: column })
  })
})

describe('where the cards go', () => {
  const three = { count: 3, width: 100 }

  it('puts the newest at the top left and the others in reading order across the columns', () => {
    expect(boardOf([50, 60, 70, 80], three).places).toEqual([
      { x: 0, y: 0 },
      { x: 108, y: 0 },
      { x: 216, y: 0 },
      { x: 0, y: 58 }
    ])
  })

  it('keeps every card in its column however tall the others are', () => {
    const short = boardOf([10, 10, 10, 10, 10], three).places.map((place) => place.x)
    const tall = boardOf([900, 10, 10, 10, 10], three).places.map((place) => place.x)
    expect(tall).toEqual(short)
  })

  it('moves only the cards under a card that grows', () => {
    const before = boardOf([50, 60, 70, 80, 90], three).places
    const after = boardOf([150, 60, 70, 80, 90], three).places
    expect(after[1]).toEqual(before[1])
    expect(after[2]).toEqual(before[2])
    expect(after[4]).toEqual(before[4])
    expect(after[3]).toEqual({ x: 0, y: 158 })
  })

  it('is as tall as its tallest column', () => {
    expect(boardOf([50, 300, 70, 80], three).height).toBe(300)
    expect(boardOf([50, 60, 70, 80], three).height).toBe(138)
  })

  it('takes no room with no card', () => {
    expect(boardOf([], three)).toEqual({ places: [], height: 0 })
  })
})

describe('the cards kept on the board', () => {
  const view = (id: string) => ({ id })
  const ids = (cards: ReturnType<typeof keptOf<{ id: string }>>) => cards.map((card) => `${card.view.id}${card.leaving ? ' leaving' : ''}`)

  it('shows the views as they are', () => {
    expect(ids(keptOf([], [view('a'), view('b')]))).toEqual(['a', 'b'])
  })

  it('keeps a closed card where it stood until it has faded', () => {
    const was = keptOf([], [view('a'), view('b'), view('c')])
    expect(ids(keptOf(was, [view('a'), view('c')]))).toEqual(['a', 'b leaving', 'c'])
  })

  it('puts a new view first, before a card that is leaving', () => {
    const was = keptOf(keptOf([], [view('a'), view('b')]), [view('b')])
    expect(ids(keptOf(was, [view('c'), view('b')]))).toEqual(['c', 'a leaving', 'b'])
  })

  it('brings a closed card back when its view is shown again', () => {
    const was = keptOf(keptOf([], [view('a'), view('b')]), [view('b')])
    expect(ids(keptOf(was, [view('a'), view('b')]))).toEqual(['a', 'b'])
  })

  it('keeps the last card in place when every view is closed', () => {
    const was = keptOf([], [view('a')])
    expect(ids(keptOf(was, []))).toEqual(['a leaving'])
  })
})
