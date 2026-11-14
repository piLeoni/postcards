use super::*;
use drawland_core::grammar::{LineBufferCap, Op, Section, UnionRules};
use drawland_core::grammar_run::{run, Inputs};
use drawland_core::output::Output;
use std::collections::BTreeMap;

fn err(source: &str) -> ScriptError {
    evaluate(source).expect_err("the script must fail")
}

#[test]
fn a_script_builds_the_graph_it_calls() {
    let g = evaluate(
        "title('Buildings')\n\
         const bldg = features.osm({ building: true })\n\
         const foot = areas.polygons(bldg)\n\
         draw({ id: 'bldg_fill', from: fills.fill({ in: foot, pattern: 'zigzag', spacing: '0.5mm', per: 'feature' }) })\n",
    )
    .unwrap();
    assert_eq!(g.title.as_deref(), Some("Buildings"));
    assert_eq!(g.defs(Section::Features).len(), 1);
    let foot = &g.defs(Section::Areas)[0];
    assert_eq!(foot.at, Some(At(3, 28)), "the def remembers the call");
    let Op::Fill(fill) = &g.defs(Section::Fills)[0].op else { panic!("a fill") };
    assert!(fill.per_feature);
    assert_eq!(fill.in_area, foot.reference());
    assert_eq!(g.groups(), ["bldg_fill"]);
    assert_eq!(g.draw[0].at.map(|a| a.0), Some(4));
}

#[test]
fn loops_and_functions_make_ordinary_graphs() {
    let g = evaluate(
        "const kinds = [{ leisure: 'garden' }, { leisure: 'park' }]\n\
         const taken = []\n\
         for (const tags of kinds) taken.push(areas.difference(areas.polygons(features.osm(tags)), taken))\n\
         const all = areas.union(taken)\n\
         draw({ id: 'edge', from: lines.rings(all), stroke: 'solid' })\n",
    )
    .unwrap();
    // The first kind has nothing to subtract: `difference` with no cut is the
    // area itself, not an empty operation.
    let areas: Vec<&Op> = g.defs(Section::Areas).iter().map(|d| &d.op).collect();
    assert!(matches!(areas[0], Op::Polygons(_)));
    assert!(matches!(areas[2], Op::Difference(d) if d.cut.len() == 1));
    assert!(matches!(areas[3], Op::Union(UnionRules::Refs(r)) if r.len() == 2));
}

#[test]
fn a_script_draws_contours_in_a_loop_over_elevation_bands() {
    // Step 11's own criterion: a loop over height bands, each a contour belt
    // drawn as its own layer, from the elevation under the output.
    let g = evaluate(
        "// Contour belts every 200 m, light where high.\n\
         const bands = [0, 200, 400, 600]\n\
         for (let i = 0; i < bands.length - 1; i++) {\n\
           const from = bands[i], to = bands[i + 1]\n\
           draw({\n\
             id: `band_${from}`,\n\
             from: lines.contours({ from, to, color: '#8a7a5c', style: { line_space: 7 } }),\n\
             stroke: 'solid',\n\
           })\n\
         }\n",
    )
    .unwrap();
    // Three belts from four cuts, three draws, three layers.
    assert_eq!(g.groups(), ["band_0", "band_200", "band_400"]);
    assert_eq!(g.terrains().len(), 3, "each band is a terrain def");

    // The bands keep the heights the loop wrote, and survive JSON.
    let bands: Vec<serde_json::Value> = g
        .terrains()
        .iter()
        .map(|t| serde_json::Value::Object(t.band.clone()))
        .collect();
    assert_eq!(bands[0]["elevMin"], 0.0);
    assert_eq!(bands[0]["elevMax"], 200.0);
    assert_eq!(bands[2]["elevMin"], 400.0);
    assert_eq!(bands[2]["elevMax"], 600.0);
    let back = Grammar::from_json(&g.to_json().to_string()).unwrap();
    assert_eq!(back, g, "the graph survives JSON");

    // A 64×64 cone from the sea up to 900 m, so every band is crossed: heights
    // below 0 at the corners, the summit at the centre.
    let width = 64usize;
    let elev: Vec<f32> = (0..width * width)
        .map(|i| {
            let (x, y) = ((i % width) as f32, (i / width) as f32);
            let cx = x - width as f32 / 2.0;
            let cy = y - width as f32 / 2.0;
            900.0 - (cx * cx + cy * cy) / 1.1
        })
        .collect();
    assert!(elev.iter().cloned().fold(f32::MIN, f32::max) > 600.0, "the summit clears the top band");
    assert!(elev.iter().cloned().fold(f32::MAX, f32::min) < 0.0, "the corners are sea");
    let output = Output::new(&g.output, (-122.256196, 37.8771145));
    let bounds = drawland_core::terrain::bounds_of(&output);
    let merc = [0.0, 0.0, 1000.0 * width as f64, 1000.0 * width as f64];
    let terrain = drawland_core::terrain::Grid::new(bounds, merc, elev, width);

    let out = run(
        &g,
        &output,
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: Some(terrain), memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() },
    )
    .unwrap();
    assert_eq!(out.groups.len(), 3, "three contour belts");
    for (name, lines) in &out.groups {
        assert!(*lines > 0, "the belt under {name} filled something");
    }
    assert!(out.svg.contains("<g id=\"band_200\">"));
}

#[test]
fn the_postcard_script_renders_without_osm_data() {
    // configs/postcard.js is the CLI's default and the library's living
    // example: it must load, survive JSON, and come out of the whole pipeline
    // (no features, so parks and water are empty, but every group is there).
    let g = evaluate(include_str!("../../../configs/postcard.js")).unwrap();
    assert_eq!(
        g.groups(),
        [
            "parks_ring", "parks_fill_g", "parks_fill_p", "parks_fill_w", "parks_fill_r", "parks_fill_x",
            "water_ring", "water_fill", "roads_out", "roads_trail", "roads_center", "roads_seam",
            "bldg_wall", "bldg_fill", "bldg_ring",
        ]
    );
    assert_eq!(g.compose.masks.len(), 3);
    assert_eq!(g.compose.masks[0].1.occludes.len(), 6, "wet_cover hides the parks ring and its five fills");
    let back = Grammar::from_json(&g.to_json().to_string()).unwrap();
    assert_eq!(back, g, "the graph survives JSON");
    let output = Output::new(&g.output, (-122.256196, 37.8771145));
    let out = run(&g, &output, Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() }).unwrap();
    assert!(!out.svg.is_empty());
    assert_eq!(out.groups.len(), 15);
}

#[test]
fn a_script_draws_terrain_from_the_elevation() {
    // `lines.terrain` is burin's: the graph loads, survives JSON, and the
    // whole pipeline runs over a synthetic ridge without any tiles.
    let g = evaluate(
        "draw({ id: 'terrain_g', from: lines.terrain({ color: '#000000', width: 1, angle: 0 }) })\n\
         draw({ id: 'terrain2', from: lines.terrain({ in: engine.frame(), shore: true, style: { line_space: 4 } }) })\n",
    )
    .unwrap();
    assert_eq!(g.terrains().len(), 2);
    let back = Grammar::from_json(&g.to_json().to_string()).unwrap();
    assert_eq!(back, g, "the graph survives JSON");

    // A 64×64 grid of a ridge: height rises then falls across x, so there is a
    // slope to hatch and a zero contour to draw.
    let width = 64usize;
    let elev: Vec<f32> = (0..width * width)
        .map(|i| {
            let (x, y) = ((i % width) as f32, (i / width) as f32);
            let cx = x - width as f32 / 2.0;
            let cy = y - width as f32 / 2.0;
            600.0 - (cx * cx + cy * cy) / 40.0
        })
        .collect();
    let output = Output::new(&g.output, (-122.256196, 37.8771145));
    let bounds = drawland_core::terrain::bounds_of(&output);
    let merc = [0.0, 0.0, 1000.0 * width as f64, 1000.0 * width as f64];
    let terrain = drawland_core::terrain::Grid::new(bounds, merc, elev, width);

    let out = run(
        &g,
        &output,
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: Some(terrain), memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() },
    )
    .unwrap();
    assert_eq!(out.groups.len(), 2, "two terrain groups");
    assert_eq!(out.groups[0].0, "terrain_g");
    assert_eq!(out.groups[1].0, "terrain2");
    assert!(out.groups[0].1 > 0, "the streamlines drew something");
    assert!(out.groups[1].1 > 0, "the shore drew something");
    assert!(out.svg.contains("<g id=\"terrain_g\">"));
}

#[test]
fn a_burin_document_runs_inside_a_profile() {
    // burin's own language, as a first-class builder here: the callback is a
    // real function in this interpreter, so it is linted and its errors carry
    // this script's lines. The atlas is burin's, and the engine draws it.
    let g = evaluate(
        "const natural = burin.terrain((b) => {\n\
           b.batch({ angle: 90, style: { space: 3, space_dark: 0.8 } })\n\
           b.water('dots', { follow: 'shore', style: { space: 10, space_dark: 0.3 } })\n\
           b.shore({ lines: 2 })\n\
         })\n\
         draw({ id: 'natural', from: natural, stroke: 'solid' })\n",
    )
    .unwrap();
    assert_eq!(g.burins().len(), 1, "one burin document");
    assert!(g.draws_terrain(), "a burin document needs the elevation");
    let atlas = &g.burins()[0].atlas;
    assert_eq!(atlas.as_array().unwrap().len(), 3, "a batch, a water pass and the shore");
    let back = Grammar::from_json(&g.to_json().to_string()).unwrap();
    assert_eq!(back, g, "the graph survives JSON");

    // A 64×64 cone from the sea to 600 m: a slope to hatch and a shore to draw.
    let width = 64usize;
    let elev: Vec<f32> = (0..width * width)
        .map(|i| {
            let (x, y) = ((i % width) as f32, (i / width) as f32);
            let cx = x - width as f32 / 2.0;
            let cy = y - width as f32 / 2.0;
            600.0 - (cx * cx + cy * cy) / 40.0
        })
        .collect();
    let output = Output::new(&g.output, (-122.256196, 37.8771145));
    let bounds = drawland_core::terrain::bounds_of(&output);
    let merc = [0.0, 0.0, 1000.0 * width as f64, 1000.0 * width as f64];
    let terrain = drawland_core::terrain::Grid::new(bounds, merc, elev, width);
    let out = run(
        &g,
        &output,
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: Some(terrain), memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() },
    )
    .unwrap();
    assert_eq!(out.groups.len(), 1);
    assert_eq!(out.groups[0].0, "natural");
    assert!(out.groups[0].1 > 0, "the burin document drew something");
}

#[test]
fn a_mistake_in_a_burin_document_points_at_the_profile_line() {
    // The callback runs in the profile's own engine, so the error is the
    // profile's, not a position inside a string: it names the burin call whose
    // document is wrong.
    let e = err("const a = engine.frame()\nconst n = burin.terrain((b) => {\n  b.water('swirl')\n})\n");
    assert_eq!(e.at.map(|a| a.0), Some(2), "{e}");
    assert!(e.message.contains("swirl"), "{e}");
    let e = err("burin.terrain(42)\n");
    assert!(e.message.contains("burin.terrain expects a function"), "{e}");
}

#[test]
fn a_wrong_argument_is_reported_at_the_users_line() {
    let e = err("const bldg = features.osm({ building: true })\n\n  lines.rings(bldg)\n");
    assert_eq!(e.at.map(|a| a.0), Some(3));
    assert!(e.message.contains("lines.rings expects an area"), "{e}");
    assert!(e.to_string().starts_with("line 3 column "), "{e}");
}

#[test]
fn an_error_inside_a_helper_points_at_the_helper() {
    let e = err("function ring(x) {\n  return lines.rings(x)\n}\nring(42)\n");
    assert_eq!(e.at.map(|a| a.0), Some(2));
    assert!(e.message.contains("the number 42"), "{e}");
}

#[test]
fn engine_errors_on_an_option_come_back_at_the_call() {
    let e = err("const a = engine.frame()\nconst f = fills.fill({ in: a, spacing: 'wide' })\n");
    assert_eq!(e.at.map(|a| a.0), Some(2));
    assert!(e.message.contains("spacing") || e.message.contains("length"), "{e}");
}

#[test]
fn validation_errors_carry_the_line_of_what_they_name() {
    let e = err("const a = engine.frame()\ndraw({ id: 'x', from: lines.rings(a) })\ncompose.mask({ from: a, occludes: ['y'] })\n");
    assert_eq!(e.at.map(|a| a.0), Some(3), "{e}");
    assert!(e.message.contains("\"y\""), "{e}");
    let e = err("const a = engine.frame()\ndraw({ id: 'x', from: lines.rings(a) })\ndraw({ id: 'x', from: lines.rings(a) })\n");
    assert_eq!(e.at.map(|a| a.0), Some(3), "{e}");
    let e = err("const a = engine.frame()\ndraw({ id: 'x', from: lines.rings(a) })\ncompose.order('x', 'z')\n");
    assert_eq!(e.at.map(|a| a.0), Some(3), "{e}");
}

#[test]
fn syntax_and_runtime_errors_carry_their_own_line() {
    let e = err("const a = engine.frame()\nconst b = ;\n");
    assert_eq!(e.at.map(|a| a.0), Some(2), "{e}");
    assert!(e.message.starts_with("SyntaxError"), "{e}");
    let e = err("const a = null\n\nconst b = a.x\n");
    assert_eq!(e.at.map(|a| a.0), Some(3), "{e}");
    assert!(e.message.starts_with("TypeError"), "{e}");
    let e = err("const a = engine.frame()\n  aeras.union(a)\n");
    assert_eq!(e.at, Some(At(2, 3)), "{e}");
    assert!(e.message.contains("aeras is not defined"), "{e}");
    let e = err("throw new Error('nope')\n");
    assert_eq!(e.at.map(|a| a.0), Some(1), "{e}");
}

#[test]
fn a_runaway_loop_ends_with_an_error() {
    let e = err("let i = 0\nwhile (true) { i++ }\n");
    assert!(e.message.to_lowercase().contains("loop"), "{e}");
    let e = err("function f(n) { return f(n + 1) }\nf(0)\n");
    assert!(e.message.to_lowercase().contains("recursive"), "{e}");
}

#[test]
fn the_sandbox_has_no_clock_dice_network_or_modules() {
    for name in ["Date", "fetch", "require", "process", "console", "setTimeout", "XMLHttpRequest", "WeakRef"] {
        let g = evaluate(&format!("if (typeof {name} !== 'undefined') throw new Error('{name} is reachable')"));
        assert!(g.is_ok(), "{name}: {:?}", g.err());
    }
    assert!(evaluate("if (typeof Math.random !== 'undefined') throw new Error('random')").is_ok());
    assert!(evaluate("if (typeof __drawland !== 'undefined') throw new Error('natives leak')").is_ok());
    // The library itself cannot be replaced from the script.
    assert!(evaluate("areas = null\n").is_err() || evaluate("areas = null\nareas.union").is_ok());
    assert!(evaluate("areas.union = null\n").is_err() || evaluate("areas.union = null\nif (areas.union === null) throw 1").is_ok());
}

#[test]
fn module_outputs_draw_and_mask_but_do_not_transform() {
    let g = evaluate(
        "const roads = modules.roads()\n\
         draw({ id: 'r', from: roads.outlines, stroke: 'solid' })\n\
         compose.mask({ from: roads.area, occludes: ['r'] })\n",
    )
    .unwrap();
    assert_eq!(g.draw[0].from.module.as_deref(), Some("roads"));
    assert_eq!(g.compose.masks[0].1.from.module.as_deref(), Some("roads"));
    let e = err("const roads = modules.roads()\nlines.dedupe(roads.outlines)\n");
    assert!(e.message.contains("module roads"), "{e}");
    assert_eq!(e.at.map(|a| a.0), Some(2));
}

#[test]
fn where_bands_features_and_ink_works_out_the_strokes() {
    let g = evaluate(
        "const b = features.tiles('buildings')\n\
         for (const [lo, hi] of [[0, 20], [20, 1000]]) {\n\
           const t = ink.at(lo, 0, 20)\n\
           draw({ id: `h${lo}`, from: lines.rings(areas.polygons(features.where(b, { render_height: { min: lo, max: hi } }))),\n\
                  stroke: { color: ink.ramp(['#000000', '#ffffff'], t), width: ink.width(0.1, 0.5, t) } })\n\
         }\n",
    )
    .unwrap();
    let strokes: Vec<_> = g.draw.iter().map(|d| d.stroke.clone().unwrap()).collect();
    assert_eq!(strokes[0].color.as_deref(), Some("#000000"));
    assert_eq!(strokes[1].color.as_deref(), Some("#ffffff"));
    assert_eq!(strokes[1].width.map(|w| w.0), Some(0.5));
    assert!(evaluate("ink.ramp(['#fff'], 0)").is_err());
    let e = err("const b = features.tiles('buildings')\nfeatures.where(b, { render_height: { above: 3 } })\n");
    assert!(e.message.contains("{ min, max }"), "{e}");
    assert_eq!(e.at.map(|a| a.0), Some(2));
}

#[test]
fn areas_buffer_accepts_a_cap_option() {
    let g = evaluate("const l = lines.of(features.tiles('roads'))\nconst a = areas.buffer(l, '0.3mm', { cap: 'flat' })\n").unwrap();
    let Op::BufferLines(b) = &g.defs(Section::Areas)[0].op else { panic!("buffer") };
    assert_eq!(b.cap, LineBufferCap::Flat);
    let e = err("const l = lines.of(features.tiles('roads'))\nareas.buffer(l, '0.3mm', { cap: 'square' })\n");
    assert!(e.message.contains("cap"), "{e}");
}

#[test]
fn labels_accept_user_defined_rules() {
    let g = evaluate(
        "const s = features.tiles('road_names')\n\
         const names = modules.labels({\n\
           from: s,\n\
           rules: [{ tags: { class: ['primary'] }, size: '2.5mm' }],\n\
         })\n",
    )
    .unwrap();
    let l = g
        .defs(Section::Lines)
        .iter()
        .find_map(|d| match &d.op {
            Op::Labels(x) => Some(x),
            _ => None,
        })
        .expect("labels");
    assert_eq!(l.style.rules.len(), 1);
    assert_eq!(l.style.rules[0].size, Some(drawland_core::units::Mm(2.5)));
}

#[test]
fn labels_accept_keep_centerline_and_font_origins() {
    let g = evaluate(
        "modules.labels({ from: features.tiles('parks'), buffer: 2, keepCenterline: false })\n\
         modules.labels({\n\
           from: features.tiles('road_names'),\n\
           font: { origin: 'google', family: 'Roboto', weight: 500 },\n\
           rules: [{ tags: { class: ['primary'] }, buffer: 1, keepCenterline: false }],\n\
         })\n",
    )
    .unwrap();
    let styles: Vec<_> = g
        .defs(Section::Lines)
        .iter()
        .filter_map(|d| match &d.op {
            Op::Labels(x) => Some(&x.style),
            _ => None,
        })
        .collect();
    assert_eq!(styles.len(), 2);
    assert!(!styles[0].keep_centerline);
    assert!(styles[1].keep_centerline);
    assert!(!styles[1].rules[0].keep_centerline.unwrap());
    assert!(styles[1].font.google_spec().is_some());
}

#[test]
fn stroke_fonts_compile_for_labels_and_lines_text() {
    let g = evaluate(
        "const t = lines.text({ text: 'a', font: 'ems-readability', at: ['10mm', '10mm'] })\n\
         const names = modules.labels({\n\
           from: features.tiles('parks'),\n\
           font: { origin: 'stroke', url: 'https://example.com/Custom.svg' },\n\
         })\n\
         draw({ id: 't', from: t })\n\
         draw({ id: 'n', from: names.lines })\n",
    )
    .unwrap();
    let text = g.defs(Section::Lines).iter().find_map(|d| match &d.op {
        Op::Text(t) => Some(t.font.stroke_font_key()),
        _ => None,
    });
    assert_eq!(
        text,
        Some(Some("https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSReadability.svg".into()))
    );
    let labels = g.defs(Section::Lines).iter().find_map(|d| match &d.op {
        Op::Labels(l) => Some(l.style.font.stroke_font_key()),
        _ => None,
    });
    assert_eq!(labels, Some(Some("https://example.com/Custom.svg".into())));
}

#[test]
fn labels_read_several_feature_sets_and_draw_as_lines() {
    let g = evaluate(
        "const streets = features.tiles('road_names')\n\
         const parks = features.tiles('parks')\n\
         const names = modules.labels({ from: [streets, parks], size: '2.2mm', upper: true })\n\
         draw({ id: 'labels', from: names.lines, stroke: { style: 'solid', color: '#d40000' } })\n\
         draw({ id: 'halo', from: lines.rings(areas.buffer(names.lines, '0.4mm')) })\n",
    )
    .unwrap();
    let labels = g.defs(Section::Lines).iter().find_map(|d| match &d.op {
        Op::Labels(l) => Some(l),
        _ => None,
    });
    let labels = labels.expect("a labels def");
    assert_eq!(labels.from.len(), 2);
    assert_eq!(labels.style.size.0, 2.2);
    assert!(labels.style.upper);
    assert_eq!(labels.style.font.drawland_id(), Some("futural"));
    let e = err("modules.labels({ from: features.tiles('parks'), colour: 'red' })");
    assert!(e.message.contains("unknown option colour"), "{e}");
}

#[test]
fn labels_area_is_an_ordinary_area_and_the_ink_stays_outside() {
    let g = evaluate(
        "const names = modules.labels({\n\
           from: features.tiles('parks'),\n\
           rules: [{ id: 'park', tags: { class: 'park' }, font: { origin: 'google', family: 'DynaPuff' } }],\n\
         })\n\
         const hatch = fills.fill({ in: names.park.area, pattern: 'lines', spacing: '0.3mm', angle: 45 })\n\
         compose.mask({ name: 'clear', from: areas.union(names.area, areas.buffer(names.lines, '0.4mm')), occludes: [] })\n\
         draw({ id: 'fill', from: hatch })\n\
         draw({ id: 'edge', from: lines.rings(names.park.area) })\n\
         draw({ id: 'park_lines', from: names.park.lines })\n\
         draw({ id: 'labels', from: names.lines })\n",
    )
    .unwrap();
    let labels = g.defs(Section::Lines).iter().find(|d| matches!(d.op, Op::Labels(_))).expect("a labels def");
    let areas: Vec<_> = g.defs(Section::Areas).iter().filter_map(|d| match &d.op {
        Op::LabelArea(p) => Some((d.name.clone(), p.rule.clone())),
        _ => None,
    }).collect();
    assert_eq!(areas.len(), 2, "union area and park bucket");
    assert!(areas.iter().any(|(_, rule)| rule.is_none()));
    assert!(areas.iter().any(|(_, rule)| rule.as_deref() == Some("park")));
    let lines: Vec<_> = g.defs(Section::Lines).iter().filter_map(|d| match &d.op {
        Op::LabelLines(p) if p.rule.as_deref() == Some("park") => Some(d.name.clone()),
        _ => None,
    }).collect();
    assert_eq!(lines.len(), 1);
    let back = drawland_core::grammar::Grammar::from_json(&g.to_json().to_string()).unwrap();
    assert_eq!(back.to_json(), g.to_json());

    let e = err("modules.labels({ from: features.tiles('parks'), rules: [{ tags: { class: 'park' }, fill: { pattern: 'lines' } }] })");
    assert!(e.message.contains("unknown key fill"), "{e}");
}

/// The names `drawland.d.ts` declares inside `declare const <object>: { … }`
/// or as `declare function`.
fn declared() -> Vec<String> {
    let dts = include_str!("../drawland.d.ts");
    let mut out = Vec::new();
    let mut object: Option<String> = None;
    for line in dts.lines() {
        if let Some(rest) = line.strip_prefix("declare const ") {
            let name = rest.split(':').next().unwrap_or_default().trim().to_string();
            out.push(name.clone());
            object = Some(name);
        } else if let Some(rest) = line.strip_prefix("declare function ") {
            out.push(rest.split('(').next().unwrap_or_default().to_string());
        } else if line.starts_with('}') {
            object = None;
        } else if let (Some(o), Some(method)) = (&object, line.strip_prefix("  ")) {
            if let Some(name) = method.split('(').next().filter(|n| method.contains('(') && n.chars().all(|c| c.is_alphanumeric())) {
                out.push(format!("{o}.{name}"));
            }
        }
    }
    out.sort();
    out
}

#[test]
fn the_description_declares_exactly_what_the_library_defines() {
    let defined = library_names().unwrap();
    assert_eq!(declared(), defined);
}

/// The quoted members of `type <name> = | "a" | "b" …` in `drawland.d.ts`.
fn union(name: &str) -> Vec<String> {
    let dts = include_str!("../drawland.d.ts");
    let start = dts.find(&format!("type {name} =")).unwrap_or_else(|| panic!("type {name}"));
    let body = &dts[start..];
    let body = &body[..body.find("\n\n").unwrap_or(body.len())];
    body.split('"').skip(1).step_by(2).map(str::to_string).collect()
}

#[test]
fn the_description_lists_every_pattern_and_preset() {
    // The pattern block is written from penfill's catalogue; a stale one
    // would let the editor accept a pattern the engine refuses, or the
    // reverse.
    let dts = include_str!("../drawland.d.ts");
    assert!(
        crate::catalog_dts::rewrite(dts) == dts,
        "drawland.d.ts's catalogue block is stale: run cargo run -p drawland-script --example write_dts"
    );
    let presets: Vec<String> = terramask::PRESETS.iter().map(|(n, _)| n.to_string()).collect();
    assert_eq!(union("TilePreset"), presets);
}

#[test]
fn compose_optimize_steps_round_trip_and_execute() {
    let g = evaluate(
        "output({ width: '100mm', height: '50mm' })\n\
         const f = engine.frame()\n\
         const inner = areas.grow(f, '-10mm')\n\
         draw({ id: 'ring_a', from: lines.rings(inner), stroke: 'solid' })\n\
         draw({ id: 'ring_b', from: lines.rings(inner), stroke: 'dash' })\n\
         const solid = ['ring_a']\n\
         const dashed = ['ring_b']\n\
         compose.deoverlap(solid, { tolerance: '0.3mm', acrossLayers: true })\n\
         compose.linemerge(solid, '0.1mm')\n\
         compose.simplify([...solid, ...dashed], '0.05mm')\n\
         compose.filter(solid, '0.05mm')\n\
         compose.reloop(solid)\n\
         compose.hand(solid, { preset: 'sketch', wobble: '0.3mm', bow: 0.02, seed: 4 })\n\
         compose.hand('sketch')\n\
         compose.orient(solid, 'tl-br')\n\
         compose.linesort([...solid, ...dashed], { direction: 45, splitReversals: true })\n",
    )
    .unwrap();
    assert_eq!(g.compose.optimize.len(), 9);
    match &g.compose.optimize[5].op {
        drawland_core::optimize::OptimizeOp::Hand(h) => {
            let p = h.params();
            assert_eq!((p.wobble, p.bow, p.seed), (0.3, 0.02, 4));
            assert_eq!(p.corners, penfill::HandParams::sketch().corners);
        }
        op => panic!("expected hand, got {op:?}"),
    }
    assert!(g.compose.optimize[6].layers.is_empty());
    let back = drawland_core::grammar::Grammar::from_json(&g.to_json().to_string()).unwrap();
    assert_eq!(back, g);
    let out = run(
        &g,
        &Output::new(&g.output, (0.0, 0.0)),
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() },
    )
    .unwrap();
    assert!(out.groups.iter().any(|(id, n)| id == "ring_a" && *n >= 1));
    assert!(out.groups.iter().any(|(id, n)| id == "ring_b" && *n >= 1));

    let e = err(
        "draw({ id: 'ring_a', from: lines.rings(engine.frame()) })\n\
         compose.deoverlap(['missing_layer'], '0.3mm')\n",
    );
    assert!(e.message.contains("missing_layer"), "{e}");
    assert_eq!(e.at, Some(At(2, 18)));
}

#[test]
fn geojson_datasets_draw_from_a_url_and_from_the_profile() {
    let g = evaluate(
        "output({ width: '100mm', height: '100mm', scale: '1:1000000', lat: 0, lng: 0 })\n\
         const quakes = features.geojson('https://example.org/q.geojson')\n\
         const deep = features.where(quakes, { mag: { min: 5 }, 'geom:z': { min: 300 } })\n\
         draw({ id: 'deep', from: lines.rings(areas.around(deep, '1mm')) })\n\
         const box = features.geojson({ type: 'Polygon', coordinates: [[[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]]] })\n\
         draw({ id: 'box', from: lines.rings(areas.polygons(box)) })\n",
    )
    .unwrap();
    assert_eq!(g.datasets(), ["https://example.org/q.geojson"], "inline GeoJSON needs no host");
    assert_eq!(Grammar::from_json(&g.to_json().to_string()).unwrap(), g, "the graph survives JSON");
    let quakes = r#"{"type":"FeatureCollection","features":[
        {"type":"Feature","properties":{"mag":6.1},"geometry":{"type":"Point","coordinates":[0.05,0.05,450]}},
        {"type":"Feature","properties":{"mag":6.3},"geometry":{"type":"Point","coordinates":[-0.05,0,12]}},
        {"type":"Feature","properties":{"mag":4.2},"geometry":{"type":"Point","coordinates":[0,-0.05,500]}}]}"#;
    let output = Output::new(&g.output, (0.0, 0.0));
    let render = |data: BTreeMap<String, String>| {
        run(&g, &output, Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data, views: Vec::new() })
    };
    assert!(render(BTreeMap::new()).is_err(), "a dataset the host never read is an error");
    let out = render([("https://example.org/q.geojson".to_string(), quakes.to_string())].into()).unwrap();
    let strokes: BTreeMap<_, _> = out.groups.into_iter().collect();
    assert_eq!(strokes["deep"], 1, "only the deep, strong quake");
    assert_eq!(strokes["box"], 1);
}

#[test]
fn geojson_takes_a_source_or_an_object() {
    assert!(err("features.geojson('')").to_string().contains("URL"));
    assert!(err("features.geojson({ coordinates: [] })").to_string().contains("type"));
}

#[test]
fn a_fill_another_def_reads_is_made_for_it() {
    // A clearance round a hatch: the hatch is a fill, buffered into an area
    // that masks the layer under it.
    let g = evaluate(
        "output({ width: '40mm', height: '40mm', scale: '1:1000', lat: 0, lng: 0 })\n\
         const box = areas.shape({ at: ['50%', '50%'], rect: [30, 30] })\n\
         const hatch = fills.fill({ in: box, pattern: 'lines', spacing: '4mm', angle: 90 })\n\
         const under = draw({ id: 'under', from: lines.shape({ at: ['50%', '50%'], points: [[-15, 0], [15, 0]], closed: false }) })\n\
         draw({ id: 'hatch', from: hatch })\n\
         compose.mask({ from: areas.buffer(hatch, '0.5mm'), occludes: [under] })\n",
    )
    .unwrap();
    let output = Output::new(&g.output, (0.0, 0.0));
    let out = run(&g, &output, Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new(), stroke_fonts: BTreeMap::new(), data: BTreeMap::new(), views: Vec::new() }).unwrap();
    let strokes: BTreeMap<_, _> = out.groups.into_iter().collect();
    assert!(strokes["hatch"] > 0);
    assert!(strokes["under"] > 1, "the line under the hatch is cut where hatch lines cross it, got {}", strokes["under"]);
}

fn no_inputs(views: Vec<Inputs<'static>>) -> Inputs<'static> {
    static NONE: std::sync::OnceLock<BTreeMap<String, String>> = std::sync::OnceLock::new();
    Inputs {
        features: vec![],
        tiles: vec![],
        sources: NONE.get_or_init(BTreeMap::new),
        terrain: None,
        memory_budget: None,
        google_fonts: BTreeMap::new(),
        stroke_fonts: BTreeMap::new(),
        data: BTreeMap::new(),
        views: views,
    }
}

#[test]
fn a_view_draws_its_own_graph_into_its_rectangle() {
    // A page with one view: a 20 × 10 mm rectangle at (30, 40) holding a
    // line across its middle; the page's mask over the view cuts it.
    let g = evaluate(
        "output({ width: '100mm', height: '100mm', padding: 0 })\n\
         const v = view({ id: 'inset', at: [30, 40], size: [20, 10], lat: 1, lng: 2, scale: '1:5000' }, () => {\n\
           draw({ id: 'across', from: lines.shape({ at: ['50%', '50%'], points: [[-10, 0], [10, 0]], closed: false }) })\n\
         })\n\
         const gap = areas.shape({ at: [40, 45], rect: [4, 4] })\n\
         compose.mask({ from: gap, occludes: [v] })\n",
    )
    .unwrap();
    assert_eq!(g.views.len(), 1);
    assert_eq!(g.views[0].grammar.output.lat, Some(1.0));
    assert_eq!(g.views[0].grammar.output.width.0, 20.0);
    assert_eq!(Grammar::from_json(&g.to_json().to_string()).unwrap(), g, "the graph survives JSON, views and all");
    let output = Output::new(&g.output, (0.0, 0.0));
    let out = run(&g, &output, no_inputs(vec![no_inputs(vec![])])).unwrap();
    let strokes: BTreeMap<_, _> = out.groups.into_iter().collect();
    assert_eq!(strokes["across"], 2, "the mask splits the view's line in two");
    // The line sits at the view's middle on the page: y = 40 + 5.
    assert!(out.svg.contains(",45") || out.svg.contains(" 45"), "the view is moved to its rectangle");
}

#[test]
fn a_view_can_draw_in_a_built_in_preset() {
    let g = evaluate("view({ id: 'a', at: [0, 0], size: [50, 40], lat: 41.4, lng: 2.17, scale: '1:4000' }, 'city-grain')").unwrap();
    let inner = &g.views[0].grammar;
    assert_eq!(inner.output.lat, Some(41.4), "the view's place wins over the preset's");
    assert_eq!(inner.output.width.0, 50.0);
    assert!(!inner.draw.is_empty());
    assert!(err("view({ id: 'a', at: [0, 0], size: [5, 5] }, 'nope')").to_string().contains("no preset"));
}

#[test]
fn text_counters_open_only_when_asked() {
    let g = evaluate("const a = areas.text({ text: 'A', counters: 'open' }); const b = areas.text({ text: 'B' })").unwrap();
    let json = g.to_json().to_string();
    assert_eq!(json.matches("openCounters").count(), 1);
    assert!(err("areas.text({ text: 'A', counters: 'half' })").to_string().contains("counters"));
}

#[test]
fn an_inked_view_is_a_pen_of_its_own() {
    let g = evaluate(
        "output({ width: '60mm', height: '30mm', padding: 0 })\n\
         const line = () => draw({ id: 'l', from: lines.shape({ at: ['50%', '50%'], points: [[-5, 0], [5, 0]], closed: false }) })\n\
         view({ id: 'a', at: [0, 0], size: [30, 30], ink: '#ff0000' }, line)\n\
         view({ id: 'b', at: [30, 0], size: [30, 30] }, line)\n",
    )
    .unwrap();
    assert_eq!(g.views[0].ink.as_deref(), Some("#ff0000"));
    assert_eq!(Grammar::from_json(&g.to_json().to_string()).unwrap(), g);
    let output = Output::new(&g.output, (0.0, 0.0));
    let out = run(&g, &output, no_inputs(vec![no_inputs(vec![]), no_inputs(vec![])])).unwrap();
    let ids: Vec<&str> = out.groups.iter().map(|(id, _)| id.as_str()).collect();
    assert!(ids.contains(&"a") && ids.contains(&"l"), "the inked view is one group of its own, got {ids:?}");
    assert!(out.svg.contains("#ff0000"));
    assert!(err("view({ id: 'a', at: [0, 0], size: [5, 5], ink: 3 }, () => {})").to_string().contains("ink"));
}

#[test]
fn json_items_draw_as_points_through_the_runner() {
    let g = evaluate(
        "output({ width: '100mm', height: '100mm', scale: '1:1000000', lat: 0, lng: 0 })\n\
         const v = features.json('https://example.org/v', { items: 'data', lat: 'a.lat', lng: 'a.lng' })\n\
         draw({ id: 'red', from: lines.rings(areas.around(features.where(v, { 'route.id': 'Red' }), '1mm')) })\n",
    )
    .unwrap();
    assert_eq!(g.datasets(), ["https://example.org/v"]);
    assert_eq!(Grammar::from_json(&g.to_json().to_string()).unwrap(), g);
    let reply = r#"{"data":[{"a":{"lat":0.01,"lng":0.02},"route":{"id":"Red"}},{"a":{"lat":0,"lng":0},"route":{"id":"Blue"}}]}"#;
    let output = Output::new(&g.output, (0.0, 0.0));
    let mut inputs = no_inputs(vec![]);
    inputs.data = [("https://example.org/v".to_string(), reply.to_string())].into();
    let out = run(&g, &output, inputs).unwrap();
    let strokes: BTreeMap<_, _> = out.groups.into_iter().collect();
    assert_eq!(strokes["red"], 1, "one red vehicle, one ring");
    assert!(err("features.json('u', { lat: 'a' })").to_string().contains("lng"));
}

#[test]
fn a_graticule_follows_the_projection_round_its_plate() {
    let g = evaluate(
        "output({ width: '200mm', height: '150mm', scale: '1:1000000', lat: 41.7, lng: -70.4, padding: 0 })\n\
         const plate = areas.shape({ at: [100, 75], rect: [160, 110] })\n\
         const grat = modules.graticule({ in: plate, step: 30, ticks: 10, band: '1.5mm' })\n\
         draw({ id: 'grid', from: grat.lines })\n\
         draw({ id: 'keys', from: lines.rings(grat.keys) })\n",
    )
    .unwrap();
    assert_eq!(Grammar::from_json(&g.to_json().to_string()).unwrap(), g);
    let output = Output::new(&g.output, (-70.4, 41.7));
    let out = run(&g, &output, no_inputs(vec![])).unwrap();
    let strokes: BTreeMap<_, _> = out.groups.into_iter().collect();
    assert!(strokes["grid"] >= 5, "{}", strokes["grid"]);
    // Every other 10′ along each side: about six keys on the long sides, three on the short.
    assert!((14..=22).contains(&strokes["keys"]), "{}", strokes["keys"]);
    assert!(err("modules.graticule({ in: areas.shape({ at: [0, 0], rect: [1, 1] }) })").to_string().contains("step"));
}

#[test]
fn the_built_in_presets_are_the_web_apps() {
    // `presets/` is a copy, built in so the crate stands alone; in the repo
    // it must match the web app's scripts exactly.
    let here = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let web = here.join("../../web/src/presets");
    let Ok(entries) = std::fs::read_dir(&web) else { return };
    let mut n = 0;
    for e in entries.filter_map(|e| e.ok()) {
        let name = e.file_name().into_string().unwrap_or_default();
        if !name.ends_with(".js") {
            continue;
        }
        n += 1;
        let copy = std::fs::read_to_string(here.join("presets").join(&name)).unwrap_or_default();
        assert!(
            copy == std::fs::read_to_string(e.path()).unwrap(),
            "presets/{name} differs from web/src/presets: cargo run --example check_web_presets -- --write"
        );
    }
    assert_eq!(n, crate::PRESETS.len(), "a preset is missing from presets/");
}

#[test]
fn engine_paper_is_the_outputs_size_in_mm() {
    // The paper comes back read, whatever the unit: draw a frame inset by a
    // tenth of it, and the graph carries those millimetres.
    let ok = evaluate(
        "output({ width: '6in', height: '100mm', scale: '1:8000', lat: 0, lng: 0 })\n\
         const p = engine.paper()\n\
         if (p.width !== 152.4 || p.height !== 100) throw new Error(`paper ${p.width} × ${p.height}`)\n\
         draw({ id: 'f', from: lines.rings(areas.shape({ at: [p.width / 2, p.height / 2], rect: [p.width * 0.8, p.height * 0.8] })) })\n",
    );
    assert!(ok.is_ok(), "{:?}", ok.err());
    let e = err("const p = engine.paper()\n");
    assert!(e.to_string().contains("call output"), "{e}");
}
