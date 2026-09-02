# 0004 · A fixed review schedule, not an algorithm

Date: 2026-09-02. Status: accepted.

## Context

A library that is only read is a library that is forgotten. The novellas rhapsod holds are seven-minute pieces about one thing each, and the point of reading them is to keep the thing - a paradox, a year without a summer, two people writing letters for twenty years. A reader who finishes thirty of them and remembers four has been entertained, not taught.

The obvious machinery for this is spaced repetition, and the obvious implementation is one of the SM-2 family: an ease factor per card, adjusted by a grade the reader gives each time, producing an interval that adapts to how well that particular item is known.

That machinery answers a question this product does not have. It exists for decks of thousands of items reviewed under time pressure - vocabulary, anatomy, exam material - where the difference between a 4-day and a 6-day interval, compounded over a year, is the difference between passing and failing. It costs the reader a judgement on every card ("how well did I know that, on a scale of one to five?") and it costs the product a table of tuning parameters that nobody here will ever tune.

## Decision

- **Three returns, at fixed gaps: one day, one week, one month.** After the third, the piece is carried and never comes back on its own. The intervals are a constant in the code, not a column in the database.
- **A finished piece enrols itself.** Marking a piece read puts it in the schedule; nothing asks the reader to enrol it separately. Marking it unread takes it out again - a piece in the middle of being read is not a thing to recall.
- **Two answers, and neither is a grade.** "I remember" retires the current return and sets the next. "Open it" takes the reader to the piece and keeps its place in the schedule, returning it tomorrow.
- **The card is the title and the one-liner.** Not the text. Every piece in this library already ends with the line it wants remembered, written by its author for exactly this purpose; a card that showed the prose would answer its own question.
- **Re-finishing does not restart the schedule.** A reader who re-reads a favourite has not forgotten it.

## Consequences

- **Nothing to tune, and nothing to explain.** The schedule can be described in one sentence on a documentation page, and a reader who wants to know why a piece came back today has a complete answer.
- **"Open it" is honest about what happened.** Going back to read something is not the same as having recalled it, so the step is not retired. The alternative - treating an open as a failure and resetting to day one - would punish curiosity, which is the wrong lesson for a library read for pleasure.
- **Returns accumulate rather than expire.** What is due is everything dated today or earlier, so a reader who was away for a week comes back to the backlog instead of to an empty screen that quietly dropped six days.
- **The schedule is the reader's, and it leaves.** It goes into the export alongside progress, notes and quotes, so the vault holds it and a rebuilt stand does not start the library over.
- **If three returns turn out to be too few, that is a decision with evidence behind it.** The schedule is one constant; changing it is changing that constant. What has been avoided is inventing the answer in advance, with a machinery that would make the change harder rather than easier.
- **A piece renamed in the vault leaves a row pointing at nothing.** It is skipped rather than drawn as a card with no text - the same rule the rest of the reader's state follows (see [ADR 0002](0002-content-as-files.md)), and the export still carries it.
