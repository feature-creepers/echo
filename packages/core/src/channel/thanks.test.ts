import { describe, expect, it } from 'vitest'
import { isThanks } from './thanks.ts'

describe('a thank you', () => {
  it.each([
    ['Thanks', true],
    ['Thank you!', true],
    ['thank you so much', true],
    ['Ok, thanks.', true],
    ['Great, thanks a lot', true],
    ['Thanks Ada', true],
    ['Merci Ada', true],
    ['Merci beaucoup !', true],
    ["Parfait, merci c'est top", true],
    ['Muchas gracias', true],
    ['Danke schön', true],
    ['Vielen Dank', true],
    ['Grazie mille', true],
    ['Muito obrigada', true],
    ['Dank je wel', true],
    // Going on, or not thanking.
    ['Thanks, and what about the weather?', false],
    ['Merci, et la météo ?', false],
    ['Thank him for me', false],
    ['You', false],
    ['Great', false],
    ['', false]
  ])('%j is %s', (said, thanks) => {
    expect(isThanks(said, ['Ada', 'Grace'])).toBe(thanks)
  })
})
