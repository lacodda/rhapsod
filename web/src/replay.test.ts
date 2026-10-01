import { describe, expect, it } from 'vitest'

import type { Note, Progress, Quote } from '@/api'
import type { Change } from '@/queue'
import {
  replayBookmarks,
  replayDue,
  replayNotes,
  replayProgress,
  replayQuotes,
  replayReactions,
  replayRequests,
} from '@/replay'

// The scene every test here is about: the app reopened on a train. What it
// loaded is the stand's state as of the last time home - from the worker's
// copy - and the queue holds everything done since. The screen has to show
// both, or the reader is told their morning never happened.

let next = 0
function queued(path: string, method: 'POST' | 'DELETE', body: unknown, context?: Change['context']): Change {
  next += 1
  return { id: next, path, method, body, context }
}

const AT = '2026-09-02T08:00:00.000Z'

describe('replayNotes', () => {
  const home: Note[] = [{ piece_id: '01-physics/entropy', body: 'written at home', updated_at: AT }]

  it('shows a note written since, over the held ones', () => {
    const notes = replayNotes(home, [queued('/notes/02-myths/icarus', 'POST', { body: 'on the train', marked_at: AT })])
    expect(notes.find((note) => note.piece_id === '02-myths/icarus')?.body).toBe('on the train')
    expect(notes.find((note) => note.piece_id === '01-physics/entropy')?.body).toBe('written at home')
  })

  it('shows the latest of several writes to one note', () => {
    const notes = replayNotes(home, [
      queued('/notes/01-physics/entropy', 'POST', { body: 'first', marked_at: AT }),
      queued('/notes/01-physics/entropy', 'POST', { body: 'second', marked_at: AT }),
    ])
    expect(notes.filter((note) => note.piece_id === '01-physics/entropy').map((note) => note.body)).toEqual(['second'])
  })

  it('takes away a note emptied since', () => {
    expect(replayNotes(home, [queued('/notes/01-physics/entropy', 'POST', { body: '  ', marked_at: AT })])).toEqual([])
  })

  it('shows the queue even when nothing was held', () => {
    // Away from home on a first trip: no copy, but the reader's own note.
    const notes = replayNotes([], [queued('/notes/02-myths/icarus', 'POST', { body: 'mine', marked_at: AT })])
    expect(notes.map((note) => note.body)).toEqual(['mine'])
  })
})

describe('replayQuotes', () => {
  const kept: Quote = {
    id: 'q1',
    piece_id: '02-myths/icarus',
    paragraph: 0,
    text: 'begins here',
    comment: null,
    created_at: AT,
  }

  it('shows a line kept since, with the id it was kept under', () => {
    const quotes = replayQuotes(
      [],
      [
        queued(
          '/quotes',
          'POST',
          { piece_id: '02-myths/icarus', paragraph: 1, text: 'a line', comment: null, client_id: 'q2' },
          { created_at: AT },
        ),
      ],
    )
    expect(quotes).toEqual([
      { id: 'q2', piece_id: '02-myths/icarus', paragraph: 1, text: 'a line', comment: null, created_at: AT },
    ])
  })

  it('does not show a line twice when the stand already has it', () => {
    // The drain and the load race: a line can be in the answer and still in
    // the queue for a moment.
    const quotes = replayQuotes(
      [kept],
      [queued('/quotes', 'POST', { piece_id: kept.piece_id, paragraph: 0, text: kept.text, comment: null, client_id: 'q1' })],
    )
    expect(quotes).toHaveLength(1)
  })

  it('carries comments and removals made since', () => {
    expect(replayQuotes([kept], [queued('/quotes/q1', 'POST', { comment: 'yes' })])[0]?.comment).toBe('yes')
    expect(replayQuotes([kept], [queued('/quotes/q1', 'DELETE', {})])).toEqual([])
  })
})

describe('the rest of the reader state', () => {
  it('replays bookmarks set and taken off', () => {
    const set = replayBookmarks([], [queued('/bookmarks/02-myths/icarus', 'POST', { kind: 'loved', marked_at: AT })])
    expect(set.map((bookmark) => bookmark.kind)).toEqual(['loved'])
    expect(replayBookmarks(set, [queued('/bookmarks/02-myths/icarus', 'DELETE', {})])).toEqual([])
  })

  it('replays reactions felt and taken back', () => {
    const felt = replayReactions([], [queued('/reactions/02-myths/icarus', 'POST', { kind: 'struck', felt_at: AT })])
    expect(felt.map((reaction) => reaction.kind)).toEqual(['struck'])
    expect(replayReactions(felt, [queued('/reactions/02-myths/icarus', 'DELETE', {})])).toEqual([])
  })

  it('replays requests, named as they were asked for', () => {
    const asked = replayRequests(
      [],
      [queued('/requests/01-physics/heat', 'POST', { asked_at: AT }, { title: 'Heat', section: '01-physics' })],
    )
    expect(asked).toEqual([{ topic_id: '01-physics/heat', title: 'Heat', section: '01-physics', asked_at: AT }])
    expect(replayRequests(asked, [queued('/requests/01-physics/heat', 'DELETE', {})])).toEqual([])
  })

  it('takes answered cards off today', () => {
    const cards = [
      { piece_id: '02-myths/icarus', title: 'Icarus', one_liner: null, step: 1 },
      { piece_id: '01-physics/light', title: 'Light', one_liner: null, step: 2 },
    ]
    const due = replayDue(cards, [queued('/reviews/02-myths/icarus', 'POST', { again: false })])
    expect(due.map((card) => card.piece_id)).toEqual(['01-physics/light'])
  })

  it('replays progress by the stand rules', () => {
    const home: Progress = {
      pieces: [{ piece_id: '01-physics/entropy', status: 'read', paragraph: 9, updated_at: AT, read_at: AT }],
      stats: { read: 1, words: 1200, streak: 1 },
      continue_with: null,
    }
    const now = replayProgress(home, [
      queued('/progress/02-myths/icarus', 'POST', { paragraph: 4, marked_at: AT }),
      // A stale report does not move the reader backwards.
      queued('/progress/02-myths/icarus', 'POST', { paragraph: 2, marked_at: AT }),
      // Opening a finished piece does not unfinish it.
      queued('/progress/01-physics/entropy', 'POST', { marked_at: AT }),
    ])
    const icarus = now?.pieces.find((state) => state.piece_id === '02-myths/icarus')
    expect(icarus?.paragraph).toBe(4)
    expect(icarus?.status).toBe('reading')
    expect(now?.pieces.find((state) => state.piece_id === '01-physics/entropy')?.status).toBe('read')
    expect(now?.continue_with).toBe('02-myths/icarus')
    expect(now?.stats).toEqual(home.stats)
  })

  it('finishes and unfinishes a piece', () => {
    const read = replayProgress(null, [queued('/progress/02-myths/icarus', 'POST', { read: true, marked_at: AT })])
    expect(read?.pieces[0]?.status).toBe('read')
    const unread = replayProgress(read, [queued('/progress/02-myths/icarus', 'POST', { read: false, marked_at: AT })])
    expect(unread?.pieces[0]?.status).toBe('reading')
  })
})
