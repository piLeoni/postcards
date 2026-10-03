//! `cargo run --release --example layer_stats -- <profile> <overpass.json> <lat> <lng>`
//! prints each layer before composition: mask area (mm²) and the ink length
//! of its outlines, details and filling (mm). Pairs with
//! reference/python/parity/layer_stats.py. No ocean (offline).

use geo::Area;
use drawland_core::card::{Card, OSM_TAGS};
use drawland_core::fill::Sources;
use drawland_core::geom::line_length;
use drawland_core::osm::features_from_overpass;
use drawland_core::profile::{Format, Profile};
use drawland_core::projection::Projector;
use drawland_core::themes::{self, Context};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let profile = Profile::parse(&std::fs::read_to_string(&args[1]).unwrap(), Format::from_path(&args[1])).unwrap();
    let json = std::fs::read_to_string(&args[2]).unwrap();
    let (lat, lng): (f64, f64) = (args[3].parse().unwrap(), args[4].parse().unwrap());
    let card = Card::new(&profile.map, (lng, lat));
    let projector = Projector::new(&card);
    let features: Vec<_> = features_from_overpass(&json, &card.query_polygon(), OSM_TAGS)
        .unwrap()
        .into_iter()
        .map(|mut f| {
            f.geometry = projector.project_geometry(&f.geometry);
            f
        })
        .collect();
    let sources = Sources::new();
    let masks = Default::default();
    let ctx = Context { card: &card, features: &features, ocean: None, sources: &sources, masks: &masks };
    for layer in profile.stack() {
        let t = std::time::Instant::now();
        let p = themes::render(layer, &ctx, &[]).unwrap();
        let secs = t.elapsed().as_secs_f64();
        let len = |l: &[geo::LineString<f64>]| l.iter().map(line_length).sum::<f64>();
        println!(
            "{:10} mask {:10.3}  outlines {:9.2}  details {:9.2}  filling {:9.2}  ({secs:.2}s)",
            layer.id,
            p.mask.unsigned_area(),
            len(&p.outlines),
            len(&p.details),
            len(&p.filling)
        );
    }
}
