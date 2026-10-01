/**
 * Saving what is typed after a pause, without losing the last of it.
 *
 * A note is saved when the typing stops for a moment rather than on every
 * key. The moment used to be a timer that was simply dropped when the reader
 * went - left the piece, or put the app in the background, which on a phone is
 * how an app gets closed - and the last sentence typed went with it. Here the
 * pause is cut short instead: going saves at once. Saving is a write to the
 * local queue, quick and with nothing to wait for, so going early costs
 * nothing.
 */

/** A pause in the typing, and what happens at the end of it. */
export interface Pause {
  /** The reader typed: save this once the typing stops. */
  typed: (text: string) => void
  /** Saves now whatever is waiting for the pause. */
  flush: () => void
  /** Stops watching the page, saving whatever is waiting first. */
  stop: () => void
}

/** Saves the latest text `delay` ms after the typing stops, or when the page goes. */
export function afterPause(save: (text: string) => void, delay: number): Pause {
  let waiting: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (waiting === null) return
    const text = waiting
    waiting = null
    save(text)
  }

  // `pagehide` for a page being closed or navigated away from; hidden for an
  // app sent to the background, which a phone may close without another word.
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    typed: (text) => {
      waiting = text
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(flush, delay)
    },
    flush,
    stop: () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    },
  }
}
