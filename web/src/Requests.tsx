/**
 * Asking for a novella that has not been written.
 *
 * The author keeps a plan of a couple of thousand topics; this shows it and
 * lets the reader point at one. That is the whole feature - not a vote, not a
 * priority, just a list the author reads before choosing what to write next.
 *
 * Two thousand titles is the design problem. Shelves start closed and open one
 * at a time, and a search box filters across all of them: scrolling a flat list
 * of that length to find a title is not finding it.
 */

import { useMemo, useState } from 'react'

import type { Topic, TopicShelf } from '@/api'
import type { RequestStore } from '@/useRequests'

export function RequestsScreen({ requests }: { requests: RequestStore }) {
  const [query, setQuery] = useState('')
  const [openShelf, setOpenShelf] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()

  // Searching looks across every shelf at once, because a reader after "the
  // one about the ship" does not know which shelf it is filed under.
  const found = useMemo(() => {
    if (needle.length === 0) return null
    const hits: Topic[] = []
    for (const shelf of requests.plan.shelves) {
      for (const topic of shelf.topics) {
        if (topic.title.toLowerCase().includes(needle)) hits.push(topic)
        // A search that returns two thousand rows has not narrowed anything;
        // stopping keeps the screen quick and says what to do about it.
        if (hits.length >= 60) return hits
      }
    }
    return hits
  }, [needle, requests.plan])

  if (requests.plan.shelves.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-3 py-12">
        <p className="text-lg font-medium text-text">Nothing to ask for yet.</p>
        <p className="text-sm leading-relaxed text-dim">
          The author has not published a plan of topics to this stand. When they do, what could be written appears
          here and you can say which one you would like next.
        </p>
      </div>
    )
  }

  const total = requests.plan.shelves.reduce((sum, shelf) => sum + shelf.topics.length, 0)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 px-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Ask for one</h1>
        <p className="text-sm text-dim">
          {total.toLocaleString('en-US')} topics the author could write
          {requests.asked.length > 0 ? ` · ${requests.asked.length} asked for` : ''}
        </p>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search the topics"
          className="w-full rounded-lg border border-line bg-raise px-3 py-2 text-sm text-text placeholder:text-faint focus-visible:border-accent focus-visible:outline-none"
        />
      </header>

      {requests.asked.length > 0 && needle.length === 0 ? (
        <section className="flex flex-col gap-2 px-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-dim">Asked for</h2>
          <ul className="flex flex-col gap-1">
            {requests.asked.map((request) => (
              <li key={request.topic_id}>
                <Row
                  topic={{ id: request.topic_id, title: request.title, section: request.section }}
                  wanted
                  onToggle={requests.toggle}
                  showShelf
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {found !== null ? (
        <section className="flex flex-col gap-2 px-3">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-dim">
            {found.length === 0 ? 'Nothing matches' : `${found.length}${found.length >= 60 ? '+' : ''} found`}
          </h2>
          <ul className="flex flex-col gap-1">
            {found.map((topic) => (
              <li key={topic.id}>
                <Row topic={topic} wanted={requests.wanted.has(topic.id)} onToggle={requests.toggle} showShelf />
              </li>
            ))}
          </ul>
          {found.length >= 60 ? (
            <p className="text-xs text-dim">Too many to show. A few more letters will narrow it.</p>
          ) : null}
        </section>
      ) : (
        <ul className="flex flex-col gap-1 px-3">
          {requests.plan.shelves.map((shelf) => (
            <Shelf
              key={shelf.id}
              shelf={shelf}
              open={openShelf === shelf.id}
              // One shelf at a time: with thirty of them, leaving the last one
              // open turns the screen into the flat list this avoids.
              onOpen={() => {
                setOpenShelf(openShelf === shelf.id ? null : shelf.id)
              }}
              requests={requests}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One shelf of the plan, closed until it is asked for. */
function Shelf({
  shelf,
  open,
  onOpen,
  requests,
}: {
  shelf: TopicShelf
  open: boolean
  onOpen: () => void
  requests: RequestStore
}) {
  const asked = shelf.topics.filter((topic) => requests.wanted.has(topic.id)).length

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="text-base font-medium text-text">{shelf.title}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-dim">
          {asked > 0 ? <span className="text-accent">{asked} · </span> : null}
          {shelf.topics.length}
        </span>
      </button>

      {open ? (
        <ul className="flex flex-col gap-1 pb-2 pl-3">
          {shelf.topics.map((topic) => (
            <li key={topic.id}>
              <Row topic={topic} wanted={requests.wanted.has(topic.id)} onToggle={requests.toggle} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** One topic, and whether it has been asked for. */
function Row({
  topic,
  wanted,
  onToggle,
  showShelf = false,
}: {
  topic: Topic
  wanted: boolean
  onToggle: (topic: Topic) => void
  /** In a search or in the asked-for list, the shelf is worth naming. */
  showShelf?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onToggle(topic)
      }}
      aria-pressed={wanted}
      className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex flex-col gap-0.5">
        <span className={`text-sm leading-snug ${wanted ? 'text-text' : 'text-dim'}`}>{topic.title}</span>
        {showShelf ? <span className="font-mono text-[0.625rem] text-faint">{topic.section}</span> : null}
      </span>
      <span
        className={`shrink-0 font-mono text-xs ${wanted ? 'text-accent' : 'text-faint'}`}
        aria-hidden
      >
        {wanted ? '✓ asked' : 'ask'}
      </span>
    </button>
  )
}
