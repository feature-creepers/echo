import { describe, expect, it } from 'vitest'
import type { ElementFacts } from '../ports/browser.ts'
import { consequenceOf, consequenceOfAct, secretOf, wordsOf } from './sensitive.ts'

/** An element as the adapter reads it, with what a case changes. */
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

describe('the words of an element', () => {
  it.each([
    ['placeOrder-button', ' place order button '],
    ['Payer maintenant', ' payer maintenant '],
    ['  SUPPRIMER  le compte ', ' supprimer le compte '],
    ['Überweisen', ' uberweisen '],
    ['checkout_v2', ' checkout v2 ']
  ])('reads %j as %j', (text, words) => {
    expect(wordsOf(text)).toBe(words)
  })
})

describe('what a button reads as', () => {
  it.each([
    // Paying, in the languages read.
    ['Buy now', 'pays'],
    ['Place your order', 'pays'],
    ['Proceed to checkout', 'pays'],
    ['Check out', 'pays'],
    ['Pay €12.99', 'pays'],
    ['Confirm payment', 'pays'],
    ['Subscribe', 'pays'],
    ['Start my subscription', 'pays'],
    ['Transfer money', 'pays'],
    ['Rent HD €3.99', 'pays'],
    ['Acheter maintenant', 'pays'],
    ['Passer la commande', 'pays'],
    ['Valider le paiement', 'pays'],
    ['Payer', 'pays'],
    ["S'abonner", 'pays'],
    ['Effectuer un virement', 'pays'],
    ['Faire un don', 'pays'],
    ['Zahlungspflichtig bestellen', 'pays'],
    ['Jetzt kaufen', 'pays'],
    ['Comprar ahora', 'pays'],
    ['Acquista ora', 'pays'],
    // Sending and publishing.
    ['Send', 'sends'],
    ['Post', 'sends'],
    ['Publish', 'sends'],
    ['Share', 'sends'],
    ['Envoyer le message', 'sends'],
    ['Publier', 'sends'],
    ['Partager', 'sends'],
    ['Absenden', 'sends'],
    ['Enviar', 'sends'],
    // Deleting.
    ['Delete account', 'deletes'],
    ['Remove from basket', 'deletes'],
    ['Supprimer', 'deletes'],
    ['Effacer l’historique', 'deletes'],
    ['Löschen', 'deletes'],
    ['Eliminar', 'deletes'],
    // Nothing to worry about: whole words only.
    ['Add to cart', undefined],
    ['Search', undefined],
    ['Next', undefined],
    ['Sign in', undefined],
    ['Play', undefined],
    ['Repay later', undefined],
    ['Postcode', undefined],
    ['Sender', undefined],
    ['Unsubscribe', undefined],
    ['Paypal', undefined],
    ['Ajouter au panier', undefined],
    ['Rechercher', undefined],
    ['', undefined]
  ])('%j reads as %j', (text, consequence) => {
    expect(consequenceOf([text])).toBe(consequence)
  })

  it('reads every text given, the first consequence winning in the order pays, sends, deletes', () => {
    expect(consequenceOf(['Next', undefined, 'Delete', 'Pay'])).toBe('pays')
    expect(consequenceOf([undefined, ''])).toBeUndefined()
  })
})

describe('what acting on an element reads as', () => {
  const field = element({ role: 'textbox', tag: 'input', type: 'text', name: 'Postcode', submits: true })

  it('reads a clicked element by its name, its text and its hints', () => {
    expect(consequenceOfAct(element({ name: 'Continue' }), { kind: 'click' })).toBeUndefined()
    expect(consequenceOfAct(element({ name: 'Continue', text: 'Continue to payment' }), { kind: 'click' })).toBe('pays')
    expect(consequenceOfAct(element({ name: '', hints: ['buy-now-button'] }), { kind: 'click' })).toBe('pays')
  })

  it('reads the form of a submit button clicked, and where the form sends', () => {
    const form = { submits: ['Continue'], action: 'https://shop.example/checkout/step2?ref=pay' }
    expect(consequenceOfAct(element({ name: 'Continue', submits: true, form }), { kind: 'click' })).toBe('pays')
    // A button that does not send its form is read alone.
    expect(consequenceOfAct(element({ name: 'Continue', submits: false, form }), { kind: 'click' })).toBeUndefined()
  })

  it('reads the query of an address as nothing: it repeats what was typed', () => {
    const form = { submits: ['Search'], action: 'https://search.example/find?q=buy+a+car' }
    expect(consequenceOfAct(element({ ...field, form }), { kind: 'enter' })).toBeUndefined()
  })

  it('reads the form, not the field, when Enter sends it', () => {
    expect(consequenceOfAct({ ...field, form: { submits: ['Search'], action: undefined } }, { kind: 'enter' })).toBeUndefined()
    expect(consequenceOfAct({ ...field, form: { submits: ['Pay now'], action: undefined } }, { kind: 'enter' })).toBe('pays')
    expect(consequenceOfAct({ ...field, name: 'Message', form: { submits: ['Envoyer'], action: undefined } }, { kind: 'enter' })).toBe('sends')
    // A field outside any form sends nothing by itself.
    expect(consequenceOfAct({ ...field, submits: false, form: undefined }, { kind: 'enter' })).toBeUndefined()
  })

  it('reads a list chosen from by its own words', () => {
    expect(consequenceOfAct(element({ role: 'combobox', tag: 'select', name: 'Colour' }), { kind: 'select' })).toBeUndefined()
  })
})

describe('fields never typed into', () => {
  const textbox = (facts: Partial<ElementFacts>) => element({ role: 'textbox', tag: 'input', type: 'text', ...facts })

  it.each([
    ['a password field', textbox({ type: 'password', name: 'Password' }), 'password'],
    ['a password shown as text, by its autocomplete', textbox({ autocomplete: 'current-password' }), 'password'],
    ['a new password', textbox({ autocomplete: 'new-password' }), 'password'],
    ['a one-time code', textbox({ autocomplete: 'one-time-code' }), 'password'],
    ['a password shown as text, by its name', textbox({ name: 'Mot de passe' }), 'password'],
    ['a password field named in its code', textbox({ hints: ['user_password'] }), 'password'],
    ['a card number, by its autocomplete', textbox({ autocomplete: 'cc-number' }), 'card'],
    ['a security code, by its autocomplete', textbox({ autocomplete: 'section-pay cc-csc' }), 'card'],
    ['an expiry month', element({ role: 'combobox', tag: 'select', autocomplete: 'cc-exp-month' }), 'card'],
    ['a card number named in its code', textbox({ hints: ['cardnumber'] }), 'card'],
    ['a card number in French', textbox({ name: 'Numéro de carte' }), 'card'],
    ['a security code by its label', textbox({ name: 'CVC' }), 'card'],
    ['a cryptogram', textbox({ name: 'Cryptogramme visuel' }), 'card'],
    ['an email address', textbox({ name: 'Email', autocomplete: 'username' }), undefined],
    ['a search box', element({ role: 'searchbox', tag: 'input', type: 'search', name: 'Search' }), undefined],
    ['the name on a card', textbox({ autocomplete: 'cc-name', name: 'Name on card' }), undefined],
    ['a link to a forgotten password', element({ role: 'link', tag: 'a', name: 'Forgot your password?' }), undefined]
  ])('%s', (_case, facts, secret) => {
    expect(secretOf(facts)).toBe(secret)
  })
})
