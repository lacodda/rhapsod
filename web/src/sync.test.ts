import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Change } from '@/queue'

// The queue's storage is IndexedDB, which this environment does not have. What
// is under test is not the storage but the draining: the order changes are
// delivered in, what happens when the stand is away mid-drain, and what
// becomes of a change the server refuses. Those are the rules that decide
// whether a reader's work survives a train journey.
const store = vi.hoisted(() => ({ changes: [] as Change[] }))

vi.mock('@/queue', () => ({
  pending: () => Promise.resolve([...store.changes]),
  forget: (id: number) => {
    store.changes = store.changes.filter((change) => change.id !== id)
    return Promise.resolve(undefined)
  },
  waiting: () => Promise.resolve(store.changes.length),
  unkept: () => 0,
}))

const { drain, syncState, sawServer } = await import('@/sync')

/** A change as the app queues one. */
function change(id: number, path: string): Change {
  return { id, path, method: 'POST', body: { marked_at: '2026-09-02T12:00:00.000Z' } }
}

/** A fetch that answers with the given statuses, in call order. */
function answering(...statuses: (number | 'unreachable')[]) {
  const calls: string[] = []
  let at = 0
  const fetch = vi.fn((url: string) => {
    calls.push(url)
    // The last answer repeats, so a test can say "everything succeeds" with
    // one status rather than one per queued change.
    const answer = statuses[Math.min(at, statuses.length - 1)] ?? 204
    at += 1
    if (answer === 'unreachable') return Promise.reject(new Error('the stand is away'))
    return Promise.resolve(new Response(null, { status: answer }))
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

beforeEach(async () => {
  store.changes = []
  sawServer(true)
  // An empty queue has nothing waiting for a sign-in, so a drain of it puts
  // the state back to where a fresh page starts.
  await drain()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('drain', () => {
  it('delivers what is waiting, oldest first', async () => {
    // Order is the point: marked read, then unread, then read again is three
    // changes to one piece, and delivering them out of sequence would leave
    // the stand holding the wrong one.
    store.changes = [change(1, '/progress/a/first'), change(2, '/progress/a/second'), change(3, '/progress/a/third')]
    const calls = answering(204)

    await drain()

    expect(calls).toEqual(['/api/progress/a/first', '/api/progress/a/second', '/api/progress/a/third'])
    expect(store.changes).toHaveLength(0)
    expect(syncState().waiting).toBe(0)
  })

  it('stops at the first change it cannot deliver, and keeps the rest', async () => {
    // A phone that loses the network mid-drain must not skip ahead: the
    // changes after the failed one stay queued, in order, for the next try.
    store.changes = [change(1, '/progress/a/first'), change(2, '/progress/a/second')]
    answering(204, 'unreachable')

    await drain()

    expect(store.changes.map((c) => c.id)).toEqual([2])
    expect(syncState().reachable).toBe(false)
  })

  it('drops a change the stand refuses rather than blocking the queue behind it', async () => {
    // A quote on a piece that was renamed in the vault is a change the server
    // will never accept. Retrying it forever would hold every later change
    // hostage to one the reader cannot fix.
    store.changes = [change(1, '/quotes/gone'), change(2, '/progress/a/second')]
    const calls = answering(404, 204)

    await drain()

    expect(calls).toHaveLength(2)
    expect(store.changes).toHaveLength(0)
    expect(syncState().reachable).toBe(true)
  })

  it('waits for a stand that is having a bad moment', async () => {
    // A 500 is the server being there and failing, which is worth retrying;
    // dropping the change would lose what the reader did.
    store.changes = [change(1, '/progress/a/first')]
    answering(500)

    await drain()

    expect(store.changes.map((c) => c.id)).toEqual([1])
    expect(syncState().reachable).toBe(false)
  })

  it('keeps every change when the device is no longer signed in', async () => {
    // After "Sign out everywhere", or a session that ran out, every write
    // answers 401. The queue drains on app open, before the sign-in screen has
    // drawn - so treating 401 as a refusal threw away a whole journey of
    // reading the moment the reader came home.
    store.changes = [change(1, '/progress/a/first'), change(2, '/bookmarks/a/b')]
    const calls = answering(401)

    await drain()

    expect(store.changes.map((c) => c.id)).toEqual([1, 2])
    // One knock, not one per change: the rest wait behind the first.
    expect(calls).toHaveLength(1)
    expect(syncState().signIn).toBe(true)
    // The stand answered; it is not away, it wants a sign-in.
    expect(syncState().reachable).toBe(true)
  })

  it('delivers what waited for a sign-in once there is one', async () => {
    store.changes = [change(1, '/progress/a/first'), change(2, '/bookmarks/a/b')]
    answering(401)
    await drain()

    const calls = answering(204)
    await drain()

    expect(calls).toEqual(['/api/progress/a/first', '/api/bookmarks/a/b'])
    expect(store.changes).toHaveLength(0)
    expect(syncState().signIn).toBe(false)
  })

  it('keeps a change the stand refuses for want of permission', async () => {
    store.changes = [change(1, '/progress/a/first')]
    answering(403)

    await drain()

    expect(store.changes.map((c) => c.id)).toEqual([1])
    expect(syncState().signIn).toBe(true)
  })

  it.each([400, 404, 409, 410, 422])('drops a change the stand refuses outright (%i)', async (status) => {
    store.changes = [change(1, '/quotes/gone'), change(2, '/progress/a/second')]
    const calls = answering(status, 204)

    await drain()

    expect(calls).toHaveLength(2)
    expect(store.changes).toHaveLength(0)
  })

  it.each([405, 408, 429, 502, 503])('keeps a change on an answer it was not told to drop on (%i)', async (status) => {
    // Dropping cannot be undone; waiting can. An answer that is not a refusal
    // of the change itself keeps it.
    store.changes = [change(1, '/progress/a/first')]
    answering(status)

    await drain()

    expect(store.changes.map((c) => c.id)).toEqual([1])
  })

  it('runs one drain at a time', async () => {
    // The app asks on focus, on the browser reporting a connection, and after
    // every write. Three drains at once would deliver the same change thrice.
    store.changes = [change(1, '/progress/a/first')]
    const calls = answering(204)

    await Promise.all([drain(), drain(), drain()])

    expect(calls).toHaveLength(1)
  })
})

describe('a note written away from home', () => {
  it('carries the text its edit started from to the stand', async () => {
    // The stand decides what to keep - the note it has, the reader's, or
    // both - and it can only do that if it is told what the reader saw.
    const sent: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        sent.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined)
        return Promise.resolve(new Response(null, { status: 204 }))
      }),
    )
    store.changes = [
      {
        id: 1,
        path: '/notes/02-myths/icarus',
        method: 'POST',
        body: { body: 'written on the train', marked_at: '2026-09-02T12:00:00.000Z', base: null },
      },
    ]

    await drain()

    // As queued, in one request: no read of the stand's note first.
    expect(sent).toEqual([{ body: 'written on the train', marked_at: '2026-09-02T12:00:00.000Z', base: null }])
    expect(store.changes).toHaveLength(0)
  })
})
