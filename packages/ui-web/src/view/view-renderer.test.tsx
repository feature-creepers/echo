// @vitest-environment jsdom
import { EXAMPLE_VIEW, type ViewSpec, validateView } from '@repo/catalog'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ViewActions } from './context.ts'
import { ViewRenderer } from './view-renderer.tsx'

// jsdom draws nothing and lacks what UI SDK's controls call to scroll and animate; React is told it runs in tests.
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = () => undefined
  Element.prototype.getAnimations = () => []
})

const drawn: Root[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of drawn.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** A view checked as the core checks it. */
function checked(written: unknown): ViewSpec {
  const validation = validateView(written)
  if (!validation.ok) throw new Error(validation.problems.join(' '))
  return validation.spec
}

/** A view of these elements, the first one the root. */
const view = (elements: Record<string, { type: string; props?: Record<string, unknown>; children?: string[] }>): ViewSpec => ({
  root: Object.keys(elements)[0] ?? '',
  elements: Object.fromEntries(Object.entries(elements).map(([id, element]) => [id, { props: {}, children: [], ...element }])) as ViewSpec['elements']
})

async function draw(spec: ViewSpec, given: Partial<ViewActions> = {}) {
  const actions: ViewActions = { say: vi.fn(), readFile: () => Promise.reject(new Error('none')), ...given }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  drawn.push(root)
  await act(async () => root.render(<ViewRenderer spec={spec} actions={actions} />))
  return { host, actions }
}

const press = (element: Element | null | undefined) =>
  act(async () => {
    ;(element as HTMLElement).click()
  })

/** Type into an input as a person does, so React hears it. */
const type = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

/** Press a key where the keyboard is. */
const key = (name: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  })

/** The lines to type another answer to a question in. */
const other = (host: HTMLElement) => [...host.querySelectorAll<HTMLInputElement>('input[placeholder="Other answer…"]')]

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].find((one) => one.textContent === name)

describe('a view drawn', () => {
  it.each([
    {
      name: 'the example view, checked, with its heading, its two metrics and its chart',
      spec: () => checked(EXAMPLE_VIEW),
      shown: ['Lyon, this week', 'Now', '21', 'Wind', '12'],
      also: 'svg[role="img"]'
    },
    {
      name: 'a view with a block the app does not know, everything else',
      spec: () =>
        view({
          all: { type: 'Stack', children: ['new', 'known'] },
          new: { type: 'Hologram', props: { text: 'From a newer core' } },
          known: { type: 'Text', props: { text: 'Still here' } }
        }),
      shown: ['Still here'],
      hidden: 'From a newer core',
      said: 'warn' as const
    },
    {
      name: 'a view with a block that fails, the rest of it',
      spec: () =>
        view({
          all: { type: 'Stack', children: ['broken', 'fine'] },
          broken: { type: 'List', props: { items: null } },
          fine: { type: 'Text', props: { text: 'Still here' } }
        }),
      shown: ['Still here'],
      said: 'error' as const
    },
    {
      name: 'a Table keyed by words json-render reads as expressions, each cell as written',
      spec: () =>
        checked({
          root: 'table',
          elements: {
            table: {
              type: 'Table',
              props: {
                columns: ['name', '$state', '$template', '$computed', '$bindState'].map((key) => ({ key, label: key })),
                rows: [{ name: 'Lyon', $state: '/city', $template: 'Hello', $computed: 'sum', $bindState: '/form' }]
              }
            }
          }
        }),
      cells: ['Lyon', '/city', 'Hello', 'sum', '/form']
    }
  ])('shows $name', async ({ spec, shown = [], hidden, also, cells, said }) => {
    // A block the app does not know and one that fails are said in the console, not on screen.
    const logged = {
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined)
    }
    const { host } = await draw(spec())
    if (said) expect(logged[said]).toHaveBeenCalled()
    for (const text of shown) expect(host.textContent).toContain(text)
    if (hidden) expect(host.textContent).not.toContain(hidden)
    if (also) expect(host.querySelector(also)).not.toBeNull()
    if (cells) expect([...host.querySelectorAll('tbody td')].map((cell) => cell.textContent)).toEqual(cells)
  })

  it.each([
    {
      name: 'pressing a Button',
      spec: view({ button: { type: 'Button', props: { label: 'Yes', say: 'Yes, book it' } } }),
      use: async (host: HTMLElement) => {
        await press(button(host, 'Yes'))
        await press(button(host, 'Yes'))
      },
      // A button says its words at each press.
      said: [['Yes, book it'], ['Yes, book it']]
    },
    {
      name: 'picking the answer of one question, sent at once',
      spec: checked(
        view({
          questions: {
            type: 'Questions',
            props: { questions: [{ question: 'Which one?', options: [{ label: 'Red', recommended: true }, { label: 'Blue' }] }] }
          }
        })
      ),
      use: async (host: HTMLElement) => {
        const [red, blue] = host.querySelectorAll('[role="option"]')
        await press(blue)
        // Once picked, it is answered: another answer says nothing.
        await press(red)
      },
      said: [['Which one? Blue']]
    },
    {
      name: 'answering one question with the keys',
      spec: checked(
        view({ questions: { type: 'Questions', props: { questions: [{ question: 'Which one?', options: [{ label: 'Red' }, { label: 'Blue' }] }] } } })
      ),
      use: async (host: HTMLElement) => {
        const [red] = host.querySelectorAll<HTMLElement>('[role="option"]')
        red?.focus()
        await key('ArrowDown')
        await key('Enter')
      },
      said: [['Which one? Blue']]
    },
    {
      name: 'the exact words of an answer that waits for them',
      spec: checked(
        view({
          questions: {
            type: 'Questions',
            props: {
              questions: [
                {
                  options: [
                    { label: 'Allow once', say: 'Allow once.' },
                    { label: 'No', say: 'No.' }
                  ],
                  other: false
                }
              ]
            }
          }
        })
      ),
      use: async (host: HTMLElement) => {
        expect(other(host)).toEqual([])
        await press(host.querySelectorAll('[role="option"]')[1])
      },
      said: [['No.']]
    },
    {
      name: 'several questions, sent together once each has an answer',
      spec: checked(
        view({
          questions: {
            type: 'Questions',
            props: {
              questions: [
                { question: 'Build it?', options: [{ label: 'Yes', recommended: true }, { label: 'Not yet' }] },
                { question: 'Which parts?', multiple: true, options: [{ label: 'Code' }, { label: 'Tests' }, { label: 'Spec' }] }
              ]
            }
          }
        })
      ),
      use: async (host: HTMLElement) => {
        const [yes, , code, , spec] = host.querySelectorAll('[role="option"]')
        await press(yes)
        expect(button(host, 'Send')?.disabled).toBe(true)
        await press(code)
        await press(spec)
        await type(other(host)[1] as HTMLInputElement, 'the docs')
        await press(button(host, 'Send'))
        await press(button(host, 'Sent'))
      },
      said: [['Build it? Yes\nWhich parts? Code, Spec, the docs']]
    },
    {
      name: 'an answer typed in place of one to pick',
      spec: checked(
        view({ questions: { type: 'Questions', props: { questions: [{ question: 'Which one?', options: [{ label: 'Red' }, { label: 'Blue' }] }] } } })
      ),
      use: async (host: HTMLElement) => {
        expect(button(host, 'Send')).toBeUndefined()
        await type(other(host)[0] as HTMLInputElement, 'Green')
        await press(button(host, 'Send'))
      },
      said: [['Which one? Green']]
    },
    {
      name: 'sending a Field',
      spec: view({ field: { type: 'Field', props: { label: 'Where to', say: 'Book a table in', placeholder: 'A city' } } }),
      use: async (host: HTMLElement) => {
        await type(host.querySelector('input') as HTMLInputElement, ' Lyon ')
        await press(button(host, 'Send'))
      },
      said: [['Book a table in Lyon']]
    }
  ])('says the words of $name, once each', async ({ spec, use, said }) => {
    const { host, actions } = await draw(spec)
    await use(host)
    expect(vi.mocked(actions.say).mock.calls).toEqual(said)
  })

  it("names a Field's input by its label", async () => {
    const { host } = await draw(view({ field: { type: 'Field', props: { label: 'Where to', say: 'Book in' } } }))
    const input = host.querySelector('input')
    const label = host.querySelector('label')
    expect(label?.textContent).toBe('Where to')
    expect(label?.htmlFor).toBe(input?.id)
  })
})
