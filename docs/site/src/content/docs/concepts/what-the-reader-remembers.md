---
title: What the reader remembers
description: The three statuses, the paragraph position and why it is an index, the streak rule, and why what comes next is from another shelf.
---

The library is files and never changes as you read it ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Everything about *your* reading of it lives in one SQLite file: where you are, what you have finished, and what that adds up to.

This page is about the rules behind that. The endpoints are in [the API reference](/rhapsod/reference/api/).

## Three statuses, one of which is nothing

A piece is **not opened**, **reading**, or **read**.

The first has no storage. A piece you have never opened has no row, and that is the whole representation - there is no third value to keep in sync with the other two, no backfill when a piece is published, and no row to go stale when one is deleted. A library of three thousand pieces you have not touched is an empty table.

Opening a piece writes the row. Finishing it is the reader's own act.

## Finishing is a button

Reaching the bottom of a piece does not mark it read.

Scrolling past the song seed to see how long something is should not silently finish it, and a reader who abandons a piece halfway has not finished it either. Both would put a mark on a shelf that the reader never put there, and a counter that counts things you did not do is worse than no counter.

So there is a button, and it works both ways: a piece marked read by mistake can be put back to being read.

## The position is a paragraph index

What is stored is which paragraph you last saw - a number into the list of paragraphs the server returns - not a pixel offset and not a percentage.

This is why a piece comes back as a list of paragraphs rather than one blob of markdown. Paragraph 7 is the same sentence on a phone in portrait, on the same phone in landscape, and on a desktop with a window half that width. A pixel offset is a fact about a screen; a paragraph is a fact about the text.

### It only moves forward

A report that would move the position backwards is accepted and ignored.

Two devices are the ordinary case: the phone on the train, the desktop in the evening. A phone that comes back into range and syncs a position from before the desktop moved on would otherwise send the reader back up the page they were already past - and the reader is left scrolling to find their place, which is exactly the thing this feature exists to prevent.

Going back to the top of a piece is done by finishing it and opening it again, not by scrolling up. That is a deliberate trade: re-reading is rarer than syncing, and the rare case gets the extra tap.

The app follows the same rule locally, and does not send a report it knows would be refused. What it reports is the last paragraph whose top has passed the middle of the screen - the line being read, not the one about to appear.

## What it adds up to

Three numbers, shown on the library screen once there is something to show.

**Read** is how many pieces you have finished.

**Words** is how long they were, added up - the number that grows visibly, because piece counts move slowly and word counts move every time. It is counted from the library rather than from a stored column, so a piece that was rewritten counts as what it is now rather than as what it was when you read it.

**Streak** is consecutive days with at least one piece finished.

### The streak rule

A streak counts the day each piece was **first** finished, and that day is written once.

Re-reading an old favourite does not move it. If it did, a reader could repair a broken streak by opening something they finished last spring and tapping the button, and a number that can be repaired that way is not measuring anything.

A streak ends today or yesterday. A reader who has not read yet today has not broken anything - it is still today - and telling them at breakfast that their streak is gone is both wrong and discouraging. Miss a whole day and it is over; the count starts again at the next piece finished.

The app shows the streak only past one day. "1 day" is not a streak, it is today.

## Continue, and what comes next

Two different questions, answered by two different rules.

**Continue** is the most recently touched unfinished piece. It is the top of the library screen because it is what a reader most often wants from that screen: not a choice, but the thing they were already in the middle of.

**Next** is offered at the end of a piece, and it is an unread piece **from another shelf**.

That preference is the important part. Reading straight down one shelf turns thirty pieces about paradoxes into a textbook, and this format is built for the opposite: a piece about a volcano, then one about two people writing letters, then one about a paradox. The shelves are for finding things, not for marching through.

When everything unread is on the shelf just finished, that shelf is the answer rather than nothing - the rule is a preference, not a refusal. Within the preference, reading order decides, so the answer is the same on every device and does not shuffle underfoot between one glance and the next.

When nothing is unread, the app says that was the last unread piece. That is an ending, not an error.

## Where it lives, and what happens to it

One SQLite file, the one `RHAPSOD_DATABASE_URL` points at. A backup is a copy of it.

Progress is keyed to the piece id, which is derived from the file's path. Re-publishing the library changes what is on the shelf and nothing about your reading of it - but **renaming a file or its section changes the id**, and the row against the old id no longer finds anything. That is the honest outcome: a renamed file is a different link, and the old progress pointed at a piece that no longer exists under that name. Renames are cheap in a vault and not free here.

Sessions live in the same file and are unrelated to any of this. Locking or unlocking a stand does not touch what has been read; see [Locking a stand](/rhapsod/guides/locking-a-stand/).

## See also

- [The library](/rhapsod/concepts/the-library/) - what a piece is, and how its id is formed.
- [API](/rhapsod/reference/api/) - `GET /api/progress`, `POST /api/progress/{section}/{piece}` and `GET /api/next`, with real responses.
