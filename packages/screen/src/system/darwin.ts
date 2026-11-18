import { spawn } from 'node:child_process'
import type { Combination, Modifier } from '../keys.ts'
import { onceHelper } from './helpers.ts'
import type { ScreenSystem } from './system.ts'

/**
 * macOS: the accessibility API, read and operated through System Events from JavaScript for Automation (`osascript`),
 * which every Mac has. The person gives the app the Accessibility permission once, in System Settings. A helper is
 * started for each question; its keys are paths in a window's tree (`pid:window/child/child`), so they outlive it.
 */

const KEY_CODES: Record<string, number> = {
  enter: 36,
  escape: 53,
  tab: 48,
  backspace: 51,
  delete: 117,
  space: 49,
  arrowup: 126,
  arrowdown: 125,
  arrowleft: 123,
  arrowright: 124,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  insert: 114,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111
}

const USING: Record<Modifier, string> = { control: 'control down', shift: 'shift down', alt: 'option down', meta: 'command down' }

/** A combination as System Events presses it: a key code or a character, and the modifiers held. */
export function macKeys({ modifiers, key }: Combination): { code: number | null; character: string; using: string[] } {
  const code = KEY_CODES[key]
  return { code: code ?? null, character: code === undefined ? key : '', using: modifiers.map((modifier) => USING[modifier]) }
}

/** The helper, in JavaScript for Automation. It reads one question on its input and writes one line. */
const HELPER = String.raw`
ObjC.import('Foundation')
const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding).js
const events = Application('System Events')
const reply = (value) => JSON.stringify(value)
const attempt = (read, otherwise) => { try { const value = read(); return value === undefined || value === null ? otherwise : value } catch (error) { return otherwise } }

function windowsOf() {
  const found = []
  const processes = events.applicationProcesses.whose({ backgroundOnly: false })()
  for (const process of processes) {
    const pid = attempt(() => process.unixId(), 0)
    const name = attempt(() => process.name(), '')
    const front = attempt(() => process.frontmost(), false)
    const windows = attempt(() => process.windows(), [])
    windows.forEach((window, index) => {
      const position = attempt(() => window.position(), [0, 0])
      const size = attempt(() => window.size(), [0, 0])
      found.push({
        id: pid + ':' + index,
        program: name.toLowerCase(),
        app: name,
        title: attempt(() => window.name(), '') || '',
        bounds: { x: position[0], y: position[1], width: size[0], height: size[1] },
        focused: front && index === 0,
        minimized: attempt(() => window.attributes.byName('AXMinimized').value(), false)
      })
    })
  }
  return found.sort((one, other) => Number(other.focused) - Number(one.focused))
}

function windowAt(id) {
  const [pid, index] = id.split(':').map(Number)
  const process = events.applicationProcesses.whose({ unixId: pid })()[0]
  if (!process) throw new Error('There is no window ' + id + ' open now. Call desktop_windows for the windows open and their identifiers.')
  const window = process.windows()[index]
  if (!window) throw new Error('There is no window ' + id + ' open now. Call desktop_windows for the windows open and their identifiers.')
  return { process, window }
}

function elementAt(key) {
  const [id, ...path] = key.split('/')
  let element = windowAt(id).window
  for (const step of path) {
    element = element.uiElements()[Number(step)]
    if (!element) throw new Error('The element is gone: look at the window again with desktop_look.')
  }
  return element
}

function tree(id, limit) {
  const nodes = []
  const walk = (element, key, depth) => {
    if (depth > 30) return
    const children = attempt(() => element.uiElements(), [])
    for (let index = 0; index < children.length && nodes.length < limit; index++) {
      const child = children[index]
      const role = attempt(() => child.role(), '')
      const subrole = attempt(() => child.subrole(), '')
      const password = subrole === 'AXSecureTextField'
      const node = {
        key: key + '/' + index,
        role: password ? 'AXSecureTextField' : role,
        name: attempt(() => child.name(), '') || attempt(() => child.description(), '') || attempt(() => child.title(), '') || '',
        password,
        enabled: attempt(() => child.enabled(), true),
        depth
      }
      if (!password) {
        const value = attempt(() => child.value(), null)
        if (typeof value === 'string' || typeof value === 'number') node.value = String(value).slice(0, 200)
      }
      nodes.push(node)
      walk(child, node.key, depth + 1)
    }
  }
  walk(windowAt(id).window, id, 0)
  return nodes
}

function press(keys) {
  if (keys.code !== null) events.keyCode(keys.code, { using: keys.using })
  else events.keystroke(keys.character, { using: keys.using })
}

function answer(question) {
  const input = question.input || {}
  switch (question.name) {
    case 'windows': return windowsOf()
    case 'tree': return tree(input.window, input.limit)
    case 'inspect': {
      let element
      try { element = elementAt(input.key) } catch (error) { return null }
      const subrole = attempt(() => element.subrole(), '')
      const password = subrole === 'AXSecureTextField'
      const facts = {
        role: password ? 'AXSecureTextField' : attempt(() => element.role(), ''),
        name: attempt(() => element.name(), '') || attempt(() => element.description(), '') || '',
        password,
        enabled: attempt(() => element.enabled(), true),
        hints: [attempt(() => element.help(), ''), attempt(() => element.attributes.byName('AXIdentifier').value(), '')].filter(Boolean),
        window: input.key.split('/')[0]
      }
      if (!password) { const value = attempt(() => element.value(), null); if (typeof value === 'string') facts.value = value.slice(0, 200) }
      return facts
    }
    case 'focus': {
      const { process, window } = windowAt(input.window)
      attempt(() => { window.attributes.byName('AXMinimized').value = false })
      process.frontmost = true
      attempt(() => window.actions.byName('AXRaise').perform())
      delay(0.15)
      return windowsOf().find((one) => one.id === input.window)
    }
    case 'click': {
      const element = elementAt(input.key)
      const pressed = attempt(() => { element.actions.byName('AXPress').perform(); return true }, false)
      if (!pressed) events.click(element)
      return null
    }
    case 'type': {
      const element = elementAt(input.key)
      attempt(() => { element.focused = true })
      const set = attempt(() => { element.value = input.text; return true }, false)
      if (!set) { events.keystroke('a', { using: ['command down'] }); events.keystroke(input.text) }
      if (input.submit) events.keyCode(36)
      return null
    }
    case 'press': {
      const { process } = windowAt(input.window)
      process.frontmost = true
      if (input.key) attempt(() => { elementAt(input.key).focused = true })
      press(input.keys)
      return null
    }
    case 'scroll': {
      const { process } = windowAt(input.window)
      process.frontmost = true
      if (input.key) attempt(() => { elementAt(input.key).focused = true })
      for (let time = 0; time < Math.max(1, Math.round(input.screens)); time++) events.keyCode(input.direction === 'down' ? 121 : 116)
      return null
    }
    default: throw new Error('The helper does not know ' + question.name + '.')
  }
}

let output
try { output = reply({ ok: true, value: answer(JSON.parse(input)) }) } catch (error) { output = reply({ ok: false, error: String(error.message || error) }) }
output
`

/** What a program prints, whole, or nothing when it fails. */
function printed(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const running = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    running.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
    })
    running.once('error', () => resolve(undefined))
    running.once('close', (code) => resolve(code === 0 ? output : undefined))
  })
}

const helper = onceHelper('/usr/bin/osascript', async () => ['-l', 'JavaScript', '-e', HELPER])

export const darwin: ScreenSystem = {
  async find() {
    const trusted = await printed('/usr/bin/osascript', ['-e', 'tell application "System Events" to get UI elements enabled'])
    if (trusted === undefined) return { available: false, problem: 'System Events, which reads the other apps, could not be reached.' }
    return trusted.trim() === 'true'
      ? { available: true }
      : { available: false, problem: 'Let the app control your computer first: System Settings, Privacy & Security, Accessibility.' }
  },
  helper: () => ({
    async ask(name, input) {
      // A picture and the time since the last input come from the system's own tools, not from System Events.
      if (name === 'idle') {
        const read = await printed('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'])
        const nanoseconds = read && /"HIDIdleTime"\s*=\s*(\d+)/.exec(read)?.[1]
        return (nanoseconds ? Math.round(Number(nanoseconds) / 1_000_000) : null) as never
      }
      if (name === 'screenshot') {
        const window = ((await helper.ask('windows', {})) as { id: string; bounds: { x: number; y: number; width: number; height: number } }[]).find(
          (one) => one.id === (input as { window: string }).window
        )
        if (!window) throw new Error('There is no such window open now. Call desktop_windows.')
        const { x, y, width, height } = window.bounds
        const picture = await new Promise<Buffer>((resolve, reject) => {
          const running = spawn('/usr/sbin/screencapture', ['-x', '-t', 'png', `-R${x},${y},${width},${height}`, '/dev/stdout'], {
            stdio: ['ignore', 'pipe', 'ignore']
          })
          const parts: Buffer[] = []
          running.stdout.on('data', (part: Buffer) => parts.push(part))
          running.once('error', reject)
          running.once('close', (code) =>
            code === 0
              ? resolve(Buffer.concat(parts))
              : reject(new Error('The screen could not be read: let the app record the screen in System Settings, Privacy & Security.'))
          )
        })
        return { data: picture.toString('base64'), mime: 'image/png' } as never
      }
      return helper.ask(name, input)
    },
    close: async () => undefined
  }),
  keys: macKeys
}
