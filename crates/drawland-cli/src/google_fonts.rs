//! Download TTF bytes for Google Fonts (for labels with `origin: "google"`).

use drawland_core::text::parse_google_font_key;

const CSS_UA: &str = "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Truetype)";

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
    let ttf = css
        .lines()
        .filter_map(|l| l.trim().strip_prefix("src: url("))
        .find_map(|rest| rest.split(')').next())
        .filter(|u| u.ends_with(".ttf"))
        .ok_or_else(|| format!("google fonts: no TTF in stylesheet for {:?}", family))?;
    ureq::get(ttf)
        .call()
        .map_err(|e| format!("google font {:?}: {e}", family))?
        .into_body()
        .read_to_vec()
        .map_err(|e| format!("google font {:?}: {e}", family))
}
