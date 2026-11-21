import type { BlockProps } from '@repo/catalog'
import { useEffect, useState } from 'react'
import { offerDownload } from '../../files/file-actions.ts'
import { tableRows } from '../../files/words.ts'
import { Button } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { type FileContent, useViewActions } from '../context.ts'
import { Markdown } from './markdown.tsx'

const HEIGHT = { short: 'max-h-56', normal: 'max-h-96', tall: 'max-h-[36rem]' } as const
const EXTENSION = { markdown: 'md', text: 'txt', csv: 'csv' } as const

const download = (file: FileContent) => offerDownload(new Blob([file.text], { type: `${file.mime};charset=utf-8` }), `${file.name}.${EXTENSION[file.format]}`)

export function FilePreview({ props }: { props: BlockProps<'FilePreview'> }) {
  const { readFile } = useViewActions()
  const [file, setFile] = useState<FileContent | 'missing'>()

  useEffect(() => {
    let current = true
    readFile(props.file).then(
      (read) => current && setFile(read),
      () => current && setFile('missing')
    )
    return () => {
      current = false
    }
  }, [props.file, readFile])

  if (file === 'missing') return <p className="text-[0.8125rem] text-text-faint">This document is no longer available.</p>

  return (
    <div className="grid min-w-0">
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="caps flex h-6 w-8 shrink-0 items-center justify-center text-text-soft shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
            {file ? EXTENSION[file.format] : '…'}
          </span>
          <div className="grid min-w-0">
            <span className="truncate text-[0.8125rem] leading-tight">{file?.name ?? 'Opening…'}</span>
            {file && <Eyebrow>Version {file.version}</Eyebrow>}
          </div>
        </div>
        <Button size="sm" kind="primary" disabled={!file} onClick={() => file && download(file)}>
          Download
        </Button>
      </div>
      {/* The document starts under a rule of the full ink; while it is read, a hatched plane holds its place. */}
      <div className={cn('scroll-quiet overflow-y-auto border-text border-t-2 pt-2.5', HEIGHT[props.height])}>
        {!file ? (
          <div className="hatch h-16 text-line" />
        ) : file.format === 'markdown' ? (
          <Markdown text={file.text} />
        ) : file.format === 'csv' ? (
          <table className="w-full border-collapse text-[0.8125rem] tabular-nums">
            <tbody>
              {tableRows(file.text).map((row, index) => (
                <tr key={index} className={cn('border-b last:border-0', index === 0 ? 'caps border-text border-b-2 text-text-soft' : 'border-line')}>
                  {row.map((value, column) => (
                    <td key={column} className="py-1.5 pr-3 last:pr-0">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-text-soft text-xs leading-relaxed">{file.text}</pre>
        )}
      </div>
    </div>
  )
}
