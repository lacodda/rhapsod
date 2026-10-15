//! The light markdown the format uses inside a line, read once, here.
//!
//! A paragraph used to travel to the reading app as the markdown it was written
//! in, and the app worked out what a reader sees with a parser of its own that
//! knew only `**bold**`. Three things followed from that one shortcut: `*italic*`
//! was shown with its asterisks, a kept line that crossed a bold word was never
//! picked out again, and a misspelling selected across one could not be found
//! in the file - the reader's words were the rendered ones, the file held the
//! markers. What a reader sees is decided here now, and the app draws it.
//!
//! The format uses three things inside a line and nothing more: `**strong**`,
//! `*emphasis*` and wiki links, `[[path|caption]]` or `[[path]]`. A marker that
//! is not closed is text, because a stray asterisk in prose is a character the
//! author typed, not a formatting error to be guessed at.

use serde::{Serialize, Serializer, ser::SerializeSeq};

/// A run of text that looks one way.
///
/// The flags are left out of the JSON when they are off, so a plain paragraph
/// is a list of `{"text": ...}` and nothing else.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Span {
    pub text: String,
    #[serde(skip_serializing_if = "is_false")]
    pub strong: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub em: bool,
    /// The path a wiki link names, exactly as written. Resolved by the app
    /// against the library it holds, so a piece published later turns an old
    /// caption into a link without the cached paragraph being fetched again.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

// `skip_serializing_if` hands over a reference.
#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_false(flag: &bool) -> bool {
    !*flag
}

/// The runs a block of the format reads as.
#[must_use]
pub fn parse(block: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    for (part, strong) in strong_runs(block) {
        for (part, em) in emphasis_runs(part) {
            push_links(part, strong, em, &mut spans);
        }
    }
    spans
}

/// The text of a block as a reader sees it: every marker gone, every caption
/// in place of its link.
#[must_use]
pub fn visible(block: &str) -> String {
    parse(block).into_iter().map(|span| span.text).collect()
}

/// Text with every run of whitespace made one space, and none at the ends.
///
/// What a browser draws and what a selection reads back are both collapsed
/// this way; the file is not. Matching a reader's words against the file
/// therefore compares the two after this, on both sides.
#[must_use]
pub fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Writes a list of blocks as lists of runs: how the API sends prose.
///
/// The piece keeps its blocks as markdown - the reading position, the word
/// count and the search for a reader's words all want the source - and turns
/// them into runs only on the way out.
///
/// # Errors
///
/// Fails only when the serializer does.
pub fn as_runs<S: Serializer>(blocks: &[String], serializer: S) -> Result<S::Ok, S::Error> {
    let mut list = serializer.serialize_seq(Some(blocks.len()))?;
    for block in blocks {
        list.serialize_element(&parse(block))?;
    }
    list.end()
}

/// The block cut at its `**` pairs, each part saying whether it is strong.
///
/// Pairs are taken in order, the first marker with the second: the shortest
/// reading, which is the one an author means by `**a** and **b**`. A marker
/// left over at the end has no partner and stays as two asterisks.
fn strong_runs(block: &str) -> Vec<(&str, bool)> {
    let mut parts = Vec::new();
    let mut rest = block;
    while let Some(open) = rest.find("**") {
        let after = &rest[open + 2..];
        let Some(close) = after.find("**") else { break };
        // `****` is not an empty strong run worth drawing; it is text.
        if close == 0 {
            parts.push((&rest[..open + 4], false));
            rest = &after[2..];
            continue;
        }
        parts.push((&rest[..open], false));
        parts.push((&after[..close], true));
        rest = &after[close + 2..];
    }
    parts.push((rest, false));
    parts.retain(|(part, _)| !part.is_empty());
    parts
}

/// A part cut at its `*emphasis*` pairs.
///
/// An asterisk opens only before a letter or a mark that is not a space, and
/// closes only after one, and neither may sit inside a word: `2 * 3` and
/// `a*b` are what the author typed, not emphasis.
fn emphasis_runs(part: &str) -> Vec<(&str, bool)> {
    let chars: Vec<(usize, char)> = part.char_indices().collect();
    let mut runs = Vec::new();
    let mut start = 0;
    let mut at = 0;
    while at < chars.len() {
        let (byte, ch) = chars[at];
        if ch == '*' && opens(&chars, at) {
            let close = (at + 1..chars.len()).find(|&next| chars[next].1 == '*' && closes(&chars, next) && next > at + 1);
            if let Some(close) = close {
                runs.push((&part[start..byte], false));
                let inner_start = byte + 1;
                let inner_end = chars[close].0;
                runs.push((&part[inner_start..inner_end], true));
                start = inner_end + 1;
                at = close + 1;
                continue;
            }
        }
        at += 1;
    }
    runs.push((&part[start..], false));
    runs.retain(|(run, _)| !run.is_empty());
    runs
}

fn opens(chars: &[(usize, char)], at: usize) -> bool {
    let next = chars.get(at + 1).map(|&(_, ch)| ch);
    let previous = at.checked_sub(1).and_then(|before| chars.get(before)).map(|&(_, ch)| ch);
    next.is_some_and(|ch| !ch.is_whitespace() && ch != '*') && !previous.is_some_and(char::is_alphanumeric)
}

fn closes(chars: &[(usize, char)], at: usize) -> bool {
    let previous = at.checked_sub(1).and_then(|before| chars.get(before)).map(|&(_, ch)| ch);
    let next = chars.get(at + 1).map(|&(_, ch)| ch);
    previous.is_some_and(|ch| !ch.is_whitespace()) && !next.is_some_and(char::is_alphanumeric)
}

/// A run cut at its wiki links, pushed as spans that share its look.
fn push_links(run: &str, strong: bool, em: bool, spans: &mut Vec<Span>) {
    let plain = |text: &str| Span {
        text: text.to_string(),
        strong,
        em,
        link: None,
    };
    let mut rest = run;
    while let Some(open) = rest.find("[[") {
        let inner_start = open + 2;
        let Some(length) = rest[inner_start..].find("]]") else { break };
        let inner = &rest[inner_start..inner_start + length];
        let (path, caption) = inner.split_once('|').unwrap_or((inner, ""));
        let path = path.trim();
        // `[[]]` or `[[|x]]` names nothing; leave it as the author wrote it.
        if path.is_empty() {
            spans.push(plain(&rest[..inner_start + length + 2]));
            rest = &rest[inner_start + length + 2..];
            continue;
        }
        if open > 0 {
            spans.push(plain(&rest[..open]));
        }
        let caption = caption.trim();
        let caption = if caption.is_empty() {
            path.rsplit('/').next().unwrap_or(path).trim()
        } else {
            caption
        };
        spans.push(Span {
            text: caption.to_string(),
            strong,
            em,
            link: Some(path.to_string()),
        });
        rest = &rest[inner_start + length + 2..];
    }
    if !rest.is_empty() {
        spans.push(plain(rest));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(text: &str) -> Span {
        Span {
            text: text.to_string(),
            strong: false,
            em: false,
            link: None,
        }
    }

    fn strong(text: &str) -> Span {
        Span {
            strong: true,
            ..self::text(text)
        }
    }

    fn em(text: &str) -> Span {
        Span { em: true, ..self::text(text) }
    }

    fn link(text: &str, path: &str) -> Span {
        Span {
            link: Some(path.to_string()),
            ..self::text(text)
        }
    }

    #[test]
    fn a_plain_block_is_one_run() {
        assert_eq!(parse("Июнь 1816 года."), [text("Июнь 1816 года.")]);
    }

    #[test]
    fn strong_is_read_without_its_markers() {
        assert_eq!(
            parse("Камень слушает **не тебя**, а лёд."),
            [text("Камень слушает "), strong("не тебя"), text(", а лёд.")]
        );
    }

    #[test]
    fn two_strong_runs_stay_two() {
        assert_eq!(parse("**a** и **b**"), [strong("a"), text(" и "), strong("b")]);
    }

    #[test]
    fn emphasis_is_read_without_its_asterisks() {
        // The case the reader saw on the stand: `*pebble*` with its asterisks.
        assert_eq!(
            parse("Это называется *pebble*, «крупа»."),
            [text("Это называется "), em("pebble"), text(", «крупа».")]
        );
    }

    #[test]
    fn emphasis_inside_strong_is_both() {
        let spans = parse("**игру зовут *the roaring game* до сих пор**");
        assert_eq!(
            spans,
            [
                strong("игру зовут "),
                Span {
                    em: true,
                    ..strong("the roaring game")
                },
                strong(" до сих пор"),
            ]
        );
    }

    #[test]
    fn an_asterisk_that_is_arithmetic_stays_an_asterisk() {
        assert_eq!(parse("2 * 3 = 6, and 4 * 5 = 20"), [text("2 * 3 = 6, and 4 * 5 = 20")]);
        assert_eq!(parse("a*b*c"), [text("a*b*c")]);
    }

    #[test]
    fn a_marker_left_open_is_text() {
        assert_eq!(parse("**half open"), [text("**half open")]);
        assert_eq!(parse("one *star"), [text("one *star")]);
    }

    #[test]
    fn a_wiki_link_becomes_its_caption_and_its_path() {
        assert_eq!(
            parse("See [[Library/02 — History/Year Without a Summer|the cold year]] first."),
            [
                text("See "),
                link("the cold year", "Library/02 — History/Year Without a Summer"),
                text(" first."),
            ]
        );
    }

    #[test]
    fn a_wiki_link_without_a_caption_is_called_by_its_last_segment() {
        assert_eq!(
            parse("[[02 — History/Year Without a Summer]] — the same cold."),
            [link("Year Without a Summer", "02 — History/Year Without a Summer"), text(" — the same cold.")]
        );
    }

    #[test]
    fn a_link_inside_strong_is_strong() {
        assert_eq!(
            parse("**[[a/b|B]]**"),
            [Span {
                strong: true,
                ..link("B", "a/b")
            }]
        );
    }

    #[test]
    fn a_link_left_open_is_text() {
        assert_eq!(parse("[[a/b no end"), [text("[[a/b no end")]);
    }

    #[test]
    fn the_visible_text_is_what_a_reader_selects() {
        assert_eq!(
            visible("крутится по часовой — уходит **вправо**. И *pebble*, и [[a/Корабль|корабль]]."),
            "крутится по часовой — уходит вправо. И pebble, и корабль."
        );
    }

    #[test]
    fn whitespace_collapses_the_way_a_browser_draws_it() {
        assert_eq!(collapse("  one\ntwo\u{a0} three  "), "one two three");
    }

    #[test]
    fn the_api_sends_blocks_as_lists_of_runs() {
        #[derive(Serialize)]
        struct Holder {
            #[serde(serialize_with = "as_runs")]
            blocks: Vec<String>,
        }
        let json = serde_json::to_value(Holder {
            blocks: vec!["plain".into(), "a **b**".into()],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "blocks": [[{ "text": "plain" }], [{ "text": "a " }, { "text": "b", "strong": true }]] })
        );
    }
}
