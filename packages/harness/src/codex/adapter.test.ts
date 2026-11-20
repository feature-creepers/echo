import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fake, folder, recordingLog, removeFolders } from '../../test/sessions.ts'
import type { Cli } from '../process/cli.ts'
import type { Environment } from '../process/environment.ts'
import { readVersion } from '../process/output.ts'
import { createCodex } from './adapter.ts'
import { userToolServers } from './isolation.ts'
import { readAccount, status } from './status.ts'

afterEach(removeFolders)

function harness(env: Environment = {}) {
  const log = recordingLog()
  const at = folder()
  return { harness: createCodex({ folder: at, log, command: fake('fake-codex.ts'), env: { ...process.env, CODEX_HOME: folder(), ...env } }), log, folder: at }
}

describe('Codex', () => {
  it('is named for settings and for the user', () => {
    const { harness: codex } = harness()
    expect([codex.id, codex.name]).toEqual(['codex', 'Codex'])
  })

  describe('status', () => {
    it('says how the user is signed in, and with which version', async () => {
      expect(await harness().harness.status()).toEqual({ installed: true, signedIn: true, version: '9.9.9', account: 'ChatGPT' })
    })

    it('says when nobody is signed in', async () => {
      expect(await harness({ FAKE_LOGIN: 'out' }).harness.status()).toEqual({
        installed: true,
        signedIn: false,
        version: '9.9.9',
        problem: 'Codex is not signed in.'
      })
    })

    it('says when the CLI is not installed', async () => {
      const nowhere: Cli = { launch: () => Promise.reject(new Error('unused')), find: () => Promise.resolve(undefined) }
      expect(await status(nowhere)).toEqual({
        installed: false,
        signedIn: false,
        problem: 'Codex is not installed. Install it from developers.openai.com/codex, then sign in.'
      })
    })

    it('reads the version and the sign-in the CLI prints', () => {
      expect(readVersion('codex-cli 0.130.0\n')).toBe('0.130.0')
      expect(readAccount('Logged in using ChatGPT\n', 0)).toEqual({ signedIn: true, account: 'ChatGPT' })
      expect(readAccount('WARNING: something\nLogged in using an API key - sk-***\n', 0)).toEqual({ signedIn: true, account: 'an API key - sk-***' })
      expect(readAccount('Not logged in\n', 1)).toEqual({ signedIn: false })
      expect(readAccount('', 1)).toEqual({ signedIn: false })
    })
  })

  describe('a single question', () => {
    it('resolves with the answer, and not with what the CLI prints about the run', async () => {
      const { harness: codex } = harness()
      expect(await codex.complete({ role: 'utility', instructions: 'Be brief.', input: 'hello' })).toBe('You said: hello')
    })

    it('asks with everything of the CLI’s own switched off', async () => {
      const { harness: codex } = harness()
      const args: string[] = JSON.parse(await codex.complete({ role: 'utility', instructions: '', input: 'argv' }))
      const settings = args.filter((_, index) => args[index - 1] === '-c')

      expect(args[0]).toBe('exec')
      expect(args[args.indexOf('-m') + 1]).toBe('gpt-6-luna')
      expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
      for (const flag of ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check']) expect(args).toContain(flag)
      expect(settings).toEqual(expect.arrayContaining(['features.shell_tool=false', 'project_doc_max_bytes=0']))
      expect(settings.some((setting) => /^model_instructions_file="[^\\]*instructions\.txt"$/.test(setting))).toBe(true)
      expect(args.at(-1)).toBe('-')
    })

    it('hands over the instructions whole, and leaves no file behind', async () => {
      const { harness: codex, folder: at } = harness()
      expect(await codex.complete({ role: 'utility', instructions: 'You are Ada.\nBe brief.', input: 'instructions' })).toBe('You are Ada.\nBe brief.')
      expect(readdirSync(at)).toEqual([])
    })

    it('rejects, saying so, when the user is not signed in', async () => {
      const { harness: codex } = harness()
      await expect(codex.complete({ role: 'utility', instructions: '', input: 'signed out' })).rejects.toThrow(
        'Codex is not signed in. Sign in to it, then try again.'
      )
    })

    it('rejects with what the CLI printed when it fails', async () => {
      const { harness: codex, log } = harness()
      await expect(codex.complete({ role: 'utility', instructions: '', input: 'crash' })).rejects.toThrow('Codex reported an error: boom: the one-shot broke')
      expect(log.errors).toHaveLength(1)
    })

    it('gives up after the time allowed', async () => {
      const { harness: codex, folder: at } = harness()
      await expect(codex.complete({ role: 'utility', instructions: '', input: 'sleep', timeoutMs: 300 })).rejects.toThrow('Codex took too long to answer.')
      expect(readdirSync(at)).toEqual([])
    })
  })

  it('reads no tool server from a home that has no settings', async () => {
    expect(await userToolServers(folder())).toEqual([])
  })

  it.each([
    ['a table', '[mcp_servers.files]\ncommand = "files"\n', ['files']],
    ['a quoted name', '[mcp_servers."my files"]\ncommand = "files"\n', ['my files']],
    ['dotted keys', 'mcp_servers.notes.command = "notes"\n', ['notes']],
    ['an inline table', 'mcp_servers = { mail = { command = "mail" }, web = { url = "https://example.org" } }\n', ['mail', 'web']],
    ['a header with spaces', '[ mcp_servers . spaced ]\ncommand = "x"\n', ['spaced']],
    ['no servers', 'model = "terra"\n', []],
    ['settings Codex cannot read either', '[mcp_servers.broken\n', []]
  ])('reads the tool servers of the user written as %s', async (_, settings, names) => {
    const home = folder()
    writeFileSync(join(home, 'config.toml'), settings)
    expect(await userToolServers(home)).toEqual(names)
  })
})
