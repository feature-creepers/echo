import type { BlockProps } from '@repo/catalog'
import { useEffect, useState } from 'react'
import { Button } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { type FileContent, useViewActions } from '../context.ts'
import { Markdown } from './markdown.tsx'

const HEIGHT = { short: 'max-h-56', normal: 'max-h-96', tall: 'max-h-[36rem]' } as const
const EXTENSION = { markdown: 'md', text: 'txt', csv: 'csv' } as const

/** Saves the file with the system's own dialog: the window offers it as a download. */
function download(file: FileContent): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: `${file.mime};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${file.name}.${EXTENSION[file.format]}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Rows of a CSV file, read simply: commas, and quotes around a value that holds one. */
function rows(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((match) => (match[1] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1))
}

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
    <div className="grid overflow-hidden rounded-md border border-line bg-ground/60">
      <div className="flex items-center justify-between gap-3 border-line border-b bg-white/[0.02] py-2 pr-2 pl-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-7 shrink-0 items-center justify-center rounded-xs border border-line-strong font-mono text-[0.5625rem] text-text-soft uppercase">
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
      <div className={cn('scroll-quiet overflow-y-auto px-5 py-4', HEIGHT[props.height])}>
        {!file ? null : file.format === 'markdown' ? (
          <Markdown text={file.text} />
        ) : file.format === 'csv' ? (
          <table className="w-full text-[0.8125rem]">
            <tbody>
              {rows(file.text).map((row, index) => (
                <tr key={index} className={cn('border-line border-b last:border-0', index === 0 && 'font-mono text-label text-text-faint uppercase')}>
                  {row.map((value, column) => (
                    <td key={column} className="px-2 py-1.5">
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
