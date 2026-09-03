//! The library: a directory of markdown files, read into memory.
//!
//! The content is files and stays files (ADR 0002). Nothing here writes to the
//! directory; the index is rebuilt from it and held in memory, because a
//! personal library is thousands of files at most and reading them all costs
//! less than keeping a second copy of them in the database consistent.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;

/// Sections are directories named `NN — Title`: the number orders them, the
/// title is what a reader sees. A directory without that shape is still a
/// section, named after itself and sorted last.
const SECTION_SEPARATOR: &str = " — ";

/// The four trailing blocks a piece ends with. They are lifted out of the body
/// so the reading app can set them apart from the prose: the neighbours are
/// links, the one-liner is what a repetition card shows, the song seed is the
/// author's own workbench and not part of the read, and the reference is the
/// dry answer to "what was that, exactly" a reader wants once the story ends.
///
/// A heading that is not on this list stays in the prose, which is what makes
/// adding one to the format a change here and not a silent regression: an
/// unknown heading used to be swallowed by whichever block came before it.
const NEIGHBOURS_HEADING: &str = "Соседи";
const ONE_LINER_HEADING: &str = "Одной строкой";
const SONG_HEADING: &str = "Для песни";
const REFERENCE_HEADING: &str = "Справка";

/// One piece of the library, as the API returns it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Piece {
    /// Stable identifier derived from the path: `19-lyubov-i-pary/abelyar-i-eloiza`.
    pub id: String,
    /// Section id, the part of `id` before the slash.
    pub section: String,
    /// Title, from the `topic` field or the first heading.
    pub title: String,
    /// Date from the frontmatter, if any, as written.
    pub written: Option<String>,
    /// Word count of the body as the file declares it, or as counted.
    pub words: usize,
    /// The prose, one string per paragraph. Reading position is an index into
    /// this, which is why it is a list and not one blob of markdown.
    pub paragraphs: Vec<String>,
    /// Neighbouring pieces, as written: free text, possibly naming a piece that
    /// does not exist yet.
    pub neighbours: Vec<String>,
    /// The line meant to be remembered.
    pub one_liner: Option<String>,
    /// The song seed, kept whole and shown apart from the prose.
    pub song: Vec<String>,
    /// The reference block: what the piece is about, stated plainly. Shown in
    /// a frame of its own, because it deliberately breaks the voice of the
    /// story and reads as a card rather than as a last paragraph.
    pub reference: Vec<String>,
}

/// A piece without its text: what a list of pieces needs and no more.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PieceSummary {
    pub id: String,
    pub section: String,
    pub title: String,
    pub written: Option<String>,
    pub words: usize,
    pub one_liner: Option<String>,
}

impl Piece {
    fn summary(&self) -> PieceSummary {
        PieceSummary {
            id: self.id.clone(),
            section: self.section.clone(),
            title: self.title.clone(),
            written: self.written.clone(),
            words: self.words,
            one_liner: self.one_liner.clone(),
        }
    }
}

/// A shelf of the library.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Section {
    /// Slug of the directory name: `19-lyubov-i-pary`.
    pub id: String,
    /// Number from the directory name, used for ordering.
    pub number: Option<u32>,
    /// Title without the number.
    pub title: String,
    /// How many pieces the shelf holds.
    pub pieces: usize,
}

/// The whole library, read once and answered from memory.
#[derive(Debug, Clone, Default)]
pub struct Library {
    sections: Vec<Section>,
    pieces: BTreeMap<String, Piece>,
    /// Piece ids in reading order: by section, then by title within it. The
    /// order the app walks when it offers what to read next.
    order: Vec<String>,
}

impl Library {
    /// Reads every markdown file under `root` into a new index.
    ///
    /// Files that cannot be read or parsed are skipped with a warning rather
    /// than failing the whole index: one malformed file should not take the
    /// library down, and the log names it.
    ///
    /// # Errors
    ///
    /// Fails only when `root` itself cannot be listed.
    pub fn load(root: &Path) -> Result<Self> {
        let mut sections = Vec::new();
        let mut pieces = BTreeMap::new();

        let entries = std::fs::read_dir(root).with_context(|| format!("failed to read the library directory {}", root.display()))?;
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        dirs.sort();

        for dir in dirs {
            let Some(name) = dir.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let (number, title) = split_section_name(name);
            let id = slug(name);
            let mut count = 0;

            let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
                .with_context(|| format!("failed to read the section directory {}", dir.display()))?
                .filter_map(std::result::Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|extension| extension == "md"))
                .collect();
            files.sort();

            for file in files {
                match read_piece(&file, &id) {
                    Ok(Some(piece)) => {
                        count += 1;
                        pieces.insert(piece.id.clone(), piece);
                    }
                    // Not a novella: a companion file of the reader's own
                    // notes, or anything else that shares the directory.
                    Ok(None) => tracing::debug!(path = %file.display(), "not a novella; left out of the library"),
                    Err(error) => tracing::warn!(%error, path = %file.display(), "skipping a file that could not be read"),
                }
            }

            if count > 0 {
                sections.push(Section {
                    id,
                    number,
                    title,
                    pieces: count,
                });
            }
        }

        // Numbered sections first, in order; anything unnumbered after them,
        // alphabetically. Reading order follows the same rule.
        sections.sort_by(|a, b| match (a.number, b.number) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.title.cmp(&b.title),
        });

        let order = sections
            .iter()
            .flat_map(|section| {
                let mut ids: Vec<String> = pieces
                    .values()
                    .filter(|piece| piece.section == section.id)
                    .map(|piece| piece.id.clone())
                    .collect();
                ids.sort();
                ids
            })
            .collect();

        Ok(Self { sections, pieces, order })
    }

    /// The shelves, in reading order.
    #[must_use]
    pub fn sections(&self) -> &[Section] {
        &self.sections
    }

    /// Every piece, in reading order, without text.
    #[must_use]
    pub fn summaries(&self) -> Vec<PieceSummary> {
        self.order.iter().filter_map(|id| self.pieces.get(id)).map(Piece::summary).collect()
    }

    /// The pieces of one shelf, in reading order, without text.
    #[must_use]
    pub fn summaries_in(&self, section: &str) -> Vec<PieceSummary> {
        self.summaries().into_iter().filter(|piece| piece.section == section).collect()
    }

    /// One piece with its text.
    #[must_use]
    pub fn piece(&self, id: &str) -> Option<&Piece> {
        self.pieces.get(id)
    }

    /// How many pieces the library holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.pieces.len()
    }

    /// Whether the library holds nothing. A published directory that indexes to
    /// zero pieces is a real state — an empty stand on its first day.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.pieces.is_empty()
    }
}

/// Splits `19 — Любовь и пары` into `(Some(19), "Любовь и пары")`.
fn split_section_name(name: &str) -> (Option<u32>, String) {
    match name.split_once(SECTION_SEPARATOR) {
        Some((number, title)) => (number.trim().parse().ok(), title.trim().to_string()),
        None => (None, name.trim().to_string()),
    }
}

/// Reads one file into a piece, or `None` when the file is not one.
///
/// A published directory holds more than the library. The ritual that returns
/// the reader's marks to the vault writes a companion file beside each piece -
/// the notes and kept lines belonging to it - and those travel to the stand
/// with everything else. Indexed as pieces, they appeared on the shelf as
/// one-minute novellas with no text, which is what this rules out.
///
/// The test is the `type` in the frontmatter, not the file's name: a name is a
/// convention that shifts, and matching on one would only work until somebody
/// called a companion something else. Anything that does not say it is a
/// novella is left alone - the library is the author's, and a file that has
/// not claimed to belong in it does not.
fn read_piece(path: &Path, section: &str) -> Result<Option<Piece>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let (frontmatter, body) = split_frontmatter(&text);
    let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or_default();

    // No `type` at all is a novella: the field arrived after the first pieces
    // were written, and a library that dropped everything older than the
    // convention would be a worse answer than a library that keeps it.
    if let Some(kind) = frontmatter.get("type")
        && kind.trim() != "novella"
    {
        return Ok(None);
    }

    let title = frontmatter
        .get("topic")
        .cloned()
        .or_else(|| first_heading(body))
        .unwrap_or_else(|| stem.to_string());
    let words = frontmatter
        .get("words")
        .and_then(|words| words.parse().ok())
        .unwrap_or_else(|| body.split_whitespace().count());

    let blocks = split_body(body);

    Ok(Some(Piece {
        id: format!("{section}/{}", slug(stem)),
        section: section.to_string(),
        title,
        written: frontmatter.get("written").cloned(),
        words,
        paragraphs: blocks.prose,
        neighbours: blocks.neighbours,
        one_liner: blocks.one_liner,
        song: blocks.song,
        reference: blocks.reference,
    }))
}

/// Splits a file into its frontmatter fields and the rest.
///
/// The frontmatter is YAML in name only: flat `key: value` pairs, which is all
/// the format uses. A real YAML parser would buy nothing here and would have to
/// be kept honest about the same edge cases anyway.
fn split_frontmatter(text: &str) -> (BTreeMap<String, String>, &str) {
    let mut fields = BTreeMap::new();
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else {
        return (fields, text);
    };
    let Some(end) = rest.find("\n---") else {
        return (fields, text);
    };
    let (block, body) = rest.split_at(end);

    for line in block.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"');
        if !value.is_empty() && value != "[]" {
            fields.insert(key.trim().to_string(), value.to_string());
        }
    }

    let body = body.trim_start_matches('\n').strip_prefix("---").unwrap_or(body);
    (fields, body.trim_start_matches(['\n', '\r']))
}

/// The body, split into what the reading app shows where.
struct Blocks {
    prose: Vec<String>,
    neighbours: Vec<String>,
    one_liner: Option<String>,
    song: Vec<String>,
    reference: Vec<String>,
}

/// Splits the body into prose paragraphs and the four trailing blocks.
///
/// Everything before the first of the trailing headings is prose; the headings
/// themselves are known by name, because the format names them and a piece that
/// invents its own heading should keep it in the prose rather than lose it.
fn split_body(body: &str) -> Blocks {
    let mut prose = Vec::new();
    let mut neighbours = Vec::new();
    let mut one_liner = None;
    let mut song = Vec::new();
    let mut reference = Vec::new();
    let mut current: Option<&str> = None;

    for block in body.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        // A horizontal rule separates the moves of a piece; it is punctuation
        // for the eye in a markdown file, not a paragraph. Found by running
        // the server against the real library: every piece carried three of
        // them, and the fixtures had none.
        if block.chars().all(|ch| ch == '-') {
            continue;
        }

        if let Some(heading) = block.strip_prefix("## ") {
            let heading = heading.trim();
            if matches!(heading, NEIGHBOURS_HEADING | ONE_LINER_HEADING | SONG_HEADING | REFERENCE_HEADING) {
                current = Some(match heading {
                    NEIGHBOURS_HEADING => NEIGHBOURS_HEADING,
                    ONE_LINER_HEADING => ONE_LINER_HEADING,
                    SONG_HEADING => SONG_HEADING,
                    _ => REFERENCE_HEADING,
                });
                continue;
            }
        }

        match current {
            Some(NEIGHBOURS_HEADING) => neighbours.extend(list_items(block)),
            Some(ONE_LINER_HEADING) => one_liner = Some(strip_emphasis(block)),
            Some(SONG_HEADING) => song.extend(list_items(block)),
            Some(REFERENCE_HEADING) => reference.extend(list_items(block)),
            // The title heading is the file's own name, already carried in
            // `title`; repeating it above the text would be an empty line of
            // display in every piece.
            _ if block.starts_with("# ") => {}
            _ => prose.push(block.to_string()),
        }
    }

    Blocks {
        prose,
        neighbours,
        one_liner,
        song,
        reference,
    }
}

/// The items of a markdown list, without their bullets.
fn list_items(block: &str) -> Vec<String> {
    block
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- "))
        .map(|item| item.trim().to_string())
        .collect()
}

/// Drops the bold markers and the quotation marks the one-liner is written in.
///
/// The closing quote is not the last character: the format writes
/// `**«...».**`, so the sentence's full stop sits outside the quotation. A
/// trim from the ends alone leaves `»` in the middle of the line, which is
/// what a repetition card would then show.
fn strip_emphasis(block: &str) -> String {
    let line = block.trim().trim_matches('*').trim();
    let line = line.strip_suffix('.').unwrap_or(line);
    let line = line.trim_matches(['«', '»']);
    format!("{}.", line.trim_end_matches(['.', ' ']))
}

/// The first `# ` heading of a body, if it has one.
fn first_heading(body: &str) -> Option<String> {
    body.lines().find_map(|line| line.strip_prefix("# ")).map(|line| line.trim().to_string())
}

/// A URL-safe id for a file or directory name.
///
/// Cyrillic is transliterated rather than percent-encoded: these ids end up in
/// the address bar of a phone, and `19-lyubov-i-pary` is a link a person can
/// read, while `19-%D0%9B%D1%8E%D0%B1...` is not. The mapping only has to be
/// stable and collision-free within one library, not reversible.
#[must_use]
pub fn slug(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut dash = false;
    for ch in name.chars() {
        // The soft and hard signs carry no sound and no word boundary: they
        // simply vanish. Treating them as separators put a dash inside a word
        // (`uplotnitel-nye`), which is what the stand's URLs showed.
        if matches!(ch, 'ь' | 'Ь' | 'ъ' | 'Ъ') {
            continue;
        }
        let mapped = transliterate(ch);
        if mapped.is_empty() {
            if !out.is_empty() && !dash {
                out.push('-');
                dash = true;
            }
        } else {
            out.push_str(&mapped);
            dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

/// One character of a name as it appears in an id: latin letters and digits as
/// themselves, Cyrillic transliterated, everything else a separator.
fn transliterate(ch: char) -> String {
    if ch.is_ascii_alphanumeric() {
        return ch.to_ascii_lowercase().to_string();
    }
    let lower = ch.to_lowercase().next().unwrap_or(ch);
    match lower {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' => "g",
        'д' => "d",
        'е' | 'ё' | 'э' => "e",
        'ж' => "zh",
        'з' => "z",
        'и' => "i",
        // `й` and `ы` are not `и`: collapsing all three turned `пары` into
        // `pari`, which reads as a different word in the address bar.
        'й' | 'ы' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "h",
        'ц' => "c",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "sch",
        'ю' => "yu",
        'я' => "ya",
        // The soft and hard signs drop out, like every other character that
        // is not a letter: they carry no sound to transliterate.
        _ => "",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A library laid out the way a published one is.
    fn library() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let section = dir.path().join("19 — Любовь и пары");
        std::fs::create_dir_all(&section).unwrap();
        std::fs::write(
            section.join("Абеляр и Элоиза.md"),
            "---\ntype: novella\nsection: 19 — Любовь и пары\ntopic: Абеляр и Элоиза\nwritten: 2026-09-01\nwords: 1012\nsource: \"\"\nsongs: []\n---\n\n# Абеляр и Элоиза\n\nПариж, около 1132 года.\n\nВторой абзац.\n\n## Соседи\n\n- Орфей и Эвридика — другая пара.\n- Данте и Беатриче — любовь в тексте.\n\n## Одной строкой\n\n**«Ради него, а не ради Бога».**\n\n## Для песни\n\n- **Ситуация:** она осталась.\n- **Образ:** покрывало у алтаря.\n\n## Справка\n\n- **Что это:** исторические лица и корпус писем.\n- **Область:** средневековая философия.\n- **Статус:** подлинность переписки спорна.\n",
        )
        .unwrap();

        // No `type` at all: the field arrived after the first pieces were
        // written, and those are still novellas.
        let second = dir.path().join("02 — История");
        std::fs::create_dir_all(&second).unwrap();
        std::fs::write(
            second.join("Год без лета.md"),
            "---\ntopic: Год без лета\nwords: 953\n---\n\n# Год без лета\n\nИюнь 1816 года.\n",
        )
        .unwrap();

        // The companion file the vault ritual writes beside a piece. It lives
        // in the same directory and is published with everything else.
        std::fs::write(
            second.join("Год без лета — заметки.md"),
            "---\ntype: reading-notes\nproject: rhapsod\nnovella: Год без лета\npiece_id: 02-istoriya/god-bez-leta\n---\n\n# Год без лета — заметки\n\n**Прочитано:** 02.09.2026\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn a_companion_file_is_not_a_novella() {
        // The ritual that returns the reader's marks writes these beside each
        // piece, and publishing carries them to the stand. Indexed as pieces,
        // they appeared on the shelf as one-minute novellas with no text -
        // which is what the owner saw, and what tests did not.
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");

        let summaries = lib.summaries();
        let titles: Vec<&str> = summaries.iter().map(|piece| piece.title.as_str()).collect();
        assert!(
            !titles.iter().any(|title| title.contains("заметки")),
            "a companion file was indexed as a novella: {titles:?}"
        );
        assert_eq!(lib.len(), 2, "the library should hold the two novellas and nothing else");

        // The shelf counter has to agree: a count that included companions
        // would say three pieces on a shelf holding one.
        let shelf = lib.sections().iter().find(|section| section.id == "02-istoriya").expect("the shelf");
        assert_eq!(shelf.pieces, 1, "the shelf counted something that is not a piece");
    }

    #[test]
    fn a_piece_with_no_type_is_still_a_novella() {
        // The field arrived after the first pieces were written; dropping
        // everything older than the convention would be a worse answer than
        // keeping it.
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");
        assert!(lib.piece("02-istoriya/god-bez-leta").is_some(), "a piece without a type was dropped");
    }

    #[test]
    fn reads_sections_in_their_numbered_order() {
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");

        let ids: Vec<&str> = lib.sections().iter().map(|section| section.id.as_str()).collect();
        assert_eq!(
            ids,
            ["02-istoriya", "19-lyubov-i-pary"],
            "sections are ordered by their number, not alphabetically"
        );
        assert_eq!(lib.sections()[0].title, "История", "the number is not part of the title");
        assert_eq!(lib.sections()[0].number, Some(2));
        assert_eq!(lib.len(), 2);
    }

    #[test]
    fn a_piece_carries_its_frontmatter_and_its_prose() {
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");
        let piece = lib.piece("19-lyubov-i-pary/abelyar-i-eloiza").expect("the piece should be indexed");

        assert_eq!(piece.title, "Абеляр и Элоиза");
        assert_eq!(piece.written.as_deref(), Some("2026-09-01"));
        assert_eq!(piece.words, 1012, "the declared word count is used as written");
        assert_eq!(piece.paragraphs, ["Париж, около 1132 года.", "Второй абзац."]);
    }

    #[test]
    fn the_reference_block_is_its_own_block() {
        // The format grew a tenth move on 2026-09-03, and an unknown heading
        // does not fail loudly: its lines simply continue whichever block came
        // before it. On the stand that showed as a reference glued to the end
        // of the song seed, which is the opposite kind of text - the seed is
        // the author's workbench, the reference is for the reader.
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");
        let piece = lib.piece("19-lyubov-i-pary/abelyar-i-eloiza").unwrap();

        assert_eq!(piece.reference.len(), 3, "every line of the block is kept");
        assert!(piece.reference[0].starts_with("**Что это:**"));
        assert_eq!(piece.song.len(), 2, "the reference must not be swallowed by the song seed above it");
        assert!(
            piece.paragraphs.iter().all(|paragraph| !paragraph.contains("Справка")),
            "the reference leaked into the prose"
        );
    }

    #[test]
    fn the_trailing_blocks_are_lifted_out_of_the_prose() {
        // The reading app sets them apart: neighbours are links, the one-liner
        // is a repetition card, and the song seed is the author's workbench.
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");
        let piece = lib.piece("19-lyubov-i-pary/abelyar-i-eloiza").unwrap();

        assert_eq!(piece.neighbours.len(), 2);
        assert!(piece.neighbours[0].starts_with("Орфей и Эвридика"));
        assert_eq!(piece.one_liner.as_deref(), Some("Ради него, а не ради Бога."));
        assert_eq!(piece.song.len(), 2);
        assert!(
            piece.paragraphs.iter().all(|paragraph| !paragraph.contains("Соседи")),
            "a trailing block leaked into the prose"
        );
    }

    #[test]
    fn a_horizontal_rule_is_not_a_paragraph() {
        // The format separates the moves of a piece with `---`; those are
        // punctuation in the file, and a reader should never see one as a
        // line of text.
        let dir = tempfile::tempdir().unwrap();
        let section = dir.path().join("01 — Раздел");
        std::fs::create_dir_all(&section).unwrap();
        std::fs::write(
            section.join("Тема.md"),
            "---
topic: Тема
---

# Тема

Первый.

---

Второй.
",
        )
        .unwrap();

        let lib = Library::load(dir.path()).unwrap();
        let piece = lib.piece("01-razdel/tema").expect("the piece should be indexed");
        assert_eq!(piece.paragraphs, ["Первый.", "Второй."], "a separator leaked into the prose");
    }

    #[test]
    fn the_title_heading_is_not_repeated_in_the_prose() {
        // It is already the piece's title; showing it again would be an empty
        // line of display in every piece.
        let dir = library();
        let lib = Library::load(dir.path()).expect("the library should load");
        let piece = lib.piece("02-istoriya/god-bez-leta").unwrap();
        assert_eq!(piece.paragraphs, ["Июнь 1816 года."]);
    }

    #[test]
    fn ids_are_readable_in_an_address_bar() {
        assert_eq!(slug("19 — Любовь и пары"), "19-lyubov-i-pary");
        assert_eq!(slug("Кейдж и 4′33″"), "keydzh-i-4-33");
        assert_eq!(slug("  Ёж  "), "ezh");
        assert_eq!(slug("Пары"), "pary", "й and ы are not и");
        // A soft sign is silent, not a word break: it must not leave a dash
        // in the middle of a word.
        assert_eq!(slug("Уплотнительные кольца"), "uplotnitelnye-kolca");
    }

    #[test]
    fn a_file_that_cannot_be_parsed_does_not_take_the_library_down() {
        // One malformed file is a content problem; the rest of the library
        // still has to be readable.
        let dir = library();
        std::fs::write(dir.path().join("19 — Любовь и пары/Пустая.md"), "").unwrap();
        let lib = Library::load(dir.path()).expect("the library should still load");
        assert_eq!(lib.len(), 3, "an empty file is a piece with no text, not a failure");
    }

    #[test]
    fn an_empty_directory_is_a_library_with_nothing_in_it() {
        // A stand on its first day: no content published yet, and the server
        // has to answer rather than refuse to start.
        let dir = tempfile::tempdir().unwrap();
        let lib = Library::load(dir.path()).expect("an empty directory is a valid library");
        assert!(lib.is_empty());
        assert!(lib.sections().is_empty());
    }

    #[test]
    fn a_section_with_no_pieces_is_not_a_shelf() {
        // Empty section directories exist in a vault the moment a section is
        // created; a shelf with nothing on it is noise in the app.
        let dir = library();
        std::fs::create_dir_all(dir.path().join("26 — Символы")).unwrap();
        let lib = Library::load(dir.path()).unwrap();
        assert_eq!(lib.sections().len(), 2, "an empty directory became a shelf");
    }

    #[test]
    fn reading_order_walks_sections_in_order() {
        let dir = library();
        let lib = Library::load(dir.path()).unwrap();
        let summaries = lib.summaries();
        let ids: Vec<&str> = summaries.iter().map(|piece| piece.id.as_str()).collect();
        assert_eq!(ids, ["02-istoriya/god-bez-leta", "19-lyubov-i-pary/abelyar-i-eloiza"]);
    }

    #[test]
    fn summaries_carry_no_text() {
        // The list of a section is fetched on a phone over a home network;
        // shipping every paragraph with it would make the first screen wait
        // for the whole library.
        let dir = library();
        let lib = Library::load(dir.path()).unwrap();
        let summary = &lib.summaries_in("19-lyubov-i-pary")[0];
        assert_eq!(summary.title, "Абеляр и Элоиза");
        assert_eq!(summary.one_liner.as_deref(), Some("Ради него, а не ради Бога."));
    }
}
