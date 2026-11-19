import type { Exchange, ShownView, Step } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { cutInput, cutText, fitThread, previewInput, STEP_PREVIEW_TEXT, stepPreview, stepWhole, THREAD_READ_BUDGET } from './fit.ts'

const exchange = (turn: string, said = 'Work on it.'): Exchange => ({
  turn,
  at: '2026-11-18T17:00:00.000Z',
  persona: 'p1',
  thread: 'th1',
  said,
  replied: 'Done.',
  outcome: 'done'
})
const step = (turn: string, call: string, output = 'ok', input: unknown = { command: 'pnpm check' }): Step => ({
  call,
  turn,
  thread: 'th1',
  tool: 'computer_run',
  input,
  output,
  at: '2026-11-18T17:00:00.000Z',
  ended: '2026-11-18T17:00:01.000Z'
})
const view = (id: string, turn: string | undefined, elements = 1): ShownView => ({
  id,
  title: `View ${id}`,
  ...(turn === undefined ? {} : { turn }),
  thread: 'th1',
  spec: {
    root: 'all',
    elements: Object.fromEntries(
      Array.from({ length: elements }, (_, index) => [`e${index}`, { type: 'Text', props: { text: 'x'.repeat(200) }, children: [] }])
    )
  }
})
const turns = (count: number, from = 0) => Array.from({ length: count }, (_, index) => exchange(`t${from + index}`))

describe('cutting a text', () => {
  it.each([
    ['short', 'abc', 5, 'abc'],
    ['exactly at the limit', 'abcde', 5, 'abcde'],
    ['over the limit', 'abcdefg', 5, 'abcde\n[…cut]']
  ])('%s', (_name, text, most, expected) => {
    expect(cutText(text, most)).toBe(expected)
  })
})

describe('cutting what a tool was given', () => {
  it.each([
    ['a long string', 'x'.repeat(10), 'xxxx\n[…cut]'],
    ['a number', 42, 42],
    ['nothing', null, null],
    ['an object, keeping its keys', { command: 'y'.repeat(10), timeout: 5 }, { command: 'yyyy\n[…cut]', timeout: 5 }],
    ['an array within', { paths: ['abc', 'z'.repeat(9)] }, { paths: ['abc', 'zzzz\n[…cut]'] }]
  ])('%s', (_name, input, expected) => {
    expect(cutInput(input, 4)).toEqual(expected)
  })
})

describe('previewing what a tool was given', () => {
  const long = 'l'.repeat(STEP_PREVIEW_TEXT + 50)
  const cut = `${'l'.repeat(STEP_PREVIEW_TEXT)}\n[…cut]`
  it.each([
    ['a command, cut', { command: long, timeout: 600 }, { command: cut, timeout: 600 }],
    ['a change of a file, its texts cut', { file_path: 'a.ts', old_string: long, new_string: 'b' }, { file_path: 'a.ts', old_string: cut, new_string: 'b' }],
    [
      'the paths it named, the first ones',
      { paths: Array.from({ length: 30 }, (_, index) => `f${index}`) },
      { paths: Array.from({ length: 20 }, (_, index) => `f${index}`) }
    ],
    ['a view, its elements left for the whole', { title: 'Sales', view: { root: 'a', elements: { a: {} } } }, { title: 'Sales' }],
    ['a plain text', long, cut],
    ['a flag', true, true],
    ['nothing', undefined, undefined]
  ])('%s', (_name, input, expected) => {
    expect(previewInput(input)).toEqual(expected)
  })

  it('keeps the start of what it gave back', () => {
    expect(stepPreview(step('t1', 'c1', 'o'.repeat(50_000))).output?.length).toBeLessThan(STEP_PREVIEW_TEXT + 20)
  })
})

describe('reading one step whole', () => {
  it('gives it as recorded when it fits', () => {
    const recorded = step('t1', 'c1', 'o'.repeat(40_000), { content: 'i'.repeat(100_000) })
    expect(stepWhole(recorded)).toBe(recorded)
  })

  it('cuts what it was given, shorter until it fits one message', () => {
    const whole = stepWhole(step('t1', 'c1', 'o'.repeat(40_000), { a: 'i'.repeat(500_000), b: 'j'.repeat(500_000) }))
    expect(JSON.stringify(whole).length).toBeLessThanOrEqual(THREAD_READ_BUDGET)
    expect(whole.output).toBe('o'.repeat(40_000))
  })
})

describe('fitting a page of a thread to one message', () => {
  it('keeps a small thread whole', () => {
    const page = fitThread(turns(2), [step('t0', 'c0'), step('t1', 'c1')], [view('v1', 't1')])
    expect(page).toMatchObject({ earlier: 0, earlierSteps: 0 })
    expect(page.exchanges.map((one) => one.turn)).toEqual(['t0', 't1'])
    expect(page.steps.map((one) => one.call)).toEqual(['c0', 'c1'])
    expect(page.views).toEqual([{ id: 'v1', title: 'View v1', turn: 't1' }])
  })

  it('names the views without what they show, and leaves out those of no request', () => {
    const page = fitThread(turns(1), [], [view('v1', 't0', 5_000), view('v2', undefined)])
    expect(page.views).toEqual([{ id: 'v1', title: 'View v1', turn: 't0' }])
    expect(JSON.stringify(page).length).toBeLessThan(1_000)
  })

  it('leaves out the calls of no request on the page', () => {
    expect(fitThread(turns(1), [step('t0', 'c0'), step('elsewhere', 'c1')], []).steps.map((one) => one.call)).toEqual(['c0'])
  })

  it('keeps the latest requests, with their calls, as far as the budget goes', () => {
    const exchanges = turns(3_000)
    const steps = exchanges.flatMap((one) => Array.from({ length: 10 }, (_, index) => step(one.turn, `${one.turn}-${index}`, 'o'.repeat(4_000))))
    const page = fitThread(exchanges, steps, [])
    expect(page.earlier).toBeGreaterThan(0)
    expect(page.exchanges.length + page.earlier).toBe(3_000)
    expect(page.exchanges.at(-1)?.turn).toBe('t2999')
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(THREAD_READ_BUDGET)
    const kept = new Set(page.exchanges.map((one) => one.turn))
    expect(page.steps.every((one) => kept.has(one.turn))).toBe(true)
  })

  it('reads the page before a request, ending just before it', () => {
    const page = fitThread(turns(10), [], [], 't6', 600)
    expect(page.exchanges.at(-1)?.turn).toBe('t5')
    expect(page.exchanges.length + page.earlier).toBe(6)
    expect(page.earlier).toBeGreaterThan(0)
  })

  it('reads the first page, with nothing before it', () => {
    const page = fitThread(turns(3), [], [], 't2')
    expect(page.exchanges.map((one) => one.turn)).toEqual(['t0', 't1'])
    expect(page.earlier).toBe(0)
  })

  it('reads nothing before a request that is no longer there', () => {
    expect(fitThread(turns(3), [], [], 'gone')).toEqual({ exchanges: [], steps: [], views: [], earlier: 0, earlierSteps: 0 })
  })

  it('keeps the latest calls of a request too long to fit alone, saying how many are left out', () => {
    const steps = Array.from({ length: 3_000 }, (_, index) => step('t1', `c${index}`, 'o'.repeat(4_000), { command: 'x'.repeat(4_000) }))
    const page = fitThread(turns(2), steps, [])
    expect(page.exchanges.map((one) => one.turn)).toEqual(['t1'])
    expect(page.earlier).toBe(1)
    expect(page.earlierSteps).toBeGreaterThan(0)
    expect(page.earlierSteps + page.steps.length).toBe(3_000)
    expect(page.steps.at(-1)?.call).toBe('c2999')
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(THREAD_READ_BUDGET)
  })

  it('always keeps the latest request, however heavy', () => {
    const page = fitThread([exchange('t1'), exchange('t2', 'w'.repeat(2_000))], [], [], undefined, 100)
    expect(page.exchanges.map((one) => one.turn)).toEqual(['t2'])
    expect(page.earlier).toBe(1)
  })
})
