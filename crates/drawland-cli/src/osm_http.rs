//! Overpass and Nominatim over HTTP, cached on disk.
//!
//! Overpass replies go in `<cache>/overpass/`, one `<name>.json` each with a
//! `<name>.meta.json` saying what ground and keys it covers; which one an output
//! uses, and which are deleted, follows `drawland_core::osm_cache`, as in
//! the browser, with a bigger budget. Nominatim lookups are
//! `<cache>/<sha1 of the GET url>.json`.

use drawland_core::output::{
    overpass_error, overpass_slot_wait_s, overpass_status_url, Output, OVERPASS_ENDPOINTS, OVERPASS_ENDPOINT_TIMEOUT_S,
    OVERPASS_MAX_SLOT_WAIT_S, OVERPASS_ROUND_PAUSE_S,
};
use drawland_core::osm_cache::{self, Entry};
use drawland_core::progress::{Level, Task};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";
const USER_AGENT: &str = "draw.land (https://draw.land)";
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

    /// The Overpass JSON for `output` and `keys`: a stored reply that covers
    /// the output, or a download of the padded ground from the first server
    /// that answers. Every server is tried in rounds, as the page does it
    /// (`OVERPASS_ROUND_PAUSE_S`); each try is a row under `task`.
    pub fn overpass(&self, output: &Output, keys: &[String], task: &Task) -> Result<String, String> {
        let req = osm_cache::request(output, keys);
        let dir = self.cache.join("overpass");
        let stored = stored_replies(&dir);
        let now = unix_now();
        if !self.refresh {
            let entries: Vec<Entry> = stored.iter().map(|(_, e)| e.clone()).collect();
            let max_age = if self.offline { None } else { Some(osm_cache::MAX_AGE_S) };
            if let Some(i) = osm_cache::pick(&entries, &req.need, now, max_age) {
                let path = dir.join(format!("{}.json", stored[i].0));
                if let Ok(text) = std::fs::read_to_string(&path) {
                    let row = task.child("osm-cache", "OSM from cache", 0, "");
                    row.ok(&format!("{:.1} MB · {}", text.len() as f64 / 1e6, age_words(now.saturating_sub(entries[i].fetched))));
                    task.note("");
                    task.log(Level::Info, &format!("cached reply {}", path.display()));
                    return Ok(text);
                }
            }
        }
        if self.offline {
            return Err(format!("overpass: not in {} and --offline is set", display(&dir)));
        }
        let query = req.query.as_str();
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
                let mut result = post_overpass(&agent, url, query, &row, task);
                // Out of slots: the server says when one frees up; sit it out
                // once if that is soon, rather than spend the next server.
                if matches!(&result, Err(why) if why.starts_with("429")) {
                    if let Some(wait) = slot_wait_s(&agent, url).filter(|&w| w <= OVERPASS_MAX_SLOT_WAIT_S) {
                        for left in (1..=wait).rev() {
                            row.note(&format!("429 · a slot frees in {left} s"));
                            std::thread::sleep(Duration::from_secs(1));
                        }
                        result = post_overpass(&agent, url, query, &row, task);
                    }
                }
                match result {
                    Ok(text) => {
                        row.ok("");
                        let entry = Entry { extent: req.fetch.clone(), fetched: unix_now(), bytes: text.len() as u64 };
                        let path = store_reply(&dir, &entry, &text)?;
                        task.log(Level::Info, &format!("saved to {}", path.display()));
                        prune(&dir, stored, (entry.extent.name(), entry), now);
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

    /// A GeoJSON dataset by URL (`features.geojson`), cached in
    /// `<cache>/data/<sha1 of the url>.geojson`. Live feeds go stale, so a
    /// stored copy is used for [`DATA_MAX_AGE_S`] only (`--offline`: any age;
    /// `--refresh`: never). Returns the text and a note saying which.
    pub fn dataset(&self, url: &str) -> Result<(String, String), String> {
        let dir = self.cache.join("data");
        let path = dir.join(format!("{}.geojson", sha1_smol::Sha1::from(url).digest()));
        let age = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .map(|d| d.as_secs());
        if let Some(age) = age.filter(|&a| !self.refresh && (self.offline || a < DATA_MAX_AGE_S)) {
            if let Ok(text) = std::fs::read_to_string(&path) {
                let note = format!("{:.1} MB · cached, {}", text.len() as f64 / 1e6, age_words(age));
                return Ok((text, note));
            }
        }
        if self.offline {
            return Err(format!("{url}: not in {} and --offline is set", display(&dir)));
        }
        let text = self
            .agent
            .get(url)
            .header("User-Agent", USER_AGENT)
            .call()
            .and_then(|mut r| r.body_mut().with_config().limit(DATA_MAX_BYTES).read_to_string())
            .map_err(|e| format!("{url}: {e}"))?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        std::fs::write(&path, &text).map_err(|e| format!("{}: {e}", path.display()))?;
        let note = format!("{:.1} MB · {}", text.len() as f64 / 1e6, host(url));
        Ok((text, note))
    }
}

/// How long a downloaded dataset is reused: long enough to iterate on a
/// profile, short enough that a live feed (earthquakes) stays current.
pub const DATA_MAX_AGE_S: u64 = 15 * 60;
/// The largest dataset read.
const DATA_MAX_BYTES: u64 = 512 * 1024 * 1024;

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
    // Out of time or memory, Overpass still answers 200, cut short.
    if let Some(error) = overpass_error(&text) {
        return Err(format!("cut short: {error}"));
    }
    Ok(text)
}

/// Seconds until `interpreter` has a free slot for us, from its status page.
fn slot_wait_s(agent: &ureq::Agent, interpreter: &str) -> Option<u64> {
    let status = agent
        .get(&overpass_status_url(interpreter))
        .header("User-Agent", USER_AGENT)
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()?;
    overpass_slot_wait_s(&status)
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

/// The servers to try, in order: `DRAWLAND_OVERPASS` (comma separated)
/// replaces the usual mirrors, to test a server or the retries.
fn endpoints() -> Vec<String> {
    match std::env::var("DRAWLAND_OVERPASS") {
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

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// "fetched 3 days ago".
fn age_words(s: u64) -> String {
    match s {
        s if s < 120 => "fetched just now".into(),
        s if s < 7200 => format!("fetched {} min ago", s / 60),
        s if s < 2 * 86400 => format!("fetched {} h ago", s / 3600),
        s => format!("fetched {} days ago", s / 86400),
    }
}

/// The replies in `dir`, by name, from their `.meta.json` files.
fn stored_replies(dir: &Path) -> Vec<(String, Entry)> {
    let Ok(read) = std::fs::read_dir(dir) else { return vec![] };
    read.filter_map(|f| {
        let path = f.ok()?.path();
        let name = path.file_name()?.to_str()?.strip_suffix(".meta.json")?.to_string();
        let entry = serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
        Some((name, entry))
    })
    .collect()
}

/// Writes the reply, then its meta file, so a meta file always has its reply.
fn store_reply(dir: &Path, entry: &Entry, text: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let name = entry.extent.name();
    let path = dir.join(format!("{name}.json"));
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    let meta = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{name}.meta.json")), meta).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

/// Deletes what `osm_cache::evict` gives up, the new reply included in the count.
fn prune(dir: &Path, stored: Vec<(String, Entry)>, new: (String, Entry), now: u64) {
    let mut all: Vec<(String, Entry)> = stored.into_iter().filter(|(n, _)| *n != new.0).collect();
    all.push(new);
    let entries: Vec<Entry> = all.iter().map(|(_, e)| e.clone()).collect();
    for i in osm_cache::evict(&entries, osm_cache::DISK_BUDGET, now) {
        let name = &all[i].0;
        let _ = std::fs::remove_file(dir.join(format!("{name}.meta.json")));
        let _ = std::fs::remove_file(dir.join(format!("{name}.json")));
    }
}
