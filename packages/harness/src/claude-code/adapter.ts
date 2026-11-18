import type { Harness } from '@repo/core'
import type { HarnessOptions } from '../options.ts'
import { createCli } from '../process/cli.ts'
import { openTerminal } from '../process/terminal/index.ts'
import { installLocations } from './install/index.ts'
import { CLAUDE_CODE_CHOICES, CLAUDE_CODE_MODELS } from './models.ts'
import { complete } from './one-shot.ts'
import { openSession } from './session.ts'
import { NOT_INSTALLED, status } from './status.ts'

export const CLAUDE_CODE_ID = 'claude-code'

/** Where Claude Code keeps the user's settings and sign-in, when it is not the default place. */
const HOME_VARIABLE = 'CLAUDE_CONFIG_DIR'

/** Claude Code, the user's own, signed in with their own account, as an engine for the core. */
export function createClaudeCode(options: HarnessOptions): Harness {
  const { folder, log } = options
  const models = { ...CLAUDE_CODE_MODELS, ...options.models }
  const cli = createCli({ program: 'claude', usualLocations: installLocations, notInstalled: NOT_INSTALLED, command: options.command, env: options.env })

  return {
    id: CLAUDE_CODE_ID,
    name: 'Claude Code',
    // Pictures the person hands over are shown to the model with what they said.
    capabilities: { images: true },
    status: () => status(cli),
    models: async () => CLAUDE_CODE_CHOICES,
    async signIn() {
      const { command, env } = await cli.launch()
      const home = env[HOME_VARIABLE]
      await openTerminal({
        command: [command.program, ...command.leading, 'auth', 'login'],
        title: 'Claude Code sign-in',
        // So that the terminal signs in to the account the sessions will use.
        variables: home === undefined ? {} : { [HOME_VARIABLE]: home },
        env
      })
    },
    open: (request) => openSession(request, { cli, folder, model: request.model ?? models[request.role], log }),
    complete: (request) => complete(request, { cli, folder, model: request.model ?? models[request.role], log })
  }
}
