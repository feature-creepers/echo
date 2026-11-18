import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Desktop, WindowFacts } from '@repo/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDesktop } from '../src/index.ts'

/**
 * Against the real desktop of this computer: a small window of its own is opened, read and operated. It takes the
 * front for a moment and types in it, so it runs only when asked (`ASSISTANT_DESKTOP=1`), on a machine with a desktop.
 * Windows only for now: the window is made with Windows Forms.
 */
const asked = process.env.ASSISTANT_DESKTOP === '1' && process.platform === 'win32'

const TITLE = 'Echo desktop check'

/** A window with a field, a password box, a button that greets, and a label that shows the greeting. */
const FORM = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.Width = 420; $form.Height = 260
$name = New-Object System.Windows.Forms.TextBox; $name.AccessibleName = 'Your name'; $name.Top = 20; $name.Left = 20; $name.Width = 200
$secret = New-Object System.Windows.Forms.TextBox; $secret.AccessibleName = 'Secret'; $secret.UseSystemPasswordChar = $true; $secret.Top = 60; $secret.Left = 20
$greet = New-Object System.Windows.Forms.Button; $greet.Text = 'Greet'; $greet.Top = 100; $greet.Left = 20
$said = New-Object System.Windows.Forms.Label; $said.Name = 'Greeting'; $said.Text = 'Nobody yet'; $said.Top = 140; $said.Left = 20; $said.Width = 300
$greet.Add_Click({ $said.Text = 'Hello, ' + $name.Text })
$form.Controls.AddRange(@($name, $secret, $greet, $said))
[System.Windows.Forms.Application]::Run($form)
`

/** The reference of the name field, whatever it holds. */
const fieldIn = (outline: string) => /- edit "Your name".*\[(e\d+)\]/.exec(outline)?.[1] as string

describe.runIf(asked)('the desktop of this computer', () => {
  let folder: string
  let form: ChildProcess
  let desktop: Desktop
  let window: WindowFacts

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'echo-screen-'))
    const script = join(folder, 'form.ps1')
    writeFileSync(script, FORM)
    form = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore' })
    desktop = createDesktop({ folder: join(folder, 'helper') })
    for (let tries = 0; tries < 40; tries++) {
      const found = (await desktop.windows()).find((one) => one.title === TITLE)
      if (found) {
        window = found
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('The test window did not open.')
  })

  afterAll(async () => {
    await desktop?.close()
    form?.kill()
    rmSync(folder, { recursive: true, force: true })
  })

  it('lists the window, reads it as an outline, and hides what a password box holds', async () => {
    expect(window.program).toBe('powershell')
    const seen = await desktop.look(window.id, 10_000)
    expect(seen.outline).toMatch(/- edit "Your name" \[e\d+\]/)
    expect(seen.outline).toMatch(/- button "Greet" \[e\d+\]/)
    expect(seen.outline).toContain('Nobody yet')
    const secret = /- edit "Secret" \[(e\d+)\]/.exec(seen.outline)?.[1] as string
    expect((await desktop.inspect(secret))?.password).toBe(true)
  })

  it('types into a field, presses a button, and sees what changed', async () => {
    const seen = await desktop.look(window.id, 10_000)
    const field = fieldIn(seen.outline)
    const button = /- button "Greet" \[(e\d+)\]/.exec(seen.outline)?.[1] as string
    await desktop.type(field, 'Ada', false)
    await desktop.click(button)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await desktop.look(window.id, 10_000)).outline).toContain('Hello, Ada')
  })

  it('presses keys in the window, takes its picture, and does not take its own keys for the person’s', async () => {
    const seen = await desktop.look(window.id, 10_000)
    const field = fieldIn(seen.outline)
    await desktop.focus(window.id)
    await desktop.press(window.id, 'End', field)
    await desktop.press(window.id, 'é', field)
    // Keys are queued for the app, which takes them in a moment.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await desktop.look(window.id, 10_000)).outline).toContain('"Your name" = "Adaé"')
    expect(await desktop.idle()).toBeUndefined()
    const picture = await desktop.screenshot(window.id)
    expect(Buffer.from(picture.data, 'base64').subarray(1, 4).toString()).toBe('PNG')
  })

  it("finds a button by its name and presses it, as a widget's button does", async () => {
    const button = await desktop.seek(window.id, 'greet', 'button')
    expect(button).toMatch(/^e\d+$/)
    await desktop.click(button as string)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await desktop.look(window.id, 10_000)).outline).toContain('Hello, Ada')
  })

  // Muted, then back as it was: the system takes the key, and the sound is left as the person had it.
  it('presses a key of the whole system', async () => {
    await expect(desktop.systemKey('VolumeMute', 2)).resolves.toBeUndefined()
  })
})
