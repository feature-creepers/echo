import type { SystemKey } from '@repo/core'
import type { Combination, Modifier } from '../keys.ts'
import { type Program, printedBy, runProgram } from '../program.ts'
import { onceHelper } from './helpers.ts'
import type { Helper, Questions, ScreenSystem } from './system.ts'

/**
 * Linux: AT-SPI, the desktop's accessibility bus, read and operated from Python through its GObject bindings, and
 * `xdotool` for keys and the pointer where AT-SPI has no action. Under Wayland an app cannot drive another's input:
 * reading works, and acts that need keys work in an X11 session only. A helper is started for each question; its
 * keys are paths in a window's tree (`app/window/child/child`), so they outlive it.
 */

const XDOTOOL_KEYS: Record<string, string> = {
  enter: 'Return',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'BackSpace',
  delete: 'Delete',
  space: 'space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'Prior',
  pagedown: 'Next',
  insert: 'Insert',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`f${index + 1}`, `F${index + 1}`]))
}

const XDOTOOL_MODIFIERS: Record<Modifier, string> = { control: 'ctrl', shift: 'shift', alt: 'alt', meta: 'super' }

/** A combination as `xdotool key` names it: "ctrl+shift+Return". A character is named by its code point, whatever it is. */
function linuxKeys({ modifiers, key }: Combination): string {
  const named = XDOTOOL_KEYS[key] ?? (/^[a-z0-9]$/.test(key) ? key : `U${(key.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)
  return [...modifiers.map((modifier) => XDOTOOL_MODIFIERS[modifier]), named].join('+')
}

/**
 * What a key of the whole system does on Linux, where no app may press one under Wayland: what the desktop does with
 * the keyboard's own. A media key is a command to the player that plays, over the session's bus (MPRIS); a sound key
 * changes the default output, with PipeWire's or PulseAudio's own tool.
 */
type LinuxSystemKey = { player: 'PlayPause' | 'Next' | 'Previous' | 'Stop' } | { sound: 'up' | 'down' | 'mute' }

const LINUX_SYSTEM_KEYS: Readonly<Record<SystemKey, LinuxSystemKey>> = {
  MediaPlayPause: { player: 'PlayPause' },
  MediaNext: { player: 'Next' },
  MediaPrevious: { player: 'Previous' },
  MediaStop: { player: 'Stop' },
  VolumeUp: { sound: 'up' },
  VolumeDown: { sound: 'down' },
  VolumeMute: { sound: 'mute' }
}

/** How much a sound key changes the volume, in percent, as the desktops' own keys do. */
const SOUND_STEP = 5

const MPRIS = 'org.mpris.MediaPlayer2'
const MPRIS_PATH = '/org/mpris/MediaPlayer2'

/** A call on the session's bus with `gdbus`, which comes with GLib on every desktop. */
export const busCall = (destination: string, path: string, method: string, ...args: string[]): Program => ({
  command: 'gdbus',
  args: ['call', '--session', '--dest', destination, '--object-path', path, '--method', method, ...args]
})

/** The players on the session's bus, read from what `ListNames` prints: `(['org.freedesktop.DBus', ':1.2', '…'],)`. */
export function playersIn(listed: string): string[] {
  return [...listed.matchAll(/'(org\.mpris\.MediaPlayer2\.[^']+)'/g)].map((match) => match[1] as string)
}

/** A player's state, read from what `Properties.Get` prints: `(<'Playing'>,)`. */
export function statusIn(read: string): string | undefined {
  return /<'(\w+)'>/.exec(read)?.[1]
}

/** The player a media key drives, as the desktop's own keys choose it: the one playing, else one paused, else the first. */
export function playerToDrive(players: readonly { name: string; status: string | undefined }[]): string | undefined {
  return (players.find((one) => one.status === 'Playing') ?? players.find((one) => one.status === 'Paused') ?? players[0])?.name
}

/**
 * The programs that change the sound as a key pressed `times` times would, each tried until one answers: PipeWire's
 * `wpctl`, then PulseAudio's `pactl`, which PipeWire answers too. Mute pressed twice leaves it as it was: nothing.
 */
export function soundPrograms(change: 'up' | 'down' | 'mute', times: number): Program[] {
  const step = `${SOUND_STEP * times}%`
  switch (change) {
    case 'up':
      return [
        { command: 'wpctl', args: ['set-volume', '--limit', '1.0', '@DEFAULT_AUDIO_SINK@', `${step}+`] },
        { command: 'pactl', args: ['set-sink-volume', '@DEFAULT_SINK@', `+${step}`] }
      ]
    case 'down':
      return [
        { command: 'wpctl', args: ['set-volume', '@DEFAULT_AUDIO_SINK@', `${step}-`] },
        { command: 'pactl', args: ['set-sink-volume', '@DEFAULT_SINK@', `-${step}`] }
      ]
    case 'mute':
      return times % 2 === 0
        ? []
        : [
            { command: 'wpctl', args: ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle'] },
            { command: 'pactl', args: ['set-sink-mute', '@DEFAULT_SINK@', 'toggle'] }
          ]
  }
}

/** How long a program of the desktop may take to answer, in milliseconds: each answers at once, or not at all. */
const ANSWER_MS = 5_000

/** A key of the whole system, as `LINUX_SYSTEM_KEYS` says what it does, pressed `times` times. */
async function pressSystemKey(key: LinuxSystemKey, times: number): Promise<void> {
  if ('sound' in key) {
    const programs = soundPrograms(key.sound, times)
    if (programs.length === 0) return
    for (const program of programs) if ((await printedBy(program, ANSWER_MS)) !== undefined) return
    throw new Error('The sound cannot be changed here: neither wpctl nor pactl answered.')
  }
  const listed = await printedBy(busCall('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames'), ANSWER_MS)
  if (listed === undefined) throw new Error('The media keys cannot be pressed here: gdbus did not answer.')
  const players = await Promise.all(
    playersIn(listed).map(async (name) => {
      const read = await printedBy(busCall(name, MPRIS_PATH, 'org.freedesktop.DBus.Properties.Get', `${MPRIS}.Player`, 'PlaybackStatus'), ANSWER_MS)
      return { name, status: read === undefined ? undefined : statusIn(read) }
    })
  )
  const player = playerToDrive(players)
  if (player === undefined) throw new Error('No app that plays music or video is open.')
  for (let time = 0; time < times; time++) {
    const pressed = await printedBy(busCall(player, MPRIS_PATH, `${MPRIS}.Player.${key.player}`), ANSWER_MS)
    if (pressed === undefined) throw new Error(`${player.slice(MPRIS.length + 1).split('.')[0]} did not take the key.`)
  }
}

/** Open a link with the app the desktop gives its scheme. The core checked the link first. */
async function openLink(link: string): Promise<void> {
  const ran = await runProgram(
    { command: 'xdg-open', args: [link] },
    { timeout: 10_000, missing: 'Links cannot be opened here: xdg-open is not installed.', slow: 'The link took too long to open.' }
  )
  if (ran.code !== 0) throw new Error(`No app on this computer opens ${link.split(':')[0]}: links.`)
}

/** The helper, in Python. It reads one question on its input and writes one line. */
const HELPER = String.raw`
import base64, json, re, subprocess, sys
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

FRAMES = ('frame', 'window', 'dialog', 'alert', 'file chooser')

def attempt(read, otherwise):
    try:
        value = read()
        return otherwise if value is None else value
    except Exception:
        return otherwise

def program_of(app):
    pid = attempt(app.get_process_id, 0)
    try:
        with open('/proc/%d/comm' % pid) as comm:
            return comm.read().strip().lower()
    except Exception:
        return (attempt(app.get_name, '') or '').lower()

def windows():
    found = []
    desktop = Atspi.get_desktop(0)
    for a in range(attempt(desktop.get_child_count, 0)):
        app = attempt(lambda: desktop.get_child_at_index(a), None)
        if app is None:
            continue
        for w in range(attempt(app.get_child_count, 0)):
            window = attempt(lambda: app.get_child_at_index(w), None)
            if window is None or attempt(window.get_role_name, '') not in FRAMES:
                continue
            states = attempt(window.get_state_set, None)
            if states is not None and not states.contains(Atspi.StateType.SHOWING):
                continue
            box = attempt(lambda: window.get_extents(Atspi.CoordType.SCREEN), None)
            found.append({
                'id': '%d/%d' % (a, w),
                'program': program_of(app),
                'app': attempt(app.get_name, '') or program_of(app),
                'title': attempt(window.get_name, '') or '',
                'bounds': {'x': box.x, 'y': box.y, 'width': box.width, 'height': box.height} if box else {'x': 0, 'y': 0, 'width': 0, 'height': 0},
                'focused': bool(states and states.contains(Atspi.StateType.ACTIVE)),
                'minimized': bool(states and states.contains(Atspi.StateType.ICONIFIED)),
            })
    found.sort(key=lambda one: not one['focused'])
    return found

def element_at(key):
    steps = [int(step) for step in key.split('/')]
    element = Atspi.get_desktop(0)
    for step in steps:
        element = attempt(lambda: element.get_child_at_index(step), None)
        if element is None:
            raise Exception('The element is gone: look at the window again with desktop_look.')
    return element

def window_at(id):
    try:
        return element_at(id)
    except Exception:
        raise Exception('There is no window %s open now. Call desktop_windows for the windows open and their identifiers.' % id)

def text_of(element):
    text = attempt(element.get_text_iface, None)
    if text is None:
        return None
    return attempt(lambda: text.get_text(0, min(200, text.get_character_count())), None)

def tree(id, limit):
    nodes = []
    def walk(element, key, depth):
        if depth > 30:
            return
        for index in range(attempt(element.get_child_count, 0)):
            if len(nodes) >= limit:
                return
            child = attempt(lambda: element.get_child_at_index(index), None)
            if child is None:
                continue
            states = attempt(child.get_state_set, None)
            if states is not None and not states.contains(Atspi.StateType.SHOWING):
                continue
            role = attempt(child.get_role_name, '')
            node = {'key': '%s/%d' % (key, index), 'role': role, 'name': attempt(child.get_name, '') or '', 'password': role == 'password text',
                    'enabled': not states or states.contains(Atspi.StateType.ENABLED), 'depth': depth}
            if role != 'password text' and states is not None and states.contains(Atspi.StateType.EDITABLE):
                value = text_of(child)
                if value is not None:
                    node['value'] = value
            nodes.append(node)
            walk(child, node['key'], depth + 1)
    walk(window_at(id), id, 0)
    return nodes

def center(element):
    box = element.get_extents(Atspi.CoordType.SCREEN)
    return box.x + box.width // 2, box.y + box.height // 2

def xdotool(*args):
    subprocess.run(['xdotool'] + list(args), check=True)

def focus(id):
    window = window_at(id)
    component = attempt(window.get_component_iface, None)
    if component is not None:
        attempt(component.grab_focus, False)
    title = attempt(window.get_name, '')
    if title:
        # xdotool reads the name as an extended regular expression: the title's own characters are matched as they are.
        pattern = re.sub(r'([][\\.^$*+?(){}|])', r'\\\1', title)
        subprocess.run(['xdotool', 'search', '--name', '^%s$' % pattern, 'windowactivate'], check=False)

def answer(question):
    data = question.get('input') or {}
    name = question['name']
    if name == 'windows':
        return windows()
    if name == 'tree':
        return tree(data['window'], data['limit'])
    if name == 'inspect':
        try:
            element = element_at(data['key'])
        except Exception:
            return None
        role = attempt(element.get_role_name, '')
        states = attempt(element.get_state_set, None)
        facts = {'role': role, 'name': attempt(element.get_name, '') or '', 'password': role == 'password text',
                 'enabled': not states or states.contains(Atspi.StateType.ENABLED),
                 'hints': [hint for hint in [attempt(element.get_description, ''), attempt(element.get_accessible_id, '')] if hint],
                 'window': '/'.join(data['key'].split('/')[:2])}
        if role != 'password text':
            value = text_of(element)
            if value is not None:
                facts['value'] = value
        return facts
    if name == 'focus':
        focus(data['window'])
        return next((one for one in windows() if one['id'] == data['window']), None)
    if name == 'click':
        element = element_at(data['key'])
        action = attempt(element.get_action_iface, None)
        if action is not None and attempt(action.get_n_actions, 0) > 0:
            action.do_action(0)
        else:
            x, y = center(element)
            xdotool('mousemove', str(x), str(y), 'click', '1')
        return None
    if name == 'type':
        element = element_at(data['key'])
        editable = attempt(element.get_editable_text_iface, None)
        if editable is not None and attempt(lambda: editable.set_text_contents(data['text']), False):
            pass
        else:
            component = attempt(element.get_component_iface, None)
            if component is not None:
                attempt(component.grab_focus, False)
            xdotool('key', 'ctrl+a')
            xdotool('type', '--', data['text'])
        if data['submit']:
            xdotool('key', 'Return')
        return None
    if name == 'press':
        focus(data['window'])
        if data.get('key'):
            component = attempt(element_at(data['key']).get_component_iface, None)
            if component is not None:
                attempt(component.grab_focus, False)
        xdotool('key', data['keys'])
        return None
    if name == 'scroll':
        target = element_at(data['key']) if data.get('key') else window_at(data['window'])
        x, y = center(target)
        xdotool('mousemove', str(x), str(y))
        for _ in range(max(1, round(data['screens'])) * 5):
            xdotool('click', '5' if data['direction'] == 'down' else '4')
        return None
    if name == 'screenshot':
        window = next((one for one in windows() if one['id'] == data['window']), None)
        if window is None:
            raise Exception('There is no window %s open now.' % data['window'])
        box = window['bounds']
        for command in (['import', '-window', 'root', '-crop', '%dx%d+%d+%d' % (box['width'], box['height'], box['x'], box['y']), 'png:-'],
                        ['grim', '-g', '%d,%d %dx%d' % (box['x'], box['y'], box['width'], box['height']), '-']):
            try:
                picture = subprocess.run(command, check=True, capture_output=True).stdout
                return {'data': base64.b64encode(picture).decode('ascii'), 'mime': 'image/png'}
            except Exception:
                continue
        raise Exception('The screen could not be read: install ImageMagick (X11) or grim (Wayland).')
    if name == 'idle':
        try:
            return int(subprocess.run(['xprintidle'], check=True, capture_output=True, text=True).stdout.strip())
        except Exception:
            return None
    raise Exception('The helper does not know %s.' % name)

try:
    print(json.dumps({'ok': True, 'value': answer(json.loads(sys.stdin.read()))}))
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error)}))
`

/** Whether a program runs and ends well with these arguments. */
const runs = async (command: string, args: string[]) => (await printedBy({ command, args }, 10_000)) !== undefined

export const linux: ScreenSystem = {
  async find() {
    if (!(await runs('python3', ['-c', "import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi"])))
      return { available: false, problem: 'Install what reads the other apps first: python3-gi and gir1.2-atspi-2.0 (or python3-gobject and at-spi2-core).' }
    if (!(await runs('xdotool', ['version']))) return { available: false, problem: 'Install xdotool first: it presses keys and clicks for the assistant.' }
    return { available: true }
  },
  helper: (): Helper => {
    const reader = onceHelper('python3', async () => ['-c', HELPER])
    return {
      async ask(name, input) {
        // A key of the whole system and a link are the desktop's own: no app is read for them.
        if (name === 'systemKey') {
          const { key, times } = input as Questions['systemKey']['input']
          await pressSystemKey(key as LinuxSystemKey, times)
          return null as never
        }
        if (name === 'open') {
          await openLink((input as Questions['open']['input']).link)
          return null as never
        }
        return reader.ask(name, input)
      },
      close: () => reader.close()
    }
  },
  keys: linuxKeys,
  systemKeys: LINUX_SYSTEM_KEYS
}
