//! The declarative profile: map frame, layers, stacking. YAML is the primary
//! format; JSON5 is accepted for the same schema.

use crate::units::{Mm, Scale};
use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    #[error("YAML profile: {0}")]
    Yaml(String),
    #[error("JSON5 profile: {0}")]
    Json5(String),
    #[error("profile: {0}")]
    Invalid(String),
}

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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub map: MapSpec,
    #[serde(default)]
    pub layers: Vec<LayerSpec>,
    #[serde(default)]
    pub compose: ComposeSpec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProjectionMode {
    #[default]
    Utm,
    Webmercator,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapSpec {
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
}

fn default_width() -> Mm {
    Mm(152.4)
}
fn default_height() -> Mm {
    Mm(101.6)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayerSpec {
    pub id: String,
    pub module: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub fill: Option<FillSpec>,
    /// Per-kind fills, in claim order. A bare length is shorthand for
    /// `{ spacing: <length> }`.
    #[serde(default, deserialize_with = "ordered_kinds")]
    pub kinds: Vec<(String, FillSpec)>,
    #[serde(default)]
    pub stroke: Option<StrokeSpec>,
    /// Module-specific settings.
    #[serde(default)]
    pub options: BTreeMap<String, Value>,
}

impl LayerSpec {
    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }

    pub fn option_str(&self, key: &str) -> Option<&str> {
        self.options.get(key).and_then(Value::as_str)
    }
}

/// How a region is filled: a penfill generator by name, or an SVG source
/// clipped into the region. Unset fields inherit (module default, then the
/// layer's `fill`, then a kind's entry).
#[derive(Debug, Clone, Default, Deserialize)]
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
    /// units are card millimetres.
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StrokeSpec {
    #[serde(default)]
    pub style: Option<StrokeStyle>,
    #[serde(default)]
    pub dash: Option<Mm>,
    #[serde(default)]
    pub gap: Option<Mm>,
    #[serde(default)]
    pub mark: Option<Mm>,
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComposeSpec {
    /// Bottom-most first; each layer is clipped by the masks of the layers
    /// after it. Without it, layers stack in the order they are listed.
    /// Layers it leaves out go on top, in listed order.
    #[serde(default)]
    pub order: Option<Vec<String>>,
}

fn ordered_kinds<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(String, FillSpec)>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Entry {
        Length(Mm),
        Spec(Box<FillSpec>),
    }

    struct V;
    impl<'de> Visitor<'de> for V {
        type Value = Vec<(String, FillSpec)>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a mapping of kind name to a fill or a spacing")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::new();
            while let Some((name, entry)) = map.next_entry::<String, Entry>()? {
                let spec = match entry {
                    Entry::Length(mm) => FillSpec { spacing: Some(mm), ..FillSpec::default() },
                    Entry::Spec(spec) => *spec,
                };
                out.push((name, spec));
            }
            Ok(out)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }
    }
    d.deserialize_any(V)
}

impl Profile {
    pub fn parse(text: &str, format: Format) -> Result<Profile, ProfileError> {
        let profile: Profile = match format {
            Format::Yaml => serde_saphyr::from_str(text).map_err(|e| ProfileError::Yaml(e.to_string()))?,
            Format::Json5 => json5::from_str(text).map_err(|e| ProfileError::Json5(e.to_string()))?,
        };
        profile.validate()?;
        Ok(profile)
    }

    fn validate(&self) -> Result<(), ProfileError> {
        let mut seen = std::collections::BTreeSet::new();
        for layer in &self.layers {
            if !seen.insert(layer.id.as_str()) {
                return Err(ProfileError::Invalid(format!("layer id {:?} is used twice", layer.id)));
            }
            if !crate::modules::is_known(&layer.module) {
                return Err(ProfileError::Invalid(format!(
                    "layer {:?}: unknown module {:?} (known: {})",
                    layer.id,
                    layer.module,
                    crate::modules::KNOWN.join(", ")
                )));
            }
        }
        for id in self.compose.order.iter().flatten() {
            if !seen.contains(id.as_str()) {
                return Err(ProfileError::Invalid(format!("compose.order names {id:?}, which is not a layer id")));
            }
        }
        Ok(())
    }

    /// Enabled layers, bottom-most first.
    pub fn stack(&self) -> Vec<&LayerSpec> {
        let by_id = |id: &str| self.layers.iter().find(|l| l.id == id);
        let mut out: Vec<&LayerSpec> = Vec::new();
        for id in self.compose.order.iter().flatten() {
            if let Some(l) = by_id(id) {
                if !out.iter().any(|o| o.id == l.id) {
                    out.push(l);
                }
            }
        }
        for l in &self.layers {
            if !out.iter().any(|o| o.id == l.id) {
                out.push(l);
            }
        }
        out.retain(|l| l.is_enabled());
        out
    }

    /// Every SVG file a fill references, so the host can read them.
    pub fn source_files(&self) -> Vec<String> {
        let mut out = Vec::new();
        for layer in &self.layers {
            let fills = layer.fill.iter().chain(layer.kinds.iter().map(|(_, f)| f));
            for f in fills {
                if let Some(src) = &f.source {
                    if !out.contains(&src.file) {
                        out.push(src.file.clone());
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = r#"
map:
  lat: 37.8
  lng: -122.4
  width: 6in
  height: 4in
  scale: "1:10000"
layers:
  - id: parks
    module: parks/v1
    fill: { generator: dots, spacing: 0.5mm, angle: 45, mark: 0.2mm }
    kinds:
      garden: 0.25mm
      wood: { generator: grass, spacing: 0.7mm }
    options: { leftover: wood }
    stroke: { style: dash, dash: 0.45mm, gap: 0.40mm }
  - id: buildings
    module: buildings/v1
    fill: { algorithm: zigzag, spacing: 0.75mm, angle: 45 }
compose:
  order: [parks, buildings]
"#;

    #[test]
    fn parses_yaml() {
        let p = Profile::parse(YAML, Format::Yaml).unwrap();
        assert_eq!(p.map.width, Mm(152.4));
        assert_eq!(p.map.scale, Scale(10000.0));
        let parks = &p.layers[0];
        assert_eq!(parks.kinds[0].0, "garden");
        assert_eq!(parks.kinds[0].1.spacing, Some(Mm(0.25)));
        assert_eq!(parks.kinds[1].1.generator.as_deref(), Some("grass"));
        assert_eq!(parks.option_str("leftover"), Some("wood"));
        assert_eq!(p.layers[1].fill.as_ref().unwrap().generator.as_deref(), Some("zigzag"));
    }

    #[test]
    fn parses_json5() {
        let text = r#"{
          map: { lat: 1, lng: 2, width: "6in" },
          layers: [ { id: 'water', module: 'water/v1', fill: { generator: 'waves', spacing: 0.75 } } ],
          compose: { order: ['water'] },
        }"#;
        let p = Profile::parse(text, Format::Json5).unwrap();
        assert_eq!(p.layers[0].fill.as_ref().unwrap().spacing, Some(Mm(0.75)));
    }

    #[test]
    fn rejects_unknown_module_and_order() {
        let bad = "map: {}\nlayers:\n  - { id: a, module: nope/v1 }\n";
        assert!(Profile::parse(bad, Format::Yaml).is_err());
        let bad = "map: {}\nlayers:\n  - { id: a, module: water/v1 }\ncompose: { order: [b] }\n";
        assert!(Profile::parse(bad, Format::Yaml).is_err());
    }

    #[test]
    fn kind_merge_keeps_theme_generator() {
        let theme = FillSpec { generator: Some("dots".into()), angle: Some(45.0), ..FillSpec::default() };
        let kind = FillSpec::spacing(0.25);
        let m = theme.merged(&kind);
        assert_eq!(m.generator.as_deref(), Some("dots"));
        assert_eq!(m.angle, Some(45.0));
        assert_eq!(m.spacing, Some(Mm(0.25)));
    }
}
