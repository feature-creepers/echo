import { type FrameNews, type FrameQuestion, frameNewsSchema, frameQuestionSchema, isWithin, type WidgetApp } from '@repo/protocol'

/**
 * What a widget app's page asks the window, and how the window answers (docs/SPEC.md, section 9.9). The page is not
 * trusted: a message is read against its schema, and what it may reach is decided by the core, from what the app declared and
 * the person allowed. Opening a page in the browser is the window's own, so it is held to the declared addresses here.
 */

/** What the window does for a page: through the core, and in the browser. */
export interface FrameServices {
  call(request: {
    url: string
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    headers: Record<string, string>
    body?: string | undefined
  }): Promise<unknown>
  state(): Promise<Record<string, unknown>>
  keep(key: string, value: unknown): Promise<void>
  notify(title: string, body: string): Promise<void>
  open(url: string): void
}

/** A page's message: a question to answer, news of the page, or nothing worth reading. */
export function readMessage(data: unknown): { question: FrameQuestion } | { news: FrameNews } | undefined {
  if (typeof data !== 'object' || data === null || (data as { echo?: unknown }).echo !== 1) return undefined
  const question = frameQuestionSchema.safeParse(data)
  if (question.success) return { question: question.data }
  const news = frameNewsSchema.safeParse(data)
  return news.success ? { news: news.data } : undefined
}

/** The answer to a page's question, as the page reads it: its value, or why not. */
export async function answerQuestion(
  question: FrameQuestion,
  app: Pick<WidgetApp, 'addresses'>,
  services: FrameServices
): Promise<{ echo: 1; id: number; ok: true; value: unknown } | { echo: 1; id: number; ok: false; error: string }> {
  const { id } = question
  try {
    switch (question.type) {
      case 'call':
        return {
          echo: 1,
          id,
          ok: true,
          value: await services.call({ url: question.url, method: question.method, headers: question.headers, body: question.body })
        }
      case 'state':
        return { echo: 1, id, ok: true, value: await services.state() }
      case 'keep':
        await services.keep(question.key, question.value)
        return { echo: 1, id, ok: true, value: null }
      case 'notify':
        await services.notify(question.title, question.body)
        return { echo: 1, id, ok: true, value: null }
      case 'open':
        if (!app.addresses.some((start) => isWithin(question.url, start)))
          return { echo: 1, id, ok: false, error: `${question.url} is not among the addresses this widget declared.` }
        services.open(question.url)
        return { echo: 1, id, ok: true, value: null }
    }
  } catch (error) {
    return { echo: 1, id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
