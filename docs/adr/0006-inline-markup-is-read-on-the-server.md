# 0006 · Inline markup is read on the server

Date: 2026-10-15. Status: accepted.

## Context

A piece's prose is markdown, and the format uses three things inside a line: `**strong**`, `*emphasis*` and wiki links, `[[path|caption]]` or `[[path]]`. The server split the body into paragraphs and sent each one as the string it was written as; the reading app found the markers itself, with a parser that knew `**strong**` and wiki links and nothing else.

A rehearsal of a week of reading - a copy of the live stand, a phone-sized browser, a train with the stand switched off, the vault scripts run into a copy of the vault - showed what that cost. `*pebble*` in five pieces was drawn with its asterisks. A kept line that crossed a bold word was saved and never highlighted again, because the app looked for it in each run between markers on its own. And a misspelling selected across a bold word could not be found in the file at all: the reader's words were the rendered ones, the file held the markers, and the script that turns reports into patches called it "already corrected". Three defects, one cause: what a reader sees was decided by whichever client happened to look.

## Decision

- **The server reads the inline markup, once** (`src/inline.rs`), and the API sends every block of text - paragraphs, neighbours, the song seed, the reference - as runs: `{"text": ...}` with `strong`, `em` or `link` when they apply. The app draws runs; it does not parse.
- **A piece keeps its blocks as written** and turns them into runs only on the way out. The reading position, the word count and the search for a reader's words all want the source.
- **A link carries its path as written.** Whether it leads to a piece is decided by the app against the library index it holds, so a piece published later turns an old caption into a link without the paragraph being fetched again - offline included.
- **A reader's words are matched against what the screen showed.** `GET /api/typos` answers every report with the paragraphs of the published piece whose visible text holds the words, each with its source, so the author searches the vault for the paragraph as written. The app finds kept lines across runs the same way. Both sides compare whitespace collapsed, as a browser draws it.
- **A marker that is not closed is text,** and so is an asterisk that is arithmetic or inside a word. The format has no escape for an asterisk, and guessing at intent would be wrong more often than leaving the character the author typed.

## Consequences

- **One reading of the format.** A new marker is added in one place and every client gets it; the full-text search, the EPUB export and the shared reader block planned for 1.x need the visible text on the server anyway.
- **The shape of a piece changed.** A phone holding pieces in the old shape would open one on a train and draw nothing, so the library cache is named by the shape it holds (`rhapsod-library-2`), and a new worker drops the old copy when it takes over - at home, where the update arrived and the library refills.
- **The app and the server must agree on the visible text,** and they do by construction: the app joins the runs the server sent. What is left to agree on is whitespace, which both collapse.
