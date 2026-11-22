import type { ComponentRegistry, ComponentRenderProps } from '@json-render/react'
import type { BlockName, BlockProps } from '@repo/catalog'
import type { ReactNode } from 'react'
import { AppFrame } from '../widgets/app-frame.tsx'
import { Chart, Metric, Progress, Table, Timeline } from './blocks/data.tsx'
import { Drawing, Image } from './blocks/drawing.tsx'
import { FileList } from './blocks/file-list.tsx'
import { FilePreview } from './blocks/file-preview.tsx'
import { Illustration } from './blocks/illustration.tsx'
import { Button, Field, Questions } from './blocks/input.tsx'
import { Card, Divider, Grid, Row, Section, Stack } from './blocks/layout.tsx'
import { PlaceMap, RegionMap } from './blocks/map.tsx'
import { Media } from './blocks/media.tsx'
import { Badge, Heading, KeyValue, List, Prose, Steps, Text } from './blocks/text.tsx'

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
  Illustration,
  Image,
  Media,
  Button,
  Questions,
  Field,
  FilePreview,
  FileList,
  App: ({ props }: { props: BlockProps<'App'> }) => <AppFrame widget={props.widget} />
}

/**
 * The blocks as json-render's renderer finds them by name. A checked view gives each block its own properties, so
 * each is drawn with what its element holds.
 */
export const REGISTRY: ComponentRegistry = Object.fromEntries(
  Object.entries(DRAWERS).map(([name, drawer]) => {
    const Draw = drawer as (args: { props: unknown; children: ReactNode }) => ReactNode
    return [name, ({ element, children }: ComponentRenderProps) => <Draw props={element.props} children={children} />]
  })
)
