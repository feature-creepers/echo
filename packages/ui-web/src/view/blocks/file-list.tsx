import type { BlockProps } from '@repo/catalog'
import { runsWhenOpened } from '@repo/client'
import { useState } from 'react'
import { FileMark } from '../../files/file-content.tsx'
import { OpenGlyph, PreviewGlyph, RevealGlyph } from '../../files/glyphs.tsx'
import { sizeWords } from '../../files/words.ts'
import { Button } from '../../primitives/button.tsx'
import { IconButton } from '../../primitives/icon-button.tsx'
import { useViewActions } from '../context.ts'

/** The last part of a path, and the folder it is in, whatever the system's separator. */
function partsOf(path: string): { name: string; folder: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at < 0 ? { name: path, folder: '' } : { name: path.slice(at + 1), folder: path.slice(0, at) || path.slice(0, at + 1) }
}

/**
 * Files on the computer, one to a row: the mark of its kind, its name and where it is, its size, and what can be
 * done with it here. Pressing the name previews it. Past the limit, the rest fold under "and 12 more".
 */
export function FileList({ props }: { props: BlockProps<'FileList'> }) {
  const { files: actions } = useViewActions()
  const [unfolded, setUnfolded] = useState(false)
  const shown = unfolded ? props.files : props.files.slice(0, props.limit)
  const folded = props.files.length - props.limit

  return (
    <div className="grid">
      <ul className="grid">
        {shown.map((file) => {
          const { name: last, folder } = partsOf(file.path)
          const name = file.name ?? last
          const look = actions?.preview ?? (runsWhenOpened(name) ? undefined : actions?.open)
          return (
            <li
              key={file.path}
              className="group flex min-h-[2.125rem] min-w-0 items-center gap-3 border-line border-t py-1.5 transition-colors duration-(--duration-quick) first:border-text first:border-t-2 hover:bg-text/[0.04]"
            >
              <FileMark name={name} />
              <button
                type="button"
                disabled={!look}
                onClick={() => look?.(file.path)}
                title={file.path}
                className="grid min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <span className="truncate text-[0.8125rem] leading-snug">{name}</span>
                {file.detail ? (
                  <span className="truncate text-text-faint text-xs leading-snug">{file.detail}</span>
                ) : (
                  folder && (
                    <span dir="rtl" className="truncate text-left font-mono text-[0.625rem] text-text-faint leading-snug">
                      <bdi>{folder}</bdi>
                    </span>
                  )
                )}
              </button>
              {file.size !== undefined && <span className="caps shrink-0 text-text-soft tabular-nums">{sizeWords(file.size)}</span>}
              <span className="flex shrink-0 items-center text-text-faint">
                {actions?.open && !runsWhenOpened(name) && (
                  <Button size="sm" kind="quiet" className="[&_svg]:size-3.5" onClick={() => actions.open?.(file.path)}>
                    <OpenGlyph />
                    Open
                  </Button>
                )}
                {actions?.reveal && (
                  <IconButton label="Show in folder" className="size-6 [&_svg]:size-3.5" onClick={() => actions.reveal?.(file.path)}>
                    <RevealGlyph />
                  </IconButton>
                )}
                {actions?.preview && (
                  <IconButton label="Preview" className="size-6 [&_svg]:size-3.5" onClick={() => actions.preview?.(file.path)}>
                    <PreviewGlyph />
                  </IconButton>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {folded > 0 && (
        <button
          type="button"
          onClick={() => setUnfolded(!unfolded)}
          className="caps h-[2.125rem] border-line border-t text-left text-text-soft transition-colors duration-(--duration-quick) hover:bg-text/[0.04] hover:text-text"
        >
          {unfolded ? 'Show fewer' : `and ${folded} more`}
        </button>
      )}
    </div>
  )
}
