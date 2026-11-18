import { spawn } from 'node:child_process'
import type { Combination, Modifier } from '../keys.ts'
import { onceHelper } from './helpers.ts'
import type { ScreenSystem } from './system.ts'

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
export function linuxKeys({ modifiers, key }: Combination): string {
  const named = XDOTOOL_KEYS[key] ?? (/^[a-z0-9]$/.test(key) ? key : `U${(key.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)
  return [...modifiers.map((modifier) => XDOTOOL_MODIFIERS[modifier]), named].join('+')
}

/** The helper, in Python. It reads one question on its input and writes one line. */
const HELPER = String.raw`
import json, subprocess, sys
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
        subprocess.run(['xdotool', 'search', '--name', '^%s$' % title.replace('\\', '\\\\'), 'windowactivate'], check=False)

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
        import base64
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
const runs = (command: string, args: string[]) =>
  new Promise<boolean>((resolve) => {
    const running = spawn(command, args, { stdio: 'ignore' })
    running.once('error', () => resolve(false))
    running.once('close', (code) => resolve(code === 0))
  })

export const linux: ScreenSystem = {
  async find() {
    if (!(await runs('python3', ['-c', "import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi"])))
      return { available: false, problem: 'Install what reads the other apps first: python3-gi and gir1.2-atspi-2.0 (or python3-gobject and at-spi2-core).' }
    if (!(await runs('xdotool', ['version']))) return { available: false, problem: 'Install xdotool first: it presses keys and clicks for the assistant.' }
    return { available: true }
  },
  helper: () => onceHelper('python3', async () => ['-c', HELPER]),
  keys: linuxKeys
}
