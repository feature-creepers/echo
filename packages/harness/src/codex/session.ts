import type { ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { Attachment, ComputerUse, Log, Role, Session, SessionRequest } from '@repo/core'
import { absolute } from '../computer/paths.ts'
import { checkUse } from '../computer/scope.ts'
import { type Cli, NotInstalled } from '../process/cli.ts'
import { createSessionEvents } from '../process/events.ts'
import { asArray, asObject, asString, type JsonObject } from '../process/json.ts'
import { readJsonLines, writeJsonLine } from '../process/json-lines.ts'
import { KEPT_OUTPUT, lastLines, saysSignedOut } from '../process/output.ts'
import { platform } from '../process/platform/index.ts'
import { start } from '../process/run.ts'
import { appServerArguments, shellAllowed, TOOL_SERVER, threadSettings, userToolServers } from './isolation.ts'
import { codexHome, codexModels } from './models.ts'
import { SIGNED_OUT } from './status.ts'

export interface SessionContext {
  cli: Cli
  /** The adapter's working folder. */
  folder: string
  /** The models the user chose, by role. */
  models: Partial<Record<Role, string>>
  log: Log
}

/** How long Codex has to stop by itself once its input is closed, before it is stopped. */
const CLOSE_GRACE_MS = 1500

/** How this program names itself to Codex, which keeps it in its own records. */
const CLIENT = { name: 'core', title: 'Core', version: '1' }

const text = (value: string) => [{ type: 'text', text: value, text_elements: [] }]

/** What is said, and the pictures handed over with it, which Codex reads from where they are. */
const input = (value: string, attachments: readonly Attachment[]) => [
  ...text(value),
  ...attachments.filter((attachment) => attachment.image).map((attachment) => ({ type: 'localImage', path: attachment.path }))
]

/** The name the core reports a change of files under. */
const WRITE_TOOL = 'computer_write'

/** A word written back into a POSIX line, quoted so it reads as the one word it was. */
const quoted = (word: string) => (/^[\w./~:=@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)

/** A command as Codex gives it, a line or its words, as one line to show the person and to read. */
const commandLine = (value: unknown) => (Array.isArray(value) ? value.map((word) => quoted(String(word))).join(' ') : typeof value === 'string' ? value : '')

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
  const shell = shellAllowed(scope)

  let lastCall = 0
  const calls = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>()

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
      const [models, userServers] = await Promise.all([codexModels(home, context.models), userToolServers(home), mkdir(context.folder, { recursive: true })])
      if (closed) return
      const running = start(launch.command, appServerArguments(userServers, shell), { cwd: context.folder, env: launch.env })
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
          scope: shell ? scope : undefined
        })
      )
      thread = asString(asObject(asObject(opened)?.thread)?.id) ?? ''
      if (thread === '') throw new Error('it did not open a conversation.')
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
    const running = child
    child = undefined
    for (const pending of calls.values()) pending.reject(new Error('Codex stopped.'))
    calls.clear()
    if (running && running.exitCode === null && running.signalCode === null) {
      running.stdin?.end()
      const timer = setTimeout(() => platform.terminate(running), CLOSE_GRACE_MS)
      timer.unref()
      running.once('exit', () => clearTimeout(timer))
    }
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
   * core decides for itself when the call arrives, and any other server's are declined.
   */
  function answer(method: string, params: JsonObject): Reply | Promise<Reply> {
    const folder = asString(params.cwd) ?? (shell && scope?.home ? scope.home : context.folder)
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
        const paths = Object.keys(asObject(params.fileChanges) ?? {}).map((path) => absolute(path, folder))
        return decide(paths.length > 0 ? { action: 'change', tool: 'apply_patch', paths } : undefined, asString(params.callId)).then((yes) => ({
          result: { decision: yes ? 'approved' : 'denied' }
        }))
      }
      case 'mcpServer/elicitation/request':
        return { result: params.serverName === TOOL_SERVER ? { action: 'accept', content: {} } : { action: 'decline', content: null } }
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
    const use = await checkUse(found, reach.scope(), [context.folder])
    const controller = new AbortController()
    asking.add(controller)
    const stopped = new Promise<false>((resolve) => controller.signal.addEventListener('abort', () => resolve(false), { once: true }))
    try {
      const verdict = await Promise.race([reach.approve(use, controller.signal), stopped])
      if (verdict === false || !verdict.allow) return false
      if (verdict.use !== undefined && item !== undefined) allowedUses.set(item, verdict.use)
      return true
    } catch {
      return false
    } finally {
      asking.delete(controller)
    }
  }

  /** The folder a change names its files from. */
  function filesBase(): string {
    return shell && scope?.home ? scope.home : context.folder
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
      const touched = asArray(item.changes).map(asObject)
      const kinds = touched.map((change) => asString(asObject(change?.kind)?.type) ?? asString(change?.kind))
      const base = filesBase()
      const paths = touched.map((change) => absolute(asString(change?.path) ?? '.', base))
      const action = kinds.every((kind) => kind === 'add') ? 'create' : kinds.every((kind) => kind === 'delete') ? 'delete' : 'change'
      if (paths.length > 0) changes.set(asString(item.id) ?? '', { action, tool: 'apply_patch', paths })
    }
    const ours = item.type === 'mcpToolCall' && item.server === TOOL_SERVER ? asString(item.tool) : undefined
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
        else if (item.type === 'fileChange') {
          events.emit({ type: 'tool', name: WRITE_TOOL, phase: 'started', ...changeOf(item, filesBase()).call })
        }
        return
      case 'item/completed': {
        const use = reportUse(item)
        if (ours !== undefined) events.emit({ type: 'tool', name: ours, phase: 'ended', ...callOf(item), ...outcomeOf(item) })
        else if (item.type === 'fileChange') {
          // A change made is named, so the person is shown the files; one declined or failed is not.
          const { call, kept } = changeOf(item, filesBase())
          const done = item.status === 'completed'
          events.emit({
            type: 'tool',
            name: WRITE_TOOL,
            phase: 'ended',
            ...call,
            ...(done ? {} : { failed: true }),
            ...(kept.length > 0 && done ? { wrote: kept } : {}),
            ...(use === undefined ? {} : { use })
          })
        } else if (item.type === 'agentMessage' && !streamed.has(asString(item.id) ?? '')) {
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

/** A change of files as a call (which it is, and the files it touches), and the files it makes or keeps, absolute. */
function changeOf(item: JsonObject, base: string): { call: { call?: string; input: { paths: string[] } }; kept: string[] } {
  const touched = asArray(item.changes).map(asObject)
  const paths = touched.map((change) => absolute(asString(change?.path) ?? '.', base))
  const kept = touched.flatMap((change, index) => {
    const kind = asString(asObject(change?.kind)?.type) ?? asString(change?.kind)
    const path = paths[index]
    return kind === 'delete' || path === undefined ? [] : [path]
  })
  const id = asString(item.id)
  return { call: { ...(id === undefined ? {} : { call: id }), input: { paths } }, kept }
}
