---
title: What the reader remembers
description: The three statuses, the paragraph position and why it is an index, the streak rule, why a quote is its words rather than a place in the file, and how it all comes back out.
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

## Notes, and the lines worth keeping

Two more things the reader leaves behind, and neither of them belongs to the library. A note is what a piece left you with; a quote is a line out of it you did not want to lose. The markdown files are never written ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)) - both live in the same SQLite file as the progress, and both come back out through [the export](#taking-it-back-out).

### One note per piece

A note is a piece of markdown in your own words, and there is exactly one of them per piece.

Not a thread, not a list of dated entries. A note about a piece is a thing you revise rather than append to: reading it again a month later changes what you think, and the honest record of that is the new sentence, not the old one with a timestamp beside it. It is saved a moment after you stop typing rather than on every keystroke, because a note is typed in bursts and one save per character would be one save per thought.

Notes are kept apart from the reading state, in their own table. A note outlives the reading of a piece: marking something unread, or finishing it, must not put at risk what you wrote about it.

### An emptied note is no note

Clear the textarea and the note is deleted, not stored as an empty string.

This is the same rule as the unopened status, for the same reason. A shelf marks which pieces carry a note, and an empty row would put that mark on a piece with nothing written about it - a lie on the shelf, and one you could not clear, because there would be no way to say "there is nothing here" other than the thing you just did. Whitespace counts as empty; a note of three spaces is not a note.

So there is no separate delete. Emptying the note *is* deleting it, which is how a reader would expect it to work and the only gesture the app has to offer.

### A quote is its words, not a place in the file

A quote stores the **text** the reader selected. Not a character offset, not a range, not a line number.

Offsets would be smaller and faster, and they would be wrong the first time you fixed a typo. The library is published from a vault and republished whenever a piece is edited; every edit above a highlight shifts its offsets by however many characters were added or removed, and nothing tells the server that happened. The highlight would still resolve - to whatever sentence now sits at that position.

That is the failure worth avoiding. A highlight that lands on the wrong sentence is worse than one that no longer matches, because it is confidently wrong: it shows you a line you never marked and attributes your own comment to it. Matching by text can only fail in the honest direction. The app finds a highlight again by searching the paragraph for the quoted words; if a piece was rewritten hard enough that they are gone, the highlight is no longer drawn on the text - and the quote itself, with its comment, is still on the quotes page, still readable, still yours.

The paragraph index is kept alongside, but only as a hint: it says where to look first and orders the quotes of one piece down the page. It is not what identifies the quote.

Only the comment can be edited afterwards. The text and the paragraph are what you selected, and a quote whose words could be changed would no longer be a quote.

### The same line can be kept twice

Keeping a sentence you already kept makes a second quote, with its own id. It is not a duplicate to reject.

Two readings of the same piece can land on the same line and mean different things by it - the first time for the image, the second for what it turned out to foreshadow, each with its own comment. Refusing the second would be the app telling the reader they already had that thought.

It follows that a quote is identified by its id and not by what it says. That id is **minted on the device that kept the line**, not handed out by the server. A highlight made on a train has to be commentable and removable there too, hours before the stand hears about it - and an id assigned by the server could not be used until the queue drained. `POST /api/quotes` carries the id with it and answers with the stored row; sending the same one twice keeps the line once ([ADR 0003](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0003-offline-first.md)).

## Marking a piece to find it again

A quote is a sentence worth keeping. A **bookmark** is a whole piece worth coming back to - and neither is the reading state, which records what happened rather than what you intend to do about it.

There are four kinds, and they are fixed:

| Mark | What it means |
| --- | --- |
| **Loved** | It was good. |
| **Come back** | There is something here to return to. |
| **For a song** | There is a song in this one. |
| **Read again** | Worth a second reading. |

A set you could define yourself would buy a settings screen in exchange for flexibility one reader rarely wants; if four turns out to be too few, a fifth is a migration rather than a redesign.

**A piece carries one mark.** Marking something *loved* that was already *read again* changes the kind rather than adding a second - a reader who does that means the newer one. Tapping the kind a piece already has takes the mark off, because the gesture that put it there should be the one that removes it.

The colours are the meaning. On a shelf the mark is a coloured dot beside the title, and recognising "the green one" is faster than reading a label. They come from the line's own vocabulary rather than a palette of their own, so they follow the theme into light mode.

Bookmarks travel with everything else: they are in [the export](#taking-it-back-out), and they come back on a stand restored from one.

## Coming back to it

A library that is only read is a library that is forgotten. Finishing a piece puts it into a schedule, and it comes back three times: **a day later, then a week, then a month**. After the third return it is carried, and never comes back on its own.

Those three gaps are fixed. They are not an algorithm that adapts an interval per piece, and there is no grade to give ([ADR 0004](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0004-fixed-review-schedule.md)). That machinery exists for decks of thousands of items under exam pressure, where a day either way compounds into passing or failing; this is a few hundred novellas read for pleasure by one person, and three returns spread over a month is the whole of what "do not let this fade" needs.

### The card is the line, not the piece

A card shows the piece's title and **the line it wants remembered** - the one-liner the piece already ends with, written for exactly this.

It does not show the text. A card that showed the prose would answer its own question: the point is to find out whether the thing is still in your head, and reading it again is what you do *after* discovering that it is not.

### Two answers, neither of them a grade

**I remember** retires this return and sets the next one - a week after the first, a month after the second.

**Open it** takes you to the piece and **keeps its place in the schedule**, bringing it back tomorrow. Going back to read something is not the same as having recalled it, so the return is not retired. It is not counted as a failure either: resetting a month of schedule because you were curious enough to reread would be teaching the wrong lesson about a library read for pleasure.

### Enrolling is finishing

Nothing asks you to add a piece to the schedule. Marking it read is what enrols it, because the schedule follows from having read something and a second decision about one act is a decision too many.

Marking a piece unread takes it out again - something in the middle of being read is not a thing to recall. And re-finishing a piece already in the schedule does not restart it: a favourite you reread has not been forgotten, and bringing it back tomorrow for having been enjoyed twice would be punishing the enjoyment.

### Nothing expires

What is due is everything dated **today or earlier**. A reader who was away for a week comes back to what accumulated, not to an empty screen that quietly dropped six days of returns.

When nothing is due - which is most days - the library screen says nothing about it at all. A counter reading zero on every visit is noise.

## Made here, delivered later

Every change described above is written on the device first and shown as done at once - then delivered to the stand whenever it can be reached ([ADR 0003](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0003-offline-first.md)). Nothing waits for the network, because the network is usually a Pi at home and the reading usually happens somewhere else.

Changes queue in the order they were made and are delivered in that order. That matters more than it sounds: marking a piece read, then unread, then read again is three changes to one piece, and delivering them out of sequence would leave the stand holding the wrong one.

A change the stand **refuses** - a quote on a piece that was renamed in the vault, a comment on one already removed - is dropped rather than retried forever, because everything queued behind it would otherwise be held hostage to a change the reader cannot fix. A change the stand **fails** to accept, because it is having a bad moment, is kept and tried again.

### Whoever wrote last, wins

Two devices can produce changes to the same thing while neither can see the other. When they meet, the newer one wins - by the clock of the device that made it, not by the order the two reached the database.

This is why it is the device's time that travels with a change. A piece marked unread on a train and delivered in the evening must not be undone by the "read" it was undoing, just because the desktop's report happened to arrive first.

The reading position is the exception, and only ever moves forward, for the reason given [above](#it-only-moves-forward).

A phone with a wrong clock can therefore override a right one. For one reader this is a curiosity rather than a risk, and it is written down here so it is not rediscovered later as a bug.

### What the app tells you

Nothing, in the ordinary case. At home, with everything delivered, there is nothing worth saying and a tick on every screen would be noise.

When there is something to know, the header says it: how many changes are **kept on this phone**, or that the stand is away. The wording is deliberate - the changes are saved, just not *there* yet, and "unsaved" would be a lie about work the reader can see on their screen.

The one thing worth knowing about it: those changes live in the browser's storage until they are delivered. Clearing the browser's data for the site while something is waiting throws it away. The stand is the durable copy; the queue is a queue.

## Taking it back out

Everything above - the reading state, the notes, the quotes - comes back as one JSON document from `GET /api/export`.

One document rather than one endpoint per kind, because of what reads it: a script that writes your marks into the vault the library was published from. That script needs the three kinds to be from the same moment. Fetched separately, a piece finished between two requests would be filed under a reading state that no longer described it, and the vault would record something that was never true at any instant. A snapshot taken in one request is what makes the script safe to run at any time, including while somebody is reading on a phone in the next room.

The export is a read. It changes nothing on the stand, and running it twice differs only in the file it writes. The walk-through is in [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/).

## Where it lives, and what happens to it

One SQLite file, the one `RHAPSOD_DATABASE_URL` points at. A backup is a copy of it.

Progress, notes and quotes are all keyed to the piece id, which is derived from the file's path. Re-publishing the library changes what is on the shelf and nothing about your reading of it - but **renaming a file or its section changes the id**, and the rows against the old id no longer find anything. That is the honest outcome: a renamed file is a different link, and the old progress pointed at a piece that no longer exists under that name. Renames are cheap in a vault and not free here.

Nothing is deleted when that happens. The rows stay, keyed to an id no piece answers to, and a quote whose piece is gone still shows on the quotes page under the id it came from rather than vanishing - which is also what you would want if the rename were a mistake about to be undone. The export carries them out either way, so a rename never silently loses a note.

Sessions live in the same file and are unrelated to any of this. Locking or unlocking a stand does not touch what has been read; see [Locking a stand](/rhapsod/guides/locking-a-stand/).

## See also

- [The library](/rhapsod/concepts/the-library/) - what a piece is, and how its id is formed.
- [API](/rhapsod/reference/api/) - the progress, notes, quotes and export endpoints, with real responses.
- [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/) - the export document, and the scripts that fetch it.
