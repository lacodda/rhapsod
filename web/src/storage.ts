/**
 * Asking the browser to keep what this device holds.
 *
 * By default a browser treats an origin's storage as best effort: under
 * pressure - a phone filling up with photos on a week away - it may clear the
 * caches and IndexedDB of a site it judges unimportant, without asking. Here
 * that is the held library and, worse, the queue of everything the reader did
 * since the last time home, which exists nowhere else yet. Persistent storage
 * is the browser's promise not to do that without the reader's say-so.
 *
 * The browser decides whether to grant it - by how much the site is used,
 * whether it is installed, or by asking - so the request is made at the
 * moments the reader is choosing to keep things here, and the answer is shown
 * on the stand screen rather than assumed.
 *
 * Silent everywhere it is missing: a browser without the API keeps things
 * however it keeps them, and there is nothing for the reader to act on.
 */

/** Whether this browser can be asked at all. */
function manager(): StorageManager | null {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) return null
  const storage = navigator.storage
  return typeof storage.persist === 'function' && typeof storage.persisted === 'function' ? storage : null
}

/** Whether what this device holds is kept until the reader clears it; `null` where the browser cannot say. */
export async function persisted(): Promise<boolean | null> {
  const storage = manager()
  if (!storage) return null
  try {
    return await storage.persisted()
  } catch {
    return null
  }
}

/**
 * Asks for what this device holds to be kept, and says whether it is.
 *
 * Not asked again once granted: some browsers answer a request with a
 * question to the reader, and a question already answered is noise.
 */
export async function keep(): Promise<boolean | null> {
  const storage = manager()
  if (!storage) return null
  try {
    if (await storage.persisted()) return true
    return await storage.persist()
  } catch {
    return null
  }
}

/** Where the device remembers that it asked on its own, unprompted. */
const ASKED = 'rhapsod.persist-asked'

/**
 * Asks once per device, when it first starts keeping the library.
 *
 * Without a tap behind it: the fill starts when the app opens, not when the
 * reader presses anything. A browser that decides by itself - most do -
 * answers quietly; one that asks the reader asks once, here, rather than on
 * every visit. The stand screen asks again whenever the reader changes what
 * the device keeps, which is a choice they are making in that moment.
 */
export function keepOnce(): void {
  try {
    if (localStorage.getItem(ASKED) !== null) return
    localStorage.setItem(ASKED, new Date().toISOString())
  } catch {
    // Storage that refuses a flag - a private window - is storage that will
    // not be kept either way.
    return
  }
  void keep()
}
