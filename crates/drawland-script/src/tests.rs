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
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: Some(terrain), memory_budget: None, google_fonts: BTreeMap::new() },
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
    let out = run(&g, &output, Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: None, memory_budget: None, google_fonts: BTreeMap::new() }).unwrap();
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
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: Some(terrain), memory_budget: None, google_fonts: BTreeMap::new() },
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
        Inputs { features: vec![], tiles: vec![], sources: &BTreeMap::new(), terrain: Some(terrain), memory_budget: None, google_fonts: BTreeMap::new() },
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
fn the_description_lists_every_pattern_preset_and_hatch() {
    let patterns: Vec<String> = drawland_core::fill::GENERATORS.iter().map(|s| s.to_string()).collect();
    assert_eq!(union("Pattern"), patterns);
    let presets: Vec<String> = terramask::PRESETS.iter().map(|(n, _)| n.to_string()).collect();
    assert_eq!(union("TilePreset"), presets);
    let hatches: Vec<String> = penfill::pat::BUILTIN.iter().map(|s| s.to_string()).collect();
    assert_eq!(union("PatName"), hatches);
}
