//! Which Overpass reply a card can use, the same rules for every place that
//! keeps replies: the command line on disk, the page in the browser's cache.
//!
//! A card asks for more ground than it covers ([`PAD`] of its size on every
//! side), and a stored reply serves any later card whose ground and OSM keys
//! it contains. Moving a card a little, zooming in, or switching profiles
//! with the same keys then reuses the reply instead of asking Overpass again.
//! Features are read against the card's own outline either way
//! ([`crate::osm::features_from_overpass`]), so a bigger reply draws the same
//! card.
//!
//! The stores differ only in what they can afford: each passes its own byte
//! budget to [`evict`].

use crate::card::Card;
use geo::BoundingRect;
use serde::{Deserialize, Serialize};

/// Extra ground fetched on each side, as a fraction of the card's size: 0.25
/// fetches 1.5 × the width and height, and a card can then move a quarter of
/// its size, or grow by half, and still be served.
pub const PAD: f64 = 0.25;

/// The time limit the query declares. Overpass admits a query only when it
/// can reserve what the query declares, so a busy server turns big
/// declarations away first (504): a card's ground answers in seconds, and 90
/// s leaves room without asking for the default 180.
pub const QUERY_TIMEOUT_S: u32 = 90;

/// A reply older than this is downloaded again when the network is there.
pub const MAX_AGE_S: u64 = 30 * 24 * 3600;

/// Bytes of replies the browser keeps; the oldest go first.
pub const BROWSER_BUDGET: u64 = 200_000_000;

/// Bytes of replies the command line keeps.
pub const DISK_BUDGET: u64 = 2_000_000_000;

/// Fetched boxes are rounded outward to 1 / this many degrees (about 10 m),
/// so their names stay short.
const GRID_PER_DEG: f64 = 1e4;

/// Some ground, `[west, south, east, north]` in degrees, and the OSM keys
/// asked for on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Extent {
    pub bbox: [f64; 4],
    pub keys: Vec<String>,
}

impl Extent {
    /// Whether a reply for `self` holds everything `need` asks for.
    pub fn covers(&self, need: &Extent) -> bool {
        let [w, s, e, n] = self.bbox;
        let [nw, ns, ne, nn] = need.bbox;
        w <= nw && s <= ns && e >= ne && n >= nn && need.keys.iter().all(|k| self.keys.contains(k))
    }

    fn area(&self) -> f64 {
        let [w, s, e, n] = self.bbox;
        (e - w) * (n - s)
    }

    /// A file-safe name for the reply: the box, then a hash of the keys.
    pub fn name(&self) -> String {
        let [w, s, e, n] = self.bbox;
        let mut keys = self.keys.clone();
        keys.sort();
        // FNV-1a: short, stable, and needs no crate.
        let hash = keys.join(",").bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
        format!("{w:.4}_{s:.4}_{e:.4}_{n:.4}_{hash:016x}")
    }
}

/// A stored reply: what it covers, when it was fetched (Unix seconds), and
/// its size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    #[serde(flatten)]
    pub extent: Extent,
    pub fetched: u64,
    pub bytes: u64,
}

/// What a card needs from Overpass, and what to ask for when no stored reply
/// has it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Request {
    /// The card's own ground: a reply must cover this.
    pub need: Extent,
    /// The padded ground to download.
    pub fetch: Extent,
    /// The Overpass QL for `fetch`.
    pub query: String,
}

/// The request for `card` with `keys` (see [`crate::card::fetch_keys`]).
pub fn request(card: &Card, keys: &[String]) -> Request {
    let r = card.query_polygon().bounding_rect().expect("a card has corners");
    let need = [r.min().x, r.min().y, r.max().x, r.max().y];
    let (pw, ph) = ((need[2] - need[0]) * PAD, (need[3] - need[1]) * PAD);
    let down = |v: f64| (v * GRID_PER_DEG).floor() / GRID_PER_DEG;
    let up = |v: f64| (v * GRID_PER_DEG).ceil() / GRID_PER_DEG;
    let fetch = [down(need[0] - pw), down(need[1] - ph), up(need[2] + pw), up(need[3] + ph)];
    let keys = keys.to_vec();
    Request {
        query: overpass_query_bbox(fetch, &keys),
        need: Extent { bbox: need, keys: keys.clone() },
        fetch: Extent { bbox: fetch, keys },
    }
}

/// The stored reply to use for `need`: the smallest one that covers it, so
/// the least is read. Replies older than `max_age_s` are skipped; pass `None`
/// to take any (offline).
pub fn pick(entries: &[Entry], need: &Extent, now: u64, max_age_s: Option<u64>) -> Option<usize> {
    entries
        .iter()
        .enumerate()
        .filter(|(_, e)| max_age_s.is_none_or(|max| now.saturating_sub(e.fetched) < max))
        .filter(|(_, e)| e.extent.covers(need))
        .min_by(|(_, a), (_, b)| a.extent.area().total_cmp(&b.extent.area()))
        .map(|(i, _)| i)
}

/// The replies to delete: the expired ones, those a younger reply covers
/// entirely, then the oldest until the rest fit in `budget` bytes.
pub fn evict(entries: &[Entry], budget: u64, now: u64) -> Vec<usize> {
    let expired = |e: &Entry| now.saturating_sub(e.fetched) >= MAX_AGE_S;
    let covered = |i: usize, e: &Entry| {
        entries.iter().enumerate().any(|(j, o)| {
            j != i && !expired(o) && o.extent.covers(&e.extent) && (o.fetched, j) > (e.fetched, i)
        })
    };
    let mut gone: Vec<usize> = (0..entries.len()).filter(|&i| expired(&entries[i]) || covered(i, &entries[i])).collect();
    let mut kept: Vec<usize> = (0..entries.len()).filter(|i| !gone.contains(i)).collect();
    kept.sort_by_key(|&i| entries[i].fetched);
    let mut total: u64 = kept.iter().map(|&i| entries[i].bytes).sum();
    for i in kept {
        if total <= budget {
            break;
        }
        total -= entries[i].bytes;
        gone.push(i);
    }
    gone.sort_unstable();
    gone
}

/// Overpass QL for every element with one of `keys` in `bbox`, with tags,
/// then the ways and nodes they are built from, as bare geometry.
///
/// The memory it declares grows with the ground, from 64 MiB: far below
/// the default 512 MiB, so a busy server admits it sooner, and still more
/// than a dense city's square kilometres take.
pub fn overpass_query_bbox(bbox: [f64; 4], keys: &[String]) -> String {
    let [w, s, e, n] = bbox;
    let area = format!("({s:.4},{w:.4},{n:.4},{e:.4})");
    let km2 = (e - w) * 111.32 * ((s + n) / 2.0).to_radians().cos() * (n - s) * 110.57;
    let mib = (64.0 + 16.0 * km2).clamp(64.0, 1024.0).round() as u64;
    let parts: String = keys.iter().map(|k| format!("nwr['{k}']{area};")).collect();
    format!(
        "[out:json][timeout:{QUERY_TIMEOUT_S}][maxsize:{}];({parts})->.hit;.hit > ->.down;(.down; - .hit;)->.rest;\
         .hit out body qt;.rest out skel qt;",
        mib << 20
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProjectionMode;

    fn card(lng: f64, lat: f64, scale: f64) -> Card {
        Card { center: (lng, lat), width_mm: 152.4, height_mm: 101.6, scale, bearing: 0.0, projection: ProjectionMode::Utm }
    }

    fn keys() -> Vec<String> {
        vec!["building".into(), "highway".into()]
    }

    fn entry(r: &Request, fetched: u64, bytes: u64) -> Entry {
        Entry { extent: r.fetch.clone(), fetched, bytes }
    }

    #[test]
    fn a_small_move_or_a_zoom_in_is_served_by_the_first_reply() {
        let first = request(&card(-122.3934746, 37.7955487, 10000.0), &keys());
        let stored = [entry(&first, 0, 1)];
        let nudged = request(&card(-122.392, 37.7965, 10000.0), &keys());
        let closer = request(&card(-122.3934746, 37.7955487, 6000.0), &keys());
        assert_eq!(pick(&stored, &nudged.need, 10, Some(MAX_AGE_S)), Some(0));
        assert_eq!(pick(&stored, &closer.need, 10, Some(MAX_AGE_S)), Some(0));
    }

    #[test]
    fn a_far_move_a_new_key_or_an_old_reply_is_not() {
        let first = request(&card(-122.3934746, 37.7955487, 10000.0), &keys());
        let stored = [entry(&first, 0, 1)];
        let away = request(&card(-122.37, 37.7955487, 10000.0), &keys());
        let mut more = keys();
        more.push("leisure".into());
        let wider = request(&card(-122.3934746, 37.7955487, 10000.0), &more);
        assert_eq!(pick(&stored, &away.need, 10, Some(MAX_AGE_S)), None);
        assert_eq!(pick(&stored, &wider.need, 10, Some(MAX_AGE_S)), None);
        assert_eq!(pick(&stored, &first.need, MAX_AGE_S + 1, Some(MAX_AGE_S)), None);
        assert_eq!(pick(&stored, &first.need, MAX_AGE_S + 1, None), Some(0));
    }

    #[test]
    fn the_smallest_cover_wins() {
        let big = request(&card(-122.3934746, 37.7955487, 20000.0), &keys());
        let small = request(&card(-122.3934746, 37.7955487, 10000.0), &keys());
        let stored = [entry(&big, 0, 1), entry(&small, 0, 1)];
        assert_eq!(pick(&stored, &small.need, 10, Some(MAX_AGE_S)), Some(1));
    }

    #[test]
    fn eviction_drops_expired_covered_then_oldest() {
        let a = request(&card(-122.3934746, 37.7955487, 10000.0), &keys());
        let b = request(&card(-122.3934746, 37.7955487, 30000.0), &keys());
        let c = request(&card(-122.25, 37.87, 10000.0), &keys());
        let d = request(&card(-122.20, 37.80, 10000.0), &keys());
        let now = MAX_AGE_S + 100;
        let stored = [
            entry(&a, now - 50, 10), // covered by the younger `b`
            entry(&b, now - 10, 10),
            entry(&c, 0, 10),        // expired
            entry(&d, now - 40, 10),
        ];
        assert_eq!(evict(&stored, 100, now), vec![0, 2]);
        assert_eq!(evict(&stored, 10, now), vec![0, 2, 3]);
    }

    #[test]
    fn the_query_asks_for_the_padded_box() {
        let r = request(&card(-122.3934746, 37.7955487, 10000.0), &keys());
        let [w, s, e, n] = r.fetch.bbox;
        assert!(r.query.contains(&format!("nwr['highway']({s:.4},{w:.4},{n:.4},{e:.4});")));
        assert!(r.query.contains("[timeout:90][maxsize:"));
        assert!(r.fetch.covers(&r.need));
        let (nw, fw) = (r.need.bbox[2] - r.need.bbox[0], e - w);
        assert!((fw / nw - 1.5).abs() < 0.01);
    }
}
