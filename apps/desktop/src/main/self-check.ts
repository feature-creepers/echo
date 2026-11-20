import { openSession, type SessionLink } from '@repo/client'
import type { Settings } from '@repo/protocol'

/** How long the whole exchange may take before it counts as failed. */
const TIMEOUT_MS = 15_000

type Session = ReturnType<typeof openSession>

/** Run one check in a session of its own. Resolves with 'ok', or with what went wrong in words for a developer. */
async function check(link: SessionLink, work: (session: Session) => Promise<string>): Promise<string> {
  const session = openSession(link)
  let late: NodeJS.Timeout | undefined
  const timeout = new Promise<string>((resolve) => {
    late = setTimeout(() => resolve(`the core did not answer within ${TIMEOUT_MS / 1000} seconds`), TIMEOUT_MS)
  })
  try {
    return await Promise.race([work(session), timeout])
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    clearTimeout(late)
    session.close()
  }
}

/**
 * Do what a first launch does, against the real core: read a new user's settings, name a persona, pick it,
 * hear the change announced, and read it back from the core's file.
 */
export function checkSettings(link: SessionLink): Promise<string> {
  return check(link, exchange)
}

/**
 * Search by meaning, as far as it goes with no model: the core's store loaded sqlite-vec, and the worker that runs the
 * model starts and loads its runtime, which the core does before downloading anything. The download that follows is
 * stopped at once, in the check's own folder.
 */
export function checkMeaning(link: SessionLink): Promise<string> {
  return check(link, async (session) => {
    const { memory } = await session.run('memory.read', {})
    if (!memory.meaning) return 'the core offers no search by meaning'
    if (memory.meaning.state === 'unavailable') return memory.meaning.why
    const { memory: started } = await session.run('memory.meaning.install', {})
    await session.run('memory.meaning.cancel', {})
    const meaning = started.meaning
    if (meaning?.state === 'unavailable') return meaning.why
    if (meaning?.state === 'absent') return `the download did not start: ${meaning.failed ?? 'no reason given'}`
    return meaning?.state === 'downloading' ? 'ok' : `search by meaning was ${meaning?.state ?? 'gone'} before any download`
  })
}

async function exchange(session: Session): Promise<string> {
  const { settings: fresh } = await session.run('settings.read', {})
  if (fresh.personas.confirmed) return 'a new user already had confirmed personas'
  const last = fresh.personas.available.at(-1)
  if (!last) return 'a new user had no persona'

  const announced = new Promise<Settings>((resolve) => {
    session.onEvent((event) => {
      if (event.name === 'settings.changed') resolve(event.settings)
    })
  })
  // Typed as a person might; kept as a call sign, in capitals with a hyphen.
  const name = 'SELF-CHECK'
  const { settings: kept } = await session.run('personas.set', { names: [{ persona: last.id, name: 'Self Check' }], active: last.id })
  const heard = await announced
  const { settings: read } = await session.run('settings.read', {})

  const expected = { revision: fresh.revision + 1, active: last.id, confirmed: true, name }
  for (const [where, settings] of Object.entries({ 'the result': kept, 'the event': heard, 'the second read': read })) {
    const found = {
      revision: settings.revision,
      active: settings.personas.active,
      confirmed: settings.personas.confirmed,
      name: settings.personas.available.find((persona) => persona.id === last.id)?.name
    }
    if (JSON.stringify(found) !== JSON.stringify(expected)) return `${where} held ${JSON.stringify(found)}, not ${JSON.stringify(expected)}`
  }
  return 'ok'
}
