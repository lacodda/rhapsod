import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No IndexedDB here, which is exactly the browser under test: one that will
// not keep anything on the device - some private windows, site data blocked.
// Each change used to get a single try at the wire, and on a train that try
// failed and the change was gone without a word.

let queue: typeof import('@/queue')
let sync: typeof import('@/sync')

beforeEach(async () => {
  // The page's own queue lives in module scope, as it does in a page; each
  // test gets a fresh page.
  vi.resetModules()
  queue = await import('@/queue')
  sync = await import('@/sync')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const change = (path: string) => ({ path, method: 'POST' as const, body: { marked_at: '2026-09-02T12:00:00.000Z' } })

describe('a browser that will not keep the queue', () => {
  it('holds the change in the page rather than losing it', async () => {
    await queue.enqueue(change('/bookmarks/02-myths/icarus'))

    expect((await queue.pending()).map((held) => held.path)).toEqual(['/bookmarks/02-myths/icarus'])
    expect(await queue.waiting()).toBe(1)
    expect(queue.unkept()).toBe(1)
  })

  it('says the change is held only in the page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('the stand is away'))))
    await queue.enqueue(change('/bookmarks/02-myths/icarus'))

    await sync.drain()

    // Still there after a failed try, and counted as not kept on the device:
    // the screens tell the reader not to close the page.
    expect(sync.syncState().waiting).toBe(1)
    expect(sync.syncState().unkept).toBe(1)
  })

  it('delivers it, in order, once the stand answers', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('the stand is away'))))
    await queue.enqueue(change('/progress/02-myths/icarus'))
    await queue.enqueue(change('/bookmarks/02-myths/icarus'))
    await sync.drain()

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url)
        return Promise.resolve(new Response(null, { status: 204 }))
      }),
    )
    await sync.drain()

    expect(calls).toEqual(['/api/progress/02-myths/icarus', '/api/bookmarks/02-myths/icarus'])
    expect(sync.syncState().waiting).toBe(0)
    expect(sync.syncState().unkept).toBe(0)
  })
})
