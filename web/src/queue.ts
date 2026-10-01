/**
 * What the reader did while the stand was out of reach.
 *
 * Every change the reader makes is written here first and shown as done
 * immediately, then delivered when the server can be reached (ADR 0003). The
 * store is IndexedDB rather than localStorage: this has to survive the browser
 * deciding to reclaim space on a phone, and it is written from a scroll
 * handler, where a synchronous store would be felt.
 *
 * The queue is ordered and drained in order. Order is what makes a sequence of
 * changes to one thing arrive as the reader made them - marked read, then
 * unread, then read again is three entries, not a set of three facts to
 * reconcile.
 */

const DATABASE = 'rhapsod'
const STORE = 'queue'
const VERSION = 1

/** A change waiting to be delivered. */
export interface Change {
  /** Insertion order, assigned by the store. */
  id?: number
  /** The API path it goes to, without the `/api` prefix. */
  path: string
  method: 'POST' | 'DELETE'
  /** The body as it will be sent, already carrying its device timestamp. */
  body: unknown
  /**
   * What the device knew when the change was made. Kept with the change and
   * never sent: the stand has no use for it, the device does.
   */
  context?: ChangeContext
}

/** What a change remembers about the moment it was made. */
export interface ChangeContext {
  /** For a kept line: when it was kept, so it sorts as it did before. */
  created_at?: string
  /** For a request: the topic as it read, so it can be listed before it lands. */
  title?: string
  section?: string
}

/**
 * Opens the store, creating it on first use.
 *
 * Every call opens its own connection rather than holding one: a held
 * connection blocks a version change in another tab, and the cost of opening
 * an already-created database is a fraction of the write that follows it.
 */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        // The key is the insertion order, which is the delivery order.
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('the local queue could not be opened'))
    }
  })
}

/** Runs one transaction against the queue, closing the connection after it. */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = run(transaction.objectStore(STORE))
      request.onsuccess = () => {
        resolve(request.result as T)
      }
      request.onerror = () => {
        reject(request.error ?? new Error('the local queue could not be used'))
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Changes held in this page because the browser would not keep them.
 *
 * A browser that refuses IndexedDB - some private windows, site data blocked
 * - used to get one attempt at sending each change, and on a train that
 * attempt failed and the change was gone without a word. Held here, a change
 * is retried like any other for as long as the page is open, and the screens
 * say that this is all the keeping it gets.
 *
 * Once the store has refused, everything after goes here too, so the order
 * stays the order the reader made the changes in. The ids are negative so
 * they never meet the store's own.
 */
const memory: Change[] = []
let refused = false
let memoryId = 0

/** Adds a change to the end of the queue, in this page if not on the device. */
export async function enqueue(change: Change): Promise<number> {
  if (!refused) {
    try {
      return await withStore<number>('readwrite', (store) => store.add(change))
    } catch {
      refused = true
    }
  }
  memoryId -= 1
  memory.push({ ...change, id: memoryId })
  return memoryId
}

/** Everything waiting, in the order it was made. */
export async function pending(): Promise<Change[]> {
  let stored: Change[] = []
  try {
    stored = await withStore<Change[]>('readonly', (store) => store.getAll())
  } catch {
    // Nothing on the device to read; what is in the page still counts.
  }
  return [...stored, ...memory]
}

/** How many waiting changes live only in this page, and go when it closes. */
export const unkept = (): number => memory.length

/** Forgets a change that has been delivered. */
export async function forget(id: number): Promise<undefined> {
  if (id < 0) {
    const at = memory.findIndex((change) => change.id === id)
    if (at !== -1) memory.splice(at, 1)
    return undefined
  }
  return withStore<undefined>('readwrite', (store) => store.delete(id))
}

/** How many changes are waiting, on the device and in this page. */
export async function waiting(): Promise<number> {
  let stored = 0
  try {
    stored = await withStore<number>('readonly', (store) => store.count())
  } catch {
    // As in `pending`: the page's own still count.
  }
  return stored + memory.length
}

/** Empties the queue. Used by the tests; the app drains rather than clears. */
export const clear = (): Promise<undefined> => withStore<undefined>('readwrite', (store) => store.clear())

/**
 * An identity for one act of keeping a line.
 *
 * Minted on the device so that a quote delivered twice - the app retried after
 * a connection dropped mid-drain - lands once on the server. `randomUUID` is
 * unavailable on a page served over plain HTTP, which a stand on a home
 * network is, so there is a fallback rather than a crash on the one deployment
 * this product actually has.
 */
export function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
