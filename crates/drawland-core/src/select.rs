//! Tag selections: which OSM features a `features.osm({...})` keeps.

use crate::osm::Feature;

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
