//! Tag selections: which OSM features a `features.osm({...})` keeps.

use crate::osm::Feature;
use serde_json::Value;

/// Which features a selection keeps: any listed key matching, none of the
/// `except` keys matching, and not underground unless asked.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Selector {
    pub any: Vec<(String, TagMatch)>,
    pub except: Vec<(String, TagMatch)>,
    pub underground: bool,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TagMatch {
    /// `key: true` — the tag is present (any value); `false` — absent.
    Present(bool),
    Values(Vec<String>),
}

impl TagMatch {
    fn matches(&self, value: Option<&str>) -> bool {
        match self {
            TagMatch::Present(p) => value.is_some() == *p,
            TagMatch::Values(vs) => value.is_some_and(|v| vs.iter().any(|w| w == v)),
        }
    }
}

impl Selector {
    pub fn keeps(&self, f: &Feature) -> bool {
        let hit = |rules: &[(String, TagMatch)]| rules.iter().any(|(k, m)| m.matches(f.tag(k)));
        hit(&self.any) && !hit(&self.except) && (self.underground || !crate::themes::is_underground(f))
    }

    /// Keys whose presence can select a feature (what Overpass must fetch).
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.any.iter().filter(|(_, m)| *m != TagMatch::Present(false)).map(|(k, _)| k.as_str())
    }
}

/// One test of `features.where`: a tag's presence or values, or a numeric
/// range on its value (`render_height`, `building:levels`, `rank`).
#[derive(Debug, Clone, PartialEq)]
pub enum TagTest {
    Match(TagMatch),
    /// `min` included, `max` not, so ranges side by side split a set without
    /// overlap. A value that is missing or not a number fails.
    Range { min: Option<f64>, max: Option<f64> },
}

impl TagTest {
    pub fn passes(&self, value: Option<&str>) -> bool {
        match self {
            TagTest::Match(m) => m.matches(value),
            TagTest::Range { min, max } => {
                let Some(v) = value.and_then(number) else { return false };
                min.is_none_or(|lo| v >= lo) && max.is_none_or(|hi| v < hi)
            }
        }
    }
}

/// Every test holds.
pub fn passes(tests: &[(String, TagTest)], f: &Feature) -> bool {
    tests.iter().all(|(k, t)| t.passes(f.tag(k)))
}

/// Tag tests from a JSON object, as in `features.where` and `modules.labels` rules.
pub fn parse_tag_tests(map: serde_json::Map<String, Value>) -> Result<Vec<(String, TagTest)>, String> {
    if map.is_empty() {
        return Err("needs at least one tag".into());
    }
    let bad = |k: &str, v: &Value| format!("{k} is {v}: write true, false, a value, a list of values or {{ min, max }}");
    let mut tags = Vec::new();
    for (k, v) in map {
        let test = match &v {
            Value::Bool(p) => TagTest::Match(TagMatch::Present(*p)),
            Value::String(s) => TagTest::Match(TagMatch::Values(vec![s.clone()])),
            Value::Number(n) => TagTest::Match(TagMatch::Values(vec![n.to_string()])),
            Value::Array(items) => TagTest::Match(TagMatch::Values(
                items
                    .iter()
                    .map(|i| match i {
                        Value::String(s) => Ok(s.clone()),
                        Value::Number(n) => Ok(n.to_string()),
                        _ => Err(bad(&k, &v)),
                    })
                    .collect::<Result<_, _>>()?,
            )),
            Value::Object(r) => {
                let bound = |name: &str| -> Result<Option<f64>, String> {
                    match r.get(name) {
                        None | Some(Value::Null) => Ok(None),
                        Some(b) => b.as_f64().map(Some).ok_or_else(|| bad(&k, &v)),
                    }
                };
                if r.keys().any(|key| key != "min" && key != "max") || r.is_empty() {
                    return Err(bad(&k, &v));
                }
                TagTest::Range { min: bound("min")?, max: bound("max")? }
            }
            Value::Null => return Err(bad(&k, &v)),
        };
        tags.push((k, test));
    }
    Ok(tags)
}

/// The JSON form of [`parse_tag_tests`], for saved graphs.
pub fn tag_tests_to_map(tests: &[(String, TagTest)]) -> serde_json::Map<String, Value> {
    use serde_json::json;
    let mut out = serde_json::Map::new();
    for (k, t) in tests {
        let v = match t {
            TagTest::Match(TagMatch::Present(p)) => Value::Bool(*p),
            TagTest::Match(TagMatch::Values(vs)) if vs.len() == 1 => Value::String(vs[0].clone()),
            TagTest::Match(TagMatch::Values(vs)) => Value::Array(vs.iter().cloned().map(Value::String).collect()),
            TagTest::Range { min, max } => {
                let mut r = serde_json::Map::new();
                if let Some(lo) = min {
                    r.insert("min".into(), json!(lo));
                }
                if let Some(hi) = max {
                    r.insert("max".into(), json!(hi));
                }
                Value::Object(r)
            }
        };
        out.insert(k.clone(), v);
    }
    out
}

/// The leading number of a tag value: `12`, `12.5`, `12 m`, `3;4` all read.
fn number(text: &str) -> Option<f64> {
    let t = text.trim();
    let end = t
        .char_indices()
        .find(|&(i, c)| !(c.is_ascii_digit() || c == '.' || (i == 0 && (c == '-' || c == '+'))))
        .map_or(t.len(), |(i, _)| i);
    t[..end].parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_split_without_overlap_and_read_loose_numbers() {
        let low = TagTest::Range { min: None, max: Some(10.0) };
        let high = TagTest::Range { min: Some(10.0), max: None };
        assert!(low.passes(Some("9.5")) && !high.passes(Some("9.5")));
        assert!(!low.passes(Some("10")) && high.passes(Some("10")));
        assert!(high.passes(Some("12 m")) && high.passes(Some("12;14")));
        assert!(!low.passes(None) && !low.passes(Some("tall")));
        assert!(TagTest::Match(TagMatch::Values(vec!["primary".into()])).passes(Some("primary")));
    }
}
