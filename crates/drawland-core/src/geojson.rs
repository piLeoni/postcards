//! GeoJSON → features: a dataset the profile names (`features.geojson`),
//! read by the host and handed over as text, then drawn like any other
//! feature set.
//!
//! Every Feature becomes one [`Feature`] in lon/lat, its `properties` its
//! tags: strings as they are, numbers and booleans written out, nested values
//! as JSON. A bare geometry or a GeometryCollection is read too. Coordinates
//! are WGS84 lon/lat, as RFC 7946 says. A point's third coordinate (an
//! earthquake's depth, a summit's height) becomes the tag [`Z_TAG`]; on lines
//! and polygons it is dropped.

use crate::osm::{Element, Feature, Tags};
use geo::{Coord, Geometry, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon};
use serde_json::Value;

/// The tag a point's third coordinate is read into.
pub const Z_TAG: &str = "geom:z";

#[derive(Debug, thiserror::Error)]
pub enum GeoJsonError {
    #[error("not JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not GeoJSON: {0}")]
    Shape(String),
}

/// The features of a GeoJSON text. Features without a geometry, or with one
/// that has no coordinates, are skipped.
pub fn features(text: &str) -> Result<Vec<Feature>, GeoJsonError> {
    features_of(&serde_json::from_str(text)?)
}

/// [`features`] of GeoJSON already parsed (a profile's inline object).
pub fn features_of(root: &Value) -> Result<Vec<Feature>, GeoJsonError> {
    let mut out = Vec::new();
    read(root, &mut out)?;
    Ok(out)
}

fn read(v: &Value, out: &mut Vec<Feature>) -> Result<(), GeoJsonError> {
    match kind(v)? {
        "FeatureCollection" => {
            let list = v.get("features").and_then(Value::as_array).ok_or_else(|| shape("FeatureCollection without features"))?;
            for f in list {
                read(f, out)?;
            }
        }
        "Feature" => {
            let Some(g) = v.get("geometry").filter(|g| !g.is_null()) else { return Ok(()) };
            let mut tags = v.get("properties").and_then(Value::as_object).map(tags).unwrap_or_default();
            if let Some(z) = point_z(g) {
                tags.entry(Z_TAG.to_string()).or_insert_with(|| z.to_string());
            }
            for geometry in geometries(g)? {
                out.push(Feature { element: Element::Data, id: out.len() as i64, tags: tags.clone(), geometry });
            }
        }
        _ => {
            for geometry in geometries(v)? {
                out.push(Feature { element: Element::Data, id: out.len() as i64, tags: Tags::new(), geometry });
            }
        }
    }
    Ok(())
}

fn kind(v: &Value) -> Result<&str, GeoJsonError> {
    v.get("type").and_then(Value::as_str).ok_or_else(|| shape("no \"type\""))
}

fn shape(msg: &str) -> GeoJsonError {
    GeoJsonError::Shape(msg.to_string())
}

/// Properties as tags. `null` is left out, so `features.where(x, { k: false })`
/// reads it as absent.
fn tags(props: &serde_json::Map<String, Value>) -> Tags {
    props
        .iter()
        .filter_map(|(k, v)| {
            let text = match v {
                Value::Null => return None,
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                other => other.to_string(),
            };
            Some((k.clone(), text))
        })
        .collect()
}

/// A geometry, a collection read as its members; empty ones are dropped.
fn geometries(g: &Value) -> Result<Vec<Geometry<f64>>, GeoJsonError> {
    let t = kind(g)?;
    if t == "GeometryCollection" {
        let list = g.get("geometries").and_then(Value::as_array).ok_or_else(|| shape("GeometryCollection without geometries"))?;
        let mut out = Vec::new();
        for m in list {
            out.extend(geometries(m)?);
        }
        return Ok(out);
    }
    let c = g.get("coordinates").ok_or_else(|| shape(&format!("{t} without coordinates")))?;
    let geometry = match t {
        "Point" => Geometry::Point(Point(coord(c)?)),
        "MultiPoint" => Geometry::MultiPoint(MultiPoint(coords(c)?.into_iter().map(Point).collect())),
        "LineString" => Geometry::LineString(LineString(coords(c)?)),
        "MultiLineString" => Geometry::MultiLineString(MultiLineString(array(c)?.iter().map(|l| coords(l).map(LineString)).collect::<Result<_, _>>()?)),
        "Polygon" => Geometry::Polygon(polygon(c)?),
        "MultiPolygon" => Geometry::MultiPolygon(MultiPolygon(array(c)?.iter().map(polygon).collect::<Result<_, _>>()?)),
        other => return Err(shape(&format!("unknown geometry {other:?}"))),
    };
    let empty = match &geometry {
        Geometry::MultiPoint(m) => m.0.is_empty(),
        Geometry::LineString(l) => l.0.len() < 2,
        Geometry::MultiLineString(m) => m.0.is_empty(),
        Geometry::Polygon(p) => p.exterior().0.len() < 4,
        Geometry::MultiPolygon(m) => m.0.is_empty(),
        _ => false,
    };
    Ok(if empty { vec![] } else { vec![geometry] })
}

/// The third coordinate of a Point, or of a MultiPoint's first point.
fn point_z(g: &Value) -> Option<f64> {
    let c = g.get("coordinates")?;
    let pos = match g.get("type")?.as_str()? {
        "Point" => c,
        "MultiPoint" => c.get(0)?,
        _ => return None,
    };
    pos.get(2)?.as_f64()
}

fn array(v: &Value) -> Result<&Vec<Value>, GeoJsonError> {
    v.as_array().ok_or_else(|| shape("coordinates are arrays"))
}

fn coord(v: &Value) -> Result<Coord<f64>, GeoJsonError> {
    let a = array(v)?;
    let n = |i: usize| a.get(i).and_then(Value::as_f64).ok_or_else(|| shape("a position is [lon, lat]"));
    Ok(Coord { x: n(0)?, y: n(1)? })
}

fn coords(v: &Value) -> Result<Vec<Coord<f64>>, GeoJsonError> {
    array(v)?.iter().map(coord).collect()
}

fn polygon(v: &Value) -> Result<Polygon<f64>, GeoJsonError> {
    let mut rings = array(v)?.iter().map(|r| coords(r).map(LineString));
    let outer = rings.next().transpose()?.unwrap_or_else(|| LineString(vec![]));
    Ok(Polygon::new(outer, rings.collect::<Result<_, _>>()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_collection_with_properties_as_tags() {
        let text = r#"{"type":"FeatureCollection","features":[
            {"type":"Feature","id":"us7000","properties":{"mag":5.2,"place":"Off Chile","tsunami":0,"alert":null,"ok":true},
             "geometry":{"type":"Point","coordinates":[-71.5,-33.0,10.0]}},
            {"type":"Feature","properties":{"name":"A"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]],[[0.2,0.1],[0.5,0.1],[0.5,0.4],[0.2,0.1]]]}},
            {"type":"Feature","properties":{},"geometry":null},
            {"type":"Feature","properties":{},"geometry":{"type":"GeometryCollection","geometries":[
               {"type":"LineString","coordinates":[[0,0],[2,2]]},{"type":"MultiPoint","coordinates":[]}]}}
        ]}"#;
        let f = features(text).unwrap();
        assert_eq!(f.len(), 3);
        assert_eq!(f[0].tag("mag"), Some("5.2"));
        assert_eq!(f[0].tag("ok"), Some("true"));
        assert!(!f[0].has("alert"));
        assert_eq!(f[0].tag(Z_TAG), Some("10"));
        assert!(!f[1].has(Z_TAG));
        assert!(matches!(f[0].geometry, Geometry::Point(p) if p.x() == -71.5 && p.y() == -33.0));
        assert!(matches!(&f[1].geometry, Geometry::Polygon(p) if p.interiors().len() == 1));
        assert!(matches!(f[2].geometry, Geometry::LineString(_)));
        assert!(f.iter().all(|x| x.element == Element::Data));
    }

    #[test]
    fn a_bare_geometry_reads_and_nonsense_does_not() {
        assert_eq!(features(r#"{"type":"MultiLineString","coordinates":[[[0,0],[1,1]],[[2,2],[3,3]]]}"#).unwrap().len(), 1);
        assert!(matches!(features("{}"), Err(GeoJsonError::Shape(_))));
        assert!(matches!(features("nope"), Err(GeoJsonError::Json(_))));
        assert!(features(r#"{"type":"Feature","geometry":{"type":"Circle","coordinates":[0,0]}}"#).is_err());
    }
}
