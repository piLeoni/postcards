//! Single-stroke fonts: Hershey `.jhf`, Evil Mad Scientist SVG fonts, and fallbacks.

use std::collections::HashMap;
use std::sync::OnceLock;

/// Where the capitals start and end in Hershey font units (y down).
pub const CAP_TOP: f64 = -12.0;
pub const BASELINE: f64 = 9.0;
pub const CAP_HEIGHT: f64 = BASELINE - CAP_TOP;

#[derive(Debug, Clone)]
pub struct StrokeGlyph {
    pub left: f64,
    pub right: f64,
    pub strokes: Vec<Vec<(f64, f64)>>,
}

impl StrokeGlyph {
    pub fn advance(&self) -> f64 {
        self.right - self.left
    }
}

#[derive(Debug, Clone)]
pub struct StrokeFont {
    glyphs: HashMap<char, StrokeGlyph>,
    pub cap_height: f64,
    pub top: f64,
    pub bottom: f64,
    /// Space width when the font has no explicit space glyph.
    default_advance: f64,
}

impl StrokeFont {
    pub fn has(&self, c: char) -> bool {
        self.glyphs.contains_key(&c)
    }

    pub fn glyph(&self, c: char) -> Option<&StrokeGlyph> {
        self.glyphs.get(&c)
    }

    pub fn missing_glyph(&self) -> &StrokeGlyph {
        static Q: OnceLock<StrokeGlyph> = OnceLock::new();
        Q.get_or_init(|| StrokeGlyph {
            left: 0.0,
            right: 8.0,
            strokes: vec![vec![(0.0, -6.0), (4.0, 6.0)], vec![(8.0, -6.0), (4.0, 6.0)]],
        })
    }

    pub fn parse_jhf(src: &str) -> Result<StrokeFont, String> {
        let mut glyphs_ascii: Vec<StrokeGlyph> = Vec::new();
        for (i, line) in src.lines().enumerate() {
            let line = line.trim_end();
            if line.is_empty() {
                continue;
            }
            let b = line.as_bytes();
            if b.len() < 10 {
                return Err(format!("line {}: too short for a glyph", i + 1));
            }
            let count: usize = line[5..8]
                .trim()
                .parse()
                .map_err(|_| format!("line {}: bad coordinate count {:?}", i + 1, &line[5..8]))?;
            let body = &b[8..];
            if body.len() < count * 2 {
                return Err(format!("line {}: {} pairs announced, {} found", i + 1, count, body.len() / 2));
            }
            let at = |k: usize| (body[2 * k] as f64 - b'R' as f64, body[2 * k + 1] as f64 - b'R' as f64);
            let (left, right) = at(0);
            let mut strokes = Vec::new();
            let mut run: Vec<(f64, f64)> = Vec::new();
            for k in 1..count {
                if body[2 * k] == b' ' && body[2 * k + 1] == b'R' {
                    if run.len() > 1 {
                        strokes.push(std::mem::take(&mut run));
                    }
                    run.clear();
                } else {
                    let (x, y) = at(k);
                    run.push((x - left, y));
                }
            }
            if run.len() > 1 {
                strokes.push(run);
            }
            glyphs_ascii.push(StrokeGlyph { left, right, strokes });
        }
        if glyphs_ascii.len() < 95 {
            return Err(format!("{} glyphs, expected at least 95", glyphs_ascii.len()));
        }
        let mut glyphs = HashMap::new();
        for (i, g) in glyphs_ascii.iter().enumerate() {
            let c = char::from_u32(32 + i as u32).unwrap();
            glyphs.insert(c, g.clone());
        }
        let default_advance = glyphs.get(&' ').map(|g| g.advance()).unwrap_or(8.0);
        Ok(StrokeFont {
            glyphs,
            cap_height: CAP_HEIGHT,
            top: CAP_TOP,
            bottom: BASELINE + 3.0,
            default_advance,
        })
    }

    pub fn parse_svg_font(xml: &str) -> Result<StrokeFont, String> {
        let declared_cap_height = parse_svg_cap_height(xml).unwrap_or(650.0);
        let units = parse_svg_units_per_em(xml).unwrap_or(1000.0);
        let ascent = parse_svg_ascent(xml).unwrap_or(declared_cap_height * 1.2);
        let descent = parse_svg_descent(xml).unwrap_or(-declared_cap_height * 0.3);

        // First pass: parse raw glyphs in SVG font coordinates (baseline = 0, y up).
        let id_y = |y: f64| y;
        let mut raw_glyphs: Vec<(char, f64, Vec<Vec<(f64, f64)>>)> = Vec::new();
        let mut space_adv: Option<f64> = None;
        let mut pos = 0usize;
        while let Some(start) = xml[pos..].find("<glyph ") {
            let i = pos + start;
            let end = xml[i..]
                .find("/>")
                .or_else(|| xml[i..].find('>'))
                .map(|o| i + o)
                .ok_or_else(|| "stroke font: unclosed glyph tag".to_string())?;
            let tag = &xml[i..end];
            pos = end + 1;
            if tag.contains("glyph-name=\"space\"") || tag.contains("unicode=\" \"") {
                space_adv = Some(parse_horiz_adv(tag).unwrap_or(units * 0.35));
                continue;
            }
            let Some(unicode) = parse_attr(tag, "unicode") else {
                continue;
            };
            let c = match decode_xml_char(&unicode) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if c == '\0' {
                continue;
            }
            let d = parse_attr(tag, "d").filter(|s| !s.is_empty());
            let adv = parse_horiz_adv(tag).unwrap_or(units * 0.5);
            let strokes = d
                .as_ref()
                .map(|path| flatten_svg_path(path, 1.0, &id_y))
                .unwrap_or_default();
            raw_glyphs.push((c, adv, strokes));
        }

        if raw_glyphs.is_empty() && space_adv.is_none() {
            return Err("stroke font: no glyphs in SVG".into());
        }

        // Measure actual capital height from 'H', 'M', 'I', or 'E' if present (EMS SVG fonts hardcode cap-height="500").
        let measured_cap = ['H', 'M', 'I', 'E']
            .into_iter()
            .find_map(|probe| {
                raw_glyphs
                    .iter()
                    .find(|(c, _, s)| *c == probe && !s.is_empty())
                    .and_then(|(_, _, strokes)| {
                        strokes
                            .iter()
                            .flatten()
                            .map(|&(_, y)| y)
                            .reduce(f64::max)
                    })
            })
            .filter(|&h| h > 100.0);

        let cap_height = measured_cap.unwrap_or(declared_cap_height);
        let scale = CAP_HEIGHT / cap_height;
        let mut glyphs = HashMap::new();
        if let Some(adv) = space_adv {
            glyphs.insert(
                ' ',
                StrokeGlyph {
                    left: 0.0,
                    right: adv * scale,
                    strokes: Vec::new(),
                },
            );
        }
        for (c, adv, raw_strokes) in raw_glyphs {
            let strokes = raw_strokes
                .into_iter()
                .map(|run| {
                    run.into_iter()
                        .map(|(x, y)| (x * scale, BASELINE - y * scale))
                        .collect()
                })
                .collect();
            glyphs.insert(
                c,
                StrokeGlyph {
                    left: 0.0,
                    right: adv * scale,
                    strokes,
                },
            );
        }

        let default_advance = glyphs.get(&' ').map(|g| g.advance()).unwrap_or(units * 0.35 * scale);
        let top = BASELINE - ascent * scale;
        let bottom = (BASELINE - descent * scale).max(BASELINE);
        Ok(StrokeFont {
            glyphs,
            cap_height: CAP_HEIGHT,
            top,
            bottom,
            default_advance,
        })
    }

    /// Universal built-in fallback: Hershey FuturaL (ASCII) + Greek (`greeks.jhf`) + Cyrillic (`cyrillic.jhf`)
    /// + common Latin Extended / Turkish glyphs from EMS Readability.
    pub fn futural() -> &'static StrokeFont {
        static F: OnceLock<StrokeFont> = OnceLock::new();
        F.get_or_init(|| {
            let mut base = StrokeFont::parse_jhf(include_str!("../fonts/futural.jhf")).expect("futural parses");
            let greek = StrokeFont::parse_jhf(include_str!("../fonts/greeks.jhf")).expect("greeks parses");
            let cyr = StrokeFont::parse_jhf(include_str!("../fonts/cyrillic.jhf")).expect("cyrillic parses");

            // Map Hershey Greek (A..X -> Α..Ω, a..x -> α..ω) + monotonic accented Greek vowels
            let greek_upper: &[char] = &[
                'Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ',
                'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω',
            ];
            let greek_lower: &[char] = &[
                'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ',
                'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω',
            ];
            for (idx, &uc) in greek_upper.iter().enumerate() {
                if let Some(g) = greek.glyph((b'A' + idx as u8) as char) {
                    base.glyphs.insert(uc, g.clone());
                }
            }
            for (idx, &lc) in greek_lower.iter().enumerate() {
                if let Some(g) = greek.glyph((b'a' + idx as u8) as char) {
                    base.glyphs.insert(lc, g.clone());
                }
            }
            if let Some(s) = base.glyphs.get(&'σ').cloned() {
                base.glyphs.insert('ς', s);
            }
            for (accented, plain) in [
                ('Ά', 'Α'), ('Έ', 'Ε'), ('Ή', 'Η'), ('Ί', 'Ι'), ('Ό', 'Ο'), ('Ύ', 'Υ'), ('Ώ', 'Ω'),
                ('ά', 'α'), ('έ', 'ε'), ('ή', 'η'), ('ί', 'ι'), ('ό', 'ο'), ('ύ', 'υ'), ('ώ', 'ω'),
                ('ϊ', 'ι'), ('ϋ', 'υ'), ('ΐ', 'ι'), ('ΰ', 'υ'),
            ] {
                if let Some(g) = base.glyphs.get(&plain).cloned() {
                    base.glyphs.insert(accented, g);
                }
            }

            // Map Hershey Cyrillic (phonetic KOI/Hershey slot layout)
            let cyr_map: &[(char, char, char)] = &[
                ('A', 'А', 'а'),
                ('B', 'Б', 'б'),
                ('V', 'В', 'в'),
                ('G', 'Г', 'г'),
                ('D', 'Д', 'д'),
                ('[', 'Е', 'е'),
                ('H', 'Ж', 'ж'),
                ('Z', 'З', 'з'),
                ('I', 'И', 'и'),
                ('E', 'Й', 'й'),
                ('K', 'К', 'к'),
                ('L', 'Л', 'л'),
                ('M', 'М', 'м'),
                ('N', 'Н', 'н'),
                ('O', 'О', 'о'),
                ('P', 'П', 'п'),
                ('R', 'Р', 'р'),
                ('S', 'С', 'с'),
                ('T', 'Т', 'т'),
                ('Y', 'У', 'у'),
                ('F', 'Ф', 'ф'),
                ('X', 'Х', 'х'),
                ('`', 'Ц', 'ц'),
                ('J', 'Ч', 'ч'),
                ('Q', 'Ш', 'ш'),
                ('W', 'Щ', 'щ'),
                (']', 'Ъ', 'ъ'),
                ('_', 'Ь', 'ь'),
                ('C', 'Э', 'э'),
                ('U', 'Ю', 'ю'),
                ('^', 'Я', 'я'),
            ];
            for &(slot_upper, uc, lc) in cyr_map {
                let slot_lower = char::from_u32(slot_upper as u32 + 32).unwrap();
                if let Some(g) = cyr.glyph(slot_upper) {
                    base.glyphs.insert(uc, g.clone());
                }
                if let Some(g) = cyr.glyph(slot_lower) {
                    base.glyphs.insert(lc, g.clone());
                }
            }
            if let Some(g) = cyr.glyph('|') {
                base.glyphs.insert('Ы', g.clone());
                base.glyphs.insert('ы', g.clone());
            }
            for (extra, src) in [('Ё', 'Е'), ('ё', 'е'), ('І', 'I'), ('і', 'i'), ('Ї', 'I'), ('ї', 'i')] {
                if let Some(g) = base.glyphs.get(&src).cloned() {
                    base.glyphs.insert(extra, g);
                }
            }

            // Compose native Hershey accented Latin & Turkish glyphs directly from futural's own base glyphs
            add_futural_latin_accents(&mut base);

            // Merge remaining extended Latin symbols (ß, æ, Æ, ø, Ø, œ, Œ, ð, þ, …)
            if let Ok(ext) = StrokeFont::parse_svg_font(include_str!("../fonts/latin_ext.svg")) {
                for (ch, g) in ext.glyphs {
                    base.glyphs.entry(ch).or_insert(g);
                }
            }

            base
        })
    }
}

#[derive(Clone, Copy)]
enum Diacritic {
    Umlaut,
    Acute,
    Grave,
    Circumflex,
    Tilde,
    Ring,
    Breve,
    Caron,
    DotAbove,
    Cedilla,
}

fn add_futural_latin_accents(font: &mut StrokeFont) {
    // Dotless 'ı' (stem of 'i' without dot) and middle dot '·'
    font.glyphs.insert(
        'ı',
        StrokeGlyph {
            left: 0.0,
            right: 8.0,
            strokes: vec![vec![(4.0, -5.0), (4.0, 9.0)]],
        },
    );
    font.glyphs.insert(
        '·',
        StrokeGlyph {
            left: 0.0,
            right: 8.0,
            strokes: vec![vec![
                (3.0, -2.0),
                (4.0, -1.0),
                (5.0, -2.0),
                (4.0, -3.0),
                (3.0, -2.0),
            ]],
        },
    );

    use Diacritic::*;
    let specs: &[(char, char, Diacritic, bool)] = &[
        ('ä', 'a', Umlaut, false),
        ('Ä', 'A', Umlaut, true),
        ('ë', 'e', Umlaut, false),
        ('Ë', 'E', Umlaut, true),
        ('ï', 'ı', Umlaut, false),
        ('Ï', 'I', Umlaut, true),
        ('ö', 'o', Umlaut, false),
        ('Ö', 'O', Umlaut, true),
        ('ü', 'u', Umlaut, false),
        ('Ü', 'U', Umlaut, true),
        ('ÿ', 'y', Umlaut, false),
        ('Ÿ', 'Y', Umlaut, true),
        ('á', 'a', Acute, false),
        ('Á', 'A', Acute, true),
        ('ć', 'c', Acute, false),
        ('Ć', 'C', Acute, true),
        ('é', 'e', Acute, false),
        ('É', 'E', Acute, true),
        ('í', 'ı', Acute, false),
        ('Í', 'I', Acute, true),
        ('ń', 'n', Acute, false),
        ('Ń', 'N', Acute, true),
        ('ó', 'o', Acute, false),
        ('Ó', 'O', Acute, true),
        ('ś', 's', Acute, false),
        ('Ś', 'S', Acute, true),
        ('ú', 'u', Acute, false),
        ('Ú', 'U', Acute, true),
        ('ý', 'y', Acute, false),
        ('Ý', 'Y', Acute, true),
        ('ź', 'z', Acute, false),
        ('Ź', 'Z', Acute, true),
        ('à', 'a', Grave, false),
        ('À', 'A', Grave, true),
        ('è', 'e', Grave, false),
        ('È', 'E', Grave, true),
        ('ì', 'ı', Grave, false),
        ('Ì', 'I', Grave, true),
        ('ò', 'o', Grave, false),
        ('Ò', 'O', Grave, true),
        ('ù', 'u', Grave, false),
        ('Ù', 'U', Grave, true),
        ('â', 'a', Circumflex, false),
        ('Â', 'A', Circumflex, true),
        ('ê', 'e', Circumflex, false),
        ('Ê', 'E', Circumflex, true),
        ('î', 'ı', Circumflex, false),
        ('Î', 'I', Circumflex, true),
        ('ô', 'o', Circumflex, false),
        ('Ô', 'O', Circumflex, true),
        ('û', 'u', Circumflex, false),
        ('Û', 'U', Circumflex, true),
        ('ã', 'a', Tilde, false),
        ('Ã', 'A', Tilde, true),
        ('ñ', 'n', Tilde, false),
        ('Ñ', 'N', Tilde, true),
        ('õ', 'o', Tilde, false),
        ('Õ', 'O', Tilde, true),
        ('å', 'a', Ring, false),
        ('Å', 'A', Ring, true),
        ('ů', 'u', Ring, false),
        ('Ů', 'U', Ring, true),
        ('ğ', 'g', Breve, false),
        ('Ğ', 'G', Breve, true),
        ('ă', 'a', Breve, false),
        ('Ă', 'A', Breve, true),
        ('č', 'c', Caron, false),
        ('Č', 'C', Caron, true),
        ('ě', 'e', Caron, false),
        ('Ě', 'E', Caron, true),
        ('ň', 'n', Caron, false),
        ('Ň', 'N', Caron, true),
        ('ř', 'r', Caron, false),
        ('Ř', 'R', Caron, true),
        ('š', 's', Caron, false),
        ('Š', 'S', Caron, true),
        ('ž', 'z', Caron, false),
        ('Ž', 'Z', Caron, true),
        ('İ', 'I', DotAbove, true),
        ('ż', 'z', DotAbove, false),
        ('Ż', 'Z', DotAbove, true),
        ('ç', 'c', Cedilla, false),
        ('Ç', 'C', Cedilla, true),
        ('ş', 's', Cedilla, false),
        ('Ş', 'S', Cedilla, true),
    ];

    for &(target, base_ch, mark, is_upper) in specs {
        let Some(base_g) = font.glyphs.get(&base_ch).cloned() else {
            continue;
        };
        let cx = base_g.advance() * 0.5;
        let y_top = if is_upper { -15.0 } else { -8.0 };
        let diamond = |x: f64, y: f64| -> Vec<(f64, f64)> {
            vec![(x - 1.0, y), (x, y + 1.0), (x + 1.0, y), (x, y - 1.0), (x - 1.0, y)]
        };
        let mut strokes = base_g.strokes;
        match mark {
            Umlaut => {
                strokes.push(diamond(cx - 3.0, y_top));
                strokes.push(diamond(cx + 3.0, y_top));
            }
            DotAbove => {
                strokes.push(diamond(cx, y_top));
            }
            Acute => {
                strokes.push(vec![(cx - 1.5, y_top + 1.5), (cx + 2.5, y_top - 2.0)]);
            }
            Grave => {
                strokes.push(vec![(cx - 2.5, y_top - 2.0), (cx + 1.5, y_top + 1.5)]);
            }
            Circumflex => {
                strokes.push(vec![
                    (cx - 3.0, y_top + 1.5),
                    (cx, y_top - 1.8),
                    (cx + 3.0, y_top + 1.5),
                ]);
            }
            Caron => {
                strokes.push(vec![
                    (cx - 3.0, y_top - 1.5),
                    (cx, y_top + 1.8),
                    (cx + 3.0, y_top - 1.5),
                ]);
            }
            Breve => {
                strokes.push(vec![
                    (cx - 3.2, y_top - 1.5),
                    (cx - 1.5, y_top + 1.2),
                    (cx + 1.5, y_top + 1.2),
                    (cx + 3.2, y_top - 1.5),
                ]);
            }
            Tilde => {
                strokes.push(vec![
                    (cx - 3.5, y_top + 0.8),
                    (cx - 1.5, y_top - 1.2),
                    (cx + 1.5, y_top + 1.2),
                    (cx + 3.5, y_top - 0.8),
                ]);
            }
            Ring => {
                strokes.push(vec![
                    (cx, y_top - 2.0),
                    (cx + 1.8, y_top - 0.8),
                    (cx + 1.8, y_top + 0.8),
                    (cx, y_top + 2.0),
                    (cx - 1.8, y_top + 0.8),
                    (cx - 1.8, y_top - 0.8),
                    (cx, y_top - 2.0),
                ]);
            }
            Cedilla => {
                strokes.push(vec![
                    (cx, 9.0),
                    (cx - 0.5, 11.2),
                    (cx + 1.5, 12.2),
                    (cx + 1.0, 14.0),
                    (cx - 1.5, 14.5),
                ]);
            }
        }
        font.glyphs.insert(
            target,
            StrokeGlyph {
                left: base_g.left,
                right: base_g.right,
                strokes,
            },
        );
    }
}

fn parse_attr(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{}=\"", name);
    let start = tag.find(&needle)?;
    let rest = &tag[start + needle.len()..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn parse_horiz_adv(tag: &str) -> Option<f64> {
    parse_attr(tag, "horiz-adv-x").and_then(|s| s.parse().ok())
}

fn parse_svg_cap_height(xml: &str) -> Option<f64> {
    parse_font_face_attr(xml, "cap-height")
}

fn parse_svg_units_per_em(xml: &str) -> Option<f64> {
    xml.find("units-per-em=\"")
        .and_then(|i| xml[i + 15..].split('"').next())
        .and_then(|s| s.parse().ok())
}

fn parse_svg_ascent(xml: &str) -> Option<f64> {
    parse_font_face_attr(xml, "ascent")
}

fn parse_svg_descent(xml: &str) -> Option<f64> {
    parse_font_face_attr(xml, "descent")
}

fn parse_font_face_attr(xml: &str, name: &str) -> Option<f64> {
    let needle = format!("{}=\"", name);
    xml.find(&needle)
        .and_then(|i| xml[i + needle.len()..].split('"').next())
        .and_then(|s| s.parse().ok())
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn decode_xml_char(s: &str) -> Result<char, String> {
    let s = decode_xml_entities(s);
    if let Some(hex) = s.strip_prefix("&#x").and_then(|t| t.strip_suffix(';')) {
        let u = u32::from_str_radix(hex, 16).map_err(|_| format!("bad unicode {:?}", s))?;
        return char::from_u32(u).ok_or_else(|| format!("bad unicode {:?}", s));
    }
    if let Some(dec) = s.strip_prefix("&#").and_then(|t| t.strip_suffix(';')) {
        let u = dec.parse::<u32>().map_err(|_| format!("bad unicode {:?}", s))?;
        return char::from_u32(u).ok_or_else(|| format!("bad unicode {:?}", s));
    }
    let mut it = s.chars();
    let c = it.next().ok_or_else(|| format!("empty unicode {:?}", s))?;
    if it.next().is_some() {
        return Err(format!("multi-char unicode {:?}", s));
    }
    Ok(c)
}

fn flatten_svg_path(d: &str, x_scale: f64, y_flip: impl Fn(f64) -> f64) -> Vec<Vec<(f64, f64)>> {
    let tokens = tokenize_svg_path(d);
    let mut runs: Vec<Vec<(f64, f64)>> = Vec::new();
    let mut run: Vec<(f64, f64)> = Vec::new();
    let mut x = 0.0;
    let mut y = 0.0;
    let mut start_x = 0.0;
    let mut start_y = 0.0;
    let mut last_ctrl_x = 0.0;
    let mut last_ctrl_y = 0.0;
    let mut cmd = ' ';
    let mut idx = 0usize;

    let push_pt = |run: &mut Vec<(f64, f64)>, px: f64, py: f64| {
        let pt = (px * x_scale, y_flip(py));
        if run.last() != Some(&pt) {
            run.push(pt);
        }
    };

    while idx < tokens.len() {
        if let PathToken::Cmd(c) = tokens[idx] {
            cmd = c;
            idx += 1;
            if cmd == 'Z' || cmd == 'z' {
                if !run.is_empty() {
                    push_pt(&mut run, start_x, start_y);
                    if run.len() > 1 {
                        runs.push(std::mem::take(&mut run));
                    } else {
                        run.clear();
                    }
                }
                x = start_x;
                y = start_y;
                continue;
            }
        }
        let next_num = |idx: &mut usize| -> Option<f64> {
            match tokens.get(*idx) {
                Some(PathToken::Num(n)) => {
                    *idx += 1;
                    Some(*n)
                }
                _ => None,
            }
        };

        match cmd {
            'M' | 'm' => {
                let (Some(nx), Some(ny)) = (next_num(&mut idx), next_num(&mut idx)) else { break };
                if run.len() > 1 {
                    runs.push(std::mem::take(&mut run));
                } else {
                    run.clear();
                }
                x = if cmd == 'm' { x + nx } else { nx };
                y = if cmd == 'm' { y + ny } else { ny };
                start_x = x;
                start_y = y;
                last_ctrl_x = x;
                last_ctrl_y = y;
                push_pt(&mut run, x, y);
                cmd = if cmd == 'm' { 'l' } else { 'L' };
            }
            'L' | 'l' => {
                let (Some(nx), Some(ny)) = (next_num(&mut idx), next_num(&mut idx)) else { break };
                x = if cmd == 'l' { x + nx } else { nx };
                y = if cmd == 'l' { y + ny } else { ny };
                last_ctrl_x = x;
                last_ctrl_y = y;
                push_pt(&mut run, x, y);
            }
            'H' | 'h' => {
                let Some(nx) = next_num(&mut idx) else { break };
                x = if cmd == 'h' { x + nx } else { nx };
                last_ctrl_x = x;
                last_ctrl_y = y;
                push_pt(&mut run, x, y);
            }
            'V' | 'v' => {
                let Some(ny) = next_num(&mut idx) else { break };
                y = if cmd == 'v' { y + ny } else { ny };
                last_ctrl_x = x;
                last_ctrl_y = y;
                push_pt(&mut run, x, y);
            }
            'C' | 'c' => {
                let (Some(dx1), Some(dy1), Some(dx2), Some(dy2), Some(dx), Some(dy)) = (
                    next_num(&mut idx),
                    next_num(&mut idx),
                    next_num(&mut idx),
                    next_num(&mut idx),
                    next_num(&mut idx),
                    next_num(&mut idx),
                ) else {
                    break;
                };
                let (x0, y0) = (x, y);
                let (x1, y1, x2, y2, nx, ny) = if cmd == 'c' {
                    (x0 + dx1, y0 + dy1, x0 + dx2, y0 + dy2, x0 + dx, y0 + dy)
                } else {
                    (dx1, dy1, dx2, dy2, dx, dy)
                };
                for step in 1..=10 {
                    let t = step as f64 / 10.0;
                    let u = 1.0 - t;
                    let px = u * u * u * x0 + 3.0 * u * u * t * x1 + 3.0 * u * t * t * x2 + t * t * t * nx;
                    let py = u * u * u * y0 + 3.0 * u * u * t * y1 + 3.0 * u * t * t * y2 + t * t * t * ny;
                    push_pt(&mut run, px, py);
                }
                last_ctrl_x = x2;
                last_ctrl_y = y2;
                x = nx;
                y = ny;
            }
            'S' | 's' => {
                let (Some(dx2), Some(dy2), Some(dx), Some(dy)) =
                    (next_num(&mut idx), next_num(&mut idx), next_num(&mut idx), next_num(&mut idx))
                else {
                    break;
                };
                let (x0, y0) = (x, y);
                let (x1, y1) = (2.0 * x0 - last_ctrl_x, 2.0 * y0 - last_ctrl_y);
                let (x2, y2, nx, ny) = if cmd == 's' {
                    (x0 + dx2, y0 + dy2, x0 + dx, y0 + dy)
                } else {
                    (dx2, dy2, dx, dy)
                };
                for step in 1..=10 {
                    let t = step as f64 / 10.0;
                    let u = 1.0 - t;
                    let px = u * u * u * x0 + 3.0 * u * u * t * x1 + 3.0 * u * t * t * x2 + t * t * t * nx;
                    let py = u * u * u * y0 + 3.0 * u * u * t * y1 + 3.0 * u * t * t * y2 + t * t * t * ny;
                    push_pt(&mut run, px, py);
                }
                last_ctrl_x = x2;
                last_ctrl_y = y2;
                x = nx;
                y = ny;
            }
            'Q' | 'q' => {
                let (Some(dx1), Some(dy1), Some(dx), Some(dy)) =
                    (next_num(&mut idx), next_num(&mut idx), next_num(&mut idx), next_num(&mut idx))
                else {
                    break;
                };
                let (x0, y0) = (x, y);
                let (x1, y1, nx, ny) = if cmd == 'q' {
                    (x0 + dx1, y0 + dy1, x0 + dx, y0 + dy)
                } else {
                    (dx1, dy1, dx, dy)
                };
                for step in 1..=8 {
                    let t = step as f64 / 8.0;
                    let u = 1.0 - t;
                    let px = u * u * x0 + 2.0 * u * t * x1 + t * t * nx;
                    let py = u * u * y0 + 2.0 * u * t * y1 + t * t * ny;
                    push_pt(&mut run, px, py);
                }
                last_ctrl_x = x1;
                last_ctrl_y = y1;
                x = nx;
                y = ny;
            }
            'T' | 't' => {
                let (Some(dx), Some(dy)) = (next_num(&mut idx), next_num(&mut idx)) else { break };
                let (x0, y0) = (x, y);
                let (x1, y1) = (2.0 * x0 - last_ctrl_x, 2.0 * y0 - last_ctrl_y);
                let (nx, ny) = if cmd == 't' { (x0 + dx, y0 + dy) } else { (dx, dy) };
                for step in 1..=8 {
                    let t = step as f64 / 8.0;
                    let u = 1.0 - t;
                    let px = u * u * x0 + 2.0 * u * t * x1 + t * t * nx;
                    let py = u * u * y0 + 2.0 * u * t * y1 + t * t * ny;
                    push_pt(&mut run, px, py);
                }
                last_ctrl_x = x1;
                last_ctrl_y = y1;
                x = nx;
                y = ny;
            }
            _ => {
                idx += 1;
            }
        }
    }
    if run.len() > 1 {
        runs.push(run);
    }
    runs
}

#[derive(Debug, Clone, Copy)]
enum PathToken {
    Cmd(char),
    Num(f64),
}

fn tokenize_svg_path(d: &str) -> Vec<PathToken> {
    let mut out = Vec::new();
    let bytes = d.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() || b == b',' {
            i += 1;
        } else if b.is_ascii_alphabetic() {
            out.push(PathToken::Cmd(b as char));
            i += 1;
        } else if b == b'-' || b == b'+' || b == b'.' || b.is_ascii_digit() {
            let start = i;
            if b == b'-' || b == b'+' {
                i += 1;
            }
            let mut seen_dot = b == b'.';
            while i < bytes.len() {
                let c = bytes[i];
                if c.is_ascii_digit() {
                    i += 1;
                } else if c == b'.' && !seen_dot {
                    seen_dot = true;
                    i += 1;
                } else if (c == b'e' || c == b'E') && i + 1 < bytes.len() {
                    i += 1;
                    if bytes[i] == b'-' || bytes[i] == b'+' {
                        i += 1;
                    }
                } else {
                    break;
                }
            }
            if let Ok(n) = d[start..i].parse::<f64>() {
                out.push(PathToken::Num(n));
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Known draw.land stroke fonts: lazy-loaded by URL (EMS / Hershey on GitLab).
pub fn catalog_url(id: &str) -> Option<&'static str> {
    match id {
        "ems-readability" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSReadability.svg"),
        "ems-readability-italic" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSReadabilityItalic.svg"),
        "ems-swiss" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSSwiss.svg"),
        "ems-tech" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSTech.svg"),
        "ems-casual-hand" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSCasualHand.svg"),
        "ems-allure" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSAllure.svg"),
        "ems-osmotron" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSOsmotron.svg"),
        "ems-nixish" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSNixish.svg"),
        "ems-bird" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSBird.svg"),
        "ems-capitol" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSCapitol.svg"),
        "hershey-serif-med" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/Hershey/HersheySerifMed.svg"),
        "hershey-script" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/Hershey/HersheyScript1.svg"),
        "hershey-goth-english" => Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/Hershey/HersheyGothEnglish.svg"),
        _ => None,
    }
}

pub const BUILTIN_STROKE_IDS: &[&str] = &["futural"];

pub fn parse_stroke_font_bytes(bytes: &[u8]) -> Result<StrokeFont, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "stroke font: not UTF-8")?;
    if text.trim_start().starts_with('<') {
        StrokeFont::parse_svg_font(text)
    } else {
        StrokeFont::parse_jhf(text)
    }
}

/// One glyph in a laid-out string, font units (y down, x from the string's left).
#[derive(Debug, Clone)]
pub struct StrokeLabelGlyph {
    pub x: f64,
    pub advance: f64,
    pub strokes: Vec<Vec<(f64, f64)>>,
}

#[derive(Debug, Clone)]
pub struct StrokeLabelLayout {
    pub glyphs: Vec<StrokeLabelGlyph>,
    pub width: f64,
    pub cap_height: f64,
    pub top: f64,
    pub bottom: f64,
}

fn fold_latin(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'È' | 'É' | 'Ê' | 'Ë' => 'E',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'O',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
        'ñ' => 'n',
        'Ñ' => 'N',
        'ç' => 'c',
        'Ç' => 'C',
        '’' | '‘' => '\'',
        '–' | '—' => '-',
        other => other,
    }
}

fn stroke_char_renderable(primary: &StrokeFont, fallback: &StrokeFont, c: char) -> bool {
    if primary.has(c) || fallback.has(c) {
        return true;
    }
    let f = fold_latin(c);
    f != c && (primary.has(f) || fallback.has(f))
}

/// True when every non-whitespace character in `text` can be drawn natively by
/// the built-in stroke fallback (`futural`, covering Latin, Greek, and Cyrillic)
/// without resorting to `deunicode` transliteration.
pub fn has_native_glyphs(text: &str) -> bool {
    let fallback = StrokeFont::futural();
    text.chars()
        .all(|c| c.is_whitespace() || stroke_char_renderable(fallback, fallback, c))
}

fn normalize_for_deunicode(word: &str) -> String {
    let mut out = String::with_capacity(word.len());
    for c in word.chars() {
        match c {
            // `deunicode` uses broken Buckwalter symbols (`@`, `` ` ``, `~`, `'`, or empty)
            // for common Arabic letters; map them to clean Latin vowels before transliteration.
            '\u{0627}' | '\u{0623}' | '\u{0671}' | '\u{0629}' | '\u{0649}' | '\u{0639}' | '\u{06C3}' => out.push('a'),
            '\u{0625}' => out.push('i'),
            '\u{0624}' => out.push_str("u"),
            '\u{0626}' => out.push_str("y"),
            '\u{0621}' | '\u{0654}' | '\u{0655}' => {}
            _ => out.push(c),
        }
    }
    out
}

/// When a word has no native glyphs, transliterate the whole word (not letter by
/// letter). Per-character `deunicode` drops Arabic alef and similar joiners, which
/// used to become `?` in the label.
fn expand_word(primary: &StrokeFont, fallback: &StrokeFont, word: &str) -> Vec<char> {
    if word.chars().all(|c| stroke_char_renderable(primary, fallback, c)) {
        return word.chars().collect();
    }
    let cleaned = normalize_for_deunicode(word);
    deunicode::deunicode(&cleaned).chars().collect()
}

fn stroke_glyph<'a>(primary: &'a StrokeFont, fallback: &'a StrokeFont, ch: char) -> &'a StrokeGlyph {
    primary
        .glyph(ch)
        .or_else(|| fallback.glyph(ch))
        .or_else(|| {
            let f = fold_latin(ch);
            primary.glyph(f).or_else(|| fallback.glyph(f))
        })
        .unwrap_or_else(|| fallback.glyph('?').unwrap_or(fallback.missing_glyph()))
}

fn push_space(primary: &StrokeFont, fallback: &StrokeFont, glyphs: &mut Vec<StrokeLabelGlyph>, x: &mut f64) {
    let adv = primary
        .glyph(' ')
        .or_else(|| fallback.glyph(' '))
        .map(|g| g.advance())
        .unwrap_or(fallback.default_advance);
    glyphs.push(StrokeLabelGlyph { x: *x, advance: adv, strokes: Vec::new() });
    *x += adv;
}

pub fn layout_stroke(primary: &StrokeFont, fallback: &StrokeFont, text: &str) -> StrokeLabelLayout {
    let mut x = 0.0;
    let mut glyphs = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_whitespace() {
            if c == ' ' {
                push_space(primary, fallback, &mut glyphs, &mut x);
            }
            continue;
        }
        let mut word = String::new();
        word.push(c);
        while chars.peek().is_some_and(|c| !c.is_whitespace()) {
            word.push(chars.next().unwrap());
        }
        for ch in expand_word(primary, fallback, &word) {
            if ch.is_whitespace() {
                if ch == ' ' {
                    push_space(primary, fallback, &mut glyphs, &mut x);
                }
                continue;
            }
            let g = stroke_glyph(primary, fallback, ch);
            glyphs.push(StrokeLabelGlyph {
                x,
                advance: g.advance(),
                strokes: g.strokes.clone(),
            });
            x += g.advance();
        }
    }
    StrokeLabelLayout {
        glyphs,
        width: x,
        cap_height: primary.cap_height,
        top: primary.top,
        bottom: primary.bottom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn futural_has_greek_cyrillic_and_composed_latin_accents() {
        let f = StrokeFont::futural();
        assert!(f.has('Α') && f.has('ω') && f.has('М') && f.has('ю'));
        assert!(f.has('ü') && f.has('İ') && f.has('ğ'));
        let u = f.glyph('u').unwrap();
        let ue = f.glyph('ü').unwrap();
        assert_eq!(u.advance(), ue.advance());
        assert!(ue.strokes.len() > u.strokes.len());
    }

    #[test]
    fn svg_font_maps_baseline_to_hershey() {
        let xml = r#"<svg><defs><font>
          <font-face units-per-em="1000" ascent="800" descent="-200" cap-height="500"/>
          <glyph unicode="H" horiz-adv-x="600" d="M 50 0 L 50 600 L 100 600 L 100 0 L 150 0 L 150 650 L 200 650 L 200 0"/>
          <glyph unicode=" " horiz-adv-x="200"/>
        </font></defs></svg>"#;
        let f = StrokeFont::parse_svg_font(xml).unwrap();
        let h = f.glyph('H').unwrap();
        let ys: Vec<f64> = h.strokes.iter().flatten().map(|&(_, y)| y).collect();
        let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min);
        let max_y = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        assert!((min_y - CAP_TOP).abs() < 1.5, "cap top y={}", min_y);
        assert!((max_y - BASELINE).abs() < 0.5, "baseline y={}", max_y);
    }

    #[test]
    fn compact_svg_path_with_cubic_curves_parses() {
        let xml = r#"<svg><defs><font>
          <font-face units-per-em="1000" ascent="800" descent="-200" cap-height="500"/>
          <glyph unicode="x" horiz-adv-x="100" d="M10 10C10 10 50 50 90 90"/>
        </font></defs></svg>"#;
        let f = StrokeFont::parse_svg_font(xml).unwrap();
        let pts = f.glyph('x').unwrap().strokes.iter().flatten().count();
        assert!(pts >= 4, "cubic should tessellate to multiple points");
    }

    #[test]
    fn arabic_word_transliteration_does_not_insert_question_marks() {
        let f = StrokeFont::futural();
        let layout = layout_stroke(f, f, "شارع");
        let q = f.glyph('?').unwrap();
        let questions = layout.glyphs.iter().filter(|g| g.strokes == q.strokes).count();
        assert_eq!(questions, 0, "alef must not become ? when transliterating Arabic");
        assert!(layout.glyphs.len() >= 4, "شارع → shr`");
    }

    #[test]
    fn cjk_word_transliteration_keeps_deunicode_spacing() {
        let f = StrokeFont::futural();
        let tight = layout_stroke(f, f, "東京");
        let spaced = layout_stroke(f, f, "Dong Jing");
        assert_eq!(tight.glyphs.len(), spaced.glyphs.len());
    }

    #[test]
    fn catalog_urls_are_stable() {
        assert!(catalog_url("ems-readability").unwrap().contains("EMSReadability.svg"));
        assert!(catalog_url("nope").is_none());
    }
}
