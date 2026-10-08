//! Single-stroke (Hershey) fonts: text as pen strokes, the kind CNC engravers
//! and plotters draw in one pass, with no outline to fill.
//!
//! A `.jhf` file holds one glyph per line, in ASCII order from the space:
//! a 5-digit number, a 3-digit count of coordinate pairs, then the pairs, each
//! two characters offset from `R`. The first pair is the glyph's left and right
//! edge; ` R` lifts the pen. Coordinates are y down, the baseline at 9 and the
//! capitals' top at -12.
//!
//! The glyphs are Dr. A. V. Hershey's, U.S. National Bureau of Standards,
//! whose terms ask that this acknowledgement travel with them.

use std::sync::OnceLock;

/// Where the capitals start and end, in font units (y down).
pub const CAP_TOP: f64 = -12.0;
pub const BASELINE: f64 = 9.0;
/// Capital height, font units: `size` in millimetres is this tall.
pub const CAP_HEIGHT: f64 = BASELINE - CAP_TOP;

#[derive(Debug, Clone)]
pub struct Glyph {
    pub left: f64,
    pub right: f64,
    /// Pen-down runs, font units, relative to the glyph's own origin.
    pub strokes: Vec<Vec<(f64, f64)>>,
}

impl Glyph {
    pub fn advance(&self) -> f64 {
        self.right - self.left
    }
}

#[derive(Debug)]
pub struct Font {
    glyphs: Vec<Glyph>,
}

/// The fonts built in, by name.
pub const FONTS: &[&str] = &["futural"];

pub fn font(name: &str) -> Option<&'static Font> {
    static FUTURAL: OnceLock<Font> = OnceLock::new();
    match name {
        "futural" => Some(FUTURAL.get_or_init(|| {
            Font::parse(include_str!("../fonts/futural.jhf")).expect("the built-in futural font parses")
        })),
        _ => None,
    }
}

impl Font {
    pub fn parse(src: &str) -> Result<Font, String> {
        let mut glyphs = Vec::new();
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
            glyphs.push(Glyph { left, right, strokes });
        }
        if glyphs.len() < 95 {
            return Err(format!("{} glyphs, expected the 95 printable ASCII ones", glyphs.len()));
        }
        Ok(Font { glyphs })
    }

    /// The glyph for `c`, `?` for anything the font does not have. Accented
    /// letters are drawn bare.
    pub fn glyph(&self, c: char) -> &Glyph {
        let c = fold(c);
        let i = (c as u32).wrapping_sub(32) as usize;
        self.glyphs.get(i).filter(|_| (' '..='~').contains(&c)).unwrap_or(&self.glyphs['?' as usize - 32])
    }

    /// `text` laid out on one line: each glyph with where it starts, and the
    /// whole width, font units.
    pub fn layout(&self, text: &str) -> (Vec<(f64, &Glyph)>, f64) {
        let mut x = 0.0;
        let mut out = Vec::new();
        for c in text.chars() {
            let g = self.glyph(c);
            out.push((x, g));
            x += g.advance();
        }
        (out, x)
    }
}

/// The plain letter under a Latin accent, so `é` is drawn as `e`.
fn fold(c: char) -> char {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn futural_reads_in_ascii_order() {
        let f = font("futural").unwrap();
        // `A`: an apex at the capitals' top, two feet on the baseline.
        let a = f.glyph('A');
        let ys: Vec<f64> = a.strokes.iter().flatten().map(|p| p.1).collect();
        assert_eq!(ys.iter().cloned().fold(f64::MAX, f64::min), CAP_TOP);
        assert_eq!(ys.iter().cloned().fold(f64::MIN, f64::max), BASELINE);
        assert!(f.glyph(' ').strokes.is_empty());
        assert!(f.glyph('é').strokes.len() == f.glyph('e').strokes.len());
        let (_, w) = f.layout("Ave");
        assert!(w > 0.0);
    }
}
