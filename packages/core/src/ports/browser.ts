/**
 * A web browser the assistant drives: a real one installed on the computer, with a window the person sees and
 * a profile of its own, so the sites they sign in to there stay signed in (docs/SPEC.md, section 12.1).
 *
 * The adapter only carries out. What may be done, and what is asked first, is the core's to decide: it reads
 * what an element is with `inspect` before any action on it.
 *
 * Elements are named by the references of the latest outline (`snapshot`), such as `e12`. An action also takes
 * a new outline, so the references it reports are those to use next.
 *
 * Every method but `find`, `running` and `close` starts the browser when it is not running. A method rejects with
 * an `Error` whose message is written for a model to act on: "There is no element e12: take a new snapshot."
 */
export interface Browser {
  /** Which browser this computer would run, found without starting it. */
  find(): Promise<BrowserFound>
  /** Whether it is running now, its window open. */
  running(): boolean
  /** Bring the window forward, starting the browser if needed, for the person to use themselves: to sign in to their sites. */
  show(): Promise<PageFacts>
  /** Go to an address, in the tab in front or in a new one. */
  go(url: string, tab: 'current' | 'new'): Promise<PageFacts>
  /** The page's main content as text, from a character on, at most `length` of them. */
  read(from: number, length: number): Promise<PageText>
  /** What can be used on the page, as an outline with a reference for each element, at most `length` characters. */
  snapshot(length: number): Promise<PageOutline>
  /** What the window shows of the page now. */
  screenshot(): Promise<PageImage>
  /** Scroll the page by about a screenful, or bring an element into view. */
  scroll(how: { direction: 'up' | 'down'; screens: number } | { ref: string }): Promise<PageFacts>
  /** Go back to the previous page of the tab in front. */
  back(): Promise<PageFacts>
  /** The open tabs, in order. */
  tabs(): Promise<TabFacts[]>
  /** Bring a tab to the front, or close it, by its position among `tabs()`. */
  tab(index: number, change: 'select' | 'close'): Promise<PageFacts>
  /** Wait for a text to appear on the page, or for a time, up to `ms` milliseconds. Rejects when the text did not appear. */
  wait(until: { text: string; ms: number } | { ms: number }): Promise<PageFacts>
  /**
   * What an element of the latest outline is, for the core to decide whether to act on it; with no reference, the
   * element that has the focus. Nothing when there is no such element.
   */
  inspect(ref: string | undefined): Promise<ElementFacts | undefined>
  click(ref: string): Promise<ActionOutcome>
  /** Type into a field, replacing what it holds, then press Enter when `submit`. */
  type(ref: string, text: string, submit: boolean): Promise<ActionOutcome>
  /** Choose options of a list by their labels or values. */
  select(ref: string, values: readonly string[]): Promise<ActionOutcome>
  /** Press a key or a combination ("Enter", "Escape", "Control+A"), on an element or wherever the focus is. */
  press(key: string, ref?: string): Promise<ActionOutcome>
  /** Give files, by absolute path, to a file field. */
  upload(ref: string, paths: readonly string[]): Promise<ActionOutcome>
  /** Close the browser. Resolves once it is closed. The next use starts it again. */
  close(): Promise<void>
}

/** The browser this computer would run: its name for the person, and where it is. */
export type BrowserFound = { found: true; name: string; path: string } | { found: false; problem: string }

/** Where the tab in front is. */
export interface PageFacts {
  url: string
  title: string
}

/** A page's main content as text, and how much of it there is. */
export interface PageText extends PageFacts {
  text: string
  /** The first character given, and how many characters the content has in all. */
  from: number
  total: number
}

/** What can be used on a page, one element per line with its reference, indented as the page nests them. */
export interface PageOutline extends PageFacts {
  outline: string
  /** Whether the outline was cut to the length asked. */
  cut: boolean
}

export interface PageImage extends PageFacts {
  /** The picture, encoded in base 64. */
  data: string
  mime: 'image/jpeg' | 'image/png'
}

export interface TabFacts extends PageFacts {
  /** Whether it is the tab in front. */
  current: boolean
}

/** What an action did: where the tab in front is now, and what is new on the page, as outline lines with their references. */
export interface ActionOutcome extends PageFacts {
  changes: string[]
}

/** What an element of a page is, as far as deciding whether to act on it needs. Every text comes from the page. */
export interface ElementFacts {
  ref: string
  /** Its role, as assistive technology reads it: button, link, textbox, combobox, checkbox. */
  role: string
  /** Its accessible name: "Add to cart", "Search". */
  name: string
  /** Its visible text, shortened. */
  text: string
  /** Its tag, in lower case: button, a, input. */
  tag: string
  /** A field's `type` attribute, in lower case: password, email, submit. */
  type?: string | undefined
  /** A field's `autocomplete` attribute, in lower case: "current-password", "cc-number". */
  autocomplete?: string | undefined
  /** What else names it in the page's code and for the person: its name and id attributes, placeholder, title, label. */
  hints: string[]
  /** Whether using it sends its form: a submit button, or a field of a form that Enter sends. */
  submits: boolean
  /** The form it belongs to: the words of its submit buttons, and where it sends. */
  form?: { submits: string[]; action?: string | undefined } | undefined
  /** The page it is on. */
  page: PageFacts
}
