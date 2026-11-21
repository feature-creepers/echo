import { ATTACHMENTS_PER_TURN } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { PaperclipGlyph } from '../files/glyphs.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
import { LARGEST_FILE } from './use-attachments.ts'

/** What was dropped: files, and folders by where they are, when the window can tell. */
export interface Dropped {
  files: File[]
  folders: { name: string; path: string }[]
  /** Folders dropped whose place the window could not tell: a browser is never told. */
  unplaced: number
}

/** Whether something being dragged carries files: text or a link dragged from a page does not. */
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true

/**
 * Files dropped anywhere on the window, and whether some are being dragged over it now. A folder is told apart from
 * a file by the entry the drop gives for it, and its place asked of `pathOf`.
 */
export function useWindowDrop(onDrop: (dropped: Dropped) => void, pathOf: ((file: File) => string | undefined) | undefined): boolean {
  const [over, setOver] = useState(false)
  const handler = useRef(onDrop)
  handler.current = onDrop
  const locate = useRef(pathOf)
  locate.current = pathOf

  useEffect(() => {
    // Entering a child of the window leaves its parent: only the count of what was entered says when the drag left.
    let depth = 0
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth += 1
      setOver(true)
    }
    const across = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setOver(false)
      const dropped: Dropped = { files: [], folders: [], unplaced: 0 }
      for (const item of [...(event.dataTransfer?.items ?? [])]) {
        if (item.kind !== 'file') continue
        const entry = item.webkitGetAsEntry?.()
        const file = item.getAsFile()
        if (!file) continue
        if (!entry?.isDirectory) {
          dropped.files.push(file)
          continue
        }
        const path = locate.current?.(file)
        if (path) dropped.folders.push({ name: entry.name || file.name, path })
        else dropped.unplaced += 1
      }
      // A drop that names no item (some systems give only the files) still brings its files.
      if (dropped.files.length === 0 && dropped.folders.length === 0 && dropped.unplaced === 0) dropped.files.push(...(event.dataTransfer?.files ?? []))
      handler.current(dropped)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', across)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', across)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return over
}

/**
 * The window while files are dragged over it: the screen dims a little under a hairline frame, and a card in the
 * middle says what dropping does. Nothing glows; it only fades.
 */
export function DropState({ over, name }: { over: boolean; name: string }) {
  return (
    <AnimatePresence>
      {over && (
        <motion.div
          key="drop"
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.quick, ease: EASE }}
        >
          <div className="absolute inset-0 bg-ground/55" />
          <div className="absolute inset-3 shadow-[inset_0_0_0_1px_rgb(235_230_218/0.14)]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ scale: 0.97, y: 4 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98 }}
              transition={{ duration: DURATION.calm, ease: EASE }}
              className="material shadow-float grid justify-items-center gap-2.5 px-9 py-7 text-center"
            >
              <span className="text-text-soft [&_svg]:size-6">
                <PaperclipGlyph />
              </span>
              <span className="font-medium text-[0.9375rem] tracking-[-0.01em]">Drop to give these to {name}</span>
              <span className="grid text-text-faint text-xs leading-relaxed">
                <span>They go with what you say next.</span>
                <span>
                  Up to {ATTACHMENTS_PER_TURN} files of {LARGEST_FILE} each; a folder is given to read.
                </span>
              </span>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
