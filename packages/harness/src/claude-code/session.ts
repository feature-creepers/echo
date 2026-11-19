import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Attachment, Log, Session, SessionRequest, Verdict } from '@repo/core'
import { absolute, kindAt, real, within } from '../computer/paths.ts'
import { checkUse } from '../computer/scope.ts'
import { system } from '../computer/system/index.ts'
import { planFromTodos } from '../plan.ts'
import { type Cli, NotInstalled } from '../process/cli.ts'
import { createSessionEvents } from '../process/events.ts'
import { asArray, asObject, asString, type JsonObject } from '../process/json.ts'
import { readJsonLines, writeJsonLine } from '../process/json-lines.ts'
import { KEPT_OUTPUT, lastLines, saysSignedOut } from '../process/output.ts'
import { platform } from '../process/platform/index.ts'
import { start } from '../process/run.ts'
import { createWorkingFiles } from '../process/working-files.ts'
import { computerTools, useOf } from './computer-tools.ts'
import { sandboxSettings } from './confinement.ts'
import {
  coreToolName,
  type Given,
  ISOLATION_VARIABLES,
  isolationArguments,
  isolationLeaks,
  PLAN_TOOL,
  reportedToolName,
  sessionSettings,
  TOOL_SERVER,
  toolServerConfig
} from './isolation.ts'
import { SIGNED_OUT } from './status.ts'

export interface SessionContext {
  cli: Cli
  /** The adapter's working folder. */
  folder: string
  model: string
  /** How hard the model reasons. Left out, the CLI's own choice. */
  effort?: string | undefined
  log: Log
}

/**
 * The CLI as a conversation that stays open: messages go in and come out as JSON lines, the reply arrives
 * piece by piece as it is written, and what the CLI would ask a person (may this tool run?) it asks us,
 * on the same lines.
 */
export const SESSION_ARGUMENTS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-prompt-tool',
  'stdio'
]

/** A tool of the core may wait a long time for the user: an approval, an answer. The CLI must not give up on it first. */
const TOOL_TIMEOUT_MS = 3_600_000

/**
 * How long a command may run. A project's build or test suite takes minutes; the CLI's own two minutes would stop it
 * half way. The person can stop a turn at any time, and the command with it.
 */
const COMMAND_VARIABLES = {
  BASH_DEFAULT_TIMEOUT_MS: String(10 * 60_000),
  BASH_MAX_TIMEOUT_MS: String(30 * 60_000),
  // A command left running in the background, or a tool call of the core moved there after two minutes (an
  // approval the person has not answered yet), would finish after the turn the core is following has ended,
  // and the CLI would answer it on its own, out of turn. Nothing runs in the background: the person waits for
  // what they asked, sees it on screen, and can stop it.
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1'
}

/** How long the CLI has to stop by itself once its input is closed, before it is stopped. */
const CLOSE_GRACE_MS = 1500

/** A live session with Claude Code. It starts the CLI at once; what is sent before the CLI runs is kept for it. */
export function openSession(request: SessionRequest, context: SessionContext): Session {
  const { log } = context
  const events = createSessionEvents(log)
  const files = createWorkingFiles(context.folder)

  let child: ChildProcess | undefined
  let closed = false
  /** What was said before the CLI was running. */
  const unsent: unknown[] = []
  /** Messages sent and not answered yet, by the identifier each was sent with. The turn is over when none is left. */
  const unanswered = new Set<string>()
  /** Calls to the core's tools under way, by the call's identifier: the tool's name and, once written, its input. */
  const calls = new Map<string, { tool: string; input: unknown }>()
  /** Replies whose text arrives piece by piece. The whole reply comes too, and its text must not be said twice. */
  const streamed = new Set<string>()
  /** Text was written since the turn began, so the next block of text starts a new paragraph. */
  let wrote = false
  let paragraphDue = false
  /** An interruption was asked for. The CLI reports the interrupted turn as an error, which it is not. */
  let interrupting = false
  let signedOut = false
  let checked = false
  let errorOutput = ''
  /** The CLI's own tools on the computer this session was given, and the folder it works in. */
  let computer: string[] = []
  /** A project's session keeps its plan in the CLI's own to-do list. */
  const planning = request.folder !== undefined
  /** A thread's session may hand parts of its work to the CLI's own sub-agents. */
  const delegating = request.agents === true
  /** What the session was given of the CLI's own, which its calls are reported by. */
  const given = (): Given => ({ web: request.web === true, computer, plan: planning, agents: delegating })
  let workingFolder = context.folder
  /** The CLI's own folder, and the identifier of this session in it: a long output is kept there for the session to read. */
  let cliFolder: string | undefined
  let sessionId: string | undefined
  /** Questions to the core about a use of the computer, waiting for the person: withdrawn when the turn stops. */
  const asking = new Set<AbortController>()
  /** Uses of the computer allowed, by the call that makes them: how each went is told to the core once its result comes. */
  const allowedUses = new Map<string, string>()

  function write(message: unknown): void {
    if (child) writeJsonLine(child.stdin, message)
    else unsent.push(message)
  }

  async function begin(): Promise<void> {
    let running: ChildProcess
    try {
      const launch = await context.cli.launch()
      cliFolder = launch.env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
      // On the computer, the session works in its project's folder, the assistant's own folder, or an empty one of
      // its own: never in the adapter's folder, whose files hold the session's instructions and token.
      const scope = request.computer?.scope()
      computer = computerTools(scope)
      if (computer.length > 0) {
        workingFolder = request.folder ?? scope?.home ?? join(context.folder, 'empty')
        if (request.folder === undefined) await mkdir(workingFolder, { recursive: true })
        else if ((await kindAt(workingFolder)) !== 'folder') return fail(`The project's folder is no longer there: ${workingFolder}.`)
      }
      // The other folders granted, the assistant's own among them when the session works in a project's.
      const folders = []
      for (const place of scope?.places ?? [])
        if (place.kind === 'folder' && place.path !== workingFolder && (await kindAt(place.path)) === 'folder') folders.push(place.path)
      // Where the system can, it holds the session's commands to the scope as well (confinement.ts).
      const where = { home: homedir(), env: process.env }
      const confined =
        scope && computer.includes('Bash') && system.confines ? sandboxSettings(scope, { never: [context.folder], caches: system.caches(where) }) : undefined
      const paths = {
        instructions: await files.write('instructions.txt', request.instructions),
        settings: await files.write('settings.json', JSON.stringify(sessionSettings(computer, confined, delegating))),
        tools: request.tools ? await files.write('tools.json', toolServerConfig(request.tools)) : undefined,
        web: request.web === true,
        computer: { tools: computer, folders: computer.length > 0 ? folders : [] },
        plan: planning,
        agents: delegating
      }
      if (closed) return void files.remove()
      running = start(launch.command, [...SESSION_ARGUMENTS, ...isolationArguments(context.model, paths, context.effort)], {
        cwd: workingFolder,
        env: { ...launch.env, ...ISOLATION_VARIABLES, ...COMMAND_VARIABLES, MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS) }
      })
    } catch (error) {
      return fail(error instanceof NotInstalled ? error.message : `Claude Code could not be started: ${error instanceof Error ? error.message : String(error)}`)
    }
    child = running
    running.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      errorOutput = (errorOutput + chunk).slice(-KEPT_OUTPUT)
    })
    running.once('error', (error) => fail(`Claude Code could not be started: ${error.message}`))
    // "close" comes after the last line was read, so an error the CLI explained before stopping is reported in its own words.
    running.once('close', (code) => fail(stopped(code)))
    if (running.stdout) readJsonLines(running.stdout, receive)
    for (const message of unsent.splice(0)) writeJsonLine(running.stdin, message)
  }

  function stopped(code: number | null): string {
    const detail = lastLines(errorOutput)
    if (signedOut || saysSignedOut(detail)) return SIGNED_OUT
    return `Claude Code stopped unexpectedly${code === null ? '' : ` (exit code ${code})`}${detail ? `: ${detail}` : '.'}`
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
    if (running && running.exitCode === null && running.signalCode === null) {
      // The CLI ends by itself when its input closes. It is stopped only if it does not.
      running.stdin?.end()
      const timer = setTimeout(() => platform.terminate(running), CLOSE_GRACE_MS)
      timer.unref()
      running.once('exit', () => clearTimeout(timer))
    }
    void files.remove()
  }

  function receive(raw: unknown): void {
    const message = asObject(raw)
    if (!message || closed) return
    // A sub-agent's messages carry the call that started it. Its words are not the reply; its calls are reported.
    const own = message.parent_tool_use_id === null || message.parent_tool_use_id === undefined
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') check(message)
        return
      case 'stream_event':
        if (own) piece(asObject(message.event))
        return
      case 'assistant':
        if (own) reply(message)
        else if (delegating) delegated(message)
        return
      case 'user':
        toolResults(message)
        return
      case 'result':
        turnResult(message)
        return
      case 'control_request':
        asked(message)
        return
    }
  }

  /** The CLI's account of how it started, sent before each turn. Looked at once. */
  function check(init: JsonObject): void {
    if (checked) return
    checked = true
    sessionId = asString(init.session_id)
    const leaks = isolationLeaks(init, given())
    if (leaks.length > 0) log.error(`A Claude Code session started with ${leaks.join(', ')}, which should all be switched off.`)
    if (!request.tools) return
    const server = asArray(init.mcp_servers)
      .map(asObject)
      .find((candidate) => candidate?.name === TOOL_SERVER)
    if (server?.status === 'failed') log.error(`A Claude Code session could not connect to the tool server at ${request.tools.url}: it has no tools.`)
  }

  function say(text: string): void {
    if (text === '') return
    events.emit({ type: 'text', text: paragraphDue ? `\n\n${text}` : text })
    paragraphDue = false
    wrote = true
  }

  /** One step of a reply being written: the start of a block, or a piece of it. */
  function piece(event: JsonObject | undefined): void {
    if (!event) return
    if (event.type === 'message_start') {
      const id = asString(asObject(event.message)?.id)
      if (id) streamed.add(id)
    } else if (event.type === 'content_block_start') {
      const block = asObject(event.content_block)
      if (block?.type === 'text') {
        // A reply can hold several blocks of text, around its tool calls. End to end they would run into each other.
        paragraphDue = wrote
        say(asString(block.text) ?? '')
      } else if (block?.type === 'tool_use') toolStarted(block.id, block.name, undefined)
    } else if (event.type === 'content_block_delta') {
      const delta = asObject(event.delta)
      if (delta?.type === 'text_delta') say(asString(delta.text) ?? '')
    }
  }

  /** A whole block of a reply, sent once it is complete. Its text was already said if it arrived in pieces. */
  function reply(message: JsonObject): void {
    if (message.error === 'authentication_failed') signedOut = true
    // The CLI words its own failures as a reply. They are reported by the turn's result, not spoken.
    const notice = message.error !== undefined || message.is_api_error_message === true
    const body = asObject(message.message)
    const inPieces = streamed.has(asString(body?.id) ?? '')
    for (const item of asArray(body?.content)) {
      const block = asObject(item)
      if (block?.type === 'text' && !inPieces && !notice) {
        paragraphDue = wrote
        say(asString(block.text) ?? '')
      } else if (block?.type === 'tool_use') toolStarted(block.id, block.name, block.input)
    }
  }

  /**
   * A sub-agent's message, whole: the calls it makes on the computer and the web are reported as the session's, so the
   * person sees what it did and the files it changed. Its calls of the core's tools are refused, and not reported as the
   * session's: a refused view is not a view the session showed. Its words go back to the session that started it, as
   * that call's result.
   */
  function delegated(message: JsonObject): void {
    for (const item of asArray(asObject(message.message)?.content)) {
      const block = asObject(item)
      if (block?.type === 'tool_use' && coreToolName(block.name) === undefined) toolStarted(block.id, block.name, block.input, true)
    }
  }

  /**
   * A call begins when its block starts, before its input is written, so the person sees at once what is under
   * way. It is reported again once the whole block, input included, has arrived.
   */
  function toolStarted(id: unknown, name: unknown, input: unknown, byAgent = false): void {
    // The to-do list acts on nothing: what it is given is the plan, told once it is whole. A sub-agent's own list is not
    // the thread's plan.
    if (planning && name === PLAN_TOOL) {
      const steps = input === undefined || byAgent ? undefined : planFromTodos(input)
      if (steps) events.emit({ type: 'plan', steps })
      return
    }
    const call = asString(id)
    const tool = reportedToolName(name, given())
    if (call === undefined || tool === undefined) return
    const known = calls.get(call)
    if (known && (input === undefined || known.input !== undefined)) return
    calls.set(call, { tool, input })
    events.emit(input === undefined ? { type: 'tool', name: tool, phase: 'started', call } : { type: 'tool', name: tool, phase: 'started', call, input })
  }

  /** A call ended: with what it gave back, whether it failed, and, for a use of the computer the core allowed, that use. */
  function toolEnded(call: string, output?: string, failed?: boolean, use?: string): void {
    const known = calls.get(call)
    if (known === undefined) return
    calls.delete(call)
    // A file written or edited is named, wherever it is, so the person is shown it.
    const path = known.tool === WRITE_TOOL && output !== undefined && !failed ? asString(asObject(known.input)?.file_path) : undefined
    events.emit({
      type: 'tool',
      name: known.tool,
      phase: 'ended',
      call,
      ...(known.input === undefined ? {} : { input: known.input }),
      ...(output === undefined ? {} : { output }),
      ...(failed ? { failed } : {}),
      ...(path === undefined ? {} : { wrote: [absolute(path, workingFolder)] }),
      ...(use === undefined ? {} : { use })
    })
  }

  /** The results of tool calls come back as a message in the user's name. */
  function toolResults(message: JsonObject): void {
    for (const item of asArray(asObject(message.message)?.content)) {
      const block = asObject(item)
      if (block?.type !== 'tool_result') continue
      const call = asString(block.tool_use_id) ?? ''
      const output = resultText(block.content)
      const use = allowedUses.get(call)
      if (use !== undefined) {
        allowedUses.delete(call)
        request.computer?.report?.(use, block.is_error === true ? { ok: false, error: output ?? 'It failed.' } : { ok: true })
      }
      toolEnded(call, output, block.is_error === true, use)
    }
  }

  function turnResult(message: JsonObject): void {
    const wasInterrupted = interrupting || (asString(message.terminal_reason) ?? '').startsWith('aborted')
    interrupting = false
    // A call that was cut short has no result of its own.
    for (const call of [...calls.keys()]) toolEnded(call)
    streamed.clear()

    if (message.is_error === true && !wasInterrupted) {
      const said = asString(message.result) ?? ''
      log.error(`Claude Code reported an error (${asString(message.subtype) ?? 'unknown'}, ${asString(message.terminal_reason) ?? 'no reason given'}): ${said}`)
      if (signedOut || saysSignedOut(said)) fail(SIGNED_OUT)
      else fail(said ? `Claude Code reported an error: ${lastLines(said)}` : 'Claude Code could not finish its reply.')
      return
    }

    // One result can answer several messages: those sent while a turn ran are taken into it when a tool call ends.
    const before = unanswered.size
    for (const answered of asArray(message.user_message_uuids)) unanswered.delete(String(answered))
    // A result always answers something. If it does not say what, it answers the oldest message.
    if (unanswered.size === before) for (const oldest of [...unanswered].slice(0, 1)) unanswered.delete(oldest)
    // With a message still waiting, the CLI goes straight on to it: the turn is not over for the listener.
    if (unanswered.size > 0) return
    wrote = false
    paragraphDue = false
    events.emit({ type: 'turn-end' })
  }

  /** The CLI asks something it would otherwise ask the person at the keyboard. */
  function asked(message: JsonObject): void {
    const request_id = message.request_id
    const question = asObject(message.request)
    if (question?.subtype !== 'can_use_tool') {
      // Left unanswered, the CLI would wait for ever.
      write({ type: 'control_response', response: { subtype: 'error', request_id, error: `This session does not answer "${String(question?.subtype)}".` } })
      return
    }
    const answer = (response: JsonObject) => {
      if (!closed) write({ type: 'control_response', response: { subtype: 'success', request_id, response } })
    }
    const input = asObject(question.input) ?? {}
    const tool = asString(question.tool_name) ?? ''
    if (computer.includes(tool)) {
      void onComputer(tool, input, asString(question.tool_use_id) ?? callOf(tool, input)).then(answer)
      return
    }
    // A sub-agent works with files, commands and the web. The core's tools speak, show and ask for the session, so a
    // sub-agent is refused them: the question says when one asks.
    if (asString(question.agent_id) !== undefined && coreToolName(tool) !== undefined) {
      answer({ behavior: 'deny', message: AGENT_REFUSED })
      return
    }
    // The core decides for itself whether one of its tools may run, when it is called. A project's to-do list acts on
    // nothing. Nothing else may run at all.
    answer(
      reportedToolName(tool, { web: request.web === true, agents: delegating }) === undefined && !(planning && tool === PLAN_TOOL)
        ? { behavior: 'deny', message: 'This tool is not available in this session.' }
        : { behavior: 'allow', updatedInput: input }
    )
  }

  /**
   * A use of the computer: refused when it falls outside what the person granted, and otherwise put to the
   * core, which has the person approve a change or a command first when they asked to.
   */
  async function onComputer(tool: string, input: JsonObject, call: string | undefined): Promise<JsonObject> {
    const reach = request.computer
    const found = reach ? await useOf(tool, input, workingFolder) : undefined
    if (!reach || !found) return { behavior: 'deny', message: 'This tool is not available in this session.' }
    // Every tool is held to the same boundary, a command by the paths it names; the core refuses what is beyond it.
    // The session may read back what the CLI kept of a long output of its own, wherever the CLI keeps it.
    const scope = reach.scope()
    const kept = found.action === 'read' ? await ownOutputs(found.paths) : undefined
    const use = await checkUse(found, kept ? { ...scope, places: [...scope.places, { path: kept, kind: 'folder', write: false }] } : scope, [context.folder])
    const controller = new AbortController()
    asking.add(controller)
    try {
      // A stopped turn gets its answer at once, whatever the core is still doing with the question.
      const stopped = new Promise<Verdict>((resolve) =>
        controller.signal.addEventListener('abort', () => resolve({ allow: false, reason: 'The turn was stopped, so it was not done.' }), { once: true })
      )
      const verdict = await Promise.race([reach.approve(use, controller.signal), stopped])
      if (!verdict.allow) return { behavior: 'deny', message: use.refused ? `Refused: ${verdict.reason}` : verdict.reason }
      if (verdict.use !== undefined && call !== undefined) allowedUses.set(call, verdict.use)
      return { behavior: 'allow', updatedInput: input }
    } catch (error) {
      log.error(`A use of the computer could not be decided: ${error instanceof Error ? error.message : String(error)}`)
      return { behavior: 'deny', message: 'It could not be approved.' }
    } finally {
      asking.delete(controller)
    }
  }

  /**
   * The folder where the CLI keeps this session's long outputs, when every path read is inside it. A command's output
   * too long to give back whole is written to `projects/<folder>/<session>/tool-results/` in the CLI's own folder, and
   * the session is told to read it there.
   */
  async function ownOutputs(paths: readonly string[]): Promise<string | undefined> {
    if (cliFolder === undefined || sessionId === undefined || paths.length === 0) return undefined
    const projects = await real(join(cliFolder, 'projects'))
    let folder: string | undefined
    for (const path of paths) {
      const target = await real(path)
      if (!within(target, projects)) return undefined
      const parts = target.slice(projects.length + 1).split(/[\\/]/)
      // A folder named after the working folder, then this session's, then its outputs.
      if (parts.length < 4 || parts[1] !== sessionId || parts[2] !== 'tool-results') return undefined
      const own = join(projects, parts[0] as string, sessionId, 'tool-results')
      if (folder !== undefined && folder !== own) return undefined
      folder = own
    }
    return folder
  }

  /** The call a permission is asked for, when the question does not say: the latest of that tool with the same input. */
  function callOf(tool: string, input: JsonObject): string | undefined {
    const name = reportedToolName(tool, given())
    const written = JSON.stringify(input)
    return [...calls.entries()].reverse().find(([, known]) => known.tool === name && JSON.stringify(known.input) === written)?.[0]
  }

  /** Withdraw the questions waiting for the person: the turn they belong to is over. */
  function withdraw(): void {
    for (const controller of asking) controller.abort()
    asking.clear()
  }

  /**
   * What goes to the CLI goes in the order it was given, though a message with pictures takes a moment to read:
   * while one is being read, what follows waits behind it.
   */
  let sending: Promise<void> = Promise.resolve()
  let reading = 0
  const inOrder = (work: () => void | Promise<void>) => {
    if (reading === 0) return void work()
    sending = sending.then(work)
  }

  void begin()

  return {
    send(text, attachments = []) {
      if (closed) return
      // The identifier comes back with the result that answers the message.
      const uuid = randomUUID()
      unanswered.add(uuid)
      const message = (content: unknown) => ({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null })
      if (!attachments.some((attachment) => attachment.image)) return inOrder(() => write(message(text)))
      reading++
      sending = sending
        .then(async () => {
          const content = [...(await pictures(attachments, log)), { type: 'text', text }]
          if (!closed) write(message(content))
        })
        .finally(() => {
          reading--
        })
    },
    interrupt() {
      if (closed || unanswered.size === 0) return
      withdraw()
      interrupting = true
      inOrder(() => write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }))
    },
    close() {
      if (closed) return
      events.silence()
      shut()
    },
    onEvent: events.listen
  }
}

/** What a tool gave back, as text: a plain text, or the text of each of its parts. Pictures are named, not carried. */
export function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  const parts = asArray(content)
    .map(asObject)
    .map((part) => (part?.type === 'text' ? (asString(part.text) ?? '') : part?.type === 'image' ? '[an image]' : ''))
    .filter((part) => part !== '')
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/** The name the core reports a write or an edit of a file under. */
const WRITE_TOOL = 'computer_write'

/** Why a sub-agent may not call a tool of the core. */
export const AGENT_REFUSED =
  "A sub-agent works with files, commands and the web only. Showing, speaking, asking the person and the assistant's other tools belong to the thread that started you: give it your findings in your final answer."

/**
 * The pictures among the files the person handed over, as blocks of a message the model sees: each read whole and
 * sent in base64, ahead of the words. One that cannot be read is left out; the words still name it by its path.
 */
export async function pictures(attachments: readonly Attachment[], log: Log): Promise<JsonObject[]> {
  const blocks: JsonObject[] = []
  for (const attachment of attachments) {
    if (!attachment.image) continue
    try {
      const data = (await readFile(attachment.path)).toString('base64')
      blocks.push({ type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data } })
    } catch (error) {
      log.error(`A picture handed over could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return blocks
}
