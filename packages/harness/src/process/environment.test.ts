import { describe, expect, it } from 'vitest'
import { loadEnvironment, withoutAgentSession } from './environment.ts'

describe('the environment a CLI is started with', () => {
  it('has none of the marks of a surrounding agent session', () => {
    const clean = withoutAgentSession({
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      CLAUDE_CODE_SESSION_ID: 'outer',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_MESSAGING_SOCKET: '/run/outer.sock',
      CLAUDE_AGENT_SDK_VERSION: '1.0.0',
      CLAUDE_PID: '42',
      CLAUDE_EFFORT: 'high',
      AI_AGENT: 'outer',
      PATH: '/usr/bin',
      HOME: '/home/ada'
    })
    expect(clean).toEqual({ PATH: '/usr/bin', HOME: '/home/ada' })
  })

  it('keeps what says where the user’s account is and how it is reached', () => {
    const chosen = {
      CLAUDE_CONFIG_DIR: '/home/ada/.claude-work',
      CLAUDE_CODE_OAUTH_TOKEN: 'token',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_API_KEY: 'key',
      CODEX_HOME: '/home/ada/.codex-work',
      OPENAI_API_KEY: 'key'
    }
    expect(withoutAgentSession(chosen)).toEqual(chosen)
  })

  it('knows the marks whatever their case, as Windows does', () => {
    expect(withoutAgentSession({ ClaudeCode: '1', claude_code_entrypoint: 'cli', Path: 'C:\\Windows' })).toEqual({ Path: 'C:\\Windows' })
  })

  it('drops variables that have no value', () => {
    expect(withoutAgentSession({ PATH: '/usr/bin', EMPTY: undefined })).toEqual({ PATH: '/usr/bin' })
  })

  it('uses an environment it is given as it is, cleaned', async () => {
    expect(await loadEnvironment({ PATH: '/only/this', CLAUDECODE: '1' })).toEqual({ PATH: '/only/this' })
  })

  it('gives this process’s environment, cleaned, with a search path, when given none', async () => {
    const loaded = await loadEnvironment()
    expect(Object.keys(loaded).some((name) => /^(CLAUDECODE|CLAUDE_CODE_.*)$/.test(name) && !/OAUTH_TOKEN|USE_/.test(name))).toBe(false)
    expect(Object.keys(loaded).some((name) => name.toUpperCase() === 'PATH')).toBe(true)
    // Worked out once: the user's shell is not asked again.
    expect(await loadEnvironment()).toBe(loaded)
  }, 30_000)
})
