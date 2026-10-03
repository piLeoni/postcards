//! Theme modules a profile layer can name.

pub const KNOWN: &[&str] = &["buildings/v1", "parks/v1", "water/v1", "roads/v1"];

pub fn is_known(module: &str) -> bool {
    KNOWN.contains(&module)
}

/// OSM keys a module selects on.
pub fn osm_keys(module: &str) -> &'static [&'static str] {
    match module {
        "buildings/v1" => &["building"],
        "parks/v1" => &["leisure", "natural", "landuse"],
        "water/v1" => &["water", "natural"],
        "roads/v1" => &["highway"],
        _ => &[],
    }
}
