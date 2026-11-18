import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { createSchedule } from './schedule.ts'
import { SCHEDULE_CANCEL_TOOL, SCHEDULE_CREATE_TOOL, SCHEDULE_LIST_TOOL, SCHEDULE_UPDATE_TOOL, scheduleTools } from './tools.ts'

/** Wednesday 18 November 2026, 14:13 in Paris. */
const START = Date.parse('2026-11-18T13:13:00Z')

function setup() {
  const timers = manualTimers()
  const now = () => new Date(START + timers.elapsed())
  let ids = 0
  const schedule = createSchedule({
    records: memoryRecords(),
    now,
    zone: () => 'Europe/Paris',
    timers,
    newId: () => `job-${++ids}`,
    proactive: { busy: () => false, remind: () => undefined, run: () => undefined, notify: () => undefined }
  })
  const tools = scheduleTools({ schedule, now, zone: () => 'Europe/Paris' })
  const call = async (name: string, input: unknown) => {
    const tool = tools.find((one) => one.definition.name === name)
    if (!tool) throw new Error(`No tool ${name}`)
    return await tool.run(input)
  }
  return { schedule, call }
}

const feedTheCat = { kind: 'reminder', title: 'Feed the cat', sentence: "It's eight: time to feed the cat.", timing: { kind: 'once', at: '2026-11-19T08:00' } }

describe('the schedule tools', () => {
  it('set a reminder, and say when it rings for the model to confirm', async () => {
    const { schedule, call } = setup()
    expect(await call(SCHEDULE_CREATE_TOOL, feedTheCat)).toEqual({
      ok: true,
      text: 'Set [job-1]: reminder "Feed the cat", tomorrow at 08:00. Confirm it in one short sentence.'
    })
    expect(schedule.read().jobs[0]).toMatchObject({ kind: 'reminder', language: 'en', next: '2026-11-19T07:00:00.000Z' })
  })

  it('set a reminder in a few minutes, to the second', async () => {
    const { schedule, call } = setup()
    const set = await call(SCHEDULE_CREATE_TOOL, { ...feedTheCat, title: 'Stretch', sentence: 'Time to stretch.', timing: { kind: 'once', inMinutes: 2 } })
    expect(set.text).toContain('today at 14:15')
    expect(schedule.read().jobs[0]?.next).toBe('2026-11-18T13:15:00.000Z')
  })

  it('set a recurring task, and tell its language from its words', async () => {
    const { schedule, call } = setup()
    const set = await call(SCHEDULE_CREATE_TOOL, {
      kind: 'task',
      title: 'Météo à Lyon',
      request: 'Donne-moi la météo à Lyon, s’il te plaît.',
      timing: { kind: 'weekdays', time: '07:30' }
    })
    expect(set.text).toContain('every weekday at 07:30 (next tomorrow at 07:30)')
    expect(schedule.read().jobs[0]).toMatchObject({ kind: 'task', language: 'fr', request: 'Donne-moi la météo à Lyon, s’il te plaît.' })
  })

  it.each([
    ['a reminder with nothing to say', { ...feedTheCat, sentence: undefined }, /needs "sentence"/],
    ['a task with nothing to do', { kind: 'task', title: 'Weather', timing: { kind: 'daily', time: '07:00' } }, /needs "request"/],
    ['a moment past', { ...feedTheCat, timing: { kind: 'once', at: '2026-11-18T08:00' } }, /passed/],
    ['no title', { ...feedTheCat, title: '' }, /"title"/]
  ])('refuse %s, saying why', async (_case, input, problem) => {
    const { call } = setup()
    const refused = await call(SCHEDULE_CREATE_TOOL, input)
    expect(refused.ok).toBe(false)
    expect(refused.text).toMatch(problem)
  })

  it('list what is set, with ids', async () => {
    const { call } = setup()
    expect((await call(SCHEDULE_LIST_TOOL, {})).text).toBe('Nothing is set.')
    await call(SCHEDULE_CREATE_TOOL, feedTheCat)
    expect((await call(SCHEDULE_LIST_TOOL, {})).text).toBe('- [job-1] reminder "Feed the cat", tomorrow at 08:00')
  })

  it('move a reminder to another time, and pause it', async () => {
    const { schedule, call } = setup()
    await call(SCHEDULE_CREATE_TOOL, feedTheCat)
    expect((await call(SCHEDULE_UPDATE_TOOL, { job: 'job-1', timing: { kind: 'once', at: '2026-11-19T09:00' } })).text).toContain('tomorrow at 09:00')
    await call(SCHEDULE_UPDATE_TOOL, { job: 'job-1', paused: true })
    expect(schedule.read().jobs[0]?.state).toBe('paused')
    expect((await call(SCHEDULE_UPDATE_TOOL, { job: 'job-9', paused: true })).ok).toBe(false)
  })

  it('cancel by what it is about, and ask which when several could be meant', async () => {
    const { schedule, call } = setup()
    await call(SCHEDULE_CREATE_TOOL, feedTheCat)
    await call(SCHEDULE_CREATE_TOOL, { ...feedTheCat, title: 'Buy cat food', sentence: 'Buy cat food on the way.' })
    await call(SCHEDULE_CREATE_TOOL, { ...feedTheCat, title: 'Call the dentist', sentence: 'Call the dentist.' })

    const unsure = await call(SCHEDULE_CANCEL_TOOL, { description: 'the cat' })
    expect(unsure.ok).toBe(false)
    expect(unsure.text).toContain('Several could be meant')

    expect(await call(SCHEDULE_CANCEL_TOOL, { description: 'dentist' })).toEqual({ ok: true, text: 'Cancelled: Call the dentist. Say so in a few words.' })
    expect(await call(SCHEDULE_CANCEL_TOOL, { job: 'job-1' })).toMatchObject({ ok: true })
    expect(schedule.read().jobs.map((job) => job.title)).toEqual(['Buy cat food'])
    expect((await call(SCHEDULE_CANCEL_TOOL, { description: 'piano lesson' })).ok).toBe(false)
  })
})
