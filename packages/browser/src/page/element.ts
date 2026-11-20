/**
 * What an element is: everything the core needs to decide whether to act on it, but its reference and the page,
 * which the adapter adds.
 */
interface ElementReading {
  tag: string
  type: string | undefined
  autocomplete: string | undefined
  /** Its role and name, as far as the page's markup says, for an element no outline named: the one with the focus. */
  role: string
  name: string
  text: string
  hints: string[]
  submits: boolean
  form: { submits: string[]; action: string | undefined } | undefined
  /** Whether it is a file field, which takes files directly rather than through the system's picker. */
  fileField: boolean
}

/**
 * What an element is, read inside the page. Playwright sends this function to the page as its source text, so it
 * must stand alone: no import, no function of this module, nothing from outside but its argument.
 */
export function readElement(element: Element): ElementReading {
  const clean = (value: string | null | undefined, length = 200) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, length)
  const tag = element.tagName.toLowerCase()
  const field = element as HTMLInputElement
  const type = element.getAttribute('type')?.toLowerCase() ?? (tag === 'input' ? 'text' : undefined)
  const autocomplete = element.getAttribute('autocomplete')?.toLowerCase() ?? undefined
  // biome-ignore lint/performance/useDomNodeTextContent: what the person sees, without what the page hides
  const visible = element instanceof HTMLElement ? element.innerText : element.textContent
  const labels = 'labels' in field && field.labels ? [...field.labels].map((label) => clean(label.textContent)) : []
  const pressable = (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type ?? '')) || tag === 'button'
  const hints = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('placeholder'),
    element.getAttribute('name'),
    element.id,
    element.getAttribute('data-testid'),
    pressable ? element.getAttribute('value') : null,
    ...labels
  ]
    .map((hint) => clean(hint))
    .filter((hint) => hint !== '')

  const form = 'form' in field && field.form ? field.form : element.closest('form')
  const isSubmit = (candidate: Element) => {
    const kind = candidate.getAttribute('type')?.toLowerCase()
    return (
      (candidate.tagName === 'BUTTON' && (kind === null || kind === undefined || kind === 'submit')) ||
      (candidate.tagName === 'INPUT' && (kind === 'submit' || kind === 'image'))
    )
  }
  const words = (candidate: Element) =>
    clean(
      candidate.textContent ||
        candidate.getAttribute('value') ||
        candidate.getAttribute('aria-label') ||
        candidate.getAttribute('title') ||
        candidate.getAttribute('alt')
    )
  const textTypes = ['text', 'search', 'email', 'url', 'tel', 'number', 'password', 'date', 'datetime-local', 'month', 'week', 'time']
  const typedIn = tag === 'input' && textTypes.includes(type ?? 'text')
  const submits = form !== null && (isSubmit(element) || typedIn)

  // A role and a name from the markup alone: the outline's, from the accessibility tree, are better and are used when there.
  const implicit: Record<string, string> = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button' }
  const inputRole: Record<string, string> = { checkbox: 'checkbox', radio: 'radio', search: 'searchbox', range: 'slider', number: 'spinbutton' }
  const role =
    element.getAttribute('role') ??
    (tag === 'input'
      ? (inputRole[type ?? 'text'] ?? (pressable ? 'button' : 'textbox'))
      : (implicit[tag] ?? (element instanceof HTMLElement && element.isContentEditable ? 'textbox' : 'generic')))

  return {
    tag,
    type,
    autocomplete,
    role,
    name: hints[0] ?? clean(visible, 100),
    text: clean(visible),
    hints,
    submits,
    form: form
      ? { submits: [...form.elements].filter(isSubmit).map(words).filter(Boolean), action: form.getAttribute('action') ? form.action : undefined }
      : undefined,
    fileField: tag === 'input' && type === 'file'
  }
}
