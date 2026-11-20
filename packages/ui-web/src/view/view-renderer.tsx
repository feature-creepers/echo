import type { BlockName, BlockProps, ViewSpec } from '@repo/catalog'
import type { ReactNode } from 'react'
import { Chart, Metric, Progress, Table, Timeline } from './blocks/data.tsx'
import { Drawing, Image } from './blocks/drawing.tsx'
import { FileList } from './blocks/file-list.tsx'
import { FilePreview } from './blocks/file-preview.tsx'
import { Button, Choice, Field } from './blocks/input.tsx'
import { Card, Divider, Grid, Row, Section, Stack } from './blocks/layout.tsx'
import { PlaceMap, RegionMap } from './blocks/map.tsx'
import { Media } from './blocks/media.tsx'
import { Badge, Heading, KeyValue, List, Prose, Steps, Text } from './blocks/text.tsx'
import { type ViewActions, ViewActionsContext } from './context.ts'

/** How each block is drawn on the web. Leaving one out is a compile error. */
type Drawers = { [Name in BlockName]: (args: { props: BlockProps<Name>; children: ReactNode }) => ReactNode }

const DRAWERS: Drawers = {
  Stack,
  Row,
  Grid,
  Card,
  Section,
  Divider,
  Heading,
  Text,
  Badge,
  KeyValue,
  List,
  Steps,
  Prose,
  Metric,
  Table,
  Chart,
  Timeline,
  Progress,
  RegionMap,
  PlaceMap,
  Drawing,
  Image,
  Media,
  Button,
  Choice,
  Field,
  FilePreview,
  FileList
}

/** Deeper than the catalogue lets a view nest: a guard against one that contains itself, never reached by a checked view. */
const DEEPEST = 32

/**
 * Draws a view the core has checked. The format is json-render's; the drawing is ours, so every block
 * looks like the rest of the app.
 */
export function ViewRenderer({ spec, actions }: { spec: ViewSpec; actions: ViewActions }) {
  const draw = (id: string, depth: number): ReactNode => {
    const element = spec.elements[id]
    if (!element || depth > DEEPEST) return null
    const Drawer = DRAWERS[element.type] as (args: { props: unknown; children: ReactNode }) => ReactNode
    return <Drawer key={id} props={element.props} children={element.children.map((child) => draw(child, depth + 1))} />
  }
  // A word longer than the line it is on, such as an address, breaks rather than pushing the view out of its
  // bounds. Only where it would overflow: the widths blocks take from their content stay as they are.
  return (
    <ViewActionsContext.Provider value={actions}>
      <div className="grid min-w-0 [overflow-wrap:break-word]">{draw(spec.root, 0)}</div>
    </ViewActionsContext.Provider>
  )
}
