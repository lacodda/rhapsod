/**
 * What the server offers, and the one place that talks to it.
 *
 * The whole index arrives in a single request: the reading app is meant to work
 * on a phone with no way to reach the stand, so it holds the library in memory
 * from the first screen and asks for a piece's text only when it is opened.
 */

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
    throw new ApiError('The library is out of reach. It comes back when you are home.', 0)
  }

  if (!response.ok) {
    throw new ApiError(response.status === 404 ? 'There is nothing here.' : 'The library did not answer.', response.status)
  }
  return (await response.json()) as T
}

export const fetchLibrary = (): Promise<LibraryIndex> => get<LibraryIndex>('/library')

export const fetchPiece = (id: string): Promise<Piece> => get<Piece>(`/pieces/${id}`)

export const fetchHealth = (): Promise<Health> => get<Health>('/health')

export const fetchSession = (): Promise<Session> => get<Session>('/session')

export const fetchProgress = (): Promise<Progress> => get<Progress>('/progress')

/** The next unread piece, from another shelf when there is one. */
export const fetchNext = (after: string): Promise<{ next: PieceSummary | null }> =>
  get<{ next: PieceSummary | null }>(`/next?after=${encodeURIComponent(after)}`)

async function send<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('The library is out of reach. It comes back when you are home.', 0)
  }
  if (!response.ok) {
    throw new ApiError(response.status === 401 ? 'Sign in to read.' : 'The library did not answer.', response.status)
  }
  return response.status === 204 ? null : ((await response.json()) as T)
}

export const signIn = (password: string): Promise<Session | null> => send<Session>('/session', 'POST', { password })

export const signOut = (): Promise<Session | null> => send<Session>('/session', 'DELETE')

/**
 * Reports where the reader is.
 *
 * Failures are swallowed: this fires while someone is reading, and an error
 * toast over the text they are in the middle of would be worse than a lost
 * position. What is lost is one paragraph of precision, and the next report
 * fixes it.
 */
export function report(id: string, moved: { paragraph?: number; read?: boolean }): void {
  void send(`/progress/${id}`, 'POST', moved).catch(() => undefined)
}
