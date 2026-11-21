import { randomUUID } from 'node:crypto'
import { protocol, type WebContents } from 'electron'

/**
 * Where widget apps run (docs/SPEC.md, section 9.9). The window hands over each page with its security policy, and the
 * page is served at an address of its own on this scheme, so the policy is a header no page can loosen. A widget's
 * frame never navigates anywhere else, and its sandbox keeps it from the window, its storage and every other frame.
 */

export const WIDGET_SCHEME = 'echo-widget'

/** How many pages are kept to be served: a page is served again when its frame reloads. */
const KEPT = 64

/** Make the scheme a secure, standard one, as a page served from it needs. Called before the app is ready. */
export function registerWidgetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: WIDGET_SCHEME, privileges: { standard: true, secure: true } }])
}

/** Serve the pages the window hands over, and keep every frame of the window on them. */
export function serveWidgetFrames(contents: WebContents): { frame(page: string, policy: string): string } {
  const pages = new Map<string, { page: string; policy: string }>()
  protocol.handle(WIDGET_SCHEME, (request) => {
    const found = pages.get(new URL(request.url).hostname)
    if (!found) return new Response('Not found.', { status: 404 })
    return new Response(found.page, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': found.policy,
        'x-dns-prefetch-control': 'off',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store'
      }
    })
  })
  // The window's own page never navigates (index.ts); a frame stays on the pages served here.
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !event.url.startsWith(`${WIDGET_SCHEME}://`)) event.preventDefault()
  })
  return {
    frame(page, policy) {
      const id = `w${randomUUID().replaceAll('-', '')}`
      pages.set(id, { page, policy })
      for (const old of pages.keys()) {
        if (pages.size <= KEPT) break
        pages.delete(old)
      }
      return `${WIDGET_SCHEME}://${id}/`
    }
  }
}
