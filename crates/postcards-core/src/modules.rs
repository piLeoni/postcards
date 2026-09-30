//! Theme modules a profile layer can name.

pub const KNOWN: &[&str] = &["buildings/v1", "parks/v1", "water/v1", "roads/v1"];

pub fn is_known(module: &str) -> bool {
    KNOWN.contains(&module)
}
