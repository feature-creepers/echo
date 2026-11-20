import type { ElementFacts } from '../ports/browser.ts'

/**
 * What a page's element reads as, when acting on it has a consequence the person must see coming: it pays for
 * something, it sends or publishes something in their name, or it deletes something. Such an action is asked
 * first at every level of trust (docs/SPEC.md, section 12.2).
 *
 * The page names its own buttons, so this is a reading of words, not a guarantee: it errs towards asking. A
 * button called "Order by date" asks too, which costs a click; a payment that went unasked would cost more.
 */
export type Consequence = 'pays' | 'sends' | 'deletes'

/**
 * The words, by consequence, in English and French first, then German, Spanish and Italian. Each is matched as
 * whole words, after accents are dropped and the case is ignored, so "Payer maintenant" matches "payer" and
 * "Repay" matches nothing. A phrase matches only as a whole.
 */
const WORDS: Record<Consequence, readonly string[]> = {
  pays: [
    // English
    'buy',
    'buying',
    'purchase',
    'purchasing',
    'pay',
    'paying',
    'payment',
    'checkout',
    'check out',
    'order',
    'subscribe',
    'subscription',
    'donate',
    'transfer',
    'rent',
    'book now',
    // French
    'acheter',
    'achetez',
    'achat',
    'payer',
    'payez',
    'paiement',
    'regler',
    'reglez',
    'commander',
    'commandez',
    'commande',
    'souscrire',
    'abonner',
    'abonnez',
    'abonnement',
    'virement',
    'transferer',
    'faire un don',
    'louer',
    'reserver',
    // German
    'kaufen',
    'bezahlen',
    'zahlen',
    'bestellen',
    'zahlungspflichtig',
    'abonnieren',
    'uberweisen',
    // Spanish
    'comprar',
    'pagar',
    'pedido',
    'suscribirse',
    'transferir',
    // Italian
    'acquista',
    'compra',
    'paga',
    'ordina',
    'abbonati',
    'trasferisci'
  ],
  sends: [
    'send',
    'post',
    'publish',
    'share',
    'tweet',
    'envoyer',
    'envoyez',
    'publier',
    'publiez',
    'poster',
    'partager',
    'partagez',
    'senden',
    'absenden',
    'veroffentlichen',
    'teilen',
    'enviar',
    'publicar',
    'compartir',
    'invia',
    'pubblica',
    'condividi'
  ],
  deletes: ['delete', 'remove', 'erase', 'supprimer', 'supprimez', 'effacer', 'retirer', 'loschen', 'entfernen', 'eliminar', 'borrar', 'elimina', 'rimuovi']
}

/**
 * Text as words to match: accents dropped, camel case and every mark between words turned into spaces, in lower
 * case, with a space at each end. "placeOrder-button" reads " place order button ".
 */
export function wordsOf(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return ` ${plain} `
}

const MATCHERS = Object.entries(WORDS).map(([consequence, words]) => ({
  consequence: consequence as Consequence,
  words: words.map((word) => wordsOf(word))
}))

/** What these texts read as, the first consequence found in the order pays, sends, deletes; nothing when none. */
export function consequenceOf(texts: readonly (string | undefined)[]): Consequence | undefined {
  const read = texts.filter((text): text is string => typeof text === 'string' && text.trim() !== '').map(wordsOf)
  return MATCHERS.find(({ words }) => read.some((text) => words.some((word) => text.includes(word))))?.consequence
}

/** The words of an address worth reading: its host and path, not its query, which repeats what was typed. */
function addressWords(address: string | undefined): string | undefined {
  if (!address) return undefined
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(address)
  return match ? `${match[1]} ${match[2]}` : address.split(/[?#]/)[0]
}

/**
 * What acting on an element would do, read from the element itself and, when using it sends its form, from
 * the form's submit buttons and the address it sends to.
 *
 * - A click reads the element: its accessible name, text and hints.
 * - Typing then Enter, or Enter pressed in a field, sends the form: the form is read, not the field, so a field
 *   called "Postcode" asks nothing while a form whose button says "Pay" does.
 * - A click on a submit button reads both.
 */
export function consequenceOfAct(element: ElementFacts, act: { kind: 'click' | 'select' } | { kind: 'enter' }): Consequence | undefined {
  const own = act.kind === 'enter' ? [] : [element.name, element.text, ...element.hints]
  const sendsForm = act.kind === 'enter' ? element.submits : act.kind === 'click' && element.submits
  const form = sendsForm && element.form ? [...element.form.submits, addressWords(element.form.action)] : []
  return consequenceOf([...own, ...form])
}

/** A field the assistant never types into: the person signs in and pays themselves. */
export type Secret = 'password' | 'card'

const PASSWORD_AUTOCOMPLETE = ['current-password', 'new-password', 'one-time-code']
const CARD_AUTOCOMPLETE = ['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year']

const PASSWORD_WORDS = ['password', 'passwd', 'passcode', 'mot de passe', 'mdp', 'passwort', 'contrasena', 'one time code'].map(wordsOf)
const CARD_WORDS = [
  'cardnumber',
  'card number',
  'card no',
  'ccnumber',
  'cc number',
  'cc num',
  'credit card',
  'debit card',
  'cvc',
  'cvc2',
  'cvv',
  'cvv2',
  'csc',
  'security code',
  'card verification',
  'numero de carte',
  'numero carte',
  'carte bancaire',
  'cryptogramme',
  'code de securite',
  'kartennummer',
  'numero de tarjeta'
].map(wordsOf)

/**
 * Whether a field holds a password or a payment card's details, from its type, its `autocomplete` tokens, and
 * the words that name it. A field shown as plain text to reveal a password still says so in its name.
 */
export function secretOf(element: ElementFacts): Secret | undefined {
  const tokens = (element.autocomplete ?? '').split(/\s+/)
  if (element.type === 'password' || tokens.some((token) => PASSWORD_AUTOCOMPLETE.includes(token))) return 'password'
  if (tokens.some((token) => CARD_AUTOCOMPLETE.includes(token))) return 'card'
  // Only a field takes typing: a button that says "Forgot your password?" is no secret.
  if (!['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(element.role) && !['input', 'textarea'].includes(element.tag)) return undefined
  return secretOfWords([element.name, ...element.hints])
}

/** Whether the words that name a field say it takes a password or a payment card's details. */
export function secretOfWords(texts: readonly string[]): Secret | undefined {
  const read = texts.map(wordsOf)
  if (read.some((text) => PASSWORD_WORDS.some((word) => text.includes(word)))) return 'password'
  if (read.some((text) => CARD_WORDS.some((word) => text.includes(word)))) return 'card'
  return undefined
}
