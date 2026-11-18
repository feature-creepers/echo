import type { Printer } from '@repo/core'
import { POWERSHELL_UTF8, powershell } from '../program.ts'

/**
 * The printers Windows knows, from WMI, which every Windows has: each one's name, whether it is the default, its
 * port, and how it stands. The fax is left out: printing to it opens a wizard that sends what was printed away.
 */
export const LIST = powershell(`$printers = @(Get-CimInstance Win32_Printer | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; default = [bool]$_.Default; port = [string]$_.PortName; driver = [string]$_.DriverName; offline = [bool]$_.WorkOffline; status = [int]$_.PrinterStatus; error = [int]$_.DetectedErrorState }
})
${POWERSHELL_UTF8.output('$printers')}`)

/** A printer as the script above gives it. */
export interface WindowsPrinter {
  name: string
  default: boolean
  port: string
  driver: string
  offline: boolean
  /** Win32_Printer's PrinterStatus: 3 idle, 4 printing, 5 warming up, 6 stopped, 7 offline. */
  status: number
  /** Win32_Printer's DetectedErrorState: 0 to 2 nothing known, beyond that paper, toner, a jam, the door. */
  error: number
}

/** The printers, as the core sees them, from what the script printed. */
export function readPrinters(found: readonly WindowsPrinter[]): Printer[] {
  return found
    .filter((printer) => printer.port.toUpperCase() !== 'SHRFAX:' && !/fax/i.test(printer.driver))
    .map((printer) => ({
      name: printer.name,
      default: printer.default,
      // A port that prompts is a printer that makes a file: it would open a dialog to ask where.
      output: printer.port.toUpperCase() === 'PORTPROMPT:' ? 'file' : 'paper',
      state:
        printer.offline || printer.status === 7
          ? 'offline'
          : printer.error > 2 || printer.status === 6
            ? 'error'
            : printer.status === 4 || printer.status === 5
              ? 'printing'
              : 'ready'
    }))
}

/** The ending of the file a printer that makes files writes: a PDF for Microsoft Print to PDF, XPS for the XPS writer. */
export function fileEnding(printer: string): string {
  if (/pdf/i.test(printer)) return '.pdf'
  if (/xps/i.test(printer)) return '.xps'
  return '.prn'
}

/**
 * Print one file, as JSON on standard input ({ path, printer, copies, kind, file }), with .NET's own printing, so
 * no app has to be installed and nothing opens on the screen. A PDF's pages are drawn by Windows' own PDF renderer
 * (Windows.Data.Pdf) at 200 dots per inch; a picture fills the page, turned to suit it; text is set in Consolas
 * and runs over as many pages as it takes. A printer that makes a file writes it at `file`. Prints { pages }.
 *
 * When Windows manages the default printer, it makes the last one used the default: printing to Microsoft Print to
 * PDF once would change the person's own. The default printer is put back as it was once the job is taken.
 */
export const PRINT = powershell(`$job = ${POWERSHELL_UTF8.input} | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
$before = [string](Get-CimInstance Win32_Printer -Filter 'Default=TRUE' | Select-Object -First 1).Name
$document = New-Object System.Drawing.Printing.PrintDocument
$document.PrinterSettings.PrinterName = $job.printer
if (-not $document.PrinterSettings.IsValid) { throw ('There is no printer called ' + $job.printer + '.') }
$document.DocumentName = [IO.Path]::GetFileName($job.path)
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$document.PrinterSettings.Copies = [int16]$job.copies
if ($job.file) { $document.PrinterSettings.PrintToFile = $true; $document.PrinterSettings.PrintFileName = $job.file }
$script:pages = 0
$script:index = 0
function Fit($settings, $width, $height) {
  $pageWidth = $settings.Bounds.Width - 2 * $settings.HardMarginX
  $pageHeight = $settings.Bounds.Height - 2 * $settings.HardMarginY
  $scale = [Math]::Min($pageWidth / $width, $pageHeight / $height)
  $w = $width * $scale; $h = $height * $scale
  New-Object System.Drawing.RectangleF ((($pageWidth - $w) / 2), (($pageHeight - $h) / 2), $w, $h)
}
switch ($job.kind) {
  'pdf' {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $tasks = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
    $script:operation = $tasks | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
    $script:action = $tasks | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
    function Await($task, [Type]$type) { $running = $script:operation.MakeGenericMethod($type).Invoke($null, @($task)); $null = $running.Wait(-1); $running.Result }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($job.path)) ([Windows.Storage.StorageFile])
    $script:pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    $script:count = [int]$script:pdf.PageCount
    $document.add_QueryPageSettings({ param($sender, $e)
      $size = $script:pdf.GetPage([uint32]$script:index).Size
      $e.PageSettings.Landscape = $size.Width -gt $size.Height
    })
    $document.add_PrintPage({ param($sender, $e)
      $page = $script:pdf.GetPage([uint32]$script:index)
      $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $options.DestinationWidth = [uint32]([Math]::Min(5000, $page.Size.Width * 200 / 96))
      $rendering = $script:action.Invoke($null, @($page.RenderToStreamAsync($stream, $options))); $null = $rendering.Wait(-1)
      $stream.Seek(0)
      $image = [System.Drawing.Image]::FromStream([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream))
      $e.Graphics.DrawImage($image, (Fit $e.PageSettings $image.Width $image.Height))
      $image.Dispose(); $stream.Dispose(); $page.Dispose()
      $script:index++; $script:pages++
      $e.HasMorePages = $script:index -lt $script:count
    })
  }
  'image' {
    $script:image = [System.Drawing.Image]::FromFile($job.path)
    $document.DefaultPageSettings.Landscape = $script:image.Width -gt $script:image.Height
    $document.add_PrintPage({ param($sender, $e)
      $e.Graphics.DrawImage($script:image, (Fit $e.PageSettings $script:image.Width $script:image.Height))
      $script:pages++
      $e.HasMorePages = $false
    })
  }
  'text' {
    $script:rest = ([IO.File]::ReadAllText($job.path)).Replace("\`r\`n", "\`n").Replace("\`t", '    ')
    if ($script:rest.Length -eq 0) { $script:rest = ' ' }
    $script:font = New-Object System.Drawing.Font ('Consolas', 10)
    $script:format = New-Object System.Drawing.StringFormat
    $script:format.Trimming = [System.Drawing.StringTrimming]::Word
    $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins (60, 60, 60, 60)
    $document.add_PrintPage({ param($sender, $e)
      $chars = 0; $lines = 0
      $null = $e.Graphics.MeasureString($script:rest, $script:font, [System.Drawing.SizeF]$e.MarginBounds.Size, $script:format, [ref]$chars, [ref]$lines)
      if ($chars -lt 1) { $chars = $script:rest.Length }
      $e.Graphics.DrawString($script:rest.Substring(0, $chars), $script:font, [System.Drawing.Brushes]::Black, [System.Drawing.RectangleF]$e.MarginBounds, $script:format)
      $script:rest = $script:rest.Substring($chars)
      $script:pages++
      $e.HasMorePages = $script:rest.Length -gt 0
    })
  }
}
try { $document.Print() } finally {
  if ($before -and $before -ne $job.printer) {
    for ($look = 0; $look -lt 10; $look++) {
      $now = [string](Get-CimInstance Win32_Printer -Filter 'Default=TRUE' | Select-Object -First 1).Name
      if ($now -and $now -ne $before) { $null = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $before } | Invoke-CimMethod -MethodName SetDefaultPrinter; break }
      Start-Sleep -Milliseconds 200
    }
  }
}
${POWERSHELL_UTF8.output('@{ pages = $script:pages }')}`)
