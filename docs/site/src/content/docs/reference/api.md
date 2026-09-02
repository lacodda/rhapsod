---
title: API
description: Every endpoint the server answers - the library, the session, reading progress, what to read next, and the reindex the publishing script calls.
---

The API lives under `/api`. It is JSON in and JSON out.

Whether it asks for anything depends on how the stand was started. With no `RHAPSOD_PASSWORD_HASH` the stand is **open**: everyone who can reach it is the reader, and every endpoint below answers without a session. With a password set the stand is **locked**, and everything about the library and the reading of it is behind [the session](#get-apisession) - see [Locking a stand](/rhapsod/guides/locking-a-stand/).

| Endpoint | On a locked stand |
| --- | --- |
| `GET /api/health` | Open. A monitor has to be able to ask whether the stand is alive. |
| `GET /api/session`, `POST`, `DELETE` | Open. The app has to be able to ask whether it needs a password. |
| `GET /api/library`, `/sections`, `/sections/{section}`, `/pieces/...` | Needs a session. |
| `GET /api/progress`, `POST /api/progress/...`, `GET /api/next` | Needs a session. |
| `POST /api/reindex` | Open. It is called by a publishing script on the same network, not by a browser. |

A password that protected the reading state and handed out the text would protect nothing that matters, so the library is behind the same gate as the progress.

Everything below was captured from a running server over a two-piece library, so the bodies are what you will actually get, down to the field order.

## `GET /api/health`

Liveness and readiness in one place, plus the size of the library being served. Documented in full on its own page: [Health endpoint](/rhapsod/reference/health/).

```sh
curl http://127.0.0.1:8084/api/health
```

```json
{"status":"ok","version":"0.1.1","pieces":2}
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

## `GET /api/session`

Whether this browser may read, and whether it has to prove anything. The app asks this first: an open stand and a signed-in reader look the same to it, and a locked one gets the sign-in screen.

```sh
curl http://127.0.0.1:8084/api/session
```

On an open stand:

```json
{"open":true,"reader":true}
```

On a locked stand, before signing in:

```json
{"open":false,"reader":false}
```

| Field | Meaning |
| --- | --- |
| `open` | The stand has no password. Everyone who can reach it is the reader. |
| `reader` | This browser may read. Always true on an open stand. |

The two are separate because they answer different questions: `open` is about the stand, `reader` is about the request. A client that only looked at `reader` could not tell a signed-in reader from a stand that never asks.

## `POST /api/session`

Signs in, setting the session cookie.

```sh
curl -i -X POST http://127.0.0.1:8084/api/session \
  -H 'content-type: application/json' \
  -d '{"password":"a good passphrase"}'
```

```
HTTP/1.1 200 OK
set-cookie: rhapsod_session=c7056ef6a7995560bdbbbeb25278c7f3630a1255f295eaa2f764e6e8f8f264fb; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000
```

```json
{"open":false,"reader":true}
```

The answer has the same shape as `GET`, so a client has one thing to store either way.

The cookie is `HttpOnly` because no script needs to read it, `SameSite=Lax` because the app never posts from another origin, and deliberately **not** `Secure`: the stand is reached over plain HTTP on a home network, and a `Secure` cookie would simply never be stored. `Max-Age` is ninety days, and every request that uses the session pushes it back.

The wrong password is `401`, and nothing is stored:

```sh
curl -X POST http://127.0.0.1:8084/api/session \
  -H 'content-type: application/json' -d '{"password":"not it"}'
```

```json
{"error":"that is not the password"}
```

On an open stand there is nothing to sign in to, and saying so beats handing out a session that protects nothing:

```json
{"error":"this stand has no password"}
```

That one is `400` - the request is not wrong about the password, it is wrong about the stand.

## `DELETE /api/session`

Ends the session.

```sh
curl -i -X DELETE http://127.0.0.1:8084/api/session -b cookies.txt
```

```
HTTP/1.1 200 OK
set-cookie: rhapsod_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0
```

```json
{"open":false,"reader":false}
```

The row is deleted, not merely the cookie forgotten: presenting the same token afterwards gets `{"open":false,"reader":false}` from this endpoint and `401` from anything behind the gate. Sessions are rows rather than signed tokens exactly so that this can be true - a token that cannot be revoked is not a session but a promise.

On an open stand this succeeds and changes nothing, answering `{"open":true,"reader":true}`: there was no session to end.

## `GET /api/progress`

Everything the reader has read, and what it adds up to. One request: the app needs all of it at once to draw a counter on every shelf and a mark on every row, and to decide what to offer next while offline.

```sh
curl http://127.0.0.1:8084/api/progress
```

```json
{
  "pieces": [
    {
      "piece_id": "02-istoriya/god-bez-leta",
      "status": "reading",
      "paragraph": 7,
      "updated_at": "2026-09-02T10:36:35.471Z",
      "read_at": null
    },
    {
      "piece_id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "status": "read",
      "paragraph": 0,
      "updated_at": "2026-09-02T10:36:35.611Z",
      "read_at": "2026-09-02T10:36:35.611Z"
    }
  ],
  "stats": {"read": 1, "words": 1012, "streak": 1},
  "continue_with": "02-istoriya/god-bez-leta"
}
```

A reader who has touched nothing gets the same shape with nothing in it:

```json
{"pieces":[],"stats":{"read":0,"words":0,"streak":0},"continue_with":null}
```

| Field | Meaning |
| --- | --- |
| `pieces[].piece_id` | The piece this row is about. **A piece with no row has not been opened** - that is the third status, and it needs no storage. |
| `pieces[].status` | `reading` or `read`. |
| `pieces[].paragraph` | Index into the piece's `paragraphs` array, not a pixel offset. |
| `pieces[].updated_at` | When the row was last touched. This is what orders `continue_with`. |
| `pieces[].read_at` | The day the piece was finished; `null` while it is being read. Set once - re-reading does not move it. |
| `stats.read` | Pieces finished. |
| `stats.words` | Words in the pieces finished, counted from the library rather than from a stored column, so a piece that was rewritten counts as what it is now. |
| `stats.streak` | Consecutive days with at least one piece finished, ending today or yesterday. |
| `continue_with` | The most recently touched unfinished piece, or `null`. |

Yesterday counts as the end of a live streak: a reader who has not read yet today has not broken anything, and telling them they have at breakfast is both wrong and discouraging. The rules behind these numbers are in [What the reader remembers](/rhapsod/concepts/what-the-reader-remembers/).

## `POST /api/progress/{section}/{piece}`

Records where the reader is. Answers `204` with no body - the app already knows what it just reported, and a body would be a round trip spent on nothing.

Both kinds of report go through one endpoint because they arrive from the same screen, often in the same second, and splitting them would only make the app choose between two calls.

**A position:**

```sh
curl -X POST http://127.0.0.1:8084/api/progress/02-istoriya/god-bez-leta \
  -H 'content-type: application/json' -d '{"paragraph":7}'
```

**Finishing, or putting a finished piece back:**

```sh
curl -X POST http://127.0.0.1:8084/api/progress/19-lyubov-i-pary/abelyar-i-eloiza \
  -H 'content-type: application/json' -d '{"read":true}'
```

**That a piece was opened** - an empty object, which starts a row without claiming a position:

```sh
curl -X POST http://127.0.0.1:8084/api/progress/19-lyubov-i-pary/abelyar-i-eloiza \
  -H 'content-type: application/json' -d '{}'
```

| Field | Meaning |
| --- | --- |
| `paragraph` | Index of the paragraph last seen. |
| `read` | `true` finishes the piece, `false` puts it back to being read. |

Both fields are optional and both may be sent at once.

The position **only moves forward**. A stale report is accepted and changes nothing:

```sh
curl -X POST http://127.0.0.1:8084/api/progress/02-istoriya/god-bez-leta \
  -H 'content-type: application/json' -d '{"paragraph":2}'
curl http://127.0.0.1:8084/api/progress
```

```json
{"piece_id":"02-istoriya/god-bez-leta","status":"reading","paragraph":7,"updated_at":"2026-09-02T10:36:35.767Z","read_at":null}
```

Still 7; only `updated_at` moved. A phone syncing a position from before the desktop moved on must not send the reader back up the page. Re-reading from the top is done by finishing and reopening, not by scrolling up. A negative index is read as the top.

Opening a finished piece does not unfinish it, and finishing one twice does not move `read_at`.

A report about a piece that is not in the library is refused:

```sh
curl -X POST http://127.0.0.1:8084/api/progress/02-istoriya/nope \
  -H 'content-type: application/json' -d '{"paragraph":1}'
```

```json
{"error":"no such piece"}
```

`404`. It is a stale phone or a typed URL, and storing it would leave rows no screen can ever show.

## `GET /api/next`

What to read next: an unread piece, **preferring another shelf**.

```sh
curl 'http://127.0.0.1:8084/api/next?after=02-istoriya/god-bez-leta'
```

```json
{"next":{"id":"19-lyubov-i-pary/abelyar-i-eloiza","one_liner":"Ради него, а не ради Бога.","section":"19-lyubov-i-pary","title":"Абеляр и Элоиза","words":1012,"written":"2026-09-01"}}
```

`after` names the piece just finished, so the answer can come from somewhere else. Reading straight down one shelf turns thirty pieces about paradoxes into a textbook, and the format is built for the opposite.

If everything unread is on the shelf just finished, that shelf is the answer rather than nothing:

```sh
curl 'http://127.0.0.1:8084/api/next?after=19-lyubov-i-pary/abelyar-i-eloiza'
```

```json
{"next":{"id":"02-istoriya/god-bez-leta","one_liner":"Небо взяло год и не отдало.","section":"02-istoriya","title":"Год без лета","words":953,"written":"2026-08-30"}}
```

`after` is optional; without it every unread piece is a candidate. With nothing unread left the answer is `{"next":null}`, which the app renders as "That was the last unread piece" rather than as an error.

Within the preference, reading order decides, so the answer is the same on every device and does not shuffle underfoot. The piece comes back with the same fields `/api/library` gives, but serialised in alphabetical order rather than that endpoint's declared order; read them by name.

## Failures

| Condition | Status | Body |
| --- | --- | --- |
| Unknown shelf | `404` | `{"error":"no such section"}` |
| Unknown piece, reading it or reporting progress on it | `404` | `{"error":"no such piece"}` |
| Unknown path under `/api` | `404` | `{"error":"no such endpoint"}` |
| No session on a locked stand | `401` | `{"error":"sign in to read"}` |
| The wrong password | `401` | `{"error":"that is not the password"}` |
| Signing in to an open stand | `400` | `{"error":"this stand has no password"}` |
| `RHAPSOD_PASSWORD_HASH` is not a valid PHC string | `500` | `{"error":"the stand's password is misconfigured"}` |
| The library could not be re-read | `500` | `{"error":"the library could not be read"}` |
| Database unreachable (health only) | `503` | `{"status":"degraded",...}` |

A hash the server cannot parse is a deployment error, not a wrong password. Reading it as one would leave the owner typing the right password forever against a server that cannot check it, so it is `500` and the log names the variable.

The API never falls through to the reading app. Every path outside `/api` serves the app so that a deep link into a piece loads it, but a misspelled endpoint has to look like a mistake rather than like a page:

```sh
curl -i http://127.0.0.1:8084/api/nope
```

```json
{"error":"no such endpoint"}
```
