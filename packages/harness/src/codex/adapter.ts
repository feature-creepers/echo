import type { Harness } from '@repo/core'
import type { HarnessOptions } from '../options.ts'
import { createCli } from '../process/cli.ts'
import { openTerminal } from '../process/terminal/index.ts'
import { installLocations } from './install/index.ts'
import { complete } from './one-shot.ts'
import { openSession } from './session.ts'
import { NOT_INSTALLED, status } from './status.ts'

export const CODEX_ID = 'codex'

/** Where Codex keeps the user's settings and sign-in, when it is not the default place. */
const HOME_VARIABLE = 'CODEX_HOME'

/** Codex, the user's own, signed in with their own account, as an engine for the core. */
export function createCodex(options: HarnessOptions): Harness {
  const { folder, log } = options
  const models = options.models ?? {}
  const cli = createCli({ program: 'codex', usualLocations: installLocations, notInstalled: NOT_INSTALLED, command: options.command, env: options.env })

  return {
    id: CODEX_ID,
    name: 'Codex',
    status: () => status(cli),
    async signIn() {
      const { command, env } = await cli.launch()
      const home = env[HOME_VARIABLE]
      await openTerminal({
        command: [command.program, ...command.leading, 'login'],
        title: 'Codex sign-in',
        // So that the terminal signs in to the account the sessions will use.
        variables: home === undefined ? {} : { [HOME_VARIABLE]: home },
        env
      })
    },
    open: (request) => openSession(request, { cli, folder, models, log }),
    complete: (request) => complete(request, { cli, folder, models, log })
  }
}
