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
