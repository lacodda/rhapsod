/**
 * What the server offers, and the one place that talks to it.
 *
 * The whole index arrives in a single request: the reading app is meant to work
 * on a phone with no way to reach the stand, so it holds the library in memory
 * from the first screen and asks for a piece's text only when it is opened.
 *
 * Reads go over the wire and fail when the stand is away - the service worker
 * answers them from its cache instead. Writes never fail: they go into the
 * local queue and are delivered when the stand comes back (ADR 0003).
 */

import { enqueue, mintId, type Change } from '@/queue'
import { drain, sawServer } from '@/sync'

/** A shelf of the library. */
export interface Section {
  id: string
  number: number | null
  title: string
  pieces: number
}

/** A piece as it appears in a list: everything but the text. */
export interface PieceSummary {
  id: string
  section: string
  title: string
  written: string | null
  words: number
  one_liner: string | null
}

/** A piece with its text. */
export interface Piece extends PieceSummary {
  paragraphs: string[]
  neighbours: string[]
  song: string[]
}

/** The index: the shelves and everything on them. */
export interface LibraryIndex {
  sections: Section[]
  pieces: PieceSummary[]
}

/** How far the reader got with one piece. */
export interface ReadingState {
  piece_id: string
  status: 'reading' | 'read'
  paragraph: number
  updated_at: string
  read_at: string | null
}

/** What the reader has read. */
export interface Stats {
  read: number
  words: number
  streak: number
}

/** Everything the reader has read, and what it adds up to. */
export interface Progress {
  pieces: ReadingState[]
  stats: Stats
  continue_with: string | null
}

/** A note on one piece, in the reader's own words. */
export interface Note {
  piece_id: string
  body: string
  updated_at: string
}

/** A line the reader kept, with an optional comment of their own. */
export interface Quote {
  /**
   * Minted on the device that kept the line, not assigned by the server.
   *
   * A highlight made on a train has to be commented on and removed there too,
   * hours before the stand hears about it - which an id handed out by the
   * server could not give it (ADR 0003).
   */
  id: string
  piece_id: string
  paragraph: number
  text: string
  comment: string | null
  created_at: string
}

/** Something the author could write, from the published plan. */
export interface Topic {
  id: string
  title: string
  /** The shelf of the plan it would belong to. */
  section: string
}

/** A shelf of the plan. */
export interface TopicShelf {
  id: string
  title: string
  topics: Topic[]
}

/** The plan, as the app receives it. Empty when none was published. */
export interface Plan {
  shelves: TopicShelf[]
}

/** A topic the reader asked for. */
export interface Request {
  topic_id: string
  /** The title as it read when the request was made. */
  title: string
  section: string
  asked_at: string
}

/** The kinds a bookmark can be. The server refuses anything else. */
export const BOOKMARK_KINDS = ['loved', 'return', 'song', 'reread'] as const

export type BookmarkKind = (typeof BOOKMARK_KINDS)[number]

/** A piece the reader marked to find again. */
export interface Bookmark {
  piece_id: string
  kind: BookmarkKind
  marked_at: string
}

/** A piece waiting to be recalled today. */
export interface Card {
  piece_id: string
  title: string
  /** The line the piece wants remembered: the whole of the card's front. */
  one_liner: string | null
  /** Which return this is, 1 to 3. */
  step: number
}

/** Whether this browser may read, and whether it has to prove anything. */
export interface Session {
  open: boolean
  reader: boolean
}

/** What the server says about itself. */
export interface Health {
  status: string
  version: string
  pieces: number
}

/**
 * A failed request, carrying what the reader needs to be told.
 *
 * The message is the one shown on screen, so it says what happened in the
 * reader's terms rather than repeating a status code.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function get<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`)
  } catch {
    // The stand is a Pi at home: unreachable is the normal case on a train,
    // not an exception worth a stack trace.
    sawServer(false)
    throw new ApiError('The library is out of reach. It comes back when you are home.', 0)
  }

  // The stand answered, whatever it said: a 404 is the server being there and
  // saying no, which is the opposite of being away.
  sawServer(true)
  if (!response.ok) {
    throw new ApiError(response.status === 404 ? 'There is nothing here.' : 'The library did not answer.', response.status)
  }
  return (await response.json()) as T
}

/**
 * Queues a change and asks for a delivery.
 *
 * The promise resolves once the change is in the local store, not once the
 * server has it: what the reader sees is their own action taking effect, and
 * that must not wait for a Pi on a network they may not be on.
 */
async function queue(change: Change): Promise<void> {
  try {
    await enqueue(change)
  } catch {
    // A browser that will not open IndexedDB still reads. Try the wire once
    // so a change is not silently dropped on a working connection.
    void fetch(`/api${change.path}`, {
      method: change.method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(change.body),
    }).catch(() => undefined)
    return
  }
  void drain()
}

/** The device's clock, as the server wants to read it. */
const now = (): string => new Date().toISOString()

export const fetchLibrary = (): Promise<LibraryIndex> => get<LibraryIndex>('/library')

export const fetchPiece = (id: string): Promise<Piece> => get<Piece>(`/pieces/${id}`)

export const fetchHealth = (): Promise<Health> => get<Health>('/health')

export const fetchSession = (): Promise<Session> => get<Session>('/session')

export const fetchProgress = (): Promise<Progress> => get<Progress>('/progress')

/** The next unread piece, from another shelf when there is one. */
export const fetchNext = (after: string): Promise<{ next: PieceSummary | null }> =>
  get<{ next: PieceSummary | null }>(`/next?after=${encodeURIComponent(after)}`)

/**
 * Sends a request that has to happen now, rather than being queued.
 *
 * Signing in is the whole of this: a session cannot be established against a
 * stand that is not there, and a queued sign-in would be a promise to log in
 * later, which is not what the button says.
 */
async function send<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    sawServer(false)
    throw new ApiError('The library is out of reach. It comes back when you are home.', 0)
  }
  sawServer(true)
  if (!response.ok) {
    throw new ApiError(response.status === 401 ? 'Sign in to read.' : 'The library did not answer.', response.status)
  }
  return response.status === 204 ? null : ((await response.json()) as T)
}

export const fetchTopics = (): Promise<Plan> => get<Plan>('/topics')

export const fetchRequests = (): Promise<Request[]> => get<Request[]>('/requests')

/**
 * Asks for a topic to be written.
 *
 * Queued like every other change: a reader decides they want something while
 * reading, which is usually nowhere near the stand.
 */
export const askFor = (topicId: string): Promise<void> =>
  queue({ path: `/requests/${topicId}`, method: 'POST', body: { asked_at: now() } })

export const withdrawRequest = (topicId: string): Promise<void> =>
  queue({ path: `/requests/${topicId}`, method: 'DELETE', body: {} })

export const fetchBookmarks = (): Promise<Bookmark[]> => get<Bookmark[]>('/bookmarks')

/**
 * Marks a piece, or changes which kind of mark it carries.
 *
 * Queued like every other change: a piece is marked where it is read, which
 * is usually not where the stand is.
 */
export const setBookmark = (pieceId: string, kind: BookmarkKind): Promise<void> =>
  queue({ path: `/bookmarks/${pieceId}`, method: 'POST', body: { kind, marked_at: now() } })

export const clearBookmark = (pieceId: string): Promise<void> =>
  queue({ path: `/bookmarks/${pieceId}`, method: 'DELETE', body: {} })

export const fetchDue = (): Promise<{ due: Card[] }> => get<{ due: Card[] }>('/reviews')

/**
 * Answers a card.
 *
 * Queued like every other change: recall happens on a phone, and the stand is
 * at home. `again` is the reader asking for the piece back rather than saying
 * they remember it.
 */
export const answerCard = (pieceId: string, again: boolean): Promise<void> =>
  queue({ path: `/reviews/${pieceId}`, method: 'POST', body: { again } })

export const fetchNotes = (): Promise<Note[]> => get<Note[]>('/notes')

export const fetchQuotes = (): Promise<Quote[]> => get<Quote[]>('/quotes')

export const saveNote = (id: string, body: string): Promise<void> =>
  queue({ path: `/notes/${id}`, method: 'POST', body: { body, marked_at: now() } })

/**
 * Keeps a line.
 *
 * The quote is returned as the app will hold it, without asking the server:
 * the id is minted here so the reader can comment on or remove a highlight
 * they made on a train, hours before the stand ever hears about it.
 */
export function keepQuote(quote: { piece_id: string; paragraph: number; text: string; comment: string | null }): Quote {
  const kept: Quote = {
    ...quote,
    id: mintId(),
    created_at: now(),
  }
  void queue({ path: '/quotes', method: 'POST', body: { ...quote, client_id: kept.id } })
  return kept
}

export const commentOnQuote = (id: string, comment: string | null): Promise<void> =>
  queue({ path: `/quotes/${id}`, method: 'POST', body: { comment } })

export const dropQuote = (id: string): Promise<void> => queue({ path: `/quotes/${id}`, method: 'DELETE', body: {} })

export const signIn = (password: string): Promise<Session | null> => send<Session>('/session', 'POST', { password })

export const signOut = (): Promise<Session | null> => send<Session>('/session', 'DELETE')

/**
 * Reports where the reader is.
 *
 * Queued like every other change, so a piece read on a train is read when the
 * phone gets home. The call returns before the change is stored: this fires
 * from a scroll handler, and awaiting a database write per paragraph would be
 * felt in the scrolling.
 */
export function report(id: string, moved: { paragraph?: number; read?: boolean }): void {
  void queue({ path: `/progress/${id}`, method: 'POST', body: { ...moved, marked_at: now() } })
}
