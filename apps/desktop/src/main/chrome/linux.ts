import type { Chrome } from './chrome.ts'
import { overlay } from './win32.ts'

/** Linux draws the same buttons over the title row as Windows does, on a plain ground: it has no common material. */
export const chrome: Chrome = (row) => ({ options: overlay(row), vibrant: false })
