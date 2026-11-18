import { join } from 'node:path'
import type { Harness } from '@repo/core'
import type { HarnessOptions } from '../options.ts'
import { createCli, type Launch } from '../process/cli.ts'
import { loadEnvironment } from '../process/environment.ts'
import { openTerminal } from '../process/terminal/index.ts'
import { installLocations } from './install/index.ts'
import { codexComputer, type Holding } from './isolation.ts'
import { codexChoices, codexHome } from './models.ts'
import { complete } from './one-shot.ts'
import { sandbox } from './sandbox/index.ts'
import { openSession } from './session.ts'
import { NOT_INSTALLED, status } from './status.ts'

export const CODEX_ID = 'codex'

/** Where Codex keeps the user's settings and sign-in, when it is not the default place. */
const HOME_VARIABLE = 'CODEX_HOME'

/** How long a check that found the sandbox holding writing only is kept before it is made again. */
const RECHECK_MS = 10 * 60_000

/** Codex, the user's own, signed in with their own account, as an engine for the core. */
export function createCodex(options: HarnessOptions): Harness {
  const { folder, log } = options
  const models = options.models ?? {}
  const cli = createCli({ program: 'codex', usualLocations: installLocations, notInstalled: NOT_INSTALLED, command: options.command, env: options.env })

  // How this computer's sandbox holds commands, found by running Codex once. A sandbox found to hold reading stays
  // so; one found not to is looked at again a while later, in case the check itself was cut short.
  let held: { holding: Promise<Holding>; at: number } | undefined
  const holding = (launch: Launch): Promise<Holding> => {
    const now = Date.now()
    if (held && now - held.at < RECHECK_MS) return held.holding
    const previous = held
    const found = previous ? previous.holding.then((was) => (was === 'granted' ? was : check(launch))) : check(launch)
    held = { holding: found, at: now }
    return found
  }
  const check = async (launch: Launch): Promise<Holding> => {
    const holds = await sandbox.holdsReading(launch, join(folder, 'sandbox-check'))
    return holds ? 'granted' : 'writes'
  }

  return {
    id: CODEX_ID,
    name: 'Codex',
    // Pictures the person hands over are shown to the model with what they said.
    capabilities: { images: true },
    // Its sessions read and change files with its command line and its patches, held by its sandbox.
    async computer() {
      const launch = await cli.launch().catch(() => undefined)
      return codexComputer(launch ? await holding(launch) : 'writes')
    },
    status: () => status(cli),
    // Codex keeps the list of models it offers this account in its own folder, which the environment can move.
    models: async () => codexChoices(codexHome(await loadEnvironment(options.env))),
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
    open: (request) => openSession(request, { cli, folder, models, log, holding }),
    complete: (request) => complete(request, { cli, folder, models, log })
  }
}
