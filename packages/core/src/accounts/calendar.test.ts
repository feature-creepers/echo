import { describe, expect, it } from 'vitest'
import { eventLines, type FoundEvent, inOrder, readSpan } from './calendar.ts'

const PARIS = 'Europe/Paris'

describe('a span of the calendar', () => {
  it.each([
    ['two dates, the last included', '2026-12-03', '2026-12-09', '2026-12-02T23:00:00.000Z', '2026-12-09T23:00:00.000Z', 'from 3 to 9 December'],
    ['one day', '2026-12-03', '2026-12-03', '2026-12-02T23:00:00.000Z', '2026-12-03T23:00:00.000Z', 'of 3 December'],
    ['an afternoon', '2026-12-04T14:00', '2026-12-04T18:00', '2026-12-04T13:00:00.000Z', '2026-12-04T17:00:00.000Z', 'of 4 December'],
    ['two months', '2026-11-28', '2026-12-03', '2026-11-27T23:00:00.000Z', '2026-12-03T23:00:00.000Z', 'from 28 November to 3 December'],
    ['two years', '2026-12-30', '2027-01-02', '2026-12-29T23:00:00.000Z', '2027-01-02T23:00:00.000Z', 'from 30 December 2026 to 2 January 2027'],
    ['the night the clocks go back', '2026-10-25', '2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 'of 25 October'],
    ['62 days', '2026-12-01', '2027-01-31', '2026-11-30T23:00:00.000Z', '2027-01-31T23:00:00.000Z', 'from 1 December 2026 to 31 January 2027']
  ])('reads %s on the person’s clock', (_case, from, until, start, end, words) => {
    const span = readSpan(from, until, PARIS)
    expect(span).toEqual({ ok: true, from: Date.parse(start), until: Date.parse(end), words })
  })

  it.each([
    ['more than 62 days', '2026-12-01', '2027-02-01', 'more than 62 days'],
    ['an end before its start', '2026-12-09', '2026-12-03', 'comes after'],
    ['a day that does not exist', '2026-02-30', '2026-03-02', '"from"'],
    ['words', 'tomorrow', '2026-12-03', '"from"']
  ])('refuses %s', (_case, from, until, problem) => {
    expect(readSpan(from, until, PARIS)).toEqual({ ok: false, problem: expect.stringContaining(problem) })
  })
})

const event = (fields: Partial<FoundEvent>): FoundEvent => ({
  calendar: 'Personal',
  title: 'Event',
  allDay: false,
  start: '2026-12-03T08:00:00.000Z',
  end: '2026-12-03T09:00:00.000Z',
  declined: false,
  account: 'ada@example.com',
  ...fields
})

describe('the events, as a model reads them', () => {
  it.each([
    [
      'a timed event, in the person’s time zone',
      event({ title: 'Dentist', place: '1 Rue de Lyon' }),
      'Thursday 3 December 2026\n- 09:00–10:00 · Dentist · at 1 Rue de Lyon · Personal'
    ],
    [
      'an event set in another time zone',
      event({ title: 'Call with Boston', start: '2026-12-03T09:00:00-05:00', end: '2026-12-03T10:00:00-05:00' }),
      'Thursday 3 December 2026\n- 15:00–16:00 · Call with Boston · Personal'
    ],
    [
      'an event all day',
      event({ title: 'Holiday', allDay: true, start: '2026-12-03', end: '2026-12-04' }),
      'Thursday 3 December 2026\n- all day · Holiday · Personal'
    ],
    [
      'an event of several days',
      event({ title: 'Conference', allDay: true, start: '2026-12-03', end: '2026-12-06' }),
      'Thursday 3 December 2026\n- all day, until Saturday 5 December 2026 · Conference · Personal'
    ],
    [
      'an event over midnight',
      event({ title: 'Night train', start: '2026-12-03T21:00:00.000Z', end: '2026-12-04T06:00:00.000Z' }),
      'Thursday 3 December 2026\n- 22:00 – Friday 4 December 2026 07:00 · Night train · Personal'
    ],
    ['an event declined', event({ title: 'Board', declined: true }), 'Thursday 3 December 2026\n- 09:00–10:00 · Board · Personal · declined'],
    [
      'a long description, cut',
      event({ title: 'Plan', description: `Agenda: ${'x'.repeat(600)}` }),
      `Thursday 3 December 2026\n- 09:00–10:00 · Plan · Personal\n  Agenda: ${'x'.repeat(492)}…`
    ]
  ])('writes %s', (_case, found, lines) => {
    expect(eventLines([found], PARIS, 1)).toBe(lines)
  })

  it('puts the events in order, each day under its date, an event all day first, naming the account when there are several', () => {
    const events = inOrder(
      [
        event({ title: 'Lunch', start: '2026-12-04T11:00:00.000Z', end: '2026-12-04T12:00:00.000Z', account: 'work@example.com', calendar: 'Work' }),
        event({ title: 'Holiday', allDay: true, start: '2026-12-04', end: '2026-12-05' }),
        event({ title: 'Dentist' })
      ],
      PARIS
    )
    expect(eventLines(events, PARIS, 2)).toBe(
      [
        'Thursday 3 December 2026',
        '- 09:00–10:00 · Dentist · Personal, ada@example.com',
        '',
        'Friday 4 December 2026',
        '- all day · Holiday · Personal, ada@example.com',
        '- 12:00–13:00 · Lunch · Work, work@example.com'
      ].join('\n')
    )
  })
})
