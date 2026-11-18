import type { Candidate } from './find.ts'

export const MISSING = 'Google Chrome or Chromium is needed, and neither was found on this computer.'

/**
 * Where the browsers are on Linux: Google Chrome, as its own packages install it, then Chromium, as the
 * distributions package it. The Snap comes last: its confinement may keep it from the profile's folder.
 */
export function candidates(): Candidate[] {
  return [
    { name: 'Google Chrome', path: '/opt/google/chrome/chrome' },
    { name: 'Google Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Chromium', path: '/usr/lib/chromium/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Chromium', path: '/snap/bin/chromium' }
  ]
}
