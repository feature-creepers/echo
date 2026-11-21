import type { Chrome } from './chrome.ts'

/** The height of the traffic lights, which macOS does not centre in a row by itself. */
const TRAFFIC_LIGHTS = 14

/** macOS: the traffic lights sit at the left of the title row, centred on it. */
export const chrome: Chrome = ({ height }) => ({
  titleBarStyle: 'hidden',
  titleBarOverlay: true,
  trafficLightPosition: { x: 12, y: (height - TRAFFIC_LIGHTS) / 2 }
})
