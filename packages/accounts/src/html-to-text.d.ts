// html-to-text ships no types: the one function used here, as its documentation describes it.
declare module 'html-to-text' {
  interface Selector {
    selector: string
    format?: string
    options?: Record<string, unknown>
  }
  export function convert(html: string, options?: { wordwrap?: number | false; selectors?: Selector[] }): string
}
