/**
 * Opening the drawer with a drag from the edge of the screen.
 *
 * The gesture a phone reader reaches for without being told. Written on
 * pointer events rather than pulled in as a library: there is one gesture
 * here, and it is smaller than any dependency that would do it.
 *
 * What a drag *means* lives in `gesture.ts`, which needs no browser to test.
 * This file is only the wiring: listen, ask, act.
 */

import { useEffect } from 'react'

import { begins, judge, type Start } from '@/gesture'

export function useEdgeSwipe(onOpen: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined

    let start: Start | null = null

    const onDown = (event: PointerEvent): void => {
      const candidate: Start = { x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' }
      start = begins(candidate) ? candidate : null
    }

    const onMove = (event: PointerEvent): void => {
      if (!start) return
      switch (judge(start, event.clientX, event.clientY)) {
        case 'open':
          start = null
          onOpen()
          break
        case 'abandon':
          start = null
          break
        default:
          break
      }
    }

    const stop = (): void => {
      start = null
    }

    // Passive: this never calls `preventDefault`, and saying so up front lets
    // the browser scroll without waiting to hear from us - which is the
    // difference between reading smoothly and reading in steps.
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', stop, { passive: true })
    window.addEventListener('pointercancel', stop, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    // `onOpen` has to be a stable callback: a fresh function every render
    // would tear these listeners down and rebuild them each time.
  }, [onOpen, enabled])
}
