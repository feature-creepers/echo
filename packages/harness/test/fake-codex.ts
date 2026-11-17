import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

/**
 * A stand-in for Codex, for tests that must run where it is not installed.
 *
 * It speaks the protocol of `codex app-server` the way the adapter was written to expect it, from the code
 * of another app that drives the real one. It was never compared with the real CLI on the machine where it
 * was written, so it proves the adapter's logic and not the protocol itself.
 *
 * What it does is chosen by words in what it is told: "tool" makes it call a tool of the core, "slow"
 * makes it write until interrupted, "crash" makes it stop. Told nothing special, it answers "You said: …".
 *
 *   node fake-codex.ts --version
 *   node fake-codex.ts login status
 *   node fake-codex.ts exec … -o <file> -          one question, on standard input
 *   node fake-codex.ts app-server …                a live session
 */

type Message = Record<string, unknown>

const args = process.argv.slice(2)
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const print = (message: Message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

if (args.includes('--version')) {
  process.stdout.write('codex-cli 9.9.9\n')
} else if (args[0] === 'login') {
  const signedIn = process.env.FAKE_LOGIN !== 'out'
  // The real CLI says it on standard error.
  process.stderr.write(signedIn ? 'Logged in using ChatGPT\n' : 'Not logged in\n')
  process.exitCode = signedIn ? 0 : 1
} else if (args[0] === 'exec') {
  exec()
} else if (args[0] === 'app-server') {
  appServer()
} else {
  process.exitCode = 2
}

/** `exec`, with the question on standard input and the answer written to the file named by `-o`. */
function exec(): void {
  let question = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    question += chunk
  })
  process.stdin.on('end', () => {
    if (question.includes('sleep')) return void setInterval(() => undefined, 1000)
    if (question.includes('signed out')) {
      process.stderr.write('ERROR: Not logged in. Run codex login.\n')
      process.exitCode = 1
      return
    }
    if (question.includes('crash')) {
      process.stderr.write('boom: the one-shot broke\n')
      process.exitCode = 3
      return
    }
    // What the real CLI prints about the run is not the answer.
    process.stdout.write('codex\ntokens used: 12\n')
    const instructions = args.find((arg) => arg.startsWith('model_instructions_file='))?.match(/"(.*)"/)?.[1]
    let answer = `You said: ${question}`
    if (question.includes('argv')) answer = JSON.stringify(args)
    else if (question.includes('folder')) answer = process.cwd()
    else if (question.includes('instructions') && instructions) answer = readFileSync(instructions, 'utf8')
    writeFileSync(value('-o') ?? '', answer)
  })
}

/** A live session: JSON-RPC over JSON lines, without the `jsonrpc` field, as Codex writes it. */
function appServer(): void {
  let thread: Message = {}
  let turns = 0
  let items = 0
  /** The turn under way, and what can happen to it from outside. */
  let running: { id: string; steered?: (text: string) => void; interrupted?: () => void } | undefined
  /** Whoever waits for the answer to a request this program made, by the request's identifier. */
  const answers = new Map<number, (message: Message) => void>()
  let requests = 0

  const notify = (method: string, params: Message) => print({ method, params })

  /** Ask the client something and wait for what it says. */
  function ask(method: string, params: Message): Promise<Message> {
    const id = 1000 + ++requests
    print({ id, method, params })
    return new Promise((resolve) => answers.set(id, resolve))
  }

  const said = (params: Message) => String((params.input as Message[] | undefined)?.[0]?.text ?? '')

  /** A message of the assistant, written piece by piece unless `whole`, then given whole. */
  async function message(turn: string, pieces: string[], whole = false): Promise<void> {
    const id = `item-${++items}`
    notify('item/started', { threadId: 'thread-1', turnId: turn, item: { type: 'agentMessage', id, text: '' } })
    if (!whole) {
      for (const piece of pieces) {
        notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: turn, itemId: id, delta: piece })
        await pause(2)
      }
    }
    notify('item/completed', { threadId: 'thread-1', turnId: turn, item: { type: 'agentMessage', id, text: pieces.join('') } })
  }

  function complete(turn: string, status = 'completed', error?: string): void {
    if (running?.id === turn) running = undefined
    notify('turn/completed', { threadId: 'thread-1', turn: { id: turn, status, ...(error ? { error: { message: error } } : {}) } })
  }

  async function turn(id: string, text: string): Promise<void> {
    notify('turn/started', { threadId: 'thread-1', turn: { id } })

    if (text.includes('crash')) {
      // Stops once what it wrote has left: on some systems a pipe is written to in the background.
      return new Promise(() => process.stderr.write('warming up\nboom: the session broke\n', () => process.exit(3)))
    }
    if (text.includes('overloaded')) return complete(id, 'failed', 'The model is overloaded.')
    if (text.includes('signed out')) {
      notify('error', { error: { message: 'Not logged in. Run codex login.' }, willRetry: false })
      return complete(id, 'failed', 'Not logged in. Run codex login.')
    }
    if (text.includes('retry')) notify('error', { error: { message: 'stream disconnected' }, willRetry: true })
    if (text.includes('whole')) {
      await message(id, ['All at once.'], true)
      return complete(id)
    }
    if (text.includes('slow')) {
      const item = `item-${++items}`
      notify('item/started', { threadId: 'thread-1', turnId: id, item: { type: 'agentMessage', id: item, text: '' } })
      notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: id, itemId: item, delta: 'one ' })
      await new Promise<void>((resolve) => {
        if (running) running.interrupted = resolve
      })
      return complete(id, 'interrupted')
    }
    if (text.includes('wait')) {
      // Says nothing until it is told more, then answers both.
      const more = await new Promise<string>((resolve) => {
        if (running) running.steered = resolve
      })
      await message(id, [`Both: ${text} + ${more}`])
      return complete(id)
    }
    if (text.includes('tool') || text.includes('blocks')) {
      if (text.includes('blocks')) await message(id, ['Before', '.'])
      const call = `item-${++items}`
      const item = { type: 'mcpToolCall', id: call, server: 'core', tool: 'ui_render', status: 'inProgress', arguments: { title: 'Hello' } }
      notify('item/started', { threadId: 'thread-1', turnId: id, item })
      const reply = await ask('mcpServer/elicitation/request', { threadId: 'thread-1', serverName: 'core', message: 'Allow ui_render?' })
      notify('item/completed', { threadId: 'thread-1', turnId: id, item: { ...item, status: 'completed' } })
      await message(id, text.includes('blocks') ? ['After', '.'] : [`The core's tool was ${String((reply.result as Message).action)}ed.`])
      return complete(id)
    }
    if (text.includes('other server')) {
      const item = { type: 'mcpToolCall', id: `item-${++items}`, server: 'mail', tool: 'send', status: 'inProgress' }
      notify('item/started', { threadId: 'thread-1', turnId: id, item })
      const reply = await ask('mcpServer/elicitation/request', { threadId: 'thread-1', serverName: 'mail', message: 'Allow send?' })
      notify('item/completed', { threadId: 'thread-1', turnId: id, item: { ...item, status: 'failed' } })
      await message(id, [`Another server's tool was ${String((reply.result as Message).action)}d.`])
      return complete(id)
    }
    if (text.includes('command')) {
      const command = await ask('item/commandExecution/requestApproval', { threadId: 'thread-1', itemId: 'item-c', command: 'rm -rf /' })
      const change = await ask('item/fileChange/requestApproval', { threadId: 'thread-1', itemId: 'item-f' })
      const older = await ask('execCommandApproval', { command: ['ls'] })
      const unknown = await ask('something/new', {})
      const decisions = [command, change, older].map((reply) => String((reply.result as Message).decision))
      await message(id, [`Decisions: ${decisions.join(', ')}. Unknown: ${String((unknown.error as Message).code)}.`])
      return complete(id)
    }

    let answer = `You said: ${text}`
    if (text.includes('argv')) answer = JSON.stringify(args)
    else if (text.includes('thread')) answer = JSON.stringify(thread)
    else if (text.includes('folder')) answer = process.cwd()
    else if (text.includes('pid')) answer = String(process.pid)
    const half = Math.ceil(answer.length / 2)
    await message(id, [answer.slice(0, half), answer.slice(half)])
    complete(id)
  }

  createInterface({ input: process.stdin })
    .on('line', (line) => {
      const received = JSON.parse(line) as Message
      const id = received.id as number | undefined
      const params = (received.params ?? {}) as Message

      // An answer to a request of ours.
      if (received.method === undefined && id !== undefined) {
        const take = answers.get(id)
        answers.delete(id)
        take?.(received)
        return
      }
      switch (received.method) {
        case 'initialize':
          return print({ id, result: { userAgent: 'fake-codex' } })
        case 'initialized':
          return
        case 'thread/start':
          if (String(params.developerInstructions).includes('refuse the thread'))
            return print({ id, error: { code: -32000, message: 'Not logged in. Run codex login.' } })
          thread = params
          return print({ id, result: { thread: { id: 'thread-1' } } })
        case 'turn/start': {
          const turnId = `turn-${++turns}`
          running = { id: turnId }
          print({ id, result: { turn: { id: turnId } } })
          void turn(turnId, said(params))
          return
        }
        case 'turn/steer': {
          // Codex refuses to steer a turn that is not the one under way.
          const steered = running
          if (steered === undefined || steered.id !== params.expectedTurnId) return print({ id, error: { code: -32600, message: 'no active turn to steer' } })
          if (said(params).includes('late')) {
            // The turn ends as the message arrives: it is refused, and the client must start a new turn with it.
            print({ id, error: { code: -32600, message: 'no active turn to steer' } })
            steered.steered?.('nothing more')
            return
          }
          print({ id, result: { turnId: steered.id } })
          return steered.steered?.(said(params))
        }
        case 'turn/interrupt':
          print({ id, result: {} })
          return running?.interrupted?.()
        default:
          return print({ id, error: { code: -32601, message: `unknown method ${String(received.method)}` } })
      }
    })
    .on('close', () => process.exit(0))
}
