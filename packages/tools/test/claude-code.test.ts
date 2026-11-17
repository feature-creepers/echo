import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolHost } from '@repo/core'
import { afterEach, describe, expect, it } from 'vitest'
import { serveTools, type ToolServer } from '../src/index.ts'

/**
 * The server, called by the real Claude Code.
 *
 * It needs the program installed and signed in, and it spends a little of the account's allowance (one short
 * question to the cheapest model), so it runs only when asked for:
 *
 *   REAL_HARNESS=1 pnpm --filter @repo/tools test
 */

/** What a session of Claude Code leaves in the environment of the programs it starts. A child that finds them takes itself for a part of that session. */
const OF_A_SESSION = /^CLAUDE(CODE$|_)/

interface Run {
  failure: string | undefined
  answer: string
}

/** Ask Claude Code one question, with our server as its only tools, and give what it answered. */
function claude(question: string, server: { url: string; token: string }, folder: string): Promise<Run> {
  const config = join(folder, 'mcp.json')
  writeFileSync(config, JSON.stringify({ mcpServers: { core: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.token}` } } } }))

  // The question comes first: the options that take a list would otherwise take it for one of their items.
  const args = [
    ['-p', question],
    ['--model', 'haiku'],
    // Nothing of the user's own: no settings, no project files, no other tool server, no built-in tool, no command.
    ['--setting-sources', ''],
    ['--strict-mcp-config', '--mcp-config', config],
    ['--tools', ''],
    ['--allowedTools', 'mcp__core__echo_test'],
    ['--disable-slash-commands', '--no-session-persistence']
  ].flat()
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !OF_A_SESSION.test(name)))

  return new Promise((resolve) => {
    const child = execFile('claude', args, { cwd: folder, env, timeout: 150_000 }, (error, stdout, stderr) => {
      resolve({ failure: error ? `${error.message}\n${stderr}` : undefined, answer: stdout })
    })
    // It waits a few seconds for a question on standard input unless told there is none.
    child.stdin?.end()
  })
}

describe.runIf(process.env.REAL_HARNESS === '1')('the tool server, called by Claude Code', () => {
  let server: ToolServer | undefined
  let folder: string | undefined
  afterEach(async () => {
    await server?.close()
    if (folder) rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
  })

  it('lists its tool to the model and carries its call to the host, with the token of the session', { timeout: 180_000 }, async () => {
    const token = randomBytes(24).toString('hex')
    // Something the model can only have read in the result of the tool.
    const marker = `marker-${randomBytes(6).toString('hex')}`
    const calls: { token: string; name: string; input: unknown }[] = []
    const host: ToolHost = {
      list: (candidate) =>
        candidate === token
          ? [{ name: 'echo_test', description: 'Gives a marker. Call it when asked for the marker.', inputSchema: { type: 'object', properties: {} } }]
          : undefined,
      call: async (candidate, name, input) => {
        calls.push({ token: candidate, name, input })
        return { ok: true, text: marker }
      }
    }
    server = await serveTools(host)
    folder = mkdtempSync(join(tmpdir(), 'tools-test-'))

    const run = await claude('Call the echo_test tool once, then reply with exactly the text it returned and nothing else.', { url: server.url, token }, folder)

    expect(run.failure).toBeUndefined()
    expect(calls).toEqual([{ token, name: 'echo_test', input: {} }])
    expect(run.answer).toContain(marker)
  })
})
