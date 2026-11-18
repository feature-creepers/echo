import { type Chrome, CLEAR } from './chrome.ts'

/** The height of the traffic lights, which macOS does not centre in a row by itself. */
const TRAFFIC_LIGHTS = 14

/**
 * macOS: the traffic lights sit at the left of the title row, centred on it, and the window has the system's
 * sidebar material behind the page, which the page lets through in its side panes.
 */
export const chrome: Chrome = ({ height }) => ({
  options: {
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    trafficLightPosition: { x: 12, y: (height - TRAFFIC_LIGHTS) / 2 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: CLEAR
  },
  vibrant: true
})
