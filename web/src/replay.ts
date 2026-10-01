/**
 * The reader's own state, with the queue counted in.
 *
 * What a store loads is the state as the stand last knew it - from the stand
 * at home, from the worker's copy away from it. Everything the reader did
 * since, and the stand has not heard about, is in the queue. Shown without
 * it, an app reopened on a train forgot every line kept since the last time
 * home: the changes were safe and would be delivered, but the screen said
 * they never happened, and a note written that morning showed as "+ Write a
 * note" again. ADR 0003 promises the opposite - away from home the app shows
 * the state as it was last recorded, and everything done meanwhile.
 *
 * So each store replays the queue over what it loaded. Every rule here is
 * idempotent: the load and the drain race, a change can be both in the
 * stand's answer and still in the queue, and replaying it over an answer that
 * already has it must change nothing.
 */

import {
  BOOKMARK_KINDS,
  REACTION_KINDS,
  type Bookmark,
  type BookmarkKind,
  type Card,
  type Note,
  type Progress,
  type Quote,
  type Reaction,
  type ReactionKind,
  type ReadingState,
  type Request,
} from '@/api'
import { pending, type Change } from '@/queue'

/** What a store loaded, and what is still on its way to the stand. */
export interface Loaded<T> {
  /** The stand's answer or the worker's copy of it; `null` when neither came. */
  loaded: T | null
  queued: Change[]
}

/**
 * Loads one read with the queue beside it.
 *
 * The queue is read before and after the load, and the two are joined: a
 * change delivered while the load was in flight is in the answer, one made
 * while it was in flight is in the second read, and neither falls between
 * them.
 */
export async function withQueue<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  const before = await pending()
  let loaded: T | null = null
  try {
    loaded = await read()
  } catch {
    // Away with nothing held, or signed out: the queue is still the reader's.
  }
  const after = await pending()
  const byId = new Map<number, Change>()
  for (const change of [...before, ...after]) {
    if (change.id !== undefined) byId.set(change.id, change)
  }
  return { loaded, queued: [...byId.values()].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)) }
}

/** The rest of a change's path after `prefix`, or `null` when it is not one. */
function under(change: Change, prefix: string): string | null {
  return change.path.startsWith(prefix) ? change.path.slice(prefix.length) : null
}

/** One field of a queued body, read without trusting its shape. */
function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined
}

function text(body: unknown, key: string): string | undefined {
  const value = field(body, key)
  return typeof value === 'string' ? value : undefined
}

/** Notes, with the ones written or emptied since. */
export function replayNotes(notes: Note[], changes: Change[]): Note[] {
  let held = notes
  for (const change of changes) {
    const piece = under(change, '/notes/')
    if (piece === null || change.method !== 'POST') continue
    const body = (text(change.body, 'body') ?? '').trim()
    const without = held.filter((note) => note.piece_id !== piece)
    // An emptied note is no note, as on the stand.
    held =
      body === ''
        ? without
        : [{ piece_id: piece, body, updated_at: text(change.body, 'marked_at') ?? '' }, ...without]
  }
  return held
}

/** Kept lines, with the ones kept, commented on and removed since. */
export function replayQuotes(quotes: Quote[], changes: Change[]): Quote[] {
  let held = quotes
  for (const change of changes) {
    if (change.path === '/quotes' && change.method === 'POST') {
      const id = text(change.body, 'client_id')
      const pieceId = text(change.body, 'piece_id')
      const kept = text(change.body, 'text')
      const paragraph = field(change.body, 'paragraph')
      // Already there: the stand has it, or an earlier replay added it.
      if (id === undefined || pieceId === undefined || kept === undefined || held.some((quote) => quote.id === id)) continue
      held = [
        {
          id,
          piece_id: pieceId,
          paragraph: typeof paragraph === 'number' ? paragraph : 0,
          text: kept,
          comment: text(change.body, 'comment') ?? null,
          created_at: change.context?.created_at ?? '',
        },
        ...held,
      ]
      continue
    }
    const id = under(change, '/quotes/')
    if (id === null) continue
    if (change.method === 'DELETE') {
      held = held.filter((quote) => quote.id !== id)
    } else {
      const comment = text(change.body, 'comment') ?? null
      held = held.map((quote) => (quote.id === id ? { ...quote, comment } : quote))
    }
  }
  return held
}

/** Bookmarks, with the ones set and taken off since. */
export function replayBookmarks(bookmarks: Bookmark[], changes: Change[]): Bookmark[] {
  let held = bookmarks
  for (const change of changes) {
    const piece = under(change, '/bookmarks/')
    if (piece === null) continue
    const without = held.filter((bookmark) => bookmark.piece_id !== piece)
    const kind = text(change.body, 'kind')
    if (change.method === 'DELETE') {
      held = without
    } else if (kind !== undefined && (BOOKMARK_KINDS as readonly string[]).includes(kind)) {
      held = [{ piece_id: piece, kind: kind as BookmarkKind, marked_at: text(change.body, 'marked_at') ?? '' }, ...without]
    }
  }
  return held
}

/** Reactions, with the ones felt and taken back since. */
export function replayReactions(reactions: Reaction[], changes: Change[]): Reaction[] {
  let held = reactions
  for (const change of changes) {
    const piece = under(change, '/reactions/')
    if (piece === null) continue
    const without = held.filter((reaction) => reaction.piece_id !== piece)
    const kind = text(change.body, 'kind')
    if (change.method === 'DELETE') {
      held = without
    } else if (kind !== undefined && (REACTION_KINDS as readonly string[]).includes(kind)) {
      held = [{ piece_id: piece, kind: kind as ReactionKind, felt_at: text(change.body, 'felt_at') ?? '' }, ...without]
    }
  }
  return held
}

/** Requests, with the ones made and withdrawn since. */
export function replayRequests(requests: Request[], changes: Change[]): Request[] {
  let held = requests
  for (const change of changes) {
    const topic = under(change, '/requests/')
    if (topic === null) continue
    if (change.method === 'DELETE') {
      held = held.filter((request) => request.topic_id !== topic)
    } else if (!held.some((request) => request.topic_id === topic)) {
      // A request queued before the title travelled with it is listed by its
      // id: better a plain name than a request that is not there.
      held = [
        {
          topic_id: topic,
          title: change.context?.title ?? topic,
          section: change.context?.section ?? topic.split('/')[0] ?? topic,
          asked_at: text(change.body, 'asked_at') ?? '',
        },
        ...held,
      ]
    }
  }
  return held
}

/** Today's cards, without the ones answered since. */
export function replayDue(cards: Card[], changes: Change[]): Card[] {
  const answered = new Set(
    changes.filter((change) => change.method === 'POST').map((change) => under(change, '/reviews/')),
  )
  return cards.filter((card) => !answered.has(card.piece_id))
}

/**
 * Progress, with what was read since.
 *
 * The stand's rules, applied here: the furthest paragraph is kept, finishing
 * and unfinishing set the status, and opening a piece starts it without
 * unfinishing it. The totals are the stand's to count and are left as they
 * were.
 */
export function replayProgress(progress: Progress | null, changes: Change[]): Progress | null {
  let held = progress
  for (const change of changes) {
    const piece = under(change, '/progress/')
    if (piece === null || change.method !== 'POST') continue
    const at = text(change.body, 'marked_at') ?? ''
    const pieces = held?.pieces ?? []
    const existing = pieces.find((state) => state.piece_id === piece)
    const paragraph = field(change.body, 'paragraph')
    const read = field(change.body, 'read')
    const updated: ReadingState = {
      piece_id: piece,
      status: existing?.status ?? 'reading',
      paragraph: Math.max(existing?.paragraph ?? 0, typeof paragraph === 'number' ? paragraph : 0),
      read_at: existing?.read_at ?? null,
      updated_at: at,
    }
    if (read === true) {
      updated.status = 'read'
      updated.read_at = at
    } else if (read === false) {
      updated.status = 'reading'
      updated.read_at = null
    }
    held = {
      pieces: [...pieces.filter((state) => state.piece_id !== piece), updated],
      stats: held?.stats ?? { read: 0, words: 0, streak: 0 },
      continue_with: updated.status === 'reading' ? piece : (held?.continue_with ?? null),
    }
  }
  return held
}
