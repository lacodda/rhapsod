//! The topics that have not been written yet.
//!
//! The author keeps a plan of what a novella could be about - a pool of a
//! couple of thousand titles, grouped by shelf. It is published beside the
//! library so the reader has something to point at when they want one written.
//!
//! The plan is a pool rather than a queue: any topic can be taken at any time,
//! and a topic that becomes a novella is removed from it. So this never tries
//! to be a schedule, and never claims to know what comes next - it lists what
//! could be written, which is exactly what a request needs.
//!
//! Read, never written (ADR 0002). The reader's requests live in the database
//! and come back through the export; the plan itself stays the author's.

use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::library::slug;

/// The file the plan is published as, beside the library directory.
pub const FILE: &str = "topics.md";

/// One thing that could be written.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Topic {
    /// Derived from the title, the way a piece id is derived from its path, so
    /// a request survives the app being reloaded and the URL stays readable.
    pub id: String,
    pub title: String,
    /// The shelf it would belong to, as written in the plan.
    pub section: String,
}

/// A shelf of the plan, and what could be written on it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Shelf {
    pub id: String,
    pub title: String,
    pub topics: Vec<Topic>,
}

/// The plan, as the app receives it.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct Plan {
    pub shelves: Vec<Shelf>,
}

impl Plan {
    /// How many topics there are, across every shelf.
    #[must_use]
    pub fn len(&self) -> usize {
        self.shelves.iter().map(|shelf| shelf.topics.len()).sum()
    }

    /// Whether the plan holds nothing - which is what an unpublished plan
    /// looks like, and is not an error.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Whether a topic with this id is in the plan.
    ///
    /// What a request is checked against: a request for something that is not
    /// on offer is a stale app or a typed URL.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        self.shelves.iter().any(|shelf| shelf.topics.iter().any(|topic| topic.id == id))
    }

    /// The topic with this id, if the plan has one.
    #[must_use]
    pub fn topic(&self, id: &str) -> Option<&Topic> {
        self.shelves.iter().flat_map(|shelf| &shelf.topics).find(|topic| topic.id == id)
    }
}

/// Reads the plan published beside the library.
///
/// A missing file is an empty plan, not a failure: publishing the plan is
/// optional, and a stand without one simply offers nothing to request.
///
/// # Errors
///
/// Fails when the file exists but cannot be read.
pub fn load(content_dir: &Path) -> Result<Plan> {
    let path = content_dir.join(FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Plan::default()),
        Err(error) => return Err(error).with_context(|| format!("failed to read the plan at {}", path.display())),
    };
    Ok(parse(&text))
}

/// Turns the plan's markdown into shelves of topics.
///
/// The shape it reads is the shape the author writes: `## NN - Shelf` for a
/// shelf and `- [ ] Title` for a topic. Sub-groups (`###`) are flattened into
/// their shelf - they organise the author's own thinking, and a reader
/// pointing at a topic does not need to know which drawer it came from.
///
/// A topic already ticked is one that has been written, so it is left out: it
/// is a novella now, and the library is where it belongs.
fn parse(text: &str) -> Plan {
    let mut shelves: Vec<Shelf> = Vec::new();

    for line in text.lines() {
        let line = line.trim_end();

        if let Some(heading) = line.strip_prefix("## ") {
            let title = heading.trim();
            // The plan carries the author's own working headings as well as
            // shelves. A heading with no topics under it simply ends up with
            // an empty list and is dropped below.
            shelves.push(Shelf {
                id: slug(title),
                title: title.to_string(),
                topics: Vec::new(),
            });
            continue;
        }

        let Some(rest) = line.strip_prefix("- [") else { continue };
        let Some((mark, title)) = rest.split_once("] ") else { continue };
        // `[x]` is written; it left the plan for the library.
        if mark != " " {
            continue;
        }
        let title = title.trim();
        if title.is_empty() {
            continue;
        }
        let Some(shelf) = shelves.last_mut() else { continue };

        // The id has to be unique across the plan, and two shelves can hold
        // the same title. Prefixing with the shelf keeps them apart, the same
        // way a piece id is a shelf and a name.
        //
        // One shelf can also hold the same title twice - the real plan does,
        // in two different sub-groups - and flattening the groups brings them
        // together. The sub-group is not put in the id: it is the author's own
        // filing and may be rearranged, which would break every request made
        // against it. Instead the first one takes the name and the next gets a
        // suffix, so both can be pointed at and neither moves when the other
        // is written.
        let base = format!("{}/{}", shelf.id, slug(title));
        let mut id = base.clone();
        let mut nth = 1;
        while shelf.topics.iter().any(|topic| topic.id == id) {
            nth += 1;
            id = format!("{base}-{nth}");
        }

        shelf.topics.push(Topic {
            id,
            title: title.to_string(),
            section: shelf.title.clone(),
        });
    }

    // A heading with nothing under it is not a shelf of the plan: the file
    // opens with the author's own notes, and those would otherwise arrive as
    // empty shelves for the reader to scroll past.
    shelves.retain(|shelf| !shelf.topics.is_empty());
    Plan { shelves }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# План новелл\n\
        \n\
        План - это пул тем, а не очередь.\n\
        \n\
        ## Ждёт решения владельца\n\
        \n\
        - (пусто)\n\
        \n\
        ## 01 — Парадоксы и эффекты\n\
        \n\
        ### 01 — Философия и логика\n\
        \n\
        - [ ] Парадокс лжеца\n\
        - [ ] Буриданов осёл\n\
        \n\
        ### 02 — Время\n\
        \n\
        - [ ] Парадокс близнецов\n\
        \n\
        ## 02 — История\n\
        \n\
        - [ ] Год без лета\n\
        - [x] Уже написанная тема\n";

    #[test]
    fn the_plan_reads_as_shelves_of_topics() {
        let plan = parse(SAMPLE);
        assert_eq!(
            plan.shelves.len(),
            2,
            "shelves: {:?}",
            plan.shelves.iter().map(|s| &s.title).collect::<Vec<_>>()
        );
        assert_eq!(plan.shelves[0].title, "01 — Парадоксы и эффекты");
        assert_eq!(plan.shelves[1].title, "02 — История");
    }

    #[test]
    fn sub_groups_are_flattened_into_their_shelf() {
        // They organise the author's own thinking; a reader pointing at a
        // topic does not need to know which drawer it came from.
        let plan = parse(SAMPLE);
        assert_eq!(plan.shelves[0].topics.len(), 3);
        let titles: Vec<&str> = plan.shelves[0].topics.iter().map(|topic| topic.title.as_str()).collect();
        assert_eq!(titles, ["Парадокс лжеца", "Буриданов осёл", "Парадокс близнецов"]);
    }

    #[test]
    fn a_written_topic_has_left_the_plan() {
        // A ticked topic is a novella now, and the library is where it
        // belongs; offering it as something to request would be offering
        // something that already exists.
        let plan = parse(SAMPLE);
        let titles: Vec<&str> = plan.shelves[1].topics.iter().map(|topic| topic.title.as_str()).collect();
        assert_eq!(titles, ["Год без лета"], "a written topic was still offered");
    }

    #[test]
    fn a_heading_with_no_topics_is_not_a_shelf() {
        // The file opens with the author's own notes; those would arrive as
        // empty shelves for the reader to scroll past.
        let plan = parse(SAMPLE);
        assert!(
            !plan.shelves.iter().any(|shelf| shelf.title == "Ждёт решения владельца"),
            "an empty heading became a shelf"
        );
    }

    #[test]
    fn ids_carry_their_shelf_so_two_shelves_can_share_a_title() {
        let plan = parse("## 01 — Одно\n\n- [ ] Общая тема\n\n## 02 — Другое\n\n- [ ] Общая тема\n");
        let first = &plan.shelves[0].topics[0];
        let second = &plan.shelves[1].topics[0];
        assert_ne!(first.id, second.id, "two shelves produced the same topic id");
        assert!(first.id.starts_with("01-odno/"), "{}", first.id);
        assert!(plan.has(&first.id) && plan.has(&second.id));
    }

    #[test]
    fn one_shelf_can_hold_the_same_title_twice() {
        // The real plan does: the same title appears in two sub-groups of one
        // shelf, and flattening brings them together. Without a suffix both
        // would share an id, and a request for one would look like a request
        // for the other.
        let plan = parse(
            "## 01 — Одно

### Первая

- [ ] Общая тема

### Вторая

- [ ] Общая тема
",
        );
        let topics = &plan.shelves[0].topics;
        assert_eq!(topics.len(), 2, "a repeated title was dropped");
        assert_ne!(topics[0].id, topics[1].id, "two topics share an id");
        assert_eq!(topics[1].id, format!("{}-2", topics[0].id));
        // Both are addressable, which is the whole point.
        assert!(plan.has(&topics[0].id) && plan.has(&topics[1].id));
    }

    #[test]
    fn an_unpublished_plan_is_empty_rather_than_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let plan = load(dir.path()).expect("a missing plan is not a failure");
        assert!(plan.is_empty());
        assert_eq!(plan.len(), 0);
    }

    #[test]
    fn a_published_plan_is_read_from_beside_the_library() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE), SAMPLE).unwrap();
        let plan = load(dir.path()).expect("the plan should load");
        assert_eq!(plan.len(), 4);
        assert!(plan.topic(&plan.shelves[1].topics[0].id).is_some());
    }
}
