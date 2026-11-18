import { describe, expect, it } from 'vitest'
import { createTools, type Tool } from './tools.ts'

const echo: Tool = {
  definition: { name: 'echo_back', description: 'Says it back.', inputSchema: { type: 'object' } },
  run: (input) => ({ ok: true, text: JSON.stringify(input) })
}
const broken: Tool = {
  definition: { name: 'broken', description: 'Fails.', inputSchema: { type: 'object' } },
  run: () => {
    throw new Error('it broke')
  }
}

function setup() {
  let tokens = 0
  return createTools(() => `token-${++tokens}`)
}

describe('the tools of the core', () => {
  it('lists what a session was granted, and nothing for a token that is no one’s', () => {
    const tools = setup()
    const grant = tools.grant([echo])
    expect(tools.host.list(grant.token)?.map((tool) => tool.name)).toEqual(['echo_back'])
    expect(tools.host.list('guess')).toBeUndefined()
  })

  it('runs a granted tool for the session that holds the token', async () => {
    const tools = setup()
    const grant = tools.grant([echo])
    expect(await tools.host.call(grant.token, 'echo_back', { a: 1 })).toEqual({ ok: true, text: '{"a":1}' })
  })

  it('refuses a tool the session was not granted', async () => {
    const tools = setup()
    const one = tools.grant([echo])
    tools.grant([broken])
    expect(await tools.host.call(one.token, 'broken', {})).toEqual({ ok: false, text: 'There is no tool named "broken".' })
  })

  it('turns a failure into a result the model can read', async () => {
    const tools = setup()
    const grant = tools.grant([broken])
    expect(await tools.host.call(grant.token, 'broken', {})).toEqual({ ok: false, text: 'The tool failed: it broke' })
  })

  it('stops honouring a token once revoked', async () => {
    const tools = setup()
    const grant = tools.grant([echo])
    grant.revoke()
    expect(tools.host.list(grant.token)).toBeUndefined()
    expect((await tools.host.call(grant.token, 'echo_back', {})).ok).toBe(false)
  })
})
