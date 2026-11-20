import { readFile } from 'node:fs/promises'
import type { Log, OneShot, Role } from '@repo/core'
import type { Cli } from '../process/cli.ts'
import { lastLines, saysSignedOut } from '../process/output.ts'
import { run, TimedOut } from '../process/run.ts'
import { createWorkingFiles } from '../process/working-files.ts'
import { execArguments } from './isolation.ts'
import { codexHome, codexModels } from './models.ts'
import { SIGNED_OUT } from './status.ts'

interface OneShotContext {
  cli: Cli
  folder: string
  models: Partial<Record<Role, string>>
  log: Log
}

const DEFAULT_TIMEOUT_MS = 120_000

/** One question to Codex, answered in text: a new process each time, which knows nothing of earlier ones. */
export async function complete(request: OneShot, context: OneShotContext): Promise<string> {
  const launch = await context.cli.launch()
  const models = await codexModels(codexHome(launch.env), context.models)
  const files = createWorkingFiles(context.folder)
  try {
    const instructions = await files.write('instructions.txt', request.instructions)
    const answer = files.path('answer.txt')
    const result = await run(launch.command, execArguments({ model: request.model ?? models[request.role], effort: request.effort, instructions, answer }), {
      cwd: context.folder,
      env: launch.env,
      input: request.input,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })
    const text = await readFile(answer, 'utf8').catch(() => '')
    if (result.code === 0 && text.trim() !== '') return text

    const detail = lastLines(result.stderr, result.stdout) || `exit code ${result.code}`
    context.log.error(`Codex failed to answer a single question: ${detail}`)
    throw new Error(saysSignedOut(detail) ? SIGNED_OUT : `Codex reported an error: ${detail}`)
  } catch (error) {
    if (error instanceof TimedOut) throw new Error('Codex took too long to answer.')
    throw error
  } finally {
    await files.remove()
  }
}
