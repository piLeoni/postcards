// The draw.land library, as a profile sees it. Evaluated before the profile,
// with the engine's natives in `dl`; everything else here is plain JS: handles,
// argument checks, the shape of each operation in the graph.
(function (dl) {
  "use strict";

  class Features {
    constructor(ref) { this.ref = ref; Object.freeze(this); }
  }
  class Area {
    constructor(ref, mask) { this.ref = ref; this.mask = mask || ref; Object.freeze(this); }
  }
  class Lines {
    constructor(ref, module) { this.ref = ref; this.module = module || null; Object.freeze(this); }
  }

  const fail = (message) => dl.fail(message);

  function describe(v) {
    if (v instanceof Features) return "features";
    if (v instanceof Area) return "an area";
    if (v instanceof Lines) return "lines";
    if (Array.isArray(v)) return "a list";
    if (v === undefined) return "nothing";
    if (v === null) return "null";
    return typeof v === "object" ? "an object" : `the ${typeof v} ${JSON.stringify(v)}`;
  }

  const wants = new Map([
    [Features, "features (from features.osm or features.tiles)"],
    [Area, "an area (from areas.*, engine.* or a module's .area)"],
    [Lines, "lines (from lines.*, fills.fill or a module)"],
  ]);

  // The graph reference of `v`, checked to be a `Kind`.
  function need(v, Kind, where) {
    if (!(v instanceof Kind)) fail(`${where} expects ${wants.get(Kind)}, got ${describe(v)}`);
    if (v instanceof Lines && v.module) {
      fail(`${where}: ${v.ref} comes from module ${v.module}; it can be drawn, not transformed`);
    }
    return v.ref;
  }

  // `f(a, b, c)` or `f([a, b, c])`.
  function many(args, Kind, where) {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return items.map((x, i) => need(x, Kind, items.length > 1 ? `${where} (input ${i + 1})` : where));
  }

  function object(v, where) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) fail(`${where} expects an object, got ${describe(v)}`);
    return v;
  }

  const make = (Kind, section, op) => new Kind(dl.node(section, op));

  const features = {
    osm(tags) {
      object(tags, "features.osm");
      return make(Features, "features", { osm_select: tags });
    },
    tiles(...items) {
      const flat = items.flat();
      if (!flat.length) fail("features.tiles needs a preset or a layer:class rule");
      return make(Features, "features", { tiles_select: flat });
    },
  };

  const areas = {
    polygons(of) {
      return make(Area, "areas", { tools_polygons: need(of, Features, "areas.polygons") });
    },
    union(...inputs) {
      const refs = many(inputs, Area, "areas.union");
      if (!refs.length) fail("areas.union needs at least one area");
      return make(Area, "areas", { tools_union: refs });
    },
    difference(base, ...cut) {
      const b = need(base, Area, "areas.difference");
      const refs = many(cut, Area, "areas.difference cut");
      if (!refs.length) return base;
      return make(Area, "areas", { tools_difference: { base: b, cut: refs } });
    },
    intersect(base, keep) {
      return make(Area, "areas", {
        tools_intersect: { base: need(base, Area, "areas.intersect"), keep: need(keep, Area, "areas.intersect keep") },
      });
    },
    fillHoles(of) {
      return make(Area, "areas", { tools_fill_holes: need(of, Area, "areas.fillHoles") });
    },
    grow(of, by) {
      if (typeof by !== "number" && typeof by !== "string") fail(`areas.grow: by is a length like "0.5mm", got ${describe(by)}`);
      return make(Area, "areas", { tools_grow: { of: need(of, Area, "areas.grow"), by } });
    },
  };

  const engine = {
    frame() { return make(Area, "areas", { engine_frame: {} }); },
    ocean() { return make(Area, "areas", { engine_ocean: {} }); },
  };

  const lines = {
    rings(of, options = {}) {
      object(options, "lines.rings options");
      return make(Lines, "lines", {
        tools_rings: { of: need(of, Area, "lines.rings"), exterior_only: !!options.exteriorOnly },
      });
    },
    of(features) {
      return make(Lines, "lines", { tools_lines: need(features, Features, "lines.of") });
    },
    segments(features) {
      return make(Lines, "lines", { tools_segments: need(features, Features, "lines.segments") });
    },
    dedupe(of) {
      return make(Lines, "lines", { tools_dedupe: need(of, Lines, "lines.dedupe") });
    },
    merge(of) {
      return make(Lines, "lines", { tools_merge: need(of, Lines, "lines.merge") });
    },
    join(...inputs) {
      const refs = many(inputs, Lines, "lines.join");
      if (!refs.length) fail("lines.join needs at least one set of lines");
      return make(Lines, "lines", { tools_join: refs });
    },
    clip(of, within, options = {}) {
      object(options, "lines.clip options");
      return make(Lines, "lines", {
        tools_clip: {
          lines: need(of, Lines, "lines.clip"),
          within: need(within, Area, "lines.clip within"),
          invert: !!options.invert,
        },
      });
    },
    // Pen-and-ink terrain, drawn by burin from the elevation under the output:
    // streamlines along the slope, coloured and weighted per dash. The colour
    // and the width are burin's own trees (`shade`/`width`), so the same
    // expressions that style a batch at burin's front ends work here.
    //
    // `draw: "fill"` with a `where` band makes a contour belt; `lines.contours`
    // below is the shorthand for a loop over them.
    terrain(options = {}) {
      object(options, "lines.terrain options");
      const { in: area, color, width, angle, layer, shore, style, where, draw, ...rest } = options;
      const op = { tools_terrain: {} };
      if (area !== undefined) op.tools_terrain.in_area = need(area, Area, "lines.terrain in");
      if (color !== undefined) op.tools_terrain.color = color;
      if (width !== undefined) op.tools_terrain.width = width;
      if (angle !== undefined) op.tools_terrain.angle = angle;
      if (layer !== undefined) op.tools_terrain.layer = layer;
      if (shore !== undefined) op.tools_terrain.shore = !!shore;
      if (draw !== undefined) {
        if (draw !== "lines" && draw !== "fill" && draw !== "dots") {
          throw new Error(`lines.terrain draw must be "lines", "fill" or "dots", not ${JSON.stringify(draw)}`);
        }
        op.tools_terrain.draw = draw;
      }
      if (where !== undefined) {
        object(where, "lines.terrain where");
        const w = {};
        for (const k of ["elevMin", "elevMax", "depthMin", "depthMax"]) {
          if (where[k] !== undefined) {
            if (typeof where[k] !== "number" || !isFinite(where[k])) {
              throw new Error(`lines.terrain where.${k} must be a number of metres`);
            }
            w[k] = where[k];
          }
        }
        if (Object.keys(w).length) op.tools_terrain.where = w;
      }
      // `style` and any other key are burin style parameters, by name.
      const params = { ...(style && typeof style === "object" ? style : {}), ...rest };
      if (Object.keys(params).length) op.tools_terrain.style = params;
      return make(Lines, "lines", op);
    },
    // One contour belt between two heights, as a flat fill: `lines.contours({
    // from: 200, to: 400 })`. Call it in a loop to stack the belts.
    contours(options = {}) {
      object(options, "lines.contours options");
      const { from, to, ...rest } = options;
      const where = { ...(rest.where || {}) };
      if (from !== undefined) where.elevMin = from;
      if (to !== undefined) where.elevMax = to;
      return this.terrain({ ...rest, where, draw: "fill" });
    },
  };

  // A burin document, written here: burin's own language, as a first-class
  // citizen. The callback is a real function and runs in this same engine, so
  // it is linted, completed and its errors carry this script's positions.
  //
  //   const natural = burin.terrain((b) => {
  //     b.batch({ angle: 90, style: { space: 3, space_dark: 0.8 } })
  //     b.water("dots", { follow: "shore", style: { space: 10, space_dark: 0.3 } })
  //     b.shore({ lines: 2 })
  //   })
  //
  // The atlas is built now and drawn later by the engine, over the elevation
  // the host fetched: no geometry crosses the script, and nothing is a string.
  const burin = {
    terrain(build, options = {}) {
      if (typeof build !== "function") {
        fail(`burin.terrain expects a function: burin.terrain((b) => { … }), got ${describe(build)}`);
      }
      object(options, "burin.terrain options");
      const { in: area } = options;
      const op = { tools_burin: { atlas: dl.burin(build) } };
      // `in` clips the drawing to an area, like `lines.terrain`.
      if (area !== undefined) op.tools_burin.in_area = need(area, Area, "burin.terrain in");
      return make(Lines, "lines", op);
    },
  };
  // `burin.script` reads the same: a burin document, whatever it draws.
  burin.script = burin.terrain;

  const fills = {
    // A pattern from penfill, or `content`: lines made elsewhere (a burin
    // document, any `lines.*`) cut to the area, as its pattern.
    fill(spec) {
      object(spec, "fills.fill");
      const { in: area, per, content, ...rest } = spec;
      const op = { in: need(area, Area, "fills.fill in"), ...rest };
      if (per !== undefined) op.per = per;
      if (content !== undefined) op.content = need(content, Lines, "fills.fill content");
      return make(Lines, "fills", { tools_fill: op });
    },
  };

  const modules = {
    roads(options = {}) {
      object(options, "modules.roads options");
      const op = {};
      if (options.from !== undefined) op.from = need(options.from, Features, "modules.roads from");
      const ref = dl.node("areas", { module_roads: op });
      const out = (name) => new Lines(`roads.${name}`, "roads");
      return Object.freeze({
        area: new Area(ref, "roads.area"),
        outlines: out("outlines"),
        details: out("details"),
        trails: out("trails"),
        centerlines: out("centerlines"),
        seams: out("seams"),
      });
    },
  };

  function drawRef(from) {
    if (!(from instanceof Lines)) fail(`draw: from expects ${wants.get(Lines)}, got ${describe(from)}`);
    return from.ref;
  }

  function draw(spec) {
    object(spec, "draw");
    const { id, from, stroke, ...rest } = spec;
    const extra = Object.keys(rest);
    if (extra.length) fail(`draw: unknown key ${extra[0]} (id, from, stroke)`);
    const entry = { from: drawRef(from) };
    if (id !== undefined) entry.id = String(id);
    if (stroke !== undefined) entry.stroke = stroke;
    return dl.draw(entry);
  }

  const ids = (args) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(String);

  const compose = {
    order(...order) { dl.order(ids(order)); },
    mask(spec) {
      object(spec, "compose.mask");
      const { name, from, occludes = [] } = spec;
      if (!(from instanceof Area)) fail(`compose.mask: from expects ${wants.get(Area)}, got ${describe(from)}`);
      if (!Array.isArray(occludes)) fail(`compose.mask: occludes is a list of draw ids, got ${describe(occludes)}`);
      dl.mask({ name: name === undefined ? null : String(name), from: from.mask, occludes: occludes.map(String) });
    },
    clip(value) {
      if (value === "auto" || value === "none") return dl.clip(value);
      if (Array.isArray(value)) return dl.clip(value.map((a) => need(a, Area, "compose.clip")));
      fail(`compose.clip expects "auto", "none" or a list of areas, got ${describe(value)}`);
    },
  };

  function output(spec) { dl.output(object(spec, "output")); }
  function title(text) {
    if (typeof text !== "string") fail(`title expects a string, got ${describe(text)}`);
    dl.title(text);
  }

  const lib = { features, areas, engine, lines, fills, burin, modules, draw, compose, output, title };
  for (const [name, value] of Object.entries(lib)) {
    if (typeof value === "object") Object.freeze(value);
    Object.defineProperty(globalThis, name, { value, enumerable: false, writable: false, configurable: false });
  }
})(globalThis.__drawland);
delete globalThis.__drawland;
