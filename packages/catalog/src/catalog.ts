import type { Block } from './block.ts'
import { appBlocks } from './blocks/app.ts'
import { dataBlocks } from './blocks/data.ts'
import { drawingBlocks } from './blocks/drawing.ts'
import { fileBlocks } from './blocks/files.ts'
import { inputBlocks } from './blocks/input.ts'
import { layoutBlocks } from './blocks/layout.ts'
import { mapBlocks } from './blocks/map.ts'
import { mediaBlocks } from './blocks/media.ts'
import { textBlocks } from './blocks/text.ts'

/** Every block the assistant can compose with, assembled from the groups in `blocks/`. */
export const BLOCKS = {
  ...layoutBlocks,
  ...textBlocks,
  ...dataBlocks,
  ...mapBlocks,
  ...drawingBlocks,
  ...mediaBlocks,
  ...inputBlocks,
  ...fileBlocks,
  ...appBlocks
} satisfies Record<string, Block>

export type BlockName = keyof typeof BLOCKS

export function isBlockName(name: string): name is BlockName {
  return Object.hasOwn(BLOCKS, name)
}
