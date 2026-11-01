import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { READER_STATE } from '@/offline'
import { stampWorker } from '@/stamp'

// The worker itself, not a description of it: `public/sw.js` is read, stamped
// the way the build stamps it, and run in a scope that has just enough of a
// service worker's - listeners, caches, a network that can be switched off.
// The road gate proves a browser does the same; this proves the rules,
// quickly, and says which one broke.

const VERSION = '9.9.9'
const SHELL = `rhapsod-shell-${VERSION}`
/** The app as a build leaves it, give or take the names. */
const APP = ['/index.html', '/assets/index-a1.js', '/assets/index-b2.css', '/favicon.svg', '/manifest.webmanifest']
const RAW = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
const SOURCE = stampWorker(RAW, VERSION, APP)
const ORIGIN = 'http://stand.test'

/**
 * `Request` as the worker sees it: a path is read against the stand it came
 * from, as a browser reads it against the worker's own address.
 */
class StandRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init)
  }
}

type Handler = (event: unknown) => void

/**
 * A Cache Storage that keeps responses in maps, by absolute URL. `addAll`
 * fetches on the worker's network and, like the browser's, puts nothing
 * unless every answer came and was good.
 */
function cacheStorage(fetch: (request: Request) => Promise<Response>) {
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
    addAll: async (requests: Request[]) => {
      const answers = await Promise.all(requests.map(async (request) => ({ request, answer: await fetch(request) })))
      if (answers.some(({ answer }) => !answer.ok)) throw new TypeError('Cache.addAll: a request failed')
      for (const { request, answer } of answers) store.set(key(request), answer)
    },
  })
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, store)
    return cacheOf(store)
  }
  return {
    api: {
      open: (name: string) => Promise.resolve(open(name)),
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
    },
    /** The cache names there are. */
    names: () => [...stores.keys()].sort(),
    /** The paths held under one cache name. */
    held: (name: string) => [...(stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname).sort(),
    put: (name: string, path: string, body: unknown) => open(name).put(path, Response.json(body)),
  }
}

/**
 * The worker, running. `network` answers what the worker fetches; returning
 * `null` plays the stand being out of reach, and a promise a stand that takes
 * its time.
 */
function worker(network: (path: string) => Response | null | Promise<Response | null>) {
  const handlers = new Map<string, Handler>()
  const fetch = (input: string | Request): Promise<Response> => {
    const path = new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname
    return Promise.resolve(network(path)).then((answer) => answer ?? Promise.reject(new TypeError('Failed to fetch')))
  }
  const caches = cacheStorage(fetch)
  const scope = {
    addEventListener: (type: string, handler: Handler) => {
      handlers.set(type, handler)
    },
    location: { origin: ORIGIN },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  }
  // The worker's globals are its parameters here; nothing leaks into the
  // test's own scope.
  new Function('self', 'caches', 'fetch', 'Request', SOURCE)(scope, caches.api, fetch, StandRequest)

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
    /** Installs the worker, as the browser does when it first sees it. */
    async install(): Promise<void> {
      let done: Promise<unknown> = Promise.resolve()
      handlers.get('install')?.({
        waitUntil: (promise: Promise<unknown>) => {
          done = promise
        },
      })
      await done
    },
    /** Lets the worker take over, as a new version does once installed. */
    async activate(): Promise<void> {
      let done: Promise<unknown> = Promise.resolve()
      handlers.get('activate')?.({
        waitUntil: (promise: Promise<unknown>) => {
          done = promise
        },
      })
      await done
    },
    /** Posts a message to the worker and resolves with what it posts back. */
    async post(data: unknown): Promise<unknown[]> {
      const sent = this.send(data)
      await sent.done
      return sent.replies
    },
    /** Posts a message without waiting: the replies fill in as the work ends. */
    send(data: unknown): { replies: unknown[]; done: Promise<unknown> } {
      const replies: unknown[] = []
      let done: Promise<unknown> = Promise.resolve()
      handlers.get('message')?.({
        data,
        source: { postMessage: (reply: unknown) => replies.push(reply) },
        waitUntil: (promise: Promise<unknown>) => {
          done = promise
        },
      })
      return { replies, done }
    },
    /** Asks the worker something on a port of its own, as the page does. */
    ask(data: unknown): unknown {
      let answer: unknown
      handlers.get('message')?.({
        data,
        ports: [
          {
            postMessage: (reply: unknown) => {
              answer = reply
            },
          },
        ],
      })
      return answer
    },
  }
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

describe('the app itself, for the road', () => {
  it('is held whole at install, not file by file as the page asks for it', async () => {
    // The defect this exists for: only the entry was held, the scripts were
    // to be cached "as they are fetched" - and on a first visit they are
    // fetched before any worker is there to see them. The train opened a
    // blank page under "Ready for the road."
    const sw = worker((path) => new Response(path))

    await sw.install()

    expect(sw.caches.held(SHELL)).toEqual([...APP].sort())
  })

  it('holds nothing of it when one file does not come, so this worker never takes over', async () => {
    // Half an app is a blank page. A failed install leaves the worker before
    // it - and its whole shell - answering, which is the browser's rule for a
    // rejected install and the reason it has to reject.
    const sw = worker((path) => (path.endsWith('.css') ? null : new Response(path)))

    await expect(sw.install()).rejects.toThrow()

    expect(sw.caches.held(SHELL)).toEqual([])
  })

  it('opens on the train from what it holds', async () => {
    let reachable = true
    const sw = worker((path) => (reachable ? new Response(`fresh ${path}`) : null))
    await sw.install()

    reachable = false
    const script = await sw.get('/assets/index-a1.js')

    expect(await script?.text()).toBe('fresh /assets/index-a1.js')
  })
})

// That the build stamps the worker at all is the road gate's to prove: an
// unstamped worker asks for a file that does not exist, never installs, and
// every road test with the stand out of reach goes red. A scan of
// vite.config.ts for the right words used to stand in for it.
describe('the worker as built', () => {
  it('takes the files the build made, in order, and the version', () => {
    const built = stampWorker(RAW, '1.2.3', ['/index.html', '/assets/b.js', '/assets/a.js', '/assets/a.js'])
    expect(built).toContain('const SHELL_FILES = ["/assets/a.js","/assets/b.js","/index.html"]')
    expect(built).toContain("const VERSION = '1.2.3'")
    expect(built).not.toContain('__')
  })

  it('refuses a build without the entry every route is answered with', () => {
    expect(() => stampWorker(RAW, '1.2.3', ['/assets/a.js'])).toThrow(/index\.html/)
  })

  it('refuses a worker that has lost the place for the list', () => {
    expect(() => stampWorker(RAW.replace("['__SHELL_FILES__']", '[]'), '1.2.3', APP)).toThrow(/__SHELL_FILES__/)
  })
})

describe('taking over from an older version', () => {
  it('drops a library held in a shape this app does not read, and keeps the rest', async () => {
    // Before v0.15.4 a paragraph was a string of markdown; now it is runs of
    // text. A phone that kept the old copy would open a piece on the train and
    // draw nothing - so the old copy goes, at home, where the update arrived.
    const sw = worker(() => null)
    await sw.caches.put('rhapsod-library', '/api/pieces/a/one', { paragraphs: ['**old** shape'] })
    await sw.caches.put('rhapsod-library-2', '/api/pieces/a/one', { paragraphs: [[{ text: 'new shape' }]] })
    await sw.caches.put('rhapsod-reader', '/api/notes', [])
    await sw.caches.put('rhapsod-shell-0.0.1', '/index.html', 'old app')

    await sw.activate()

    expect(sw.caches.names()).toEqual(['rhapsod-library-2', 'rhapsod-reader'])
    expect(sw.caches.held('rhapsod-library-2')).toEqual(['/api/pieces/a/one'])
  })
})

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
    expect(sw.caches.held('rhapsod-library-2')).toEqual([])
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
    expect(sw.caches.held('rhapsod-library-2')).toContain('/api/pieces/a/three')
  })

  it('reports a whole fill as nothing missed', async () => {
    const sw = worker((path) => json({ path }))
    const replies = await sw.post({ type: 'cache-library', paths })
    expect(replies).toEqual([{ type: 'library-filled', refresh: false, reached: true, missed: [] }])
  })

  it('does not drop pieces after a refresh cut short', async () => {
    // A piece not reached is not known to be gone from the library.
    const sw = worker(() => null)
    await sw.caches.put('rhapsod-library-2', '/api/pieces/old/one', { kept: true })

    await sw.post({ type: 'refresh-library', paths })

    expect(sw.caches.held('rhapsod-library-2')).toEqual(['/api/pieces/old/one'])
  })

  it('runs one fill at a time, however many are asked for', async () => {
    // A second press of "Fetch the library again" while the first was still
    // running started a second pass over every piece, and a refresh deleting
    // what it did not list raced a background fill putting pieces back.
    let fetching = 0
    let most = 0
    const sw = worker(async (path) => {
      fetching += 1
      most = Math.max(most, fetching)
      await new Promise((resolve) => setTimeout(resolve, 1))
      fetching -= 1
      return json({ path })
    })

    const first = sw.send({ type: 'refresh-library', paths })
    const second = sw.send({ type: 'refresh-library', paths })
    await Promise.all([first.done, second.done])

    expect(most).toBe(1)
    expect(first.replies).toHaveLength(1)
    expect(second.replies).toHaveLength(1)
  })

  it('says whether a fill is under way', async () => {
    // Asked of the worker because only it knows: one stopped by the browser
    // part way through comes back with nothing running, and a page counting
    // for itself would wait for a report that is never sent.
    let release: () => void = () => undefined
    const stand = new Promise<void>((resolve) => {
      release = resolve
    })
    const sw = worker(async (path) => {
      await stand
      return json({ path })
    })

    expect(sw.ask({ type: 'fill-status' })).toEqual({ type: 'fill-status', busy: false, last: null })
    const fill = sw.send({ type: 'cache-library', paths })
    expect(sw.ask({ type: 'fill-status' })).toEqual({ type: 'fill-status', busy: true, last: null })

    release()
    await fill.done
    // With the report, too: it travels apart from this answer, and a page
    // told "nothing is running" must not have to wait for it to say why.
    expect(sw.ask({ type: 'fill-status' })).toEqual({
      type: 'fill-status',
      busy: false,
      last: { type: 'library-filled', refresh: false, reached: true, missed: [] },
    })
  })
})
