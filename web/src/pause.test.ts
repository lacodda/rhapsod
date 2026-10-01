import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { afterPause } from '@/pause'

// The pause is a timer, and the defect was a timer dropped with the screen
// that owned it: a reader who typed a last sentence and left the piece - or
// closed the app - within the pause lost that sentence.

/** A page whose leaving and hiding a test can fire. */
function page() {
  const handlers = new Map<string, () => void>()
  const listen = (name: string, handler: () => void): void => {
    handlers.set(name, handler)
  }
  const forget = (name: string): void => {
    handlers.delete(name)
  }
  const doc = { visibilityState: 'visible', addEventListener: listen, removeEventListener: forget }
  vi.stubGlobal('window', { addEventListener: listen, removeEventListener: forget })
  vi.stubGlobal('document', doc)
  return {
    fire: (name: string): void => {
      handlers.get(name)?.()
    },
    hide: (): void => {
      doc.visibilityState = 'hidden'
      handlers.get('visibilitychange')?.()
    },
    listening: (): number => handlers.size,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('afterPause', () => {
  it('saves the latest text once the typing stops', () => {
    page()
    const saved: string[] = []
    const pause = afterPause((text) => saved.push(text), 800)

    pause.typed('A')
    vi.advanceTimersByTime(500)
    pause.typed('A line')
    vi.advanceTimersByTime(799)
    expect(saved).toEqual([])

    vi.advanceTimersByTime(1)
    expect(saved).toEqual(['A line'])
  })

  it('saves at once when the screen goes, instead of dropping the wait', () => {
    page()
    const saved: string[] = []
    const pause = afterPause((text) => saved.push(text), 800)

    pause.typed('The last sentence.')
    pause.stop()

    expect(saved).toEqual(['The last sentence.'])
    // And not a second time when the old timer would have fired.
    vi.advanceTimersByTime(1000)
    expect(saved).toEqual(['The last sentence.'])
  })

  it('saves when the page is closed', () => {
    const at = page()
    const saved: string[] = []
    const pause = afterPause((text) => saved.push(text), 800)

    pause.typed('Typed on the platform.')
    at.fire('pagehide')

    expect(saved).toEqual(['Typed on the platform.'])
  })

  it('saves when the app goes to the background', () => {
    // On a phone this is how an app is closed: hidden first, then gone.
    const at = page()
    const saved: string[] = []
    const pause = afterPause((text) => saved.push(text), 800)

    pause.typed('Before the doors closed.')
    at.hide()

    expect(saved).toEqual(['Before the doors closed.'])
  })

  it('saves nothing when nothing is waiting', () => {
    const at = page()
    const saved: string[] = []
    const pause = afterPause((text) => saved.push(text), 800)

    at.fire('pagehide')
    pause.stop()

    expect(saved).toEqual([])
  })

  it('stops watching the page when it stops', () => {
    const at = page()
    afterPause(() => undefined, 800).stop()
    expect(at.listening()).toBe(0)
  })
})
