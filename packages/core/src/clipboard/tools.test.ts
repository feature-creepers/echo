import { describe, expect, it } from 'vitest'
import type { Answer } from '../access/approvals.ts'
import type { Clipboard } from '../ports/clipboard.ts'
import { createClipboardControl } from './tools.ts'

const showing = () => ({ thread: 't', turn: 'turn', focused: true })

function setup(answers: Answer[] = []) {
  let held = 'copied by the person'
  const clipboard: Clipboard = {
    read: async () => held,
    write: async (text) => {
      held = text
    }
  }
  const asked: string[] = []
  const recorded: { tool: string; decision: string; reason: string }[] = []
  const control = createClipboardControl({
    clipboard,
    ask: async (question) => {
      asked.push(question.heading)
      return { answer: answers.shift() ?? 'no', pressed: true }
    },
    uses: {
      record: (use) => {
        recorded.push({ tool: use.tool, decision: use.decision, reason: use.reason })
        return `use${recorded.length}`
      },
      report: () => undefined
    }
  })
  const call = async (name: string, input: unknown = {}) => {
    const tool = control.tools(showing).find((one) => one.definition.name === name)
    if (!tool) throw new Error(`No tool ${name}`)
    return tool.run(input)
  }
  return { control, call, asked, recorded, held: () => held }
}

describe('the clipboard tools', () => {
  it('writes without asking, and keeps it in the activity', async () => {
    const { call, asked, recorded, held } = setup()
    expect(await call('clipboard_write', { text: 'Hello' })).toMatchObject({ ok: true })
    expect(held()).toBe('Hello')
    expect(asked).toEqual([])
    expect(recorded).toEqual([{ tool: 'clipboard_write', decision: 'ran', reason: 'level' }])
  })

  it.each([
    [['no'] as Answer[], false, 'declined'],
    [['unanswered'] as Answer[], false, 'unanswered'],
    [['stopped'] as Answer[], false, 'stopped'],
    [['yes'] as Answer[], true, 'pressed']
  ])('reads only once the person says yes: %j', async (answers, ok, reason) => {
    const { call, asked, recorded } = setup(answers)
    const result = await call('clipboard_read')
    expect(result.ok).toBe(ok)
    if (ok) expect(result.text).toContain('copied by the person')
    else expect(result.text).not.toContain('copied by the person')
    expect(asked).toEqual(['Read your clipboard?'])
    expect(recorded[0]?.reason).toBe(reason)
  })

  it('asks every time after a yes, and not again after a yes for the session until everything stops', async () => {
    const { control, call, asked } = setup(['yes', 'session', 'yes'])
    await call('clipboard_read')
    await call('clipboard_read')
    expect(asked).toHaveLength(2)
    await call('clipboard_read')
    expect(asked).toHaveLength(2)
    control.forget()
    await call('clipboard_read')
    expect(asked).toHaveLength(3)
  })

  it('refuses empty text', async () => {
    const { call } = setup()
    expect((await call('clipboard_write', { text: '' })).ok).toBe(false)
  })
})
