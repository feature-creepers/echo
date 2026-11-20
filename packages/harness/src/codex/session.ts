import type { ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Attachment, ComputerUse, Log, Role, Session, SessionRequest } from '@repo/core'
import { asWritten } from '../computer/paths.ts'
import { checkUse } from '../computer/scope.ts'
import { system } from '../computer/system/index.ts'
import { planFromCodex } from '../plan.ts'
import { type Cli, type Launch, NotInstalled } from '../process/cli.ts'
import { createSessionEvents } from '../process/events.ts'
import { asArray, asObject, asString, type JsonObject } from '../process/json.ts'
import { readJsonLines, writeJsonLine } from '../process/json-lines.ts'
import { KEPT_OUTPUT, lastLines, saysSignedOut } from '../process/output.ts'
import { platform } from '../process/platform/index.ts'
import { start, stopGently } from '../process/run.ts'
import { REPORTED_TOOLS } from '../tool-names.ts'
import { commandLine, shownCommand } from './command.ts'
import { appServerArguments, type Holding, heldAsAsked, shellAllowed, TOOL_SERVER, threadSettings, userToolServers, workingFolder } from './isolation.ts'
import { codexHome, codexModels } from './models.ts'
import { SIGNED_OUT } from './status.ts'

interface SessionContext {
  cli: Cli
  /** The adapter's working folder. */
  folder: string
  /** The models the user chose, by role. */
  models: Partial<Record<Role, string>>
  log: Log
  /** How this computer's sandbox holds commands, found once for the adapter. */
  holding(launch: Launch): Promise<Holding>
}

/** Why a session that would have run unconfined was not started, in words for the person. */
const NOT_HELD =
  "Codex would not hold its commands to what you granted: a sandbox_mode in your own Codex settings puts it on its older sandbox. Remove it from Codex's config.toml, or use Claude Code."

/** How this program names itself to Codex, which keeps it in its own records. */
const CLIENT = { name: 'core', title: 'Core', version: '1' }

const text = (value: string) => [{ type: 'text', text: value, text_elements: [] }]

/** What is said, and the pictures handed over with it, which Codex reads from where they are. */
const input = (value: string, attachments: readonly Attachment[]) => [
  ...text(value),
  ...attachments.filter((attachment) => attachment.image).map((attachment) => ({ type: 'localImage', path: attachment.path }))
]

/**
 * A live session with Codex, run as a server: requests and notifications go both ways as JSON lines, in
 * the form of JSON-RPC. A conversation is a "thread", made of "turns", made of "items" (a message, a tool
 * call). Codex also sends requests of its own, to ask what it would ask the person at the keyboard.
 */
export function openSession(request: SessionRequest, context: SessionContext): Session {
  const { log } = context
  const events = createSessionEvents(log)

  let child: ChildProcess | undefined
  let closed = false
  let thread = ''
  /** The turn under way. */
  let turn: string | undefined
  /** The last turn that ended. The answer to the request that started it can come after its end. */
  let ended: string | undefined
  /** Messages given to `send` that Codex has not yet taken into a turn. */
  let undelivered = 0
  /** A turn ended, and the listener has not been told: it is told once nothing is left to deliver. */
  let endOwed = false
  /** An interruption was asked for before the turn had a name to interrupt it by. */
  let interruptDue = false
  /** Messages whose text arrived piece by piece. The whole message comes too, and must not be said twice. */
  const streamed = new Set<string>()
  let wrote = false
  let paragraphDue = false
  let errorOutput = ''

  /** The files each change under way touches, by its item: Codex names them when the change starts, not when it asks. */
  const changes = new Map<string, ComputerUse>()
  /** Questions to the core about a use of the computer, waiting for the person: withdrawn when the turn stops. */
  const asking = new Set<AbortController>()
  /** Uses of the computer allowed, by the item that makes them: how each went is told to the core once it completes. */
  const allowedUses = new Map<string, string>()
  const scope = request.computer?.scope()
  /** Whether the session has the command line: known once the sandbox of this computer is. */
  let shell = false
  /** The folder its commands run in, and that the files it changes are named from. */
  let base = context.folder

  let lastCall = 0
  const calls = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>()

  /**
   * Whether what Codex says is about the session's own conversation rather than a sub-agent's: a sub-agent runs as a
   * conversation of its own on the same server, and Codex names the conversation each message concerns.
   */
  const own = (params: JsonObject) => {
    const id = asString(params.threadId)
    return id === undefined || thread === '' || id === thread
  }

  function call(method: string, params: unknown): Promise<unknown> {
    const id = ++lastCall
    return new Promise((resolve, reject) => {
      if (!child) return reject(new Error('Codex is not running.'))
      calls.set(id, { resolve, reject })
      writeJsonLine(child.stdin, { id, method, params })
    })
  }

  async function begin(): Promise<void> {
    try {
      const launch = await context.cli.launch()
      const home = codexHome(launch.env)
      const [models, userServers, holding] = await Promise.all([
        codexModels(home, context.models),
        userToolServers(home),
        scope ? context.holding(launch) : ('writes' as const),
        mkdir(context.folder, { recursive: true })
      ])
      if (closed) return
      shell = shellAllowed(scope, holding)
      const profiled = shell && holding === 'granted'
      if (shell && scope) base = workingFolder(scope, { folder: context.folder, project: request.folder, profiled })
      // What a command reads to run the person's programs and writes on its own, and the adapter's folder it never reaches.
      const where = { home: platform.home(launch.env), env: launch.env }
      const confinement = { never: [context.folder], caches: system.caches(where), programs: system.programs(where) }
      const running = start(launch.command, appServerArguments(userServers, shell, request.agents === true), { cwd: context.folder, env: launch.env })
      child = running
      running.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
        errorOutput = (errorOutput + chunk).slice(-KEPT_OUTPUT)
      })
      running.once('error', (error) => fail(`Codex could not be started: ${error.message}`))
      // "close" comes after the last line was read, so an error Codex explained before stopping is reported in its own words.
      running.once('close', (code) => fail(stopped(code)))
      if (running.stdout) readJsonLines(running.stdout, receive)

      await call('initialize', { clientInfo: CLIENT, capabilities: null })
      writeJsonLine(running.stdin, { method: 'initialized' })
      const opened = await call(
        'thread/start',
        threadSettings({
          folder: context.folder,
          project: request.folder,
          model: request.model ?? models[request.role],
          effort: request.effort,
          instructions: request.instructions,
          tools: request.tools,
          scope: shell ? scope : undefined,
          holding: !shell ? undefined : profiled ? { kind: 'granted', confinement } : { kind: 'writes' }
        })
      )
      thread = asString(asObject(asObject(opened)?.thread)?.id) ?? ''
      if (thread === '') throw new Error('it did not open a conversation.')
      // A conversation asked to hold its commands that reports no sandbox would run them unconfined: it is not used.
      if (profiled && scope && !heldAsAsked(asObject(opened)?.sandbox, scope)) {
        log.error(`Codex opened a conversation without the sandbox asked for: ${JSON.stringify(asObject(opened)?.sandbox ?? null)}`)
        return fail(NOT_HELD)
      }
    } catch (error) {
      fail(error instanceof NotInstalled ? error.message : problem('Codex could not start the session', error instanceof Error ? error.message : String(error)))
    }
  }

  function problem(what: string, detail: string): string {
    return saysSignedOut(detail) ? SIGNED_OUT : `${what}: ${lastLines(detail)}`
  }

  function stopped(code: number | null): string {
    const detail = lastLines(errorOutput)
    if (saysSignedOut(detail)) return SIGNED_OUT
    return `Codex stopped unexpectedly${code === null ? '' : ` (exit code ${code})`}${detail ? `: ${detail}` : '.'}`
  }

  function fail(reason: string): void {
    if (closed) return
    events.emit({ type: 'failed', reason })
    shut()
  }

  function shut(): void {
    closed = true
    withdraw()
    if (child) stopGently(child)
    child = undefined
    for (const pending of calls.values()) pending.reject(new Error('Codex stopped.'))
    calls.clear()
  }

  /** Give a message to Codex: into the turn under way when there is one, else as a new turn. */
  async function deliver(message: string, attachments: readonly Attachment[]): Promise<void> {
    if (closed) return
    if (turn !== undefined) {
      try {
        await call('turn/steer', { threadId: thread, expectedTurnId: turn, input: input(message, attachments) })
        return
      } catch {
        // The turn ended before the message reached it: the message starts the next one.
        if (closed) return
      }
    }
    try {
      const started = await call('turn/start', { threadId: thread, input: input(message, attachments) })
      const id = asString(asObject(asObject(started)?.turn)?.id)
      if (id !== undefined && id !== ended) turn = id
      if (interruptDue) interrupt()
    } catch (error) {
      fail(problem('Codex did not take the message', error instanceof Error ? error.message : String(error)))
    }
  }

  function interrupt(): void {
    if (closed) return
    withdraw()
    if (turn === undefined) {
      // Nothing to interrupt by name yet, when a message is on its way to start a turn.
      interruptDue = undelivered > 0
      return
    }
    interruptDue = false
    // The turn may end by itself first, and Codex then has nothing to interrupt: not an error.
    call('turn/interrupt', { threadId: thread, turnId: turn }).catch(() => undefined)
  }

  /** Tell the listener the turn is over, once a turn ended and nothing sent is still on its way to Codex. */
  function settle(): void {
    if (!endOwed || turn !== undefined || undelivered > 0) return
    endOwed = false
    wrote = false
    paragraphDue = false
    streamed.clear()
    events.emit({ type: 'turn-end' })
  }

  function say(piece: string): void {
    if (piece === '') return
    events.emit({ type: 'text', text: paragraphDue ? `\n\n${piece}` : piece })
    paragraphDue = false
    wrote = true
  }

  function receive(raw: unknown): void {
    const message = asObject(raw)
    if (!message || closed) return
    const method = asString(message.method)
    // An answer to one of our requests.
    if (message.id !== undefined && method === undefined) {
      const pending = calls.get(Number(message.id))
      calls.delete(Number(message.id))
      const error = asObject(message.error)
      if (error) pending?.reject(new Error(asString(error.message) ?? JSON.stringify(error)))
      else pending?.resolve(message.result)
      return
    }
    const params = asObject(message.params) ?? {}
    // A request of Codex's own, which waits for an answer.
    if (message.id !== undefined && method !== undefined) {
      const id = message.id
      return void Promise.resolve(answer(method, params)).then((reply) => {
        if (!closed) writeJsonLine(child?.stdin, { id, ...reply })
      })
    }
    if (method !== undefined) notified(method, params)
  }

  type Reply = { result: unknown } | { error: { code: number; message: string } }

  /**
   * What Codex is told when it asks. A command or a file change is checked against what the person granted,
   * then put to the core, which has the person approve it when they asked to; without access to the computer,
   * every one is declined. It asks before calling a tool server's tool too: the core's are accepted, since the
   * core decides for itself when the call arrives, and any other server's are declined. A sub-agent is declined the
   * core's tools too: they speak, show and ask for the session, and a sub-agent works with files and commands only.
   */
  function answer(method: string, params: JsonObject): Reply | Promise<Reply> {
    const folder = asString(params.cwd) ?? base
    switch (method) {
      case 'item/commandExecution/requestApproval':
        return decide({ action: 'run', tool: 'shell', paths: [folder], command: commandLine(params.command) }, asString(params.itemId)).then((yes) => ({
          result: { decision: yes ? 'accept' : 'decline' }
        }))
      case 'item/fileChange/requestApproval': {
        const item = asString(params.itemId)
        return decide(changes.get(item ?? ''), item).then((yes) => ({ result: { decision: yes ? 'accept' : 'decline' } }))
      }
      case 'item/permissions/requestApproval':
        return { result: { decision: 'decline' } }
      // The same questions, as older versions ask them.
      case 'execCommandApproval':
        return decide({ action: 'run', tool: 'shell', paths: [folder], command: commandLine(params.command) }, asString(params.callId)).then((yes) => ({
          result: { decision: yes ? 'approved' : 'denied' }
        }))
      case 'applyPatchApproval': {
        const paths = Object.keys(asObject(params.fileChanges) ?? {}).map((path) => asWritten(path, folder))
        return decide(paths.length > 0 ? { action: 'change', tool: 'apply_patch', paths } : undefined, asString(params.callId)).then((yes) => ({
          result: { decision: yes ? 'approved' : 'denied' }
        }))
      }
      case 'mcpServer/elicitation/request':
        return { result: params.serverName === TOOL_SERVER && own(params) ? { action: 'accept', content: {} } : { action: 'decline', content: null } }
      case 'item/tool/requestUserInput':
        return { result: { answers: {} } }
      default:
        return { error: { code: -32601, message: `This session does not answer "${method}".` } }
    }
  }

  /**
   * Whether a use of the computer may go ahead: within what was granted, and approved when it must be. The same
   * boundary as every tool, a command by the paths it names; the core refuses what is beyond it.
   */
  async function decide(found: ComputerUse | undefined, item: string | undefined): Promise<boolean> {
    const reach = request.computer
    if (!shell || !reach || !found) return false
    const controller = new AbortController()
    asking.add(controller)
    const stopped = new Promise<false>((resolve) => controller.signal.addEventListener('abort', () => resolve(false), { once: true }))
    try {
      const use = await checkUse(found, reach.scope(), [context.folder])
      const verdict = await Promise.race([reach.approve(use, controller.signal), stopped])
      if (verdict === false || !verdict.allow) return false
      if (verdict.use !== undefined && item !== undefined) allowedUses.set(item, verdict.use)
      return true
    } catch (error) {
      log.error(`A use of the computer could not be decided: ${error instanceof Error ? error.message : String(error)}`)
      return false
    } finally {
      asking.delete(controller)
    }
  }

  function withdraw(): void {
    for (const controller of asking) controller.abort()
    asking.clear()
  }

  /** A command or a change that was allowed has completed: the core is told how it went. Gives back the use, if any. */
  function reportUse(item: JsonObject): string | undefined {
    const id = asString(item.id) ?? ''
    const use = allowedUses.get(id)
    if (use === undefined) return undefined
    allowedUses.delete(id)
    const status = asString(item.status)
    const exit = typeof item.exitCode === 'number' ? item.exitCode : undefined
    const ok = status !== 'failed' && status !== 'declined' && (exit === undefined || exit === 0)
    const output = asString(item.aggregatedOutput)?.trim()
    request.computer?.report?.(
      use,
      ok ? { ok } : { ok, error: exit === undefined ? `It ${status ?? 'failed'}.` : `It ended with code ${exit}.${output ? ` ${lastLines(output)}` : ''}` }
    )
    return use
  }

  function notified(method: string, params: JsonObject): void {
    const item = asObject(params.item) ?? {}
    if (method === 'item/started' && item.type === 'fileChange') {
      const touched = touchedFiles(item, base)
      const action = touched.every(({ kind }) => kind === 'add') ? 'create' : touched.every(({ kind }) => kind === 'delete') ? 'delete' : 'change'
      if (touched.length > 0) changes.set(asString(item.id) ?? '', { action, tool: 'apply_patch', paths: touched.map(({ path }) => path) })
    }
    const mine = own(params)
    // A sub-agent's commands and changes are reported as the session's, so the person sees what it did and the files it
    // changed. Its words, its plan, its turns and its errors are its own: they go back to the session as its result.
    if (!mine && method !== 'item/started' && method !== 'item/completed') return
    const ours = mine && item.type === 'mcpToolCall' && item.server === TOOL_SERVER ? asString(item.tool) : undefined
    const delegation = mine && item.type === 'collabAgentToolCall' ? agentCallOf(item) : undefined
    switch (method) {
      case 'turn/started':
        turn = asString(asObject(params.turn)?.id) ?? turn
        return
      case 'turn/completed': {
        const finished = asObject(params.turn)
        const id = asString(finished?.id)
        ended = id ?? turn
        // The end of an earlier turn can arrive after the next one started: that one is still under way.
        if (id === undefined || id === turn) turn = undefined
        const error = asString(asObject(finished?.error)?.message)
        if (finished?.status === 'failed') {
          log.error(`Codex reported that a turn failed: ${error ?? 'no reason given'}`)
          fail(error ? problem('Codex reported an error', error) : 'Codex could not finish its reply.')
          return
        }
        endOwed = true
        settle()
        return
      }
      case 'turn/plan/updated': {
        // Its plan tool's list for the work: told whole each time it changes.
        const steps = planFromCodex(params)
        if (steps) events.emit({ type: 'plan', steps })
        return
      }
      case 'item/agentMessage/delta': {
        const id = asString(params.itemId) ?? ''
        // A turn can hold several messages, around its tool calls. End to end they would run into each other.
        if (!streamed.has(id)) paragraphDue = wrote
        streamed.add(id)
        say(asString(params.delta) ?? '')
        return
      }
      case 'item/started':
        if (ours !== undefined) events.emit({ type: 'tool', name: ours, phase: 'started', ...callOf(item) })
        else if (delegation) events.emit({ type: 'tool', name: REPORTED_TOOLS.subagent, phase: 'started', ...delegation })
        else if (item.type === 'fileChange') events.emit({ type: 'tool', name: REPORTED_TOOLS.write, phase: 'started', ...changeOf(item, base).call })
        else if (item.type === 'commandExecution') events.emit({ type: 'tool', name: REPORTED_TOOLS.run, phase: 'started', ...runOf(item) })
        return
      case 'item/completed': {
        const use = reportUse(item)
        if (ours !== undefined) events.emit({ type: 'tool', name: ours, phase: 'ended', ...callOf(item), ...outcomeOf(item) })
        else if (delegation)
          events.emit({ type: 'tool', name: REPORTED_TOOLS.subagent, phase: 'ended', ...delegation, ...(item.status === 'failed' ? { failed: true } : {}) })
        else if (item.type === 'fileChange') {
          changes.delete(asString(item.id) ?? '')
          // A change made is named, so the person is shown the files; one declined or failed is not.
          const { call, kept } = changeOf(item, base)
          const done = item.status === 'completed'
          events.emit({
            type: 'tool',
            name: REPORTED_TOOLS.write,
            phase: 'ended',
            ...call,
            ...(done ? {} : { failed: true }),
            ...(kept.length > 0 && done ? { wrote: kept } : {}),
            ...(use === undefined ? {} : { use })
          })
        } else if (item.type === 'commandExecution') {
          events.emit({ type: 'tool', name: REPORTED_TOOLS.run, phase: 'ended', ...runOf(item), ...ranOf(item), ...(use === undefined ? {} : { use }) })
        } else if (mine && item.type === 'agentMessage' && !streamed.has(asString(item.id) ?? '')) {
          paragraphDue = wrote
          say(asString(item.text) ?? '')
        }
        return
      }
      case 'error': {
        const error = asString(asObject(params.error)?.message)
        if (error !== undefined && params.willRetry !== true) fail(problem('Codex reported an error', error))
        return
      }
    }
  }

  // Everything sent goes to Codex in the order given, the opening of the conversation first.
  let queue: Promise<void> = begin()

  return {
    send(message, attachments = []) {
      if (closed) return
      undelivered += 1
      queue = queue
        .then(() => deliver(message, attachments))
        .then(() => {
          undelivered -= 1
          settle()
        })
    },
    interrupt,
    close() {
      if (closed) return
      events.silence()
      shut()
    },
    onEvent: events.listen
  }
}

/** A call to Codex's sub-agents (start one, write to it, wait for it, close it), and what it asked. */
function agentCallOf(item: JsonObject): { call?: string; input: JsonObject } {
  const id = asString(item.id)
  const prompt = asString(item.prompt)
  return { ...(id === undefined ? {} : { call: id }), input: { action: asString(item.tool) ?? 'unknown', ...(prompt === undefined ? {} : { prompt }) } }
}

/** Which call an item is, and what it was given. */
function callOf(item: JsonObject): { call?: string; input?: unknown } {
  const id = asString(item.id)
  return { ...(id === undefined ? {} : { call: id }), ...(item.arguments === undefined ? {} : { input: item.arguments }) }
}

/** What a finished call gave back, as text, and whether it failed. */
function outcomeOf(item: JsonObject): { output?: string; failed?: boolean } {
  const error = asString(asObject(item.error)?.message)
  if (error !== undefined) return { output: error, failed: true }
  const parts = asArray(asObject(item.result)?.content)
    .map(asObject)
    .map((part) => (part?.type === 'text' ? (asString(part.text) ?? '') : ''))
    .filter((part) => part !== '')
  return parts.length > 0 ? { output: parts.join('\n\n') } : {}
}

/** A command as a call: which it is, and the line it ran, without the shell Codex wraps it in. */
function runOf(item: JsonObject): { call?: string; input: { command: string } } {
  const id = asString(item.id)
  return { ...(id === undefined ? {} : { call: id }), input: { command: shownCommand(commandLine(item.command)) } }
}

/** How a command went: what it printed, and whether it failed, ended with a code other than 0 or was not allowed. */
function ranOf(item: JsonObject): { output?: string; failed?: boolean } {
  const printed = asString(item.aggregatedOutput) ?? ''
  const exit = typeof item.exitCode === 'number' ? item.exitCode : undefined
  if (item.status === 'declined') return { output: 'It was not allowed.', failed: true }
  if (item.status === 'failed' || (exit !== undefined && exit !== 0)) {
    const said = exit === undefined || exit === 0 ? printed : [`Exit code ${exit}`, printed].filter((part) => part !== '').join('\n')
    return { ...(said === '' ? {} : { output: said }), failed: true }
  }
  return printed === '' ? {} : { output: printed }
}

/**
 * The files a change of files touches, absolute and as written, for the check to follow them, each with what is done
 * to it: `add`, `delete` or `update`.
 */
function touchedFiles(item: JsonObject, base: string): { path: string; kind: string | undefined }[] {
  return asArray(item.changes)
    .map(asObject)
    .map((change) => ({ path: asWritten(asString(change?.path) ?? '.', base), kind: asString(asObject(change?.kind)?.type) ?? asString(change?.kind) }))
}

/** A change of files as a call (which it is, and the files it touches), and the files it makes or keeps, absolute. */
function changeOf(item: JsonObject, base: string): { call: { call?: string; input: { paths: string[] } }; kept: string[] } {
  const touched = touchedFiles(item, base).map(({ path, kind }) => ({ path: resolve(path), kind }))
  const id = asString(item.id)
  return {
    call: { ...(id === undefined ? {} : { call: id }), input: { paths: touched.map(({ path }) => path) } },
    kept: touched.filter(({ kind }) => kind !== 'delete').map(({ path }) => path)
  }
}
