# 0003 · Offline first: the whole library cached, the reader's state queued

Date: 2026-09-02. Status: accepted.

## Context

rhapsod is read on a phone, and most reading happens away from home: on a train, in a waiting room, in places where the Pi on the home network is not reachable. No VPN is assumed; the stand is reachable when the phone is on the same network and not otherwise. A reader that shows a spinner whenever the server is away is not a reader.

The library is small enough to carry - text, not media - and the state a reader produces is smaller still: a position, a note, a review answer. Both sides of that are favourable to working without a connection.

## Decision

- **The SPA is a PWA that caches the whole library.** Once the app has been opened at home, every piece of content is available offline, not only the pages visited. The cache is refreshed whenever the server is reachable and the index has changed.
- **The reader's state is written locally first.** Progress, notes, highlights and review answers go into a local queue in the browser and are shown as done immediately. The queue is drained to the server whenever it can be reached, in order.
- **Conflicts are resolved by last write wins, by timestamp.** Each queued change carries the time it was made on the device; the server keeps the newest value per key. With one user and, in practice, one device at a time, this is the right amount of machinery - a merge would be solving a problem nobody here has.
- **The server is the durable copy.** The browser's storage can be cleared by the browser; the SQLite file is backed up. Local state is a queue and a cache, never the only copy of anything for longer than it takes to get home.

## Consequences

- **Reading never waits for the network.** Opening the app away from home shows the library as it was last synced, with progress as it was last recorded, and everything done meanwhile is kept and delivered later.
- **The API has to be idempotent for queued writes.** A change delivered twice - after a dropped connection mid-drain - must land once. Every write carries an identity and a timestamp, and the server upserts.
- **Clock skew is accepted.** Last write wins by device timestamp means a phone with a wrong clock can override a right one. For one person this is a curiosity, not a risk, and it is recorded here so it is not rediscovered as a bug.
- **The cache has a size.** "The whole library" is a promise the app has to keep in bytes; a library that outgrows what a browser will hold is a decision to make when it happens, with numbers, not one to solve in advance.
- **Nothing here needs a VPN, an account or a third party.** The stand is a home service and stays one; the app is what makes it usable anywhere.
