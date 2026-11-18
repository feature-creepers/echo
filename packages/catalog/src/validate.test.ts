import { describe, expect, it } from 'vitest'
import { EXAMPLE_VIEW } from './instructions.ts'
import { MAX_DEPTH, validateView } from './validate.ts'

const problems = (written: unknown) => {
  const result = validateView(written)
  return result.ok ? [] : result.problems
}

const view = (elements: Record<string, { type: string; props?: unknown; children?: string[] }>, root = 'all') => ({ root, elements })

describe('validateView', () => {
  it('accepts the example given to models, and fills in the defaults', () => {
    const result = validateView(EXAMPLE_VIEW)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.spec.elements.all).toEqual({ type: 'Stack', props: { gap: 'normal', align: 'stretch' }, children: ['title', 'now', 'week'] })
    expect(result.spec.elements.temp?.props).toMatchObject({ label: 'Now', value: '21', unit: '°C', tone: 'normal' })
  })

  it('explains the format when what was written is not a view at all', () => {
    expect(problems('a weather card')).toHaveLength(1)
    expect(problems({ root: 'all' })[0]).toContain('"root"')
  })

  it('names the blocks that exist when one does not', () => {
    const [problem] = problems(view({ all: { type: 'WeatherCard' } }))
    expect(problem).toContain('there is no block named "WeatherCard"')
    expect(problem).toContain('Metric')
  })

  it('says which property of which element is wrong', () => {
    const found = problems(view({ all: { type: 'Stack', children: ['m'] }, m: { type: 'Metric', props: { label: 'Now', value: 21 } } }))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^"m" \(Metric\): value: /)
  })

  it('refuses a property the block does not have, so a model learns it does nothing', () => {
    const found = problems(view({ all: { type: 'Text', props: { text: 'Hello', color: 'red' } } }))
    expect(found.join(' ')).toContain('color')
  })

  it('refuses colours that are not roles of the app', () => {
    const found = problems(view({ all: { type: 'Text', props: { text: 'Hello', tone: '#ff0000' } } }))
    expect(found[0]).toMatch(/^"all" \(Text\): tone: /)
  })

  it.each([
    ['a root that does not exist', view({ a: { type: 'Divider' } }, 'missing'), 'The root "missing" is not one of the elements.'],
    ['a child that does not exist', view({ all: { type: 'Stack', children: ['ghost'] } }), '"all" contains "ghost", which is not one of the elements.'],
    [
      'children in a block that takes none',
      view({ all: { type: 'Text', props: { text: 'x' }, children: ['b'] }, b: { type: 'Divider' } }),
      '"all" (Text) cannot contain other elements.'
    ],
    ['an element that contains itself', view({ all: { type: 'Stack', children: ['all'] } }), '"all" contains itself: all → all.'],
    [
      'an element in two places',
      view({
        all: { type: 'Stack', children: ['a', 'b'] },
        a: { type: 'Stack', children: ['x'] },
        b: { type: 'Stack', children: ['x'] },
        x: { type: 'Divider' }
      }),
      '"x" is inside two elements. An element goes in one place.'
    ],
    [
      'an element that would never show',
      view({ all: { type: 'Stack' }, lost: { type: 'Divider' } }),
      'These elements are in no other element and are not the root, so they would not show: lost.'
    ],
    [
      'a card directly inside a card',
      view({ all: { type: 'Card', children: ['inner'] }, inner: { type: 'Card' } }),
      '"all" is a Card directly inside a Card ("inner"). Use a Section, or put the cards side by side.'
    ]
  ])('refuses %s', (_what, written, problem) => {
    expect(problems(written)).toContain(problem)
  })

  it('refuses a view nested too deep', () => {
    const elements: Record<string, { type: string; children?: string[] }> = {}
    for (let level = 0; level <= MAX_DEPTH; level++) elements[`n${level}`] = { type: 'Stack', children: level < MAX_DEPTH ? [`n${level + 1}`] : [] }
    expect(problems({ root: 'n0', elements }).join(' ')).toContain('levels deep')
  })

  it('reports every problem at once', () => {
    const found = problems(view({ all: { type: 'Stack', children: ['a', 'b'] }, a: { type: 'Nope' }, b: { type: 'Metric', props: {} } }))
    expect(found.length).toBeGreaterThanOrEqual(3)
  })

  it('refuses a drawing whose path is anything else than path commands', () => {
    const drawing = (d: string) => view({ all: { type: 'Drawing', props: { width: 10, height: 10, label: 'x', shapes: [{ shape: 'path', d }] } } })
    expect(problems(drawing('M0 0 L10 10 Z'))).toEqual([])
    expect(problems(drawing('M0 0" onload="alert(1)')).length).toBeGreaterThan(0)
  })

  it('refuses an image that is not served over https', () => {
    const image = (url: string) => view({ all: { type: 'Image', props: { url, alt: 'x' } } })
    expect(problems(image('https://example.com/a.png'))).toEqual([])
    expect(problems(image('javascript:alert(1)')).length).toBeGreaterThan(0)
    expect(problems(image('file:///etc/passwd')).length).toBeGreaterThan(0)
  })

  it('plays media only from an https address', () => {
    const media = (url: string) => problems(view({ all: { type: 'Media', props: { url, title: 'A station', live: true } } }))
    expect(media('https://example.org/live.aac')).toEqual([])
    expect(media('http://example.org/live.aac')[0]).toMatch(/^"all" \(Media\): url: Give an https:\/\/ address/)
  })

  describe('a button', () => {
    const button = (props: Record<string, unknown>) => problems(view({ all: { type: 'Button', props: { label: 'Play', ...props } } }))

    it.each([
      ['says something to the assistant', { say: 'Play the next one.' }],
      ['presses a media key', { act: [{ key: 'MediaPlayPause' }] }],
      ['raises the sound by a few steps', { act: [{ key: 'VolumeUp', times: 5 }] }],
      [
        'opens a playlist, then starts it',
        { act: [{ open: 'spotify:playlist:37i9dQZF1DX4kZR8vL5oVX' }, { click: 'Play', app: 'Spotify', role: 'button', within: 8 }] }
      ],
      ['opens a page', { act: [{ open: 'https://example.org/live' }] }],
      ['waits between two steps', { act: [{ open: 'zoommtg://zoom.us/join?confno=1' }, { wait: 2 }, { key: 'VolumeMute' }] }]
    ])('that %s is accepted', (_what, props) => {
      expect(button(props)).toEqual([])
    })

    it.each([
      ['neither says nor acts', {}, 'Give the button `say` or `act`, one of the two.'],
      ['both says and acts', { say: 'Pause.', act: [{ key: 'MediaPlayPause' }] }, 'Give the button `say` or `act`, one of the two.'],
      ['presses a key that is not a system key', { act: [{ key: 'Control+W' }] }, 'act.0'],
      ['opens a file', { act: [{ open: 'file:///C:/Windows/System32/calc.exe' }] }, 'A widget never opens file: links'],
      ['opens a page of the system', { act: [{ open: 'ms-settings:privacy' }] }, 'A widget never opens ms-settings: links'],
      ['opens a script', { act: [{ open: 'javascript:alert(1)' }] }, 'A widget never opens javascript: links'],
      ['opens a page over an open connection', { act: [{ open: 'http://example.org' }] }, 'Give the https:// address of the page.'],
      ['opens what is not a link', { act: [{ open: 'my playlist' }] }, 'Give a link with its scheme'],
      ['clicks with no app named', { act: [{ click: 'Play' }] }, 'act.0'],
      ['carries a step of its own invention', { act: [{ run: 'shutdown /s' }] }, 'act.0'],
      ['takes too many steps', { act: Array.from({ length: 7 }, () => ({ key: 'VolumeUp' })) }, 'act'],
      ['waits too long in all', { act: [{ wait: 10 }, { click: 'Play', app: 'Spotify', within: 15 }] }, 'A press waits 20 seconds at most in all']
    ])('that %s is refused', (_what, props, problem) => {
      expect(button(props).join(' ')).toContain(problem)
    })
  })
})
