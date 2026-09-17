import { expect, test, type Page } from '@playwright/test'

/**
 * The library holds: the promise this app exists to make.
 *
 * Every assertion here is about something no unit test can see. The worker
 * registering is the browser's decision; the cache filling is the worker's
 * doing; opening with the stand switched off is the whole point and involves
 * neither. On 2026-09-07 this broke and nothing said so.
 */

/** How long the background fill is given before a test stops waiting. */
const FILL_MS = 20_000

/** Puts the stand out of reach, or back. */
async function reachable(page: Page, yes: boolean): Promise<void> {
  const response = await page.request.get(`/road/reachable?yes=${yes ? 'yes' : 'no'}`)
  expect(response.ok(), 'the road stand should answer its own switch').toBe(true)
}

/** What the worker has actually cached, read from the cache itself. */
async function cached(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const cache = await caches.open('rhapsod-library')
    return (await cache.keys()).map((request) => new URL(request.url).pathname).sort()
  })
}

/** Waits until the worker has cached every path given. */
async function fills(page: Page, paths: string[]): Promise<void> {
  await expect
    .poll(async () => (await cached(page)).filter((path) => paths.includes(path)).length, { timeout: FILL_MS })
    .toBe(paths.length)
}

test.beforeEach(async ({ page }) => {
  await reachable(page, true)
})

test('the worker registers and holds the whole library', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Physics/ })).toBeVisible()

  // The browser's own answer, not ours: a worker the app believes it
  // registered but the browser refused is the failure being guarded against.
  await expect
    .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')) !== undefined), {
      timeout: FILL_MS,
    })
    .toBe(true)

  await fills(page, [
    '/api/library',
    '/api/topics',
    '/api/pieces/01-physics/entropy',
    '/api/pieces/01-physics/light',
    '/api/pieces/02-myths/icarus',
  ])
})

test('the library opens with the stand out of reach', async ({ page }) => {
  await page.goto('/')
  await fills(page, ['/api/library', '/api/pieces/02-myths/icarus'])

  // The train. The app is not reloaded first: this is the reader closing the
  // door behind them and opening the reader on the platform.
  await reachable(page, false)
  await page.reload()

  await expect(page.getByRole('link', { name: /Physics/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Myths/ })).toBeVisible()
})

test('a piece is readable with the stand out of reach', async ({ page }) => {
  await page.goto('/')
  await fills(page, ['/api/pieces/02-myths/icarus'])

  await reachable(page, false)
  await page.reload()

  await page.getByRole('link', { name: /Myths/ }).click()
  await page.getByRole('link', { name: /Icarus/ }).click()
  // The text itself, not the title: a title comes from the index, and an
  // index without the pieces is the gap this proves is closed.
  await expect(page.getByText('Icarus begins here.')).toBeVisible()
})

test('the stand screen says the device is ready for the road', async ({ page }) => {
  await page.goto('/')
  await fills(page, [
    '/api/library',
    '/api/pieces/01-physics/entropy',
    '/api/pieces/01-physics/light',
    '/api/pieces/02-myths/icarus',
  ])

  await page.goto('/stand')
  // The verdict is the answer a reader acts on; a screen that says "ready"
  // while the cache is empty is the defect this whole gate exists for.
  await expect(page.getByRole('heading', { name: 'Ready for the road.' })).toBeVisible({ timeout: FILL_MS })
})

test('a deep link opens with the stand out of reach', async ({ page }) => {
  await page.goto('/')
  await fills(page, ['/api/pieces/01-physics/entropy'])

  await reachable(page, false)
  // Not a reload of a page already open: a navigation the worker has to
  // answer with the app itself, which is a different code path in `sw.js`.
  await page.goto('/read/01-physics/entropy')

  await expect(page.getByText('Entropy begins here.')).toBeVisible()
})

test('keeping one shelf holds that shelf and not the other', async ({ page }) => {
  await page.goto('/stand')

  // Narrow the selection to the shelf with one piece on it.
  await page.getByRole('checkbox', { name: 'All of them' }).uncheck()
  await page.getByRole('checkbox', { name: 'Myths' }).check()

  // A fill only adds, so the shelves dropped leave on the refresh the reader
  // asks for - which is the button below the list.
  await page.getByRole('button', { name: /Fetch the library again/ }).click()

  await expect
    .poll(async () => (await cached(page)).filter((path) => path.startsWith('/api/pieces/')), { timeout: FILL_MS })
    .toEqual(['/api/pieces/02-myths/icarus'])

  // And the index stays, whatever shelves were given up: without it the app
  // cannot start away from the stand at all.
  expect(await cached(page)).toContain('/api/library')
})
