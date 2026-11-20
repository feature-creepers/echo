import { google } from './google.ts'
import { microsoft } from './microsoft.ts'
import type { Provider } from './provider.ts'

/** Every provider this package has, in the order the Accounts page offers them. */
export const knownProviders = (): readonly Provider[] => [google, microsoft]
