//! `cargo run --release --example dump_features -- <overpass.json> <lat> <lng>`
//! prints `element id geometry-type area` per feature, for diffing against
//! osmnx (reference/python/parity/dump_features.py).

use geo::Area;
use postcards_core::card::{Card, OSM_TAGS};
use postcards_core::osm::{features_from_overpass, Element};
use postcards_core::profile::ProjectionMode;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let json = std::fs::read_to_string(&args[1]).unwrap();
    let (lat, lng): (f64, f64) = (args[2].parse().unwrap(), args[3].parse().unwrap());
    let card = Card {
        center: (lng, lat),
        width_mm: 152.4,
        height_mm: 101.6,
        scale: 10000.0,
        bearing: 0.0,
        projection: ProjectionMode::Utm,
    };
    for f in features_from_overpass(&json, &card.query_polygon(), OSM_TAGS).unwrap() {
        let element = match f.element {
            Element::Node => "node",
            Element::Way => "way",
            Element::Relation => "relation",
            Element::Tile => "tile",
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
