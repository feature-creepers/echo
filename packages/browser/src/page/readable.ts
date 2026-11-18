/**
 * A page's main content as text, read inside the page: its main region or article when it marks one, else its
 * body, without what surrounds the content on every page (navigation, banners, side columns, footers) and
 * without what is hidden. Paragraphs are kept apart by a blank line, and runs of space are made one.
 *
 * Nothing on the page is changed: the person sees the window. Playwright sends this function to the page as
 * its source text, so it must stand alone.
 */
export function readPage(): string {
  const body = document.body
  if (!body) return ''
  // The marked region holding the most text: a page may mark a small panel as main (a search's answer box) and leave its results outside.
  // biome-ignore lint/performance/useDomNodeTextContent: how much text is shown, not how much the page holds hidden
  const length = (element: Element) => (element instanceof HTMLElement ? element.innerText.length : 0)
  const marked = [...document.querySelectorAll('main, [role="main"]'), ...document.querySelectorAll('article')]
  const largest = marked.reduce<Element | undefined>(
    (best, candidate) => (best === undefined || length(candidate) > length(best) ? candidate : best),
    undefined
  )
  // When it holds less than a third of what the page shows, the page is read whole, without what surrounds the content.
  const root = largest && length(largest) * 3 >= length(body) ? largest : body
  // Around the content on every page. A header inside the content (an article's title) stays.
  const around =
    root === body
      ? 'nav, aside, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"]'
      : 'nav, aside, [role="navigation"], [role="complementary"]'
  const never = 'script, style, noscript, template, svg, canvas, iframe, [aria-hidden="true"], [hidden], dialog:not([open])'
  const skipped = `${around}, ${never}`
  const parts: string[] = []
  const collect = (element: Element) => {
    if (element !== root && element.matches(skipped)) return
    // A part that is not shown (a closed menu, a hidden panel) is left out: its text would otherwise be read whole, as if shown.
    if (!element.checkVisibility({ visibilityProperty: true })) return
    // A part with nothing to leave out is read whole, as the page lays it out: the quickest, and the most faithful.
    if (!element.querySelector(skipped)) {
      // biome-ignore lint/performance/useDomNodeTextContent: laid out as the person sees it, with its line breaks, and without what is hidden
      const text = element instanceof HTMLElement ? element.innerText : (element.textContent ?? '')
      if (text.trim()) parts.push(text)
      return
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? ''
        if (text.trim()) parts.push(text)
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        collect(child as Element)
      }
    }
  }
  collect(root)
  return parts
    .join('\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
