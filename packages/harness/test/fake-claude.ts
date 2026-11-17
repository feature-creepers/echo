import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

/**
 * A stand-in for Claude Code, for tests that must run where it is not installed.
 *
 * It speaks the CLI's protocol as version 2.1.322 was observed to: the same messages, in the same order,
 * with the same fields. What it does is chosen by words in what it is told, so a test reads as a
 * conversation: "tool" makes it call a tool, "slow" makes it write until interrupted, "crash" makes it
 * stop. Told nothing special, it answers "You said: …" in three pieces.
 *
 *   node fake-claude.ts --version
 *   node fake-claude.ts auth status --json
 *   node fake-claude.ts -p --output-format json …                 one question, on standard input
 *   node fake-claude.ts -p --input-format stream-json …           a live session
 */

type Message = Record<string, unknown>

const args = process.argv.slice(2)
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const print = (message: Message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What the CLI was started with, for tests that check it. */
function inspect(what: string): string | undefined {
  if (what.includes('argv')) return JSON.stringify(args)
  if (what.includes('environment')) return JSON.stringify(process.env)
  if (what.includes('folder')) return process.cwd()
  if (what.includes('files')) {
    const read = (path: string | undefined) => (path === undefined ? undefined : readFileSync(path, 'utf8'))
    return JSON.stringify({ instructions: read(flag('--system-prompt-file')), settings: read(flag('--settings')), tools: read(flag('--mcp-config')) })
  }
  if (what.includes('pid')) return String(process.pid)
  return undefined
}

if (args.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code)\n')
} else if (args[0] === 'auth') {
  const account = process.env.FAKE_ACCOUNT ?? '{"loggedIn":true,"authMethod":"claude.ai","email":"ada@example.com","subscriptionType":"max"}'
  process.stdout.write(`${account}\n`)
  process.exitCode = account.includes('"loggedIn":true') ? 0 : 1
} else if (flag('--input-format') === 'stream-json') {
  session()
} else {
  oneShot()
}

/** `-p` with the question on standard input and the answer as one JSON object. */
function oneShot(): void {
  let question = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    question += chunk
  })
  process.stdin.on('end', () => {
    if (question.includes('sleep')) return void setInterval(() => undefined, 1000)
    if (question.includes('signed out')) {
      print({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' })
      process.exitCode = 1
      return
    }
    if (question.includes('crash')) {
      process.stderr.write('boom: the one-shot broke\n')
      process.exitCode = 3
      return
    }
    // The real CLI may print a notice before its answer.
    if (question.includes('notice')) process.stdout.write('A new version is available.\n')
    print({ type: 'result', subtype: 'success', is_error: false, result: inspect(question) ?? `You said: ${question}` })
  })
}

/** A live session over JSON lines. */
function session(): void {
  /** Messages from the user not yet answered: the CLI takes them one turn at a time. */
  const waiting: Message[] = []
  /** Whoever waits for the next answer to a question this program asked. */
  let answered: ((message: Message) => void) | undefined
  /** Whoever waits for an interruption. */
  let interrupted: (() => void) | undefined
  /** Whoever waits for the next message from the user, to take it into the turn under way. */
  let absorbed: ((message: Message) => void) | undefined
  let busy = false
  let inputEnded = false
  let stubborn = false
  let sequence = 0

  const id = (prefix: string) => `${prefix}_${++sequence}`
  const said = (message: Message) => String((message.message as Message | undefined)?.content ?? '')

  function init(): void {
    const given = (flag('--tools') ?? '').split(',').filter((tool) => tool !== '' && !['WebSearch', 'WebFetch'].includes(tool))
    const tools = [...(flag('--mcp-config') === undefined ? [] : ['mcp__core__ui_render']), ...given]
    print({
      type: 'system',
      subtype: 'init',
      tools: process.env.FAKE_LEAK ? [...tools, 'Bash'] : tools,
      mcp_servers: flag('--mcp-config') !== undefined ? [{ name: 'core', status: process.env.FAKE_TOOL_SERVER_STATUS ?? 'connected' }] : [],
      slash_commands: [],
      skills: [],
      ...(process.env.FAKE_LEAK ? { memory_paths: { auto: '/somewhere/memory/' } } : {})
    })
  }

  const event = (message: string, body: Message, parent: string | null = null) =>
    print({ type: 'stream_event', event: body, parent_tool_use_id: parent, api_message_id: message })

  /** A block of text written piece by piece, then sent whole, as the CLI does with partial messages on. */
  async function write(message: string, index: number, pieces: string[]): Promise<void> {
    event(message, { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
    for (const piece of pieces) {
      event(message, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } })
      await pause(2)
    }
    print({ type: 'assistant', message: { id: message, role: 'assistant', content: [{ type: 'text', text: pieces.join('') }] }, parent_tool_use_id: null })
    event(message, { type: 'content_block_stop', index })
  }

  /** A call to a tool: written, announced whole, put to the permission prompt, and its result reported. */
  async function callTool(message: string, index: number, name: string, input: Message = { title: 'Hello' }): Promise<Message> {
    const call = id('toolu')
    event(message, { type: 'content_block_start', index, content_block: { type: 'tool_use', id: call, name, input: {} } })
    event(message, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
    print({
      type: 'assistant',
      message: { id: message, role: 'assistant', content: [{ type: 'tool_use', id: call, name, input }] },
      parent_tool_use_id: null
    })
    event(message, { type: 'content_block_stop', index })
    const request = id('request')
    print({ type: 'control_request', request_id: request, request: { subtype: 'can_use_tool', tool_name: name, input, tool_use_id: call } })
    const reply = await new Promise<Message>((resolve) => {
      answered = resolve
    })
    const decision = ((reply.response as Message).response ?? {}) as Message
    const allowed = decision.behavior === 'allow'
    print({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: allowed ? 'Shown.' : decision.message, is_error: !allowed }] },
      parent_tool_use_id: null
    })
    return decision
  }

  function start(message: string): void {
    event(message, { type: 'message_start', message: { id: message, role: 'assistant', content: [] } })
  }

  function result(users: Message[], fields: Message = {}): void {
    print({
      type: 'result',
      subtype: 'success',
      is_error: false,
      terminal_reason: 'completed',
      ...(process.env.FAKE_OLD ? {} : { user_message_uuids: users.map((user) => user.uuid) }),
      ...fields
    })
  }

  async function turn(user: Message): Promise<void> {
    const text = said(user)
    init()
    const message = id('msg')

    if (text.includes('crash')) {
      // Stops once what it wrote has left: on some systems a pipe is written to in the background.
      return new Promise(() => process.stderr.write('warming up\nboom: the session broke\n', () => process.exit(3)))
    }
    if (text.includes('stubborn')) stubborn = true
    if (text.includes('signed out')) {
      print({
        type: 'assistant',
        error: 'authentication_failed',
        is_api_error_message: true,
        message: { id: message, model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
        parent_tool_use_id: null
      })
      return result([user], { is_error: true, terminal_reason: 'api_error', result: 'Not logged in · Please run /login' })
    }
    if (text.includes('limit')) {
      return result([user], { is_error: true, terminal_reason: 'api_error', result: 'You have hit your usage limit · it resets at 3pm' })
    }
    if (text.includes('whole')) {
      // No pieces: the reply comes as one message, as it does without partial messages.
      print({ type: 'assistant', message: { id: message, role: 'assistant', content: [{ type: 'text', text: 'All at once.' }] }, parent_tool_use_id: null })
      return result([user])
    }

    start(message)
    if (text.includes('slow')) {
      event(message, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      event(message, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'one ' } })
      await new Promise<void>((resolve) => {
        interrupted = resolve
      })
      print({ type: 'assistant', message: { id: message, role: 'assistant', content: [{ type: 'text', text: 'one ' }] }, parent_tool_use_id: null })
      print({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null })
      return result([user], { is_error: true, subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' })
    }
    if (text.includes('unfinished')) {
      // Interrupted while a tool call waits for permission: the call never gets a result.
      const call = id('toolu')
      event(message, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call, name: 'mcp__core__ui_render', input: {} } })
      await new Promise<void>((resolve) => {
        interrupted = resolve
      })
      return result([user], { is_error: true, subtype: 'error_during_execution', terminal_reason: 'aborted_tools' })
    }
    // "use Read {"file_path":"/x"}": a use of one of the CLI's own tools, put to the permission prompt.
    const use = /^use (\w+) (\{.*\})$/.exec(text)
    if (use?.[1] && use[2]) {
      const decision = await callTool(message, 0, use[1], JSON.parse(use[2]) as Message)
      const next = id('msg')
      start(next)
      await write(next, 0, [decision.behavior === 'allow' ? 'Allowed.' : `Refused: ${String(decision.message)}`])
      return result([user])
    }
    if (text.includes('foreign')) {
      const decision = await callTool(message, 0, 'Bash')
      const next = id('msg')
      start(next)
      await write(next, 0, [decision.behavior === 'allow' ? 'It ran.' : `Refused: ${String(decision.message)}`])
      return result([user])
    }
    if (text.includes('tool') || text.includes('blocks')) {
      if (text.includes('blocks')) await write(message, 0, ['Before', '.'])
      await callTool(message, 1, 'mcp__core__ui_render')
      const next = id('msg')
      start(next)
      await write(next, 0, ['After', '.'])
      return result([user])
    }
    if (text.includes('sub-agent')) {
      event(message, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'whispered by a sub-agent' } }, 'toolu_parent')
      print({
        type: 'assistant',
        message: { id: 'msg_other', role: 'assistant', content: [{ type: 'text', text: 'said by a sub-agent' }] },
        parent_tool_use_id: 'toolu_parent'
      })
    }
    if (text.includes('strange question')) {
      const request = id('request')
      print({ type: 'control_request', request_id: request, request: { subtype: 'something_new' } })
      const reply = await new Promise<Message>((resolve) => {
        answered = resolve
      })
      await write(message, 0, [`Answered with ${String((reply.response as Message).subtype)}.`])
      return result([user])
    }
    if (text.includes('absorb')) {
      // A message sent during the turn is taken into it, and one result answers both.
      const second = await new Promise<Message>((resolve) => {
        absorbed = resolve
      })
      await write(message, 0, [`Both: ${text} + ${said(second)}`])
      return result([user, second])
    }

    const answer = inspect(text) ?? `You said: ${text}`
    const third = Math.ceil(answer.length / 3)
    await write(message, 0, [answer.slice(0, third), answer.slice(third, 2 * third), answer.slice(2 * third)])
    result([user])
  }

  async function next(): Promise<void> {
    if (busy) return
    busy = true
    for (let user = waiting.shift(); user !== undefined; user = waiting.shift()) await turn(user)
    busy = false
    if (inputEnded && !stubborn) process.exit(0)
  }

  createInterface({ input: process.stdin })
    .on('line', (line) => {
      const message = JSON.parse(line) as Message
      if (message.type === 'user') {
        if (absorbed) {
          const take = absorbed
          absorbed = undefined
          take(message)
        } else waiting.push(message)
        void next()
      } else if (message.type === 'control_response') {
        const take = answered
        answered = undefined
        take?.(message)
      } else if (message.type === 'control_request' && (message.request as Message).subtype === 'interrupt') {
        print({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { still_queued: [] } } })
        const take = interrupted
        interrupted = undefined
        take?.()
      }
    })
    .on('close', () => {
      inputEnded = true
      // Like the real CLI, it ends when its input does. A stubborn one has to be stopped.
      if (stubborn) setInterval(() => undefined, 1000)
      else if (!busy) process.exit(0)
    })
}
