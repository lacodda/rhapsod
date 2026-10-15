//! A moment as a device reports it.
//!
//! Every gesture the reader makes carries the time it was made, by the clock of
//! the device in their hand (ADR 0003): a reaction tapped on a train is dated by
//! the train, not by the stand that heard of it two days later. That time is
//! stored as text and handed to `SQLite`'s date functions, which answer a string
//! they cannot read with `NULL` rather than an error - and a `NULL` due date
//! reads as a finished review schedule. So a moment is checked where it enters,
//! and a request carrying something else is refused before it reaches a table.

use std::fmt;

use serde::{Deserialize, Deserializer, de};

/// A UTC timestamp in the one shape the app sends: `2026-10-15T13:45:09.184Z`,
/// the fraction optional.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moment(String);

impl Moment {
    /// Reads a moment, or says why the text is not one.
    ///
    /// # Errors
    ///
    /// Fails when the text is not `YYYY-MM-DDTHH:MM:SS[.fraction]Z` with every
    /// field in range.
    pub fn parse(text: &str) -> Result<Self, String> {
        let invalid = || format!("not a moment: {text:?} - expected a UTC time like 2026-10-15T13:45:09.184Z");
        let bytes = text.as_bytes();
        if bytes.len() < 20 || bytes.last() != Some(&b'Z') {
            return Err(invalid());
        }
        let number = |from: usize, to: usize| -> Option<u32> {
            let part = text.get(from..to)?;
            part.bytes().all(|byte| byte.is_ascii_digit()).then(|| part.parse().ok())?
        };
        let shape = [(4, b'-'), (7, b'-'), (10, b'T'), (13, b':'), (16, b':')];
        if shape.iter().any(|&(at, mark)| bytes[at] != mark) {
            return Err(invalid());
        }
        let (Some(_year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) =
            (number(0, 4), number(5, 7), number(8, 10), number(11, 13), number(14, 16), number(17, 19))
        else {
            return Err(invalid());
        };
        let fraction = &text[19..text.len() - 1];
        let fraction_ok = fraction.is_empty() || (fraction.len() >= 2 && fraction.starts_with('.') && fraction[1..].bytes().all(|byte| byte.is_ascii_digit()));
        let in_range = (1..=12).contains(&month) && (1..=31).contains(&day) && hour < 24 && minute < 60 && second < 61;
        if fraction_ok && in_range {
            Ok(Self(text.to_string()))
        } else {
            Err(invalid())
        }
    }

    /// The moment as text, the way it is stored.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Moment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Moment {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Self::parse(&text).map_err(de::Error::custom)
    }
}

/// The text of an optional moment, as the database functions take it.
#[must_use]
pub fn text(moment: Option<&Moment>) -> Option<&str> {
    moment.map(Moment::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_app_sends_is_a_moment() {
        for good in ["2026-10-15T13:45:09.184Z", "2026-10-15T13:45:09Z", "2026-01-01T00:00:00.5Z"] {
            assert_eq!(Moment::parse(good).map(|moment| moment.to_string()), Ok(good.to_string()));
        }
    }

    #[test]
    fn anything_else_is_refused() {
        for bad in [
            "",
            "yesterday",
            "2026-10-15",
            "2026-10-15 13:45:09Z",
            "2026-10-15T13:45:09",
            "2026-10-15T13:45:09+03:00",
            "2026-13-15T13:45:09Z",
            "2026-10-15T25:45:09Z",
            "2026-10-15T13:45:09.Z",
            "2026-10-15T13:45:09.1xZ",
            "２０２６-10-15T13:45:09Z",
        ] {
            assert!(Moment::parse(bad).is_err(), "{bad:?} was taken for a moment");
        }
    }

    #[test]
    fn a_request_with_something_else_does_not_deserialize() {
        #[derive(Deserialize)]
        struct Body {
            #[allow(dead_code)]
            at: Option<Moment>,
        }
        assert!(serde_json::from_str::<Body>(r#"{"at":"2026-10-15T13:45:09.184Z"}"#).is_ok());
        assert!(serde_json::from_str::<Body>(r#"{"at":null}"#).is_ok());
        assert!(serde_json::from_str::<Body>(r"{}").is_ok());
        assert!(serde_json::from_str::<Body>(r#"{"at":"soon"}"#).is_err());
    }
}
