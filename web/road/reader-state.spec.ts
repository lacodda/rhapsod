import { expect, test, type Page } from '@playwright/test'

/**
 * What the reader did survives the road.
 *
 * The library holding is the other spec. This one is the reader's own side -
 * notes, marks, the queue - which fails in ways the library cannot: a note
 * that is not there on the train gets written over, a queue that meets a
 * signed-out stand gets thrown away, and a screen that takes the worker's
 * copy for the stand says the stand is there when it is not. Each was found
 * by reading the code a week before a week of reading away from home; these
 * are the browser's word that they are closed.
 */

/** How long the background work is given before a test stops waiting. */
const FILL_MS = 20_000

/** Asks the road stand to do something to itself. */
async function road(page: Page, path: string): Promise<void> {
  const response = await page.request.get(path)
  expect(response.ok(), `the road stand should answer ${path}`).toBe(true)
}

/** Puts the stand out of reach, or back. */
const reachable = (page: Page, yes: boolean): Promise<void> => road(page, `/road/reachable?yes=${yes ? 'yes' : 'no'}`)

/** What one cache holds, read from the cache itself. */
async function held(page: Page, cache: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    const opened = await caches.open(name)
    return (await opened.keys()).map((request) => new URL(request.url).pathname).sort()
  }, cache)
}

/** Waits until a cache holds every path given. */
async function holds(page: Page, cache: string, paths: string[]): Promise<void> {
  await expect
    .poll(async () => (await held(page, cache)).filter((path) => paths.includes(path)).length, { timeout: FILL_MS })
    .toBe(paths.length)
}

/** The paths of everything waiting in the queue, read from IndexedDB. */
async function queued(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const opening = indexedDB.open('rhapsod')
        opening.onerror = () => {
          reject(new Error('the queue would not open'))
        }
        opening.onsuccess = () => {
          const db = opening.result
          const reading = db.transaction('queue', 'readonly').objectStore('queue').getAll()
          reading.onsuccess = () => {
            resolve((reading.result as { path: string }[]).map((change) => change.path))
            db.close()
          }
        }
      }),
  )
}

/** What the road stand accepted, in order. */
async function received(page: Page): Promise<{ method: string; path: string; body: unknown }[]> {
  return (await (await page.request.get('/road/received')).json()) as { method: string; path: string; body: unknown }[]
}

/** Opens the piece every test reads. */
async function openIcarus(page: Page): Promise<void> {
  await page.getByRole('link', { name: /Myths/ }).click()
  await page.getByRole('link', { name: /Icarus/ }).click()
  await expect(page.getByText('Icarus begins here.')).toBeVisible()
}

// The road stand keeps notes, writes and a session between requests; every
// test starts from the same one, and leaves it that way for the other spec.
test.beforeEach(async ({ page }) => {
  await road(page, '/road/reset')
})

test.afterEach(async ({ page }) => {
  await road(page, '/road/reset')
})

test('the reader\'s note is there with the stand out of reach', async ({ page }) => {
  await page.goto('/')
  await holds(page, 'rhapsod-library', ['/api/library', '/api/pieces/02-myths/icarus'])
  // The first visit's reads went past a worker that was still installing;
  // the note is held only because the app reads it again once it can.
  await holds(page, 'rhapsod-reader', ['/api/notes'])

  await reachable(page, false)
  await page.reload()
  await openIcarus(page)

  // The note itself, in the editor - not "+ Write a note" over the top of it.
  await expect(page.getByPlaceholder('What this left you with.')).toHaveValue('A note written at home.')
})

test('a note written with nothing held tells the stand it did not know the note', async ({ page }) => {
  await page.goto('/')
  await holds(page, 'rhapsod-library', ['/api/library', '/api/pieces/02-myths/icarus'])

  // The defect's own starting point: away from home with none of the
  // reader's marks on the device, so the piece looks as if it had no note.
  await page.evaluate(async () => {
    await caches.delete('rhapsod-reader')
  })
  await reachable(page, false)
  await page.reload()
  await openIcarus(page)

  await page.getByRole('button', { name: '+ Write a note' }).click()
  await page.getByPlaceholder('What this left you with.').fill('Written on the train.')
  await expect.poll(async () => queued(page), { timeout: FILL_MS }).toContain('/notes/02-myths/icarus')

  // Home again: opening the app delivers the queue. What the stand does
  // with a note it was told the reader never saw - keeps its own, then this
  // one - is the stand's rule and is proved against the real one, in
  // `src/marks.rs`; this is the browser's half, saying so.
  await reachable(page, true)
  await page.reload()

  await expect
    .poll(async () => (await received(page)).find((write) => write.path === '/api/notes/02-myths/icarus')?.body, {
      timeout: FILL_MS,
    })
    .toMatchObject({ body: 'Written on the train.', base: null })
})

test('a note typed just before leaving the piece is kept', async ({ page }) => {
  await page.goto('/')
  await holds(page, 'rhapsod-library', ['/api/library', '/api/pieces/02-myths/icarus'])
  await holds(page, 'rhapsod-reader', ['/api/notes'])

  await reachable(page, false)
  await page.reload()
  await openIcarus(page)

  // Typed, and gone back to the shelf straight away - well inside the pause
  // the editor waits before it saves. The wait used to be dropped with the
  // screen, and the sentence with it.
  await page.getByPlaceholder('What this left you with.').fill('A note written at home. And a last line.')
  await page.getByRole('link', { name: 'Myths', exact: true }).click()

  await expect.poll(async () => queued(page), { timeout: FILL_MS }).toContain('/notes/02-myths/icarus')
})

test('a browser that will not keep the queue holds it in the page and says so', async ({ page }) => {
  // IndexedDB refused, as some private windows and blocked site data do.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('refused', 'InvalidStateError')
    }
  })
  await page.goto('/')
  await holds(page, 'rhapsod-library', ['/api/library', '/api/pieces/02-myths/icarus'])

  await reachable(page, false)
  await page.reload()
  await openIcarus(page)
  await page.getByRole('button', { name: 'Loved' }).click()

  // Not "kept on this device": it is not, and closing the page loses it.
  await expect(page.getByText(/held in this page/)).toBeVisible()

  // And it is not lost while the page lives: home, the browser reports a
  // connection, and the mark goes.
  await reachable(page, true)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect
    .poll(async () => (await received(page)).some((write) => write.method === 'POST' && write.path === '/api/bookmarks/02-myths/icarus'), {
      timeout: FILL_MS,
    })
    .toBe(true)
})

test('the app says the stand is away when the worker answers instead', async ({ page }) => {
  await page.goto('/')
  await holds(page, 'rhapsod-library', ['/api/library', '/api/pieces/02-myths/icarus'])

  await reachable(page, false)
  await page.reload()

  // Every answer on this page came from the worker's copy. Counted as the
  // stand answering, they hid this line on exactly the screens it is for.
  await expect(page.getByText('the stand is away')).toBeVisible()

  await openIcarus(page)
  // And the end of the piece does not claim the library is read out.
  await expect(page.getByText(/The stand picks what comes next, and it is out of reach/)).toBeVisible()
  await expect(page.getByText('That was the last unread piece.')).toHaveCount(0)
})

test('fetching the library again away from home says it did not', async ({ page }) => {
  await page.goto('/stand')
  await expect(page.getByRole('heading', { name: 'Ready for the road.', exact: true })).toBeVisible({ timeout: FILL_MS })
  // Whether the browser promised to keep it is said, one way or the other.
  await expect(page.getByText(/^until (you clear it|the browser needs the space)$/)).toBeVisible()

  await reachable(page, false)
  await page.getByRole('button', { name: /Fetch the library again/ }).click()

  // Against the worker's copy of the index this "worked": it fetched
  // nothing, waited, and went quiet.
  await expect(page.getByText('The stand is out of reach; the copy on this device is unchanged.')).toBeVisible()
})

test('a refresh that falls short says which part it did not get', async ({ page }) => {
  await page.goto('/stand')
  await expect(page.getByRole('heading', { name: 'Ready for the road.', exact: true })).toBeVisible({ timeout: FILL_MS })

  await road(page, '/road/refuse?path=/api/pieces/01-physics/light')
  await page.getByRole('button', { name: /Fetch the library again/ }).click()

  // Said by the worker when it is done - the count alone cannot tell a
  // refresh that worked from one that left a piece as it was.
  await expect(
    page.getByText('The stand did not give 1 of 3 pieces; the copies of those on this device are as they were.'),
  ).toBeVisible({ timeout: FILL_MS })
})

test('changes kept through a sign-out are delivered after signing in', async ({ page }) => {
  await road(page, '/road/session?state=live')
  await page.goto('/')
  await holds(page, 'rhapsod-library', ['/api/library', '/api/pieces/02-myths/icarus'])

  // On the train: a piece is marked, and the mark waits in the queue.
  await reachable(page, false)
  await page.reload()
  await openIcarus(page)
  await page.getByRole('button', { name: 'Loved' }).click()
  await expect.poll(async () => queued(page), { timeout: FILL_MS }).toContain('/bookmarks/02-myths/icarus')

  // Home, after "Sign out everywhere" from another device. Opening the app
  // drains the queue before the sign-in screen has drawn - and every change
  // answered 401 and was thrown away.
  await road(page, '/road/session?state=ended')
  await reachable(page, true)
  await page.reload()
  await expect(page.getByText('The password for this library')).toBeVisible()
  await expect.poll(async () => queued(page), { timeout: FILL_MS }).toContain('/bookmarks/02-myths/icarus')

  await page.getByLabel('The password for this library').fill('a passphrase')
  await page.getByRole('button', { name: 'Read', exact: true }).click()

  await expect
    .poll(async () => (await received(page)).some((write) => write.method === 'POST' && write.path === '/api/bookmarks/02-myths/icarus'), {
      timeout: FILL_MS,
    })
    .toBe(true)
})
