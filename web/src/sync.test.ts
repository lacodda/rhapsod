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
    return Promise.resolve({ status: answer, ok: answer < 400 } as Response)
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

beforeEach(() => {
  store.changes = []
  sawServer(true)
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

  it('runs one drain at a time', async () => {
    // The app asks on focus, on the browser reporting a connection, and after
    // every write. Three drains at once would deliver the same change thrice.
    store.changes = [change(1, '/progress/a/first')]
    const calls = answering(204)

    await Promise.all([drain(), drain(), drain()])

    expect(calls).toHaveLength(1)
  })
})
