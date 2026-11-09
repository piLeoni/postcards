//! Download font bytes for Google Fonts (for labels with `origin: "google"`).

use drawland_core::google_fonts::pick_url_from_css;
use drawland_core::text::parse_google_font_key;

/// Asked without a browser's user-agent, Google Fonts serves one TrueType file
/// with every character of the face (`İ`, `ł`, Cyrillic, Greek…), rather
/// than a file per subset.
const CSS_UA: &str = "drawland";

pub fn fetch(key: &str) -> Result<Vec<u8>, String> {
    let (family, weight, italic) = parse_google_font_key(key).ok_or_else(|| format!("bad google font key {:?}", key))?;
    let family_q = family.replace(' ', "+");
    let axis = if italic { "ital,wght" } else { "wght" };
    let vals = if italic { format!("1,{}", weight) } else { weight.to_string() };
    let css_url = format!("https://fonts.googleapis.com/css2?family={family_q}:{axis}@{vals}&display=swap");
    let css = ureq::get(&css_url)
        .header("User-Agent", CSS_UA)
        .call()
        .map_err(|e| format!("google fonts css: {e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| format!("google fonts css: {e}"))?;
    let url = pick_url_from_css(&css).ok_or_else(|| format!("google fonts: no font URL in stylesheet for {:?}", family))?;
    ureq::get(&url)
        .call()
        .map_err(|e| format!("google font {:?}: {e}", family))?
        .into_body()
        .read_to_vec()
        .map_err(|e| format!("google font {:?}: {e}", family))
}
