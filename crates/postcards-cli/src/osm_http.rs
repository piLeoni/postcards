//! Overpass and Nominatim over HTTP, cached on disk the way osmnx caches:
//! `<cache>/<sha1 of the equivalent GET url>.json`. The Python pipeline and
//! this one share the same cache folder and hit it for the same card.

use std::path::{Path, PathBuf};
use std::time::Duration;

const OVERPASS_URL: &str = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";
/// osmnx's user agent: the cache files are shared, so requests look the same.
const USER_AGENT: &str = "OSMnx Python package (https://github.com/gboeing/osmnx)";
pub const OVERPASS_TIMEOUT_S: u32 = 180;

pub struct Http {
    cache: PathBuf,
    offline: bool,
    agent: ureq::Agent,
}

/// `urllib.parse.quote_plus`: what `requests` does to query values.
fn quote_plus(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn get_url(base: &str, params: &[(&str, &str)]) -> String {
    let query: Vec<String> = params.iter().map(|(k, v)| format!("{}={}", quote_plus(k), quote_plus(v))).collect();
    format!("{base}?{}", query.join("&"))
}

impl Http {
    pub fn new(cache: PathBuf, offline: bool) -> Http {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(OVERPASS_TIMEOUT_S as u64)))
            .http_status_as_error(true)
            .build()
            .into();
        Http { cache, offline, agent }
    }

    fn cache_path(&self, url: &str) -> PathBuf {
        self.cache.join(format!("{}.json", sha1_smol::Sha1::from(url).digest()))
    }

    fn cached(&self, url: &str) -> Option<String> {
        std::fs::read_to_string(self.cache_path(url)).ok().filter(|t| !t.trim().is_empty())
    }

    fn store(&self, url: &str, text: &str) -> Result<(), String> {
        std::fs::create_dir_all(&self.cache).map_err(|e| format!("{}: {e}", self.cache.display()))?;
        let path = self.cache_path(url);
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
    }

    fn fetch(&self, key_url: &str, what: &str, send: impl FnOnce(&ureq::Agent) -> Result<String, ureq::Error>) -> Result<String, String> {
        if let Some(text) = self.cached(key_url) {
            eprintln!("{what}: cache {}", self.cache_path(key_url).display());
            return Ok(text);
        }
        if self.offline {
            return Err(format!("{what}: not in {} and --offline is set", display(&self.cache)));
        }
        eprintln!("{what}: requesting");
        let text = send(&self.agent).map_err(|e| format!("{what}: {e}"))?;
        serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("{what}: response is not JSON: {e}"))?;
        self.store(key_url, &text)?;
        Ok(text)
    }

    /// The Overpass JSON for `query`.
    pub fn overpass(&self, query: &str) -> Result<String, String> {
        let key = get_url(OVERPASS_URL, &[("data", query)]);
        self.fetch(&key, "overpass", |agent| {
            agent
                .post(OVERPASS_URL)
                .header("User-Agent", USER_AGENT)
                .send_form([("data", query)])?
                .body_mut()
                .with_config()
                .limit(u64::MAX)
                .read_to_string()
        })
    }

    /// `(lon, lat)` of the first Nominatim match for `address`.
    pub fn geocode(&self, address: &str) -> Result<(f64, f64), String> {
        let params = [("format", "json"), ("limit", "1"), ("dedupe", "0"), ("q", address)];
        let url = get_url(NOMINATIM_URL, &params);
        let text = self.fetch(&url, "nominatim", |agent| {
            agent.get(&url).header("User-Agent", USER_AGENT).call()?.body_mut().read_to_string()
        })?;
        let results: Vec<serde_json::Value> =
            serde_json::from_str(&text).map_err(|e| format!("nominatim: unexpected response: {e}"))?;
        let first = results.first().ok_or_else(|| format!("nominatim: no match for {address:?}"))?;
        let coord = |k: &str| -> Result<f64, String> {
            first[k]
                .as_str()
                .and_then(|s| s.parse().ok())
                .or_else(|| first[k].as_f64())
                .ok_or_else(|| format!("nominatim: result has no {k}"))
        };
        Ok((coord("lon")?, coord("lat")?))
    }
}

fn display(p: &Path) -> String {
    p.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use postcards_core::card::{overpass_query, Card, OSM_TAGS};
    use postcards_core::profile::ProjectionMode;

    /// The cache keys osmnx 2.0.2 wrote for these cards.
    #[test]
    fn cache_keys_match_osmnx() {
        let cases = [
            ((-122.4821837, 37.7693681), "7e16616e7a92f7d1bdab29bd2b1be997daf49932"),
            ((-122.2696803, 37.8059773), "6b8e2f4600d8dd5da30c30a3905ff04523c421a1"),
            ((-122.3934746, 37.7955487), "482ab39fbd842239c0aee10bb16066ce7d7689ee"),
        ];
        for (center, key) in cases {
            let card = Card {
                center,
                width_mm: 152.4,
                height_mm: 101.6,
                scale: 10000.0,
                bearing: 0.0,
                projection: ProjectionMode::Utm,
            };
            let query = overpass_query(&card.query_polygon(), OSM_TAGS, OVERPASS_TIMEOUT_S);
            let url = get_url(OVERPASS_URL, &[("data", &query)]);
            assert_eq!(sha1_smol::Sha1::from(&url).digest().to_string(), key);
        }
    }
}
