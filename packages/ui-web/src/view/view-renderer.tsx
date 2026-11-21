import { JSONUIProvider, Renderer } from '@json-render/react'
import type { ViewSpec } from '@repo/catalog'
import { useMemo, useRef, useState } from 'react'
import { type ViewActions, ViewActionsContext } from './context.ts'
import { REGISTRY } from './registry.tsx'
import { tableKeys } from './table-keys.ts'

/**
 * Draws a view the core has checked, with json-render's renderer and the app's own blocks, so every block looks like
 * the rest of the app. A block this app does not know, from a newer core, is left out, and so is a block that fails
 * to draw: the rest of the view is drawn.
 */
export function ViewRenderer({ spec, actions }: { spec: ViewSpec; actions: ViewActions }) {
  // json-render keeps the handlers it was first given, so they read the actions of the latest render.
  const current = useRef(actions)
  current.current = actions
  const [handlers] = useState(() => ({
    say: (params: Record<string, unknown>) => current.current.say(String(params.text))
  }))
  const drawn = useMemo(() => tableKeys(spec), [spec])
  // A word longer than the line it is on, such as an address, breaks rather than pushing the view out of its
  // bounds. Only where it would overflow: the widths blocks take from their content stay as they are.
  return (
    <div className="grid min-w-0 [overflow-wrap:break-word]">
      <ViewActionsContext.Provider value={actions}>
        <JSONUIProvider registry={REGISTRY} handlers={handlers}>
          <Renderer spec={drawn} registry={REGISTRY} />
        </JSONUIProvider>
      </ViewActionsContext.Provider>
    </div>
  )
}
