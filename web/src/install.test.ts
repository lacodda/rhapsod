import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The module under test, freshly imported.
 *
 * The kept offer lives in module scope - a browser fires the event once per
 * page, so that is where it belongs - which means a test that leaves one
 * behind would hand it to the next. Each test gets its own module.
 */
let install: typeof import('@/install').install
let offerable: typeof import('@/install').offerable
let standalone: typeof import('@/install').standalone
let watchForInstall: typeof import('@/install').watchForInstall
let watchOffer: typeof import('@/install').watchOffer

/** A window that records its listeners, so a test can fire them. */
function windowWith(matches: boolean) {
  const handlers = new Map<string, (event: Event) => void>()
  const fake = {
    addEventListener: (name: string, handler: (event: Event) => void) => {
      handlers.set(name, handler)
    },
    matchMedia: () => ({ matches }),
  }
  vi.stubGlobal('window', fake)
  vi.stubGlobal('navigator', {})
  return {
    fire: (name: string, event: Partial<Event> = {}) => {
      handlers.get(name)?.({ preventDefault: () => undefined, ...event } as Event)
    },
    listening: (name: string) => handlers.has(name),
  }
}

/** The event a browser hands over, as far as this module uses it. */
function prompt(outcome: 'accepted' | 'dismissed') {
  const raised = vi.fn(async () => undefined)
  return {
    event: { preventDefault: () => undefined, prompt: raised, userChoice: Promise.resolve({ outcome }) },
    raised,
  }
}

beforeEach(async () => {
  vi.resetModules()
  ;({ install, offerable, standalone, watchForInstall, watchOffer } = await import('@/install'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('standalone', () => {
  it('knows an installed app by its display mode', () => {
    windowWith(true)
    expect(standalone()).toBe(true)
  })

  it('knows a browser tab is not an installed app', () => {
    windowWith(false)
    expect(standalone()).toBe(false)
  })

  it('knows the older iOS answer', () => {
    windowWith(false)
    vi.stubGlobal('navigator', { standalone: true })
    expect(standalone()).toBe(true)
  })

  it('is not standalone where the query throws', () => {
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('unsupported')
      },
    })
    vi.stubGlobal('navigator', {})
    expect(standalone()).toBe(false)
  })
})

describe('the install offer', () => {
  it('keeps the browser from showing its own bar', () => {
    const win = windowWith(false)
    watchForInstall()
    const prevented = vi.fn()
    win.fire('beforeinstallprompt', { preventDefault: prevented } as unknown as Event)
    // Left alone, the browser's bar covers the text being read.
    expect(prevented).toHaveBeenCalled()
  })

  it('tells a screen that is already open when the offer arrives', () => {
    const win = windowWith(false)
    watchForInstall()
    const told = vi.fn()
    watchOffer(told)
    expect(offerable()).toBe(false)
    win.fire('beforeinstallprompt', prompt('accepted').event as unknown as Event)
    expect(offerable()).toBe(true)
    expect(told).toHaveBeenCalled()
  })

  it('raises the kept prompt and reports that it was accepted', async () => {
    const win = windowWith(false)
    watchForInstall()
    const { event, raised } = prompt('accepted')
    win.fire('beforeinstallprompt', event as unknown as Event)
    await expect(install()).resolves.toBe(true)
    expect(raised).toHaveBeenCalled()
  })

  it('reports a prompt the reader turned down', async () => {
    const win = windowWith(false)
    watchForInstall()
    win.fire('beforeinstallprompt', prompt('dismissed').event as unknown as Event)
    await expect(install()).resolves.toBe(false)
  })

  it('spends the offer, so a second press raises nothing', async () => {
    const win = windowWith(false)
    watchForInstall()
    const { event, raised } = prompt('accepted')
    win.fire('beforeinstallprompt', event as unknown as Event)
    await install()
    expect(offerable()).toBe(false)
    await expect(install()).resolves.toBe(false)
    // A browser fires the event again if it still applies; raising a spent
    // one would show a prompt that does nothing.
    expect(raised).toHaveBeenCalledTimes(1)
  })

  it('has nothing to raise before the browser offers', async () => {
    windowWith(false)
    watchForInstall()
    await expect(install()).resolves.toBe(false)
  })

  it('drops the offer once the app is installed', () => {
    const win = windowWith(false)
    watchForInstall()
    win.fire('beforeinstallprompt', prompt('accepted').event as unknown as Event)
    expect(offerable()).toBe(true)
    win.fire('appinstalled')
    expect(offerable()).toBe(false)
  })

  it('survives a prompt the browser refuses to raise', async () => {
    const win = windowWith(false)
    watchForInstall()
    win.fire('beforeinstallprompt', {
      preventDefault: () => undefined,
      prompt: () => Promise.reject(new Error('already shown')),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    } as unknown as Event)
    await expect(install()).resolves.toBe(false)
  })
})
