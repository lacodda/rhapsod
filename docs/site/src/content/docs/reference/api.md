---
title: API
description: Every endpoint the server answers - the library index, the shelves, a piece with its text, and the reindex the publishing script calls.
---

The API lives under `/api`. It is JSON in and JSON out, with no authentication: the server is meant for a home network, and the thing it protects is a library of your own files.

Everything below was captured from a running server over a two-piece library, so the bodies are what you will actually get, down to the field order.

## `GET /api/health`

Liveness and readiness in one place, plus the size of the library being served. Documented in full on its own page: [Health endpoint](/rhapsod/reference/health/).

```sh
curl http://127.0.0.1:8084/api/health
```

```json
{"status":"ok","version":"0.1.0","pieces":2}
```

`pieces` answers the question a deploy actually raises: not "is the server up" but "is it serving the library I just published".

## `GET /api/library`

The whole index in one response: every shelf and every piece, without the text.

```sh
curl http://127.0.0.1:8084/api/library
```

```json
{
  "sections": [
    {"id": "02-istoriya", "number": 2, "title": "История", "pieces": 1},
    {"id": "19-lyubov-i-pary", "number": 19, "title": "Любовь и пары", "pieces": 1}
  ],
  "pieces": [
    {
      "id": "02-istoriya/god-bez-leta",
      "section": "02-istoriya",
      "title": "Год без лета",
      "written": "2026-08-30",
      "words": 953,
      "one_liner": "Небо взяло год и не отдало."
    },
    {
      "id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "section": "19-lyubov-i-pary",
      "title": "Абеляр и Элоиза",
      "written": "2026-09-01",
      "words": 1012,
      "one_liner": "Ради него, а не ради Бога."
    }
  ]
}
```

One request rather than one per section. The app caches the library for offline reading, and a phone on a home network pays for round trips far more than for bytes.

The pieces come in **reading order**: shelves by their number, pieces within a shelf by their id. That is the order the app walks when it offers what to read next, so a client does not have to reconstruct it.

## `GET /api/sections`

Just the shelves.

```sh
curl http://127.0.0.1:8084/api/sections
```

```json
[
  {"id": "02-istoriya", "number": 2, "title": "История", "pieces": 1},
  {"id": "19-lyubov-i-pary", "number": 19, "title": "Любовь и пары", "pieces": 1}
]
```

| Field | Meaning |
| --- | --- |
| `id` | Slug of the directory name; the path segment used everywhere else. |
| `number` | The number the directory name starts with. `null` when the directory is not numbered. |
| `title` | The directory name without its number. |
| `pieces` | How many pieces the shelf holds. |

Numbered shelves come first in their numeric order; anything unnumbered follows alphabetically. A section directory with no readable pieces in it is not a shelf and does not appear.

## `GET /api/sections/{section}`

The pieces of one shelf, without their text.

```sh
curl http://127.0.0.1:8084/api/sections/19-lyubov-i-pary
```

```json
[
  {
    "id": "19-lyubov-i-pary/abelyar-i-eloiza",
    "section": "19-lyubov-i-pary",
    "title": "Абеляр и Элоиза",
    "written": "2026-09-01",
    "words": 1012,
    "one_liner": "Ради него, а не ради Бога."
  }
]
```

A shelf that does not exist is `404`, not an empty list:

```sh
curl -i http://127.0.0.1:8084/api/sections/nope
```

```json
{"error":"no such section"}
```

The distinction matters to a client: an empty array means "this shelf is real and has nothing on it", which is a state a new section genuinely has.

## `GET /api/pieces/{section}/{piece}`

One piece, with everything in it.

```sh
curl http://127.0.0.1:8084/api/pieces/19-lyubov-i-pary/abelyar-i-eloiza
```

```json
{
  "id": "19-lyubov-i-pary/abelyar-i-eloiza",
  "section": "19-lyubov-i-pary",
  "title": "Абеляр и Элоиза",
  "written": "2026-09-01",
  "words": 1012,
  "paragraphs": ["Париж, около 1132 года.", "Она пишет ему из монастыря."],
  "neighbours": ["Орфей и Эвридика — другая пара.", "Данте и Беатриче — любовь в тексте."],
  "one_liner": "Ради него, а не ради Бога.",
  "song": ["**Ситуация:** она осталась.", "**Образ:** покрывало у алтаря."]
}
```

| Field | Meaning |
| --- | --- |
| `paragraphs` | The prose, one string per paragraph. A list rather than one blob of markdown because reading position is an index into it. |
| `neighbours` | Related pieces, as the author wrote them: free text, which may name a piece that does not exist yet. |
| `one_liner` | The line meant to be remembered, normalised to end in a full stop. This is what a repetition card shows. `null` when the piece has none. |
| `song` | The song seed - the author's own workbench, kept whole and shown apart from the prose. |

The id is two path segments rather than one escaped string: it is a shelf and a piece on it, and a URL that shows that is one a person can edit by hand.

A piece that does not exist is `404`:

```json
{"error":"no such piece"}
```

## `POST /api/reindex`

Rebuilds the index from the content directory and answers with what it found.

```sh
curl -X POST http://127.0.0.1:8084/api/reindex
```

```json
{"pieces":2,"sections":2}
```

This is what [the publishing scripts](/rhapsod/guides/publishing-content/) call after copying files onto the stand. The server holds the index in memory, so new files on disk are not yet a library: without this call they would wait for a restart.

It is the one endpoint that changes what the server holds, and it changes nothing on disk - the library is read, never written ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). The counts it returns are the receipt: publish a piece and `pieces` goes up, delete one and it goes down, which is how you tell a real publish from a copy that silently did nothing.

Readers are not interrupted. The index is swapped under a write lock held only for the swap itself, so a request in flight finishes against the index it started with.

## Failures

| Condition | Status | Body |
| --- | --- | --- |
| Unknown shelf | `404` | `{"error":"no such section"}` |
| Unknown piece | `404` | `{"error":"no such piece"}` |
| Unknown path under `/api` | `404` | `{"error":"no such endpoint"}` |
| The library could not be re-read | `500` | `{"error":"the library could not be read"}` |
| Database unreachable (health only) | `503` | `{"status":"degraded",...}` |

The API never falls through to the reading app. Every path outside `/api` serves the app so that a deep link into a piece loads it, but a misspelled endpoint has to look like a mistake rather than like a page:

```sh
curl -i http://127.0.0.1:8084/api/nope
```

```json
{"error":"no such endpoint"}
```
