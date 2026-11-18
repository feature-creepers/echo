import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createBrowser } from '@repo/browser'
import { type Core, createCore } from '@repo/core'
import { createComputer, createHarnesses } from '@repo/harness'
import { openStore } from '@repo/store'
import { serveTools } from '@repo/tools'
import manifest from '../package.json' with { type: 'json' }
import { localToken } from './auth/local-token.ts'
import type { Config } from './config.ts'
import { publicWeb } from './web/public-web.ts'

export interface Composition {
  core: Core
  /** Let go of what the core holds on this machine. Called once, when the process stops. */
  close(): Promise<void>
}

/**
 * Wire the core to what it needs on this machine.
 *
 * This is the only file that knows both the core and the adapters it runs on.
 */
export async function compose(config: Config): Promise<Composition> {
  const store = openStore({ folder: config.data })
  const log = { error: (message: string) => void process.stderr.write(`${message}\n`) }
  // The assistant's own folder, where it keeps the files it makes for the user: in the data folder, created now.
  const computer = await createComputer({ workspace: join(config.data, 'workspace') })
  // The browser the assistant drives, with a profile of its own beside the user's data; what it downloads goes to the assistant's folder.
  const browser = createBrowser({ profile: join(config.data, 'browser'), downloads: join(computer.workspace, 'downloads'), log })
  const core = createCore({
    version: manifest.version,
    acceptsCredential: localToken(config.token),
    records: store.records,
    blobs: store.blobs,
    search: store.search,
    log,
    harnesses: createHarnesses({ folder: join(config.data, 'harness'), log }),
    newId: randomUUID,
    web: publicWeb,
    computer,
    browser,
    timers: {
      after(ms, work) {
        // A timer of the core never keeps the process alive on its own.
        const timer = setTimeout(work, ms).unref()
        return () => clearTimeout(timer)
      }
    }
  })
  // Sessions can show things once the tool server listens: it carries their calls to the core.
  const tools = await serveTools(core.toolHost, { version: manifest.version, log })
  core.serveToolsAt(tools.url)

  return {
    core,
    async close() {
      core.close()
      await browser.close()
      await tools.close()
      store.close()
    }
  }
}
