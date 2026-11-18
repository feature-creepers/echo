import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Browser, decidePageAct } from '@repo/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBrowser } from '../src/browser.ts'
import { BROWSER_VARIABLE, findBrowser } from '../src/find/find.ts'
import { systemBrowsers } from '../src/find/index.ts'

/**
 * The adapter against a real browser and a local page, with no window: the browser this computer has, or the one
 * `ASSISTANT_BROWSER` names. Skipped where there is none. On a Linux that refuses a downloaded browser its
 * sandbox, set `ASSISTANT_BROWSER_SANDBOX=off` as well.
 */
const found = await findBrowser({ ...systemBrowsers(), override: process.env[BROWSER_VARIABLE] })

describe.skipIf(!found.found)('the browser, for real', () => {
  let server: Server
  let origin = ''
  let folder = ''
  let browser: Browser

  beforeAll(async () => {
    const shop = await readFile(join(import.meta.dirname, 'pages', 'shop.html'), 'utf8')
    server = createServer((request, response) => {
      if (request.url === '/report.txt') {
        response.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="report.txt"' }).end('All good.')
      } else if (request.url === '/answers') {
        // A search engine's page: a small answer panel marked as main, the results beside it.
        const results = Array.from(
          { length: 8 },
          (_, index) => `<div><a href="/r${index}">Result ${index}</a><p>${'A long description of a result. '.repeat(6)}</p></div>`
        ).join('')
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>Answers</title><main>Rain, 12°</main><section>${results}</section>`)
      } else if (request.url?.startsWith('/search')) {
        response
          .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end('<title>Results</title><main><h1>Results</h1><a href="/lyon">Lyon weather</a></main>')
      } else {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(shop)
      }
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    folder = await mkdtemp(join(tmpdir(), 'browser-'))
    browser = createBrowser({ profile: join(folder, 'profile'), downloads: join(folder, 'downloads'), log: { error: () => undefined }, headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    server?.close()
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  /** The reference of the first line of the latest outline that holds this text. */
  const refOf = (outline: string, text: string) => {
    const line = outline.split('\n').find((candidate) => candidate.includes(text))
    const ref = line && /\[ref=([a-z0-9]+)\]/.exec(line)?.[1]
    if (!ref) throw new Error(`No element "${text}" in:\n${outline}`)
    return ref
  }

  it('starts at its first use, opens a page and reads its main content, without the navigation and the footer', async () => {
    expect(browser.running()).toBe(false)
    expect(await browser.go(`${origin}/`, 'current')).toEqual({ url: `${origin}/`, title: 'Sign in · Test shop' })
    expect(browser.running()).toBe(true)
    const page = await browser.read(0, 10_000)
    expect(page.text).toContain('The finest widgets, 330 metres of them.')
    expect(page.text).not.toContain('The small print.')
    expect(page.text).not.toContain('Cart')
    // Hidden, or around the content, inside the main region too.
    expect(page.text).not.toContain('Alemannisch')
    expect(page.text).not.toContain('Article tools')
  })

  it('reads the whole page when what it marks as main is a small part of it', async () => {
    await browser.go(`${origin}/answers`, 'current')
    const page = await browser.read(0, 10_000)
    expect(page.text).toContain('Rain, 12°')
    expect(page.text).toContain('Result 7')
    await browser.back()
  })

  it('outlines what can be used, with references the actions take', async () => {
    const { outline } = await browser.snapshot(10_000)
    expect(outline).toMatch(/- link "Home" \[ref=[a-z0-9]+\]/)
    expect(outline).toMatch(/- textbox "Password" \[ref=[a-z0-9]+\]/)
    expect(outline).toMatch(/- button "Buy now" \[ref=[a-z0-9]+\]/)
    expect(outline).not.toContain('The finest widgets')
  })

  it('reads a password field as one, and the core refuses to type into it at every level', async () => {
    const { outline } = await browser.snapshot(10_000)
    const element = await browser.inspect(refOf(outline, 'textbox "Password"'))
    expect(element).toMatchObject({ role: 'textbox', name: 'Password', tag: 'input', type: 'password', autocomplete: 'current-password', submits: true })
    if (!element) return
    for (const level of ['ask', 'trust'] as const) {
      expect(decidePageAct({ kind: 'type', element, text: 'hunter2', submit: false }, level)).toEqual({ verdict: 'refuse', secret: 'password' })
    }
  })

  it('reads a card number field as one', async () => {
    const { outline } = await browser.snapshot(10_000)
    const element = await browser.inspect(refOf(outline, 'textbox "Card number"'))
    expect(element && decidePageAct({ kind: 'type', element, text: '4242', submit: false }, 'trust')).toEqual({ verdict: 'refuse', secret: 'card' })
  })

  it('reads "Buy now" and where its form sends, so the core asks even when trusted', async () => {
    const { outline } = await browser.snapshot(10_000)
    const element = await browser.inspect(refOf(outline, 'button "Buy now"'))
    expect(element).toMatchObject({ name: 'Buy now', submits: true, form: { submits: ['Buy now'], action: `${origin}/checkout/pay` } })
    expect(element && decidePageAct({ kind: 'click', element }, 'trust')).toEqual({ verdict: 'ask', always: true, because: 'pays' })
  })

  it('clicks, and tells what appeared', async () => {
    const { outline } = await browser.snapshot(10_000)
    const outcome = await browser.click(refOf(outline, 'button "Add to cart"'))
    expect(outcome.changes.some((line) => line.includes('link "Go to your cart"'))).toBe(true)
  })

  it('types a search and presses Enter, landing on the results', async () => {
    const { outline } = await browser.snapshot(10_000)
    const outcome = await browser.type(refOf(outline, 'searchbox "Search"'), 'lyon weather', true)
    expect(outcome).toMatchObject({ url: `${origin}/search?q=lyon+weather`, title: 'Results' })
    expect(outcome.changes.some((line) => line.includes('link "Lyon weather"'))).toBe(true)
    expect(await browser.back()).toMatchObject({ url: `${origin}/` })
  })

  it('refuses a reference the latest outline does not have', async () => {
    expect(await browser.inspect('e999')).toBeUndefined()
    await expect(browser.click('e999')).rejects.toThrow('There is no element e999 on the page now.')
  })

  it('saves a download in the assistant’s folder, under its own name', async () => {
    const { outline } = await browser.snapshot(10_000)
    const outcome = await browser.click(refOf(outline, 'link "Download the report"'))
    const saved = join(folder, 'downloads', 'report.txt')
    expect(outcome.changes[0]).toBe(`- download: saved to ${saved}`)
    await expect.poll(() => readFile(saved, 'utf8').catch(() => ''), { timeout: 10_000 }).toBe('All good.')
  })

  it('pictures the page', async () => {
    const picture = await browser.screenshot()
    expect(picture.mime).toBe('image/jpeg')
    expect(Buffer.from(picture.data, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
  })

  it('opens again after it was closed', async () => {
    await browser.close()
    expect(browser.running()).toBe(false)
    expect(await browser.go(`${origin}/`, 'new')).toMatchObject({ title: 'Sign in · Test shop' })
    expect((await browser.tabs()).filter((tab) => tab.current)).toHaveLength(1)
  })
})
