import type { Registration } from '@repo/accounts'

/**
 * Each provider's app registration, by provider: the build's configuration, never the repository's. The desktop app
 * writes these into the core it builds (electron-vite's `define`, from the variables set when it is built); a core
 * run from the sources reads them from its environment. A provider left without one is not offered, and says why.
 */
export const registrations: Readonly<Record<string, Registration>> = {
  google: { clientId: process.env.ECHO_GOOGLE_CLIENT_ID, clientSecret: process.env.ECHO_GOOGLE_CLIENT_SECRET },
  microsoft: { clientId: process.env.ECHO_MICROSOFT_CLIENT_ID }
}
