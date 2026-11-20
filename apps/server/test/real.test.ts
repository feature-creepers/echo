import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLineDecoder, DATA_OPTION, type Event, EXIT_WITH_PARENT_FLAG, encodeLine, PROTOCOL_VERSION, readySchema } from '@repo/protocol'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * The whole core against the user's real Claude Code: a spoken answer sentence by sentence, and a view the
 * model composes and the core accepts. It spends a few calls of the user's allowance, so it runs only when
 * REAL_HARNESS=1 is set.
 */
const real = process.env.REAL_HARNESS === '1'
const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url))
// Made only when the test runs, so a run that skips it leaves nothing in the temporary folder.
const folder = real ? mkdtempSync(join(tmpdir(), 'core-real-')) : undefined
const child = folder ? spawn(process.execPath, [ENTRY, `--${DATA_OPTION}`, folder, EXIT_WITH_PARENT_FLAG], { stdio: ['pipe', 'pipe', 'inherit'] }) : undefined
// The token, on the first line of its standard input.
child?.stdin?.write('token\n')

afterAll(() => {
  child?.stdin?.end()
  if (folder) rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function client() {
  const endpoint = await new Promise<string>((resolve) => {
    const decoder = createLineDecoder()
    child?.stdout?.setEncoding('utf8').on('data', (text: string) => {
      for (const line of decoder.push(text)) if (line.ok) resolve(readySchema.parse(line.message).endpoint)
    })
  })
  const socket = connect(endpoint)
  socket.setEncoding('utf8')
  const decoder = createLineDecoder()
  const messages: unknown[] = []
  const waiters: (() => void)[] = []
  socket.on('data', (text: string) => {
    for (const line of decoder.push(text)) if (line.ok) messages.push(line.message)
    for (const waiter of waiters.splice(0)) waiter()
  })
  await new Promise((resolve) => socket.once('connect', resolve))
  socket.write(
    encodeLine({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      client: { kind: 'desktop', version: '0', device: 'd' },
      capabilities: ['display'],
      credential: 'token'
    })
  )
  let ids = 0
  const send = (name: string, input: unknown) => socket.write(encodeLine({ type: 'command', id: `c${++ids}`, name, input }))
  const until = async (test: (message: Event) => boolean, ms = 120_000) => {
    const deadline = Date.now() + ms
    for (;;) {
      const found = messages.find((message) => test(message as Event))
      if (found) return found as Event
      if (Date.now() > deadline) throw new Error(`Timed out. Received: ${JSON.stringify(messages).slice(-2000)}`)
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, 1000)
      })
    }
  }
  return { send, until, messages, close: () => socket.destroy() }
}

describe.skipIf(!real)('the core with the real Claude Code', () => {
  it('answers aloud, sentence by sentence, and shows a view it composed', { timeout: 240_000 }, async () => {
    const core = await client()
    core.send('personas.set', { names: [{ persona: 'ally', name: 'Ada' }], active: 'ally' })

    const started = Date.now()
    core.send('utterance.send', { text: 'Compare the populations of Paris, Lyon and Marseille, and show it on the screen.' })
    const firstSentence = await core.until((message) => message.name === 'speech.say')
    const ended = await core.until((message) => message.name === 'turn.ended')
    const shown = core.messages.find((message) => (message as Event).name === 'view.shown') as Extract<Event, { name: 'view.shown' }> | undefined
    const spoken = core.messages.filter((message) => (message as Event).name === 'speech.say').map((message) => (message as { text: string }).text)

    process.stderr.write(`first sentence after ${firstSentence ? Date.now() - started : '?'} ms (measured at the end)\n${spoken.join('\n')}\n`)
    if (shown)
      process.stderr.write(
        `view: ${shown.view.title}, ${Object.keys(shown.view.spec.elements).length} elements: ${Object.values(shown.view.spec.elements)
          .map((element) => element.type)
          .join(', ')}\n`
      )

    expect(ended).toMatchObject({ exchange: { outcome: 'done', persona: 'ally' } })
    expect(spoken.length).toBeGreaterThan(0)
    expect(shown).toBeDefined()
    core.close()
  })
})
