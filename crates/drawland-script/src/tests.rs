use super::*;
use drawland_core::grammar::{Op, UnionRules};
use drawland_core::profile::Format;

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
fn the_postcard_script_matches_the_postcard_profile() {
    let js = evaluate(include_str!("../../../configs/proposal/postcard.js")).unwrap();
    let yaml = Grammar::parse(include_str!("../../../configs/proposal/postcard.yaml"), Format::Yaml).unwrap();
    assert_eq!(js.output, yaml.output);
    assert_eq!(js.groups(), yaml.groups());
    for section in Section::ALL {
        assert_eq!(js.defs(section).len(), yaml.defs(section).len(), "{section}");
    }
    let masks = |g: &Grammar| -> Vec<(String, Vec<String>)> {
        g.compose
            .masks
            .iter()
            .map(|(name, m)| {
                let mut ids: Vec<String> = m.occludes.iter().map(|i| i.0.clone()).collect();
                ids.sort();
                (name.clone(), ids)
            })
            .collect()
    };
    assert_eq!(masks(&js), masks(&yaml));
    let back = Grammar::from_json(&js.to_json().to_string()).unwrap();
    assert_eq!(back, js, "the graph survives JSON");
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
