//! Google Fonts CSS → a font file the engine can parse (TTF/OTF).

/// Pick a `fonts.gstatic.com` URL from a Google Fonts stylesheet.
/// Prefers the `/* latin */` `@font-face` (basic Latin), then any `.ttf`, then `.woff2`.
pub fn pick_url_from_css(css: &str) -> Option<String> {
    if let Some(after) = css.split("/* latin */").nth(1) {
        if let Some(url) = first_gstatic_url(after, &["woff2", "woff", "ttf"]) {
            return Some(url);
        }
    }
    first_gstatic_url(css, &["ttf"]).or_else(|| first_gstatic_url(css, &["woff2", "woff"]))
}

fn first_gstatic_url(text: &str, exts: &[&str]) -> Option<String> {
    for chunk in text.split("url(").skip(1) {
        let url = chunk.split(')').next()?.trim();
        if url.starts_with("https://fonts.gstatic.com/") && exts.iter().any(|e| url.ends_with(e)) {
            return Some(url.to_string());
        }
    }
    None
}

/// TTF/OTF bytes for [`crate::text::layout`]: pass through or decompress WOFF2.
pub fn decode_font_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.starts_with(b"wOF2") {
        return wuff::decompress_woff2(bytes).map_err(|e| format!("woff2 decode: {e}"));
    }
    if bytes.starts_with(b"wOFF") {
        return wuff::decompress_woff1(bytes).map_err(|e| format!("woff decode: {e}"));
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_latin_woff2_from_google_css() {
        let css = r"
/* latin-ext */
@font-face { src: url(https://fonts.gstatic.com/ext.woff2) format('woff2'); }
/* latin */
@font-face { src: url(https://fonts.gstatic.com/latin.woff2) format('woff2'); }
";
        assert_eq!(pick_url_from_css(css).as_deref(), Some("https://fonts.gstatic.com/latin.woff2"));
    }
}
