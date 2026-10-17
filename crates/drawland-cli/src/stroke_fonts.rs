//! Download single-stroke font files (SVG/JHF) for labels.

pub fn fetch(url: &str) -> Result<Vec<u8>, String> {
    ureq::get(url)
        .call()
        .map_err(|e| format!("stroke font {:?}: {e}", url))?
        .into_body()
        .read_to_vec()
        .map_err(|e| format!("stroke font {:?}: {e}", url))
}
