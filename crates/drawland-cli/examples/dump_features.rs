//! `cargo run --release --example dump_features -- <overpass.json> <lat> <lng>`
//! prints `element id geometry-type area` per feature, for diffing against
//! osmnx (reference/python/parity/dump_features.py).

use geo::Area;
use drawland_core::output::{Output, OSM_TAGS};
use drawland_core::osm::{features_from_overpass, Element};
use drawland_core::profile::ProjectionMode;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let json = std::fs::read_to_string(&args[1]).unwrap();
    let (lat, lng): (f64, f64) = (args[2].parse().unwrap(), args[3].parse().unwrap());
    let output = Output {
        center: (lng, lat),
        width_mm: 152.4,
        height_mm: 101.6,
        scale: 10000.0,
        bearing: 0.0,
        projection: ProjectionMode::Utm,
        tile_zoom: None,
    };
    for f in features_from_overpass(&json, &output.query_polygon(), OSM_TAGS).unwrap() {
        let element = match f.element {
            Element::Node => "node",
            Element::Way => "way",
            Element::Relation => "relation",
            Element::Tile => "tile",
            Element::Data => "data",
        };
        let kind = match &f.geometry {
            geo::Geometry::Point(_) => "Point",
            geo::Geometry::LineString(_) => "LineString",
            geo::Geometry::Polygon(_) => "Polygon",
            geo::Geometry::MultiPolygon(_) => "MultiPolygon",
            _ => "Other",
        };
        println!("{element} {} {kind} {:.12}", f.id, f.geometry.unsigned_area());
    }
}
