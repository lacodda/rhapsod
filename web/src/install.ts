/**
 * Putting the reader on the phone's own screen.
 *
 * An installed reader opens without browser chrome and, more to the point,
 * is found the way anything else on a phone is found - by its icon, not by
 * remembering an address on a home network. For a library carried on a train
 * that is the difference between being read and being meant to be read.
 *
 * The browser decides when this is possible and says so once, by firing
 * `beforeinstallprompt`. The event has to be caught before the app has
 * rendered anything - hence a module that starts listening on import - and
 * kept, because the prompt can only be raised from it.
 *
 * Browsers that never fire it are not failing: iOS installs from the share
 * sheet and offers nothing to press, so the screen says how instead of
 * showing a button that could not work.
 */

/** The event browsers fire when the app could be installed. Not in lib.dom. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** The kept event, or `null` when the browser has not offered. */
let offered: InstallPrompt | null = null

type Listener = () => void
const listeners = new Set<Listener>()

/** Whether the app is already running as an installed app. */
export function standalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    // The media query is the standard answer; `navigator.standalone` is how
    // older iOS says the same thing and is still what it answers to.
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    return (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** Whether there is a prompt to raise. */
export function offerable(): boolean {
  return offered !== null
}

/** Watches for the offer arriving or being used up. Returns the unsubscribe. */
export function watchOffer(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function tell(): void {
  for (const listener of listeners) listener()
}

/**
 * Raises the browser's install prompt.
 *
 * Resolves to whether the reader accepted. The event is spent either way: a
 * browser fires `beforeinstallprompt` again if it still applies, and keeping
 * a used one would raise a prompt that does nothing.
 */
export async function install(): Promise<boolean> {
  const prompt = offered
  if (!prompt) return false
  offered = null
  tell()
  try {
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    return outcome === 'accepted'
  } catch {
    // A prompt the browser refused to raise - one already shown, or a page
    // that lost the user gesture on the way here.
    return false
  }
}

/**
 * Starts listening. Called once, from the app's entry point.
 *
 * Separate from the module body so that importing this file in a test does
 * not attach listeners to a window the test did not ask about.
 */
export function watchForInstall(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this the browser shows its own bar, which on a phone covers the
    // text being read. The offer is kept and made on the stand screen, where
    // a reader is already deciding how this device should hold the library.
    event.preventDefault()
    offered = event as InstallPrompt
    tell()
  })
  window.addEventListener('appinstalled', () => {
    offered = null
    tell()
  })
}
