import type { MiniSystem } from './system.ts'

/** macOS: Mini has no traffic lights, as the proof of concept's had none, and shows on every Space and over apps in full screen. */
export const system: MiniSystem = {
  float(window, on) {
    window.setWindowButtonVisibility(!on)
    window.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on })
  },
  placed: () => true,
  place: (window, bounds) => window.setBounds(bounds)
}
