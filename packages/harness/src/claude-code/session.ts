import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Attachment, Log, Session, SessionRequest, Verdict } from '@repo/core'
import { absolute, kindAt } from '../computer/paths.ts'
import { outsideScope } from '../computer/scope.ts'
import { type Cli, NotInstalled } from '../process/cli.ts'
import { createSessionEvents } from '../process/events.ts'
import { asArray, asObject, asString, type JsonObject } from '../process/json.ts'
import { readJsonLines, writeJsonLine } from '../process/json-lines.ts'
import { KEPT_OUTPUT, lastLines, saysSignedOut } from '../process/output.ts'
import { platform } from '../process/platform/index.ts'
import { start } from '../process/run.ts'
import { createWorkingFiles } from '../process/working-files.ts'
import { computerTools, useOf } from './computer-tools.ts'
import { ISOLATION_VARIABLES, isolationArguments, isolationLeaks, reportedToolName, sessionSettings, TOOL_SERVER, toolServerConfig } from './isolation.ts'
import { SIGNED_OUT } from './status.ts'

export interface SessionContext {
  cli: Cli
  /** The adapter's working folder. */
  folder: string
  model: string
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
  let workingFolder = context.folder
  /** Questions to the core about a use of the computer, waiting for the person: withdrawn when the turn stops. */
  const asking = new Set<AbortController>()

  function write(message: unknown): void {
    if (child) writeJsonLine(child.stdin, message)
    else unsent.push(message)
  }

  async function begin(): Promise<void> {
    let running: ChildProcess
    try {
      const launch = await context.cli.launch()
      // On the computer, the session works in the assistant's own folder, or in an empty one of its own: never
      // in the adapter's folder, whose files hold the session's instructions and token.
      const scope = request.computer?.scope()
      computer = computerTools(scope)
      if (computer.length > 0) {
        workingFolder = scope?.home ?? join(context.folder, 'empty')
        await mkdir(workingFolder, { recursive: true })
      }
      const folders = []
      for (const place of scope?.places ?? [])
        if (place.kind === 'folder' && place.path !== scope?.home && (await kindAt(place.path)) === 'folder') folders.push(place.path)
      const paths = {
        instructions: await files.write('instructions.txt', request.instructions),
        settings: await files.write('settings.json', JSON.stringify(sessionSettings(computer))),
        tools: request.tools ? await files.write('tools.json', toolServerConfig(request.tools)) : undefined,
        web: request.web === true,
        computer: { tools: computer, folders: computer.length > 0 ? folders : [] }
      }
      if (closed) return void files.remove()
      running = start(launch.command, [...SESSION_ARGUMENTS, ...isolationArguments(context.model, paths)], {
        cwd: workingFolder,
        env: { ...launch.env, ...ISOLATION_VARIABLES, MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS) }
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
    // A sub-agent's messages carry the call that started it. There is none here, and its words would not be the reply.
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
    const leaks = isolationLeaks(init, request.web === true, computer)
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
   * A call begins when its block starts, before its input is written, so the person sees at once what is under
   * way. It is reported again once the whole block, input included, has arrived.
   */
  function toolStarted(id: unknown, name: unknown, input: unknown): void {
    const call = asString(id)
    const tool = reportedToolName(name, request.web === true, computer)
    if (call === undefined || tool === undefined) return
    const known = calls.get(call)
    if (known && (input === undefined || known.input !== undefined)) return
    calls.set(call, { tool, input })
    events.emit(input === undefined ? { type: 'tool', name: tool, phase: 'started', call } : { type: 'tool', name: tool, phase: 'started', call, input })
  }

  function toolEnded(call: string, output?: string, failed?: boolean): void {
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
      ...(path === undefined ? {} : { wrote: [absolute(path, workingFolder)] })
    })
  }

  /** The results of tool calls come back as a message in the user's name. */
  function toolResults(message: JsonObject): void {
    for (const item of asArray(asObject(message.message)?.content)) {
      const block = asObject(item)
      if (block?.type === 'tool_result') toolEnded(asString(block.tool_use_id) ?? '', resultText(block.content), block.is_error === true)
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
      void onComputer(tool, input).then(answer)
      return
    }
    // The core decides for itself whether one of its tools may run, when it is called. Nothing else may run at all.
    answer(
      reportedToolName(tool, request.web === true) === undefined
        ? { behavior: 'deny', message: 'This tool is not available in this session.' }
        : { behavior: 'allow', updatedInput: input }
    )
  }

  /**
   * A use of the computer: refused when it falls outside what the person granted, and otherwise put to the
   * core, which has the person approve a change or a command first when they asked to.
   */
  async function onComputer(tool: string, input: JsonObject): Promise<JsonObject> {
    const reach = request.computer
    const use = reach ? await useOf(tool, input, workingFolder) : undefined
    if (!reach || !use) return { behavior: 'deny', message: 'This tool is not available in this session.' }
    const outside = await outsideScope(use, reach.scope(), [context.folder])
    if (outside) return { behavior: 'deny', message: `Refused: ${outside} The person can grant more in Settings, Access.` }
    const controller = new AbortController()
    asking.add(controller)
    try {
      // A stopped turn gets its answer at once, whatever the core is still doing with the question.
      const stopped = new Promise<Verdict>((resolve) =>
        controller.signal.addEventListener('abort', () => resolve({ allow: false, reason: 'The turn was stopped, so it was not done.' }), { once: true })
      )
      const verdict = await Promise.race([reach.approve(use, controller.signal), stopped])
      return verdict.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: verdict.reason }
    } catch (error) {
      log.error(`A use of the computer could not be decided: ${error instanceof Error ? error.message : String(error)}`)
      return { behavior: 'deny', message: 'It could not be approved.' }
    } finally {
      asking.delete(controller)
    }
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
