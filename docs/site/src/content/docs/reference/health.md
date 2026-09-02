---
title: Health endpoint
description: The contract of GET /api/health - status codes, body shape, and what "degraded" means.
---

`GET /api/health` answers liveness and readiness in one place: the process responds, and a database round-trip says whether it can actually do its job.

## Request

```
GET /api/health
```

No parameters, and no session: this endpoint stays open even on a stand that has a password, because a monitor has to be able to ask whether the stand is alive. It says nothing about the content beyond how many pieces there are - see [Locking a stand](/rhapsod/guides/locking-a-stand/).

## Response

| Condition | Status | `status` |
| --- | --- | --- |
| Database reachable | `200` | `"ok"` |
| Database unreachable | `503` | `"degraded"` |

```json
{
  "status": "ok",
  "version": "0.1.1",
  "pieces": 2
}
```

`version` is the server's own package version, which makes the endpoint the authoritative answer to "what is actually deployed here". `pieces` is how many pieces the index currently holds, which answers the other half of that question: whether the library being served is the one that was published. Every endpoint is on the [API reference](/rhapsod/reference/api/).

## Why degraded is not down

A process that answers `503` with a parseable body is telling you something a connection refusal cannot: it started, it read its configuration, it bound its port, and the thing it cannot reach is its storage. The container's healthcheck calls this endpoint, so `docker compose ps` distinguishes "the server is gone" from "the server is fine and the volume is not".

## Unknown endpoints

Anything else under `/api` answers `404` with `{"error":"no such endpoint"}`. The API never falls through to the app: a misspelled path has to look like a mistake, not like a page.
