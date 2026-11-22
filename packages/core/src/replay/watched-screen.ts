import type { ShownView } from '@repo/protocol'
import { createScreen, type Screen, type ScreenOptions, VIEW_CLEARED, VIEW_SHOWN } from '../views/screen.ts'

/** A screen that also says what it shows, for a test to look at: the screen itself only remembers where its cards are. */
interface WatchedScreen extends Screen {
  /** Every card still shown, the one shown last at the end. */
  shown(): ShownView[]
  /** The card shown last. */
  current(): ShownView | undefined
}

export function watchedScreen(options: ScreenOptions): WatchedScreen {
  let shown: ShownView[] = []
  const show = (view: ShownView) => {
    shown = [...shown.filter((one) => one.id !== view.id), view]
  }
  const clear = (id: string | undefined) => {
    shown = shown.filter((one) => one.id !== id)
  }
  for (const record of options.records.read([VIEW_SHOWN, VIEW_CLEARED])) {
    if (record.type === VIEW_SHOWN) show(record.payload as ShownView)
    else clear((record.payload as { view?: string }).view)
  }
  const screen = createScreen(options)
  screen.onEvent((event) => {
    if (event.name === 'view.shown') show(event.view)
    else if (event.name === 'view.cleared') clear(event.view)
  })
  return { ...screen, shown: () => [...shown], current: () => shown.at(-1) }
}
