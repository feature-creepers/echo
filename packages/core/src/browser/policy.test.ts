import { describe, expect, it } from 'vitest'
import type { ElementFacts } from '../ports/browser.ts'
import { decidePageAct, type PageAct, type PageVerdict } from './policy.ts'

const element = (facts: Partial<ElementFacts>): ElementFacts => ({
  ref: 'e1',
  role: 'button',
  name: '',
  text: '',
  tag: 'button',
  hints: [],
  submits: false,
  page: { url: 'https://shop.example/', title: 'Shop' },
  ...facts
})

const addToCart = element({ name: 'Add to cart' })
const buyNow = element({ name: 'Buy now' })
const search = element({ role: 'searchbox', tag: 'input', type: 'search', name: 'Search', submits: true, form: { submits: ['Search'], action: undefined } })
const message = element({ role: 'textbox', tag: 'textarea', name: 'Message', submits: false, form: { submits: ['Send'], action: undefined } })
const password = element({
  role: 'textbox',
  tag: 'input',
  type: 'password',
  name: 'Password',
  submits: true,
  form: { submits: ['Sign in'], action: undefined }
})
const card = element({ role: 'textbox', tag: 'input', autocomplete: 'cc-number', name: 'Card number' })
const fileField = element({ role: 'button', tag: 'input', type: 'file', name: 'Choose file' })

const go: PageVerdict = { verdict: 'go' }
const asked: PageVerdict = { verdict: 'ask', always: false }
const always = (because: Extract<PageVerdict, { verdict: 'ask' }>['because']): PageVerdict => ({ verdict: 'ask', always: true, because })

describe('what the core does with an action on a page', () => {
  it.each<[string, PageAct, PageVerdict, PageVerdict]>([
    // An ordinary action follows the person's choice.
    ['a click on "Add to cart"', { kind: 'click', element: addToCart }, asked, go],
    ['typing a search', { kind: 'type', element: search, text: 'lyon weather', submit: false }, asked, go],
    ['typing a search and pressing Enter', { kind: 'type', element: search, text: 'lyon weather', submit: true }, asked, go],
    ['choosing a colour', { kind: 'select', element: element({ role: 'combobox', tag: 'select', name: 'Colour' }), values: ['Red'] }, asked, go],
    ['pressing Space on a video', { kind: 'press', key: 'Space', element: undefined }, asked, go],
    ['pressing Enter in a search', { kind: 'press', key: 'Enter', element: search }, asked, go],
    // Moving about goes ahead, as scrolling does.
    ['pressing Escape', { kind: 'press', key: 'Escape', element: undefined }, go, go],
    ['pressing Page Down', { kind: 'press', key: 'PageDown', element: undefined }, go, go],
    ['pressing Tab out of a password field', { kind: 'press', key: 'Tab', element: password }, go, go],
    // Paying, sending, deleting and giving a file are asked at every level.
    ['a click on "Buy now"', { kind: 'click', element: buyNow }, always('pays'), always('pays')],
    ['a click on "Envoyer"', { kind: 'click', element: element({ name: 'Envoyer' }) }, always('sends'), always('sends')],
    ['a click on "Delete"', { kind: 'click', element: element({ name: 'Delete' }) }, always('deletes'), always('deletes')],
    [
      'typing a message then Enter, in a form that sends',
      { kind: 'type', element: { ...message, submits: true }, text: 'Hello', submit: true },
      always('sends'),
      always('sends')
    ],
    ['typing a message without Enter', { kind: 'type', element: message, text: 'Hello', submit: false }, asked, go],
    ['giving a file', { kind: 'upload', element: fileField, files: ['/data/workspace/cv.pdf'] }, always('upload'), always('upload')],
    // Passwords and cards are never typed, whatever the level.
    [
      'typing a password',
      { kind: 'type', element: password, text: 'hunter2', submit: false },
      { verdict: 'refuse', secret: 'password' },
      { verdict: 'refuse', secret: 'password' }
    ],
    [
      'pressing Enter in a password field',
      { kind: 'press', key: 'Enter', element: password },
      { verdict: 'refuse', secret: 'password' },
      { verdict: 'refuse', secret: 'password' }
    ],
    [
      'pressing a letter in a password field',
      { kind: 'press', key: 'a', element: password },
      { verdict: 'refuse', secret: 'password' },
      { verdict: 'refuse', secret: 'password' }
    ],
    [
      'typing a card number',
      { kind: 'type', element: card, text: '4242 4242 4242 4242', submit: false },
      { verdict: 'refuse', secret: 'card' },
      { verdict: 'refuse', secret: 'card' }
    ]
  ])('%s: asked first, then trusted', (_case, act, whenAsking, whenTrusting) => {
    expect(decidePageAct(act, 'ask')).toEqual(whenAsking)
    expect(decidePageAct(act, 'trust')).toEqual(whenTrusting)
  })
})
