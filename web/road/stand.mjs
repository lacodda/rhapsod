/**
 * A stand for the road gate: the built app, and an API that can be switched off.
 *
 * Not the real server. The gate is about what the browser and the service
 * worker do - whether the worker registers, whether it fills the cache,
 * whether the app opens with the stand out of reach - and none of that is
 * about how the JSON was produced. Using the Rust binary here would mean a
 * Rust toolchain and a published library in a job that is testing a browser.
 *
 * What it must match exactly is the shape of the paths, because those are the
 * contract the worker caches against: `/api/library`, `/api/topics` and
 * `/api/pieces/<section>/<piece>`. A test that fetched different paths from
 * the real thing would pass while the reader's train was silent.
 */

import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const PORT = 8099

/** Two shelves, so the gate can prove a selection holds one and not the other. */
const SECTIONS = [
  { id: '01-physics', number: 1, title: 'Physics', pieces: 2 },
  { id: '02-myths', number: 2, title: 'Myths', pieces: 1 },
]

const PIECES = [
  { id: '01-physics/entropy', section: '01-physics', title: 'Entropy', written: '2026-01-02', words: 1200 },
  { id: '01-physics/light', section: '01-physics', title: 'Light', written: '2026-01-03', words: 1100 },
  { id: '02-myths/icarus', section: '02-myths', title: 'Icarus', written: '2026-01-04', words: 1300 },
]

const summary = (piece) => ({ ...piece, one_liner: `One line about ${piece.title}.` })

/**
 * What an untouched reader's side looks like, per endpoint.
 *
 * Not one shape: `/api/reviews` answers `{due}`, `/api/progress` answers a
 * record with statistics, and the rest answer bare lists. Handing back `[]`
 * for all of them let the app read `.due.length` of undefined and die before
 * anything rendered - which every test then reported as its own locator
 * timing out, a long way from the cause.
 */
const EMPTY = {
  '/api/progress': { pieces: [], stats: { read: 0, words: 0, streak: 0 }, continue_with: null },
  '/api/reviews': { due: [] },
  '/api/report': { read: 0, unfinished: 0, untouched: 0, good: 0, struck: 0, typos: 0, abandoned: [] },
  '/api/journal': { months: [], scheduled: 0, recalled: 0, history: [] },
}

const whole = (piece) => ({
  ...summary(piece),
  paragraphs: [`${piece.title} begins here.`, 'And carries on for a paragraph or two.'],
  neighbours: [],
  song: [],
  reference: [],
})

/**
 * Whether the API answers at all.
 *
 * The gate turns this off to play being on a train: the app and the worker
 * are left exactly as they were, and only the stand goes away - which is what
 * actually happens when the reader leaves the house.
 */
let reachable = true

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function json(response, body, status = 200) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  response.end(payload)
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`)
  const path = url.pathname

  // The switch itself, so a test can put the stand out of reach without
  // killing the process the browser is talking to.
  if (path === '/road/reachable') {
    reachable = url.searchParams.get('yes') !== 'no'
    json(response, { reachable })
    return
  }

  if (path.startsWith('/api/')) {
    if (!reachable) {
      // Destroyed rather than answered with a status: a stand out of reach
      // does not reply, and a 503 would be a different thing to handle.
      request.destroy()
      return
    }
    if (path === '/api/health') {
      json(response, { status: 'ok', version: '0.13.0', pieces: PIECES.length, indexed_seconds_ago: 12 })
      return
    }
    if (path === '/api/session') {
      json(response, { open: true, reader: true })
      return
    }
    if (path === '/api/library') {
      json(response, { sections: SECTIONS, pieces: PIECES.map(summary) })
      return
    }
    if (path === '/api/topics') {
      json(response, {
        shelves: [{ id: '01-physics', title: 'Physics', topics: [{ id: '01-physics/heat', title: 'Heat', section: '01-physics' }] }],
      })
      return
    }
    if (path.startsWith('/api/pieces/')) {
      const piece = PIECES.find((held) => held.id === path.slice('/api/pieces/'.length))
      if (!piece) {
        json(response, { error: 'no such piece' }, 404)
        return
      }
      json(response, whole(piece))
      return
    }
    // The rest of the reader's side starts empty - but empty has a different
    // shape per endpoint, and answering the wrong one crashes the app on the
    // first render rather than failing any assertion here.
    json(response, EMPTY[path] ?? [])
    return
  }

  void serve(path, response)
})

/** The built app. Anything that is not a file is the app's own entry point. */
async function serve(path, response) {
  const wanted = normalize(join(DIST, path === '/' ? 'index.html' : path))
  // A path that climbs out of dist is not a file this stand has.
  const file = wanted.startsWith(DIST) ? wanted : join(DIST, 'index.html')
  let target = file
  try {
    const found = await stat(file)
    if (!found.isFile()) target = join(DIST, 'index.html')
  } catch {
    // A client route: every one of them is the same document.
    target = join(DIST, 'index.html')
  }
  const type = TYPES[extname(target)] ?? 'application/octet-stream'
  // The worker must not be served from the browser's HTTP cache, or a test
  // would register the one a previous run left behind.
  const headers = { 'content-type': type, 'cache-control': 'no-cache' }
  if (extname(target) === '.js' && target.endsWith('sw.js')) {
    // Chrome refuses a worker whose script is served with the wrong type.
    headers['service-worker-allowed'] = '/'
  }
  response.writeHead(200, headers)
  createReadStream(target).pipe(response)
}

// Fail loudly if the app was never built: an empty dist would let every test
// "pass" against a 404 page.
try {
  await readFile(join(DIST, 'index.html'))
} catch {
  console.error('dist/index.html is missing - run `pnpm build` before the road gate')
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`road stand on http://localhost:${PORT}`)
})
