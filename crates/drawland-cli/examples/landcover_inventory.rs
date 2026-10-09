//! `cargo run --release --example landcover_inventory -- <lat> <lng> [zoom]`
//! counts tile areas by layer/class/subclass over a 1:10000 sheet.

use std::collections::BTreeMap;

use drawland_core::output::Output;
use drawland_core::profile::ProjectionMode;
use drawland_core::tiles::{self, Tiles, LAYER_TAG};
use geo::{Area, Geometry};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (lat, lng): (f64, f64) = (args[1].parse().unwrap(), args[2].parse().unwrap());
    let zoom: u8 = args.get(3).map(|z| z.parse().unwrap()).unwrap_or(14);
    let output = Output {
        center: (lng, lat),
        width_mm: 152.4,
        height_mm: 101.6,
        scale: 10000.0,
        bearing: 0.0,
        projection: ProjectionMode::Utm,
        tile_zoom: Some(zoom),
    };
    let classes = [
        ("landcover", "farmland ice wood rock grass wetland sand"),
        ("landuse", "cemetery military residential commercial industrial retail school university college hospital stadium pitch playground track theme_park zoo quarry"),
        ("park", "national_park nature_reserve protected_area park"),
    ];
    let selectors: Vec<String> =
        classes.iter().flat_map(|(l, cs)| cs.split(' ').map(move |c| format!("{l}:{c}"))).collect();
    let mut t = Tiles::new(&output.query_polygon(), &selectors, None).unwrap();
    t.set_zoom(Some(zoom));
    let ids = t.tiles(terramask::MAX_ZOOM);
    let found = terramask::Fetcher::with_source(tiles::TILES).features_of(&ids, t.filter(), |_, _| {}).unwrap();
    t.add_features(found);
    let mut counts: BTreeMap<String, (usize, f64)> = BTreeMap::new();
    let mut shapes: BTreeMap<String, Vec<geo::Polygon<f64>>> = BTreeMap::new();
    let features = t.features();
    for f in &features {
        if !matches!(f.geometry, Geometry::Polygon(_) | Geometry::MultiPolygon(_)) {
            continue;
        }
        let g = |k: &str| f.tags.get(k).cloned().unwrap_or_default();
        let key = format!("{}:{}/{}", g(LAYER_TAG), g("class"), g("subclass"));
        let e = counts.entry(key.clone()).or_default();
        e.0 += 1;
        e.1 += f.geometry.unsigned_area() * 1e6;
        shapes.entry(key).or_default().extend(drawland_core::geom::polygons(&f.geometry));
    }
    println!("zoom {zoom}, {} tiles", ids.len());
    for (k, (n, a)) in &counts {
        println!("{k:50} {n:5}  area {a:10.3}");
    }
    let multi = |k: &str| geo::MultiPolygon::new(shapes.get(k).cloned().unwrap_or_default());
    let golf = multi("landcover:grass/golf_course");
    println!("\ninside landcover:grass/golf_course:");
    for k in shapes.keys().filter(|k| k.as_str() != "landcover:grass/golf_course") {
        let a = drawland_core::geom::intersection(&golf, &multi(k)).unsigned_area() * 1e6;
        if a > 1e-4 {
            println!("{k:50} area {a:10.3}");
        }
    }
}
