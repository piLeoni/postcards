//! Lengths as the profile writes them (`"6in"`, `"0.5mm"`, `152.4`) and map
//! scales (`"1:10000"`).

use serde::de::{self, Deserializer, Visitor};
use serde::Deserialize;
use std::fmt;

/// A length in millimetres. Deserializes from a bare number (mm) or a string
/// with an optional unit: `mm`, `cm`, `in`, `m`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Mm(pub f64);

/// `"6 in"` → `(6.0, "in")`, the unit lowercased.
fn number_and_unit(text: &str) -> Result<(f64, String), String> {
    let s = text.trim();
    let split = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E'))
        .unwrap_or(s.len());
    let (number, unit) = s.split_at(split);
    let value: f64 = number
        .trim()
        .parse()
        .map_err(|_| format!("invalid length {text:?}"))?;
    Ok((value, unit.trim().to_ascii_lowercase()))
}

pub fn parse_length_mm(text: &str) -> Result<f64, String> {
    let (value, unit) = number_and_unit(text)?;
    let factor = match unit.as_str() {
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

/// A distance on the ground in metres. Deserializes from a bare number (m)
/// or a string with a unit: `m`, `km`, `mi`, `ft`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ground(pub f64);

pub fn parse_ground_m(text: &str) -> Result<f64, String> {
    let (value, unit) = number_and_unit(text)?;
    let factor = match unit.as_str() {
        "" | "m" | "meter" | "meters" | "metre" | "metres" => 1.0,
        "km" => 1000.0,
        "mi" | "mile" | "miles" => 1609.344,
        "ft" | "foot" | "feet" => 0.3048,
        other => return Err(format!("unknown ground unit {other:?} in {text:?} (use m, km, mi or ft)")),
    };
    if value <= 0.0 {
        return Err(format!("invalid ground size {text:?}"));
    }
    Ok(value * factor)
}

impl<'de> Deserialize<'de> for Ground {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = Ground;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a ground distance: a number of metres or a string like \"1.2km\" or \"0.75mi\"")
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Ground, E> {
                Ok(Ground(v))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Ground, E> {
                Ok(Ground(v as f64))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Ground, E> {
                Ok(Ground(v as f64))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Ground, E> {
                parse_ground_m(v).map(Ground).map_err(E::custom)
            }
        }
        d.deserialize_any(V)
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
    fn ground() {
        assert_eq!(parse_ground_m("1.2km").unwrap(), 1200.0);
        assert_eq!(parse_ground_m("800").unwrap(), 800.0);
        assert!((parse_ground_m("0.5 mi").unwrap() - 804.672).abs() < 1e-9);
        assert!(parse_ground_m("3in").is_err());
    }

    #[test]
    fn scales() {
        assert_eq!(parse_scale("1:10000").unwrap(), 10000.0);
        assert_eq!(parse_scale("25000").unwrap(), 25000.0);
        assert!(parse_scale("1:0").is_err());
    }
}
