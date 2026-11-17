/**
 * Public addresses on the web, as the core reads them for itself: the shapes a map names, checked before the
 * map is shown. Sessions search and read the web with their harness's own tools; this is not for them.
 */
export interface Web {
  /**
   * Read a public https address. Resolves with its body as text, or with why it could not be read, in words a
   * model can act on. Never rejects.
   */
  read(url: string, limits: { maxBytes: number; timeoutMs: number }): Promise<{ ok: true; text: string } | { ok: false; reason: string }>
}
