//! Overpass and Nominatim over HTTP, cached on disk the way osmnx caches:
//! `<cache>/<sha1 of the equivalent GET url>.json`. The Python pipeline and
//! this one share the same cache folder and hit it for the same card.

use postcards_core::card::{OVERPASS_ENDPOINTS, OVERPASS_ENDPOINT_TIMEOUT_S, OVERPASS_ROUND_PAUSE_S};
use postcards_core::progress::{Level, Task};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The cache key's server: osmnx's, whichever server actually answered.
const OVERPASS_URL: &str = OVERPASS_ENDPOINTS[0];
const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";
/// osmnx's user agent: the cache files are shared, so requests look the same.
const USER_AGENT: &str = "OSMnx Python package (https://github.com/gboeing/osmnx)";
pub const OVERPASS_TIMEOUT_S: u32 = 180;

pub struct Http {
    cache: PathBuf,
    offline: bool,
    /// Skip cached Overpass replies (and overwrite them).
    refresh: bool,
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
    pub fn new(cache: PathBuf, offline: bool, refresh: bool) -> Http {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(OVERPASS_TIMEOUT_S as u64)))
            .http_status_as_error(true)
            .build()
            .into();
        Http { cache, offline, refresh, agent }
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
            return Ok(text);
        }
        if self.offline {
            return Err(format!("{what}: not in {} and --offline is set", display(&self.cache)));
        }
        let text = send(&self.agent).map_err(|e| format!("{what}: {e}"))?;
        serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("{what}: response is not JSON: {e}"))?;
        self.store(key_url, &text)?;
        Ok(text)
    }

    /// The Overpass JSON for `query`, from the cache or from the first server
    /// that answers. Every server is tried in rounds, as the page does it
    /// (`OVERPASS_ROUND_PAUSE_S`); each try is a row under `task`.
    pub fn overpass(&self, query: &str, task: &Task) -> Result<String, String> {
        let key = get_url(OVERPASS_URL, &[("data", query)]);
        let path = self.cache_path(&key);
        if !self.refresh {
            if let Some(text) = self.cached(&key) {
                let row = task.child("osm-cache", "OSM from cache", 0, "");
                row.ok(&format!("{:.1} MB", text.len() as f64 / 1e6));
                task.note("");
                task.log(Level::Info, &format!("cached reply {}", path.display()));
                return Ok(text);
            }
        }
        if self.offline {
            return Err(format!("overpass: not in {} and --offline is set", display(&self.cache)));
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_recv_response(Some(Duration::from_secs(OVERPASS_ENDPOINT_TIMEOUT_S)))
            .timeout_global(Some(Duration::from_secs(OVERPASS_TIMEOUT_S as u64)))
            .http_status_as_error(true)
            .build()
            .into();

        let endpoints = endpoints();
        let rounds = OVERPASS_ROUND_PAUSE_S.len();
        for (round, &pause) in OVERPASS_ROUND_PAUSE_S.iter().enumerate() {
            for left in (1..=pause).rev() {
                task.note(&format!("round {} of {rounds} in {left} s", round + 1));
                std::thread::sleep(Duration::from_secs(1));
            }
            for (i, url) in endpoints.iter().enumerate() {
                let row = task.child(&format!("try-{round}-{i}"), &format!("OSM from {}", host(url)), 0, "bytes");
                match post_overpass(&agent, url, query, &row, task) {
                    Ok(text) => {
                        row.ok("");
                        self.store(&key, &text)?;
                        task.log(Level::Info, &format!("saved to {}", path.display()));
                        return Ok(text);
                    }
                    Err(why) => {
                        let next = match (endpoints.get(i + 1), OVERPASS_ROUND_PAUSE_S.get(round + 1)) {
                            (Some(next), _) => format!("trying {}", host(next)),
                            (None, Some(p)) => format!("round {} of {rounds} in {p} s", round + 2),
                            (None, None) => "no servers left".into(),
                        };
                        task.log(Level::Warn, &format!("{} {why} · {next}", host(url)));
                        row.fail(&why);
                    }
                }
            }
        }
        task.note(&format!("no server answered in {rounds} rounds"));
        Err(format!("no Overpass server answered in {rounds} rounds; try again later"))
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

/// One POST to one server, counting the reply's bytes as they arrive on
/// its `row` and on the `download` it is part of.
fn post_overpass(agent: &ureq::Agent, url: &str, query: &str, row: &Task, download: &Task) -> Result<String, String> {
    row.note("waiting for the server");
    download.note("");
    let mut res = agent
        .post(url)
        .header("User-Agent", USER_AGENT)
        .send_form([("data", query)])
        .map_err(short)?;
    // Overpass streams its answer, usually without a length: only draw a
    // filling bar when the size is announced.
    let size: u64 = res
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if size > 0 {
        row.set_total(size);
    }
    let mut reader = res.body_mut().with_config().limit(u64::MAX).reader();
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    let mut first: Option<std::time::Instant> = None;
    loop {
        let n = reader
            .read(&mut chunk)
            .map_err(|e| format!("cut off after {:.1} MB: {}", bytes.len() as f64 / 1e6, e.kind()))?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        let since = first.get_or_insert_with(std::time::Instant::now).elapsed().as_secs_f64();
        let per_s = bytes.len() as f64 / since.max(1e-3);
        let rate = match since {
            s if s < 0.5 => String::new(),
            _ if per_s >= 1e6 => format!("{:.1} MB/s", per_s / 1e6),
            _ => format!("{:.0} kB/s", per_s / 1e3),
        };
        row.step(bytes.len() as u64, &rate);
    }
    let text = String::from_utf8(bytes).map_err(|_| "answered, but not text".to_string())?;
    // A server that is up but busy answers 200 with an HTML error page.
    if !text.trim_start().starts_with('{') {
        return Err("answered, but not JSON".into());
    }
    serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("answered, but not JSON: {e}"))?;
    Ok(text)
}

/// A failed request in a few words, for a row's note.
fn short(e: ureq::Error) -> String {
    match e {
        ureq::Error::StatusCode(code) => match code {
            429 => "429 too many requests".into(),
            502 => "502 bad gateway".into(),
            503 => "503 unavailable".into(),
            504 => "504 gateway timeout".into(),
            code => format!("http {code}"),
        },
        ureq::Error::Timeout(_) => format!("no answer in {OVERPASS_ENDPOINT_TIMEOUT_S} s"),
        ureq::Error::HostNotFound => "host not found".into(),
        ureq::Error::ConnectionFailed => "connection failed".into(),
        ureq::Error::Io(e) if e.to_string().contains("lookup") => "host not found".into(),
        ureq::Error::Io(e) => e.kind().to_string(),
        other => other.to_string(),
    }
}

/// The servers to try, in order: `POSTCARDS_OVERPASS` (comma separated)
/// replaces the usual mirrors, to test a server or the retries.
fn endpoints() -> Vec<String> {
    match std::env::var("POSTCARDS_OVERPASS") {
        Ok(list) if !list.trim().is_empty() => list.split(',').map(|s| s.trim().to_string()).collect(),
        _ => OVERPASS_ENDPOINTS.iter().map(|s| s.to_string()).collect(),
    }
}

fn host(url: &str) -> &str {
    url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or(url)
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
