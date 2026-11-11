//! Lengths as the profile writes them (`"6in"`, `"0.5mm"`, `152.4`) and map
//! scales (`"1:10000"`).

use serde::de::{self, Deserializer, Visitor};
use serde::{Deserialize, Serialize, Serializer};
use std::fmt;

/// A length in millimetres. Deserializes from a bare number (mm) or a string
/// with an optional unit: `mm`, `cm`, `in`, `m`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Mm(pub f64);

pub fn parse_length_mm(text: &str) -> Result<f64, String> {
    let s = text.trim();
    let split = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E'))
        .unwrap_or(s.len());
    let (number, unit) = s.split_at(split);
    let value: f64 = number
        .trim()
        .parse()
        .map_err(|_| format!("invalid length {text:?}"))?;
    let factor = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "mm" | "millimeter" | "millimeters" | "millimetre" | "millimetres" => 1.0,
        "cm" => 10.0,
        "m" => 1000.0,
        "in" | "inch" | "inches" | "\"" => 25.4,
        other => return Err(format!("unknown unit {other:?} in {text:?}")),
    };
    // Nanometre rounding so "6in" is exactly 152.4, not 152.39999999999998.
    Ok((value * factor * 1e6).round() / 1e6)
}

impl<'de> Deserialize<'de> for Mm {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = Mm;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a length: a number of mm or a string like \"0.5mm\" or \"6in\"")
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Mm, E> {
                Ok(Mm(v))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Mm, E> {
                Ok(Mm(v as f64))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Mm, E> {
                Ok(Mm(v as f64))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Mm, E> {
                parse_length_mm(v).map(Mm).map_err(E::custom)
            }
        }
        d.deserialize_any(V)
    }
}

impl Serialize for Mm {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_f64(self.0)
    }
}

/// A length across and one down, in mm: one length for both (`5mm`) or a
/// pair, across first (`[5mm, 3mm]`).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct MmXY {
    pub x: f64,
    pub y: f64,
}

impl MmXY {
    pub fn is_zero(&self) -> bool {
        self.x == 0.0 && self.y == 0.0
    }
}

impl<'de> Deserialize<'de> for MmXY {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Form {
            One(Mm),
            Two([Mm; 2]),
        }
        Ok(match Form::deserialize(d).map_err(|_| de::Error::custom("a length, or two: [across, down]"))? {
            Form::One(Mm(v)) => MmXY { x: v, y: v },
            Form::Two([Mm(x), Mm(y)]) => MmXY { x, y },
        })
    }
}

impl Serialize for MmXY {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if self.x == self.y {
            s.serialize_f64(self.x)
        } else {
            [self.x, self.y].serialize(s)
        }
    }
}

/// Map scale as its denominator: `1:10000` is `10000.0`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scale(pub f64);

impl Default for Scale {
    fn default() -> Self {
        Scale(10000.0)
    }
}

impl Serialize for Scale {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("1:{}", self.0))
    }
}

pub fn parse_scale(text: &str) -> Result<f64, String> {
    let s = text.trim();
    let denominator = s.split_once(':').map(|(_, d)| d).unwrap_or(s);
    let value: f64 = denominator
        .trim()
        .replace('_', "")
        .parse()
        .map_err(|_| format!("invalid scale {text:?} (use 1:10000)"))?;
    if value <= 0.0 {
        return Err(format!("invalid scale {text:?}"));
    }
    Ok(value)
}

impl<'de> Deserialize<'de> for Scale {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = Scale;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a scale like \"1:10000\" or its denominator")
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Scale, E> {
                Ok(Scale(v))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Scale, E> {
                Ok(Scale(v as f64))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Scale, E> {
                Ok(Scale(v as f64))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Scale, E> {
                parse_scale(v).map(Scale).map_err(E::custom)
            }
        }
        d.deserialize_any(V)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lengths() {
        assert_eq!(parse_length_mm("6in").unwrap(), 152.4);
        assert_eq!(parse_length_mm("4 in").unwrap(), 101.6);
        assert_eq!(parse_length_mm("0.75mm").unwrap(), 0.75);
        assert_eq!(parse_length_mm("152.4").unwrap(), 152.4);
        assert_eq!(parse_length_mm("3cm").unwrap(), 30.0);
        assert!(parse_length_mm("3furlongs").is_err());
    }

    #[test]
    fn one_length_or_two() {
        let one: MmXY = serde_saphyr::from_str("0.25in").unwrap();
        assert_eq!(one, MmXY { x: 6.35, y: 6.35 });
        let two: MmXY = serde_saphyr::from_str("[5mm, 3]").unwrap();
        assert_eq!(two, MmXY { x: 5.0, y: 3.0 });
        assert!(serde_saphyr::from_str::<MmXY>("[1, 2, 3]").is_err());
    }

    #[test]
    fn scales() {
        assert_eq!(parse_scale("1:10000").unwrap(), 10000.0);
        assert_eq!(parse_scale("25000").unwrap(), 25000.0);
        assert!(parse_scale("1:0").is_err());
    }
}
