import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { READER_STATE } from '@/offline'

// The worker itself, not a description of it: `public/sw.js` is read and run
// in a scope that has just enough of a service worker's - listeners, caches,
// a network that can be switched off. The road gate proves a browser does the
// same; this proves the rules, quickly, and says which one broke.

const SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'http://stand.test'

type Handler = (event: unknown) => void

/** A Cache Storage that keeps responses in maps, by absolute URL. */
function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>()
  const key = (request: string | Request): string =>
    new URL(typeof request === 'string' ? request : request.url, ORIGIN).href
  const cacheOf = (store: Map<string, Response>) => ({
    match: (request: string | Request) => Promise.resolve(store.get(key(request))?.clone()),
    put: (request: string | Request, response: Response) => {
      store.set(key(request), response)
      return Promise.resolve()
    },
    delete: (request: string | Request) => Promise.resolve(store.delete(key(request))),
    keys: () => Promise.resolve([...store.keys()].map((url) => new Request(url))),
  })
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, store)
    return cacheOf(store)
  }
  return {
    api: { open: (name: string) => Promise.resolve(open(name)) },
    /** The paths held under one cache name. */
    held: (name: string) => [...(stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname).sort(),
    put: (name: string, path: string, body: unknown) => open(name).put(path, Response.json(body)),
  }
}

/**
 * The worker, running. `network` answers what the worker fetches; returning
 * `null` plays the stand being out of reach.
 */
function worker(network: (path: string) => Response | null) {
  const handlers = new Map<string, Handler>()
  const caches = cacheStorage()
  const scope = {
    addEventListener: (type: string, handler: Handler) => {
      handlers.set(type, handler)
    },
    location: { origin: ORIGIN },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  }
  const fetch = (input: string | Request): Promise<Response> => {
    const path = new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname
    const answer = network(path)
    return answer ? Promise.resolve(answer) : Promise.reject(new TypeError('Failed to fetch'))
  }
  // The worker's globals are its parameters here; nothing leaks into the
  // test's own scope.
  new Function('self', 'caches', 'fetch', SOURCE)(scope, caches.api, fetch)

  return {
    caches,
    /** Fetches a path through the worker, as a page it controls would. */
    async get(path: string): Promise<Response | undefined> {
      let answer: Promise<Response> | undefined
      handlers.get('fetch')?.({
        request: new Request(`${ORIGIN}${path}`),
        respondWith: (response: Promise<Response>) => {
          answer = response
        },
      })
      return answer
    },
    /** Posts a message to the worker and resolves with what it posts back. */
    async post(data: unknown): Promise<unknown[]> {
      const replies: unknown[] = []
      let work: Promise<unknown> = Promise.resolve()
      handlers.get('message')?.({
        data,
        source: { postMessage: (reply: unknown) => replies.push(reply) },
        waitUntil: (promise: Promise<unknown>) => {
          work = promise
        },
      })
      await work
      return replies
    },
  }
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

describe('the reader state, away from home', () => {
  it('is held on the way past, from every read the app makes at the start', async () => {
    const sw = worker((path) => json({ path }))

    for (const path of READER_STATE) await sw.get(path)

    expect(sw.caches.held('rhapsod-reader')).toEqual([...READER_STATE].sort())
  })

  it('answers from what it holds when the stand is out of reach', async () => {
    // The defect this exists for: started on a train, the app had no notes,
    // the editor offered "+ Write a note" on a piece that had one, and the
    // note written there replaced it.
    let reachable = true
    const sw = worker((path) => (reachable ? json(path === '/api/notes' ? [{ piece_id: 'a/b', body: 'home' }] : []) : null))
    await sw.get('/api/notes')

    reachable = false
    const answer = await sw.get('/api/notes')

    expect(await answer?.json()).toEqual([{ piece_id: 'a/b', body: 'home' }])
  })

  it('forgets the reader state when the stand says this device is signed out', async () => {
    let status = 200
    const sw = worker(() => json([{ piece_id: 'a/b', body: 'private' }], status))
    await sw.get('/api/notes')

    status = 401
    await sw.get('/api/notes')

    expect(sw.caches.held('rhapsod-reader')).toEqual([])
  })

  it('keeps the reader state out of the library cache, which a refresh empties', async () => {
    const sw = worker(() => json([]))
    await sw.get('/api/notes')
    expect(sw.caches.held('rhapsod-library')).toEqual([])
  })
})

describe('an answer from the cache', () => {
  it('says it came from the cache, so the app does not count it as the stand', async () => {
    let reachable = true
    const sw = worker(() => (reachable ? json({ sections: [], pieces: [] }) : null))
    await sw.get('/api/library')

    reachable = false
    const answer = await sw.get('/api/library')

    expect(answer?.headers.get('x-rhapsod-cached')).toBe('1')
    expect(await answer?.json()).toEqual({ sections: [], pieces: [] })
  })

  it('says nothing of the kind when the stand answered', async () => {
    const sw = worker(() => json({ sections: [], pieces: [] }))
    const answer = await sw.get('/api/library')
    expect(answer?.headers.get('x-rhapsod-cached')).toBeNull()
  })
})

describe('filling the library', () => {
  const paths = ['/api/library', '/api/topics', '/api/pieces/a/one', '/api/pieces/a/two', '/api/pieces/a/three']

  it('reports a refresh that the stand walked away from', async () => {
    // It used to stop at the first failed fetch and say nothing, and the
    // stand screen took the silence for success.
    const sw = worker((path) => (path === '/api/pieces/a/two' || path === '/api/pieces/a/three' ? null : json({ path })))

    const replies = await sw.post({ type: 'refresh-library', paths })

    expect(replies).toEqual([
      {
        type: 'library-filled',
        refresh: true,
        reached: false,
        missed: ['/api/pieces/a/two', '/api/pieces/a/three'],
      },
    ])
  })

  it('reports the pieces the stand would not give, and fetches the rest', async () => {
    const sw = worker((path) => (path === '/api/pieces/a/two' ? json({ error: 'no' }, 500) : json({ path })))

    const replies = await sw.post({ type: 'refresh-library', paths })

    expect(replies).toEqual([{ type: 'library-filled', refresh: true, reached: true, missed: ['/api/pieces/a/two'] }])
    expect(sw.caches.held('rhapsod-library')).toContain('/api/pieces/a/three')
  })

  it('reports a whole fill as nothing missed', async () => {
    const sw = worker((path) => json({ path }))
    const replies = await sw.post({ type: 'cache-library', paths })
    expect(replies).toEqual([{ type: 'library-filled', refresh: false, reached: true, missed: [] }])
  })

  it('does not drop pieces after a refresh cut short', async () => {
    // A piece not reached is not known to be gone from the library.
    const sw = worker(() => null)
    await sw.caches.put('rhapsod-library', '/api/pieces/old/one', { kept: true })

    await sw.post({ type: 'refresh-library', paths })

    expect(sw.caches.held('rhapsod-library')).toEqual(['/api/pieces/old/one'])
  })
})
