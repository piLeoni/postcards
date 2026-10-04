//! Specs shared by the graph: the output (where, how big, at what scale),
//! fills and strokes.

use crate::units::{Mm, MmXY, Scale};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Yaml,
    Json5,
}

impl Format {
    /// `.json5` / `.json` read as JSON5, everything else as YAML.
    pub fn from_path(path: &str) -> Format {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".json5") || lower.ends_with(".json") {
            Format::Json5
        } else {
            Format::Yaml
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ProjectionMode {
    /// True distances; north turns with the distance from the zone's meridian.
    Utm,
    /// A crop of the web map, north up: what the web app's preview shows.
    #[default]
    Webmercator,
    /// A PROJ string (`+proj=lcc +lat_1=40 +lat_2=44 +lon_0={lng}`), where
    /// `{lat}` and `{lng}` stand for the output's centre.
    Proj(String),
}

impl ProjectionMode {
    /// The PROJ string with the output's centre written in.
    pub fn proj_string(template: &str, (lon, lat): (f64, f64)) -> String {
        template.replace("{lat}", &lat.to_string()).replace("{lng}", &lon.to_string())
    }
}

impl<'de> Deserialize<'de> for ProjectionMode {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        match text.trim() {
            "utm" => Ok(ProjectionMode::Utm),
            "webmercator" => Ok(ProjectionMode::Webmercator),
            s if s.contains("+proj=") => {
                proj4rs::proj::Proj::from_proj_string(&ProjectionMode::proj_string(s, (0.0, 0.0)))
                    .map_err(|e| serde::de::Error::custom(format!("projection {s:?}: {e}")))?;
                Ok(ProjectionMode::Proj(s.to_string()))
            }
            s => Err(serde::de::Error::custom(format!(
                "projection {s:?}: use utm, webmercator, or a PROJ string such as \"+proj=laea +lat_0={{lat}} +lon_0={{lng}}\""
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputSpec {
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lng: Option<f64>,
    #[serde(default = "default_width")]
    pub width: Mm,
    #[serde(default = "default_height")]
    pub height: Mm,
    #[serde(default)]
    pub scale: Scale,
    #[serde(default)]
    pub bearing: f64,
    #[serde(default)]
    pub projection: ProjectionMode,
    /// Distortions of the ground before drawing, in order; the output's edge stays.
    #[serde(default)]
    pub warp: crate::warp::Warps,
    /// Blank margin inside the paper's edge, across and down; the paper keeps
    /// its size.
    #[serde(default)]
    pub padding: MmXY,
    /// The output cut into sheets, each written on its own.
    #[serde(default)]
    pub slices: crate::sheets::Slices,
}

fn default_width() -> Mm {
    Mm(152.4)
}
fn default_height() -> Mm {
    Mm(101.6)
}


/// How a region is filled: a penfill generator by name, or an SVG source
/// clipped into the region. Unset fields inherit (module default, then the
/// layer's `fill`, then a kind's entry).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct FillSpec {
    #[serde(default, alias = "algorithm")]
    pub generator: Option<String>,
    #[serde(default)]
    pub source: Option<SourceSpec>,
    #[serde(default)]
    pub spacing: Option<Mm>,
    #[serde(default)]
    pub angle: Option<f64>,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub inset: Option<Mm>,
    #[serde(default)]
    pub mark: Option<Mm>,
    /// Generator-specific options (`lattice`, `line_width`, `name`, …).
    #[serde(flatten)]
    pub options: BTreeMap<String, Value>,
}

impl FillSpec {
    pub fn spacing(mm: f64) -> FillSpec {
        FillSpec { spacing: Some(Mm(mm)), ..FillSpec::default() }
    }

    /// `self` with every field set in `over` replaced by `over`'s value.
    pub fn merged(&self, over: &FillSpec) -> FillSpec {
        let mut options = self.options.clone();
        options.extend(over.options.iter().map(|(k, v)| (k.clone(), v.clone())));
        FillSpec {
            // A kind that switches to a source (or a generator) drops the other.
            generator: if over.source.is_some() { over.generator.clone() } else { over.generator.clone().or_else(|| self.generator.clone()) },
            source: if over.generator.is_some() { over.source.clone() } else { over.source.clone().or_else(|| self.source.clone()) },
            spacing: over.spacing.or(self.spacing),
            angle: over.angle.or(self.angle),
            seed: over.seed.or(self.seed),
            inset: over.inset.or(self.inset),
            mark: over.mark.or(self.mark),
            options,
        }
    }
}

/// An SVG drawn into the region instead of a generator. The host resolves
/// `file` to text before rendering (core does no I/O).
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SourceSpec {
    pub file: String,
    /// CSS-like placement (`contain`, `40 30`, …). Without it the SVG's user
    /// units are output millimetres.
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub position: Option<String>,
    #[serde(default)]
    pub repeat: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum StrokeStyle {
    #[default]
    Solid,
    #[serde(alias = "dashed")]
    Dash,
    #[serde(alias = "dot")]
    Dotted,
    None,
}

/// `solid`, `dash`, `dotted`, `none`, or a mapping `{ style, dash, gap, mark }`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StrokeSpec {
    pub style: Option<StrokeStyle>,
    pub dash: Option<Mm>,
    pub gap: Option<Mm>,
    pub mark: Option<Mm>,
}


impl<'de> Deserialize<'de> for StrokeSpec {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<StrokeSpec, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fields {
            #[serde(default)]
            style: Option<StrokeStyle>,
            #[serde(default)]
            dash: Option<Mm>,
            #[serde(default)]
            gap: Option<Mm>,
            #[serde(default)]
            mark: Option<Mm>,
        }
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Keyword(StrokeStyle),
            Fields(Fields),
        }
        Ok(match Raw::deserialize(d)? {
            Raw::Keyword(style) => StrokeSpec { style: Some(style), ..StrokeSpec::default() },
            Raw::Fields(f) => StrokeSpec { style: f.style, dash: f.dash, gap: f.gap, mark: f.mark },
        })
    }
}

impl StrokeSpec {
    pub fn merged(&self, over: &StrokeSpec) -> StrokeSpec {
        StrokeSpec {
            style: over.style.or(self.style),
            dash: over.dash.or(self.dash),
            gap: over.gap.or(self.gap),
            mark: over.mark.or(self.mark),
        }
    }
}
