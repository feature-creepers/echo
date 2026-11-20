import { readdirSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { fake, folder, recordingLog, removeFolders } from '../../test/sessions.ts'
import type { Cli } from '../process/cli.ts'
import type { Environment } from '../process/environment.ts'
import { readVersion } from '../process/output.ts'
import { createClaudeCode } from './adapter.ts'
import { readAccount, status } from './status.ts'

afterEach(removeFolders)

function harness(env: Environment = process.env) {
  const log = recordingLog()
  const at = folder()
  return { harness: createClaudeCode({ folder: at, log, command: fake('fake-claude.ts'), env }), log, folder: at }
}

describe('Claude Code', () => {
  it('is named for settings and for the user', () => {
    const { harness: claude } = harness()
    expect([claude.id, claude.name]).toEqual(['claude-code', 'Claude Code'])
  })

  describe('status', () => {
    it('says who is signed in, and with which version', async () => {
      expect(await harness().harness.status()).toEqual({ installed: true, signedIn: true, version: '9.9.9', account: 'ada@example.com · max' })
    })

    it('says when nobody is signed in', async () => {
      const signedOut = harness({ ...process.env, FAKE_ACCOUNT: '{"loggedIn":false,"authMethod":"none"}' })
      expect(await signedOut.harness.status()).toEqual({ installed: true, signedIn: false, version: '9.9.9', problem: 'Claude Code is not signed in.' })
    })

    it('says when the CLI is not installed', async () => {
      const nowhere: Cli = { launch: () => Promise.reject(new Error('unused')), find: () => Promise.resolve(undefined) }
      expect(await status(nowhere)).toEqual({
        installed: false,
        signedIn: false,
        problem: 'Claude Code is not installed. Install it from claude.com/claude-code, then sign in.'
      })
    })

    it('says when the CLI cannot be run', async () => {
      const broken = createClaudeCode({ folder: folder(), log: recordingLog(), command: ['/nowhere/claude'], env: process.env })
      const found = await broken.status()
      // Not an answer: it is asked again, rather than taken as not installed.
      expect(found).toMatchObject({ installed: true, signedIn: false, unanswered: true })
      expect(found.problem).toMatch(/^Claude Code could not be asked for its status: /)
    })

    it('reads the version the CLI prints', () => {
      expect(readVersion('2.1.322 (Claude Code)\n')).toBe('2.1.322')
      expect(readVersion('1.0.0-beta.2 (Claude Code)')).toBe('1.0.0-beta.2')
      expect(readVersion('nightly\n')).toBe('nightly')
      expect(readVersion('')).toBeUndefined()
    })

    it('reads the account the CLI prints, after any notice', () => {
      expect(readAccount('Update available.\n{"loggedIn":true,"email":"ada@example.com","subscriptionType":"pro"}')).toEqual({
        signedIn: true,
        account: 'ada@example.com · pro'
      })
      expect(readAccount('{"loggedIn":true,"apiProvider":"bedrock"}')).toEqual({ signedIn: true })
      expect(readAccount('{"loggedIn":false}')).toEqual({ signedIn: false })
      expect(readAccount('not json')).toBeUndefined()
    })
  })

  describe('a single question', () => {
    it('resolves with the answer', async () => {
      const { harness: claude } = harness()
      expect(await claude.complete({ role: 'utility', instructions: 'Be brief.', input: 'hello' })).toBe('You said: hello')
    })

    it('reads the answer after a notice the CLI printed first', async () => {
      const { harness: claude } = harness()
      expect(await claude.complete({ role: 'utility', instructions: '', input: 'notice' })).toBe('You said: notice')
    })

    it('asks with everything of the CLI’s own switched off, and no tools', async () => {
      const { harness: claude } = harness()
      const args: string[] = JSON.parse(await claude.complete({ role: 'utility', instructions: '', input: 'argv' }))
      const value = (flag: string) => args[args.indexOf(flag) + 1]

      expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'json'])
      expect(value('--model')).toBe('haiku')
      expect(value('--tools')).toBe('')
      expect(value('--setting-sources')).toBe('')
      for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) expect(args).toContain(flag)
      expect(args).not.toContain('--mcp-config')
    })

    it('hands over the instructions whole, and leaves no file behind', async () => {
      const { harness: claude, folder: at } = harness()
      const files = JSON.parse(await claude.complete({ role: 'utility', instructions: 'You are Ada.\nBe brief.', input: 'files' }))

      expect(files.instructions).toBe('You are Ada.\nBe brief.')
      expect(JSON.parse(files.settings)).toEqual({ autoMemoryEnabled: false })
      expect(readdirSync(at)).toEqual([])
    })

    it('asks without the marks of a surrounding agent session, and with the CLI’s memory off', async () => {
      const { harness: claude } = harness({ ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' })
      const env = JSON.parse(await claude.complete({ role: 'utility', instructions: '', input: 'environment' }))

      expect(env).not.toHaveProperty('CLAUDECODE')
      expect(env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT')
      expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    })

    it('rejects, saying so, when the user is not signed in', async () => {
      const { harness: claude } = harness()
      await expect(claude.complete({ role: 'utility', instructions: '', input: 'signed out' })).rejects.toThrow(
        'Claude Code is not signed in. Sign in to it, then try again.'
      )
    })

    it('rejects with what the CLI printed when it fails', async () => {
      const { harness: claude, log } = harness()
      await expect(claude.complete({ role: 'utility', instructions: '', input: 'crash' })).rejects.toThrow(
        'Claude Code reported an error: boom: the one-shot broke'
      )
      expect(log.errors).toHaveLength(1)
    })

    it('gives up after the time allowed', async () => {
      const { harness: claude, folder: at } = harness()
      await expect(claude.complete({ role: 'utility', instructions: '', input: 'sleep', timeoutMs: 300 })).rejects.toThrow(
        'Claude Code took too long to answer.'
      )
      expect(readdirSync(at)).toEqual([])
    })
  })
})
