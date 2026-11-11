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

  /** Draw.land Hershey id (`"futural"`) or `{ origin: "drawland" | "stroke" | "google", … }`. */
  function labelFont(font, where) {
    if (typeof font === "string") {
      if (!font) fail(`${where}: font id is a non-empty string`);
      return font;
    }
    const o = object(font, where);
    if (o.origin === "drawland") {
      if (typeof o.id !== "string" || !o.id) fail(`${where}: drawland font needs id`);
      const out = { origin: "drawland", id: o.id };
      if (o.url != null) {
        if (typeof o.url !== "string" || !o.url) fail(`${where}: drawland font url is a non-empty string`);
        out.url = o.url;
      }
      return out;
    }
    if (o.origin === "stroke") {
      if (typeof o.url !== "string" || !o.url) fail(`${where}: stroke font needs url`);
      return { origin: "stroke", url: o.url };
    }
    if (o.origin === "google") {
      const { family, weight = 400, italic = false } = o;
      if (typeof family !== "string" || !family) fail(`${where}: google font needs family`);
      if (typeof weight !== "number" || !Number.isFinite(weight)) {
        fail(`${where}: google font weight is a number, got ${describe(weight)}`);
      }
      const out = { origin: "google", family, weight: Math.round(weight) };
      if (italic) out.italic = true;
      return out;
    }
    fail(`${where}: font origin is "drawland", "stroke", or "google"`);
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
    // Every feature of a GeoJSON dataset: a URL (fetched, cached) or a file
    // path beside the profile. Properties become tags, for `features.where`
    // and labels.
    // Points from plain JSON (a transit API, a feed): dot-paths to the items
    // and to each item's latitude and longitude. Every field of an item is a
    // tag under its dotted path, for `features.where`.
    //   features.json(url, { items: "data", lat: "attributes.latitude", lng: "attributes.longitude" })
    json(url, paths) {
      if (typeof url !== "string" || !url.trim()) fail(`features.json takes a URL or a file path, got ${describe(url)}`);
      object(paths, "features.json paths");
      for (const k of ["lat", "lng"]) {
        if (typeof paths[k] !== "string" || !paths[k]) fail(`features.json needs ${k}, the dot-path to each item's ${k === "lat" ? "latitude" : "longitude"}`);
      }
      if (paths.items != null && typeof paths.items !== "string") fail("features.json items is a dot-path, like \"data\"");
      const extra = Object.keys(paths).filter((k) => !["items", "lat", "lng"].includes(k));
      if (extra.length) fail(`features.json: unknown key ${extra[0]} (items, lat, lng)`);
      return make(Features, "features", { data_select: { json: { url: url.trim(), items: paths.items ?? "", lat: paths.lat, lng: paths.lng } } });
    },
    // Or GeoJSON written in the profile: a graticule, a route, points of its own.
    geojson(source) {
      if (source !== null && typeof source === "object" && !Array.isArray(source)) {
        if (typeof source.type !== "string") fail("features.geojson: an inline object is GeoJSON, with a type");
        return make(Features, "features", { data_select: { geojson: source } });
      }
      if (typeof source !== "string" || !source.trim()) fail(`features.geojson takes a URL, a file path, or a GeoJSON object, got ${describe(source)}`);
      return make(Features, "features", { data_select: source.trim() });
    },
    // The features whose tags pass every test: a value, a list, true/false,
    // or `{ min, max }` on a number (`min` included, `max` not).
    where(of, tags) {
      const ref = need(of, Features, "features.where");
      object(tags, "features.where tags");
      if (!Object.keys(tags).length) fail("features.where needs at least one tag");
      for (const [k, v] of Object.entries(tags)) {
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          const extra = Object.keys(v).filter((b) => b !== "min" && b !== "max");
          if (extra.length || !Object.keys(v).length) fail(`features.where: ${k} takes { min, max }, got ${JSON.stringify(v)}`);
          for (const b of ["min", "max"]) {
            if (v[b] !== undefined && (typeof v[b] !== "number" || !isFinite(v[b]))) {
              fail(`features.where: ${k}.${b} must be a number, got ${describe(v[b])}`);
            }
          }
        }
      }
      return make(Features, "features", { tools_where: { of: ref, tags } });
    },
  };

  // Ink worked out from data: a colour or a width at `t`, 0 to 1, for a
  // stroke's `color` and `width`.
  const mm = (v, where) => {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\s*[\d.]+\s*mm\s*$/.test(v) ? parseFloat(v) : NaN;
    if (!isFinite(n)) fail(`${where} is a length in millimetres like 0.3 or "0.3mm", got ${describe(v)}`);
    return n;
  };
  // A shape written in the profile: `at` is `[x, y]` on the page (lengths or
  // "50%") or `{ lat, lng }` on the ground; the outline is a `circle` radius,
  // a `rect: [w, h]`, a regular polygon `{ sides, r }`, or `points: [[dx, dy], …]`
  // in mm from `at`. `rotate` turns it clockwise, in degrees.
  const shapeOp = (spec, where) => {
    object(spec, where);
    const at = spec.at ?? ["50%", "50%"];
    const ring = (n, r, start) =>
      Array.from({ length: n }, (_, i) => {
        const t = start + (2 * Math.PI * i) / n;
        return [r * Math.cos(t), r * Math.sin(t)];
      });
    let points;
    if (spec.circle != null) points = ring(64, mm(spec.circle, `${where}.circle`), 0);
    else if (spec.sides != null) points = ring(spec.sides, mm(spec.r, `${where}.r`), -Math.PI / 2);
    else if (spec.rect != null) {
      const [w, h] = spec.rect.map((v, i) => mm(v, `${where}.rect[${i}]`) / 2);
      points = [[-w, -h], [w, -h], [w, h], [-w, h]];
    } else if (Array.isArray(spec.points)) points = spec.points;
    else fail(`${where} needs a circle, rect, sides + r, or points`);
    return { at, points, rotate: spec.rotate ?? 0 };
  };
  // A line of text centred on `at` (as for shapes); `size` is the capital
  // height; `font` as in `modules.labels`.
  const textOp = (spec, where) => {
    object(spec, where);
    if (typeof spec.text !== "string" || !spec.text) fail(`${where}.text is a string`);
    const op = { at: spec.at ?? ["50%", "50%"], text: spec.text, size: spec.size ?? "4mm", rotate: spec.rotate ?? 0 };
    if (spec.font != null) op.font = labelFont(spec.font, `${where}.font`);
    if (spec.counters != null) {
      if (spec.counters !== "open" && spec.counters !== "closed") fail(`${where}.counters is "open" or "closed", got ${describe(spec.counters)}`);
      if (spec.counters === "open") op.openCounters = true;
    }
    return op;
  };
  const unit = (t, where) => {
    if (typeof t !== "number" || isNaN(t)) fail(`${where}: t is a number from 0 to 1, got ${describe(t)}`);
    return Math.min(1, Math.max(0, t));
  };
  const rgb = (hex, where) => {
    const m = typeof hex === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) fail(`${where}: colours are "#rgb" or "#rrggbb", got ${describe(hex)}`);
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const ink = {
    // The colour at `t` along `stops`, evenly spaced: ink.ramp(["#fde68a", "#7c2d12"], 0.5).
    ramp(stops, t) {
      if (!Array.isArray(stops) || stops.length < 2) fail(`ink.ramp needs two colours or more, got ${describe(stops)}`);
      const cs = stops.map((s) => rgb(s, "ink.ramp"));
      const at = unit(t, "ink.ramp") * (cs.length - 1);
      const i = Math.min(cs.length - 2, Math.floor(at));
      const f = at - i;
      const mix = cs[i].map((a, k) => Math.round(a + (cs[i + 1][k] - a) * f));
      return "#" + mix.map((c) => c.toString(16).padStart(2, "0")).join("");
    },
    // The width at `t` between `thin` and `thick`: ink.width(0.1, 0.6, t) is "0.35mm" at the middle.
    width(thin, thick, t) {
      const a = mm(thin, "ink.width thin");
      const b = mm(thick, "ink.width thick");
      return `${+(a + (b - a) * unit(t, "ink.width")).toFixed(3)}mm`;
    },
    // Where `v` sits between `lo` and `hi`, as the 0 to 1 the others take.
    at(v, lo, hi) {
      if (![v, lo, hi].every((x) => typeof x === "number" && isFinite(x)) || lo === hi) {
        fail("ink.at takes three numbers, the value and two different ends");
      }
      return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    },
  };

  const areas = {
    // A band of the elevation as an area: everything between two heights, or
    // two depths below the sea — the belts an atlas tints. Fill it `solid`.
    //   areas.band({ elevMin: 200, elevMax: 500 })
    //   areas.band({ depthMin: 50 }, { water })
    band(where = {}, options = {}) {
      object(where, "areas.band");
      object(options, "areas.band options");
      const w = {};
      for (const k of ["elevMin", "elevMax", "depthMin", "depthMax"]) {
        if (where[k] !== undefined) {
          if (typeof where[k] !== "number" || !isFinite(where[k])) {
            throw new Error(`areas.band ${k} must be a number of metres`);
          }
          w[k] = where[k];
        }
      }
      const extra = Object.keys(where).filter((k) => !(k in w));
      if (extra.length) throw new Error(`areas.band: unknown key ${extra[0]} (elevMin, elevMax, depthMin, depthMax)`);
      const op = { tools_terrain_band: { where: w } };
      if (options.in !== undefined) op.tools_terrain_band.in_area = need(options.in, Area, "areas.band in");
      // Smoother edges than a hatching pass reads: belts, not pixels.
      op.tools_terrain_band.style = { input_blur: options.blur ?? 4, mod_wobble: 0 };
      // A depth band is a fill of the sea: burin fills land unless told so.
      if (w.depthMin !== undefined || w.depthMax !== undefined) op.tools_terrain_band.style.ground = "sea";
      return make(Area, "areas", op);
    },
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
    // A disc of radius `by` around every point feature (mapped trees),
    // merged into one area; lines and polygons in `of` are ignored.
    around(of, by) {
      if (typeof by !== "number" && typeof by !== "string") fail(`areas.around: by is a length like "2mm", got ${describe(by)}`);
      return make(Area, "areas", { tools_around: { of: need(of, Features, "areas.around"), by } });
    },
    shape(spec) {
      return make(Area, "areas", { tools_shape: shapeOp(spec, "areas.shape") });
    },
    // What `lines.text(spec)` covers: the letters, with their counters filled.
    text(spec) {
      return make(Area, "areas", { tools_text_area: textOp(spec, "areas.text") });
    },
    /**
     * Half-width buffer around lines, merged into one area. Joins are always
     * round; `options.cap` is `"round"` (default) or `"flat"` (butt caps).
     */
    buffer(of, by, options = {}) {
      object(options, "areas.buffer options");
      if (typeof by !== "number" && typeof by !== "string") fail(`areas.buffer: by is a length like "0.2mm", got ${describe(by)}`);
      const op = { tools_buffer_lines: { lines: need(of, Lines, "areas.buffer"), by } };
      if (options.cap !== undefined) {
        if (options.cap !== "round" && options.cap !== "flat") {
          fail(`areas.buffer: cap is "round" or "flat", got ${describe(options.cap)}`);
        }
        if (options.cap === "flat") op.tools_buffer_lines.cap = "flat";
      }
      return make(Area, "areas", op);
    },
    /**
     * Close the thin gaps (up to `gapMm`, 1 mm by default) between `of` and
     * the edges of `within`, where vector tiles stop just short of them.
     */
    extendToFrame(of, within, options = {}) {
      object(options, "areas.extendToFrame options");
      const op = { tools_extend_to_frame: { of: need(of, Area, "areas.extendToFrame"), within: need(within, Area, "areas.extendToFrame within") } };
      if (options.gapMm != null) op.tools_extend_to_frame.gap_mm = options.gapMm;
      return make(Area, "areas", op);
    },
  };

  const oceanFromTiles = () => {
    const frame = engine.frame();
    const raw = areas.intersect(areas.polygons(features.tiles("ocean")), frame);
    return areas.extendToFrame(areas.grow(raw, "0.35mm"), frame);
  };

  const engine = {
    frame() { return make(Area, "areas", { engine_frame: {} }); },
    /** Open sea from vector tiles, grown to the card edge. Prefer explicit `features.tiles("ocean")` + `areas.extendToFrame`. */
    ocean() { return oceanFromTiles(); },
    // The scale denominator of this script's `output` (10000 for "1:10000"):
    // to size things on the ground, `metres * 1000 / engine.scale()` mm.
    scale() {
      if (outputScale == null) fail("engine.scale(): call output({ scale }) first");
      return outputScale;
    },
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
    // Same shapes as `areas.shape`, as a stroke; `points` stay open unless `closed: true`.
    shape(spec) {
      const op = shapeOp(spec, "lines.shape");
      op.closed = spec.points == null || !!spec.closed;
      return make(Lines, "lines", { tools_path: op });
    },
    text(spec) {
      return make(Lines, "lines", { tools_text: textOp(spec, "lines.text") });
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
      const { in: area, regions, water } = options;
      const op = { tools_burin: { atlas: dl.burin(build) } };
      // `in` clips the drawing to an area, like `lines.terrain`.
      if (area !== undefined) op.tools_burin.in_area = need(area, Area, "burin.terrain in");
      if (regions !== undefined) {
        object(regions, "burin.terrain regions");
        const named = {};
        for (const [name, reg] of Object.entries(regions)) {
          named[name] = need(reg, Area, `burin.terrain regions.${name}`);
        }
        op.tools_burin.regions = named;
      }
      // `water` tells burin where the sea and lakes are, instead of guessing
      // from the elevation (which misses the sea in detailed terrain tiles).
      if (water !== undefined) op.tools_burin.water = need(water, Area, "burin.terrain water");
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
    // What a fill with the same options covers on paper: the area itself for
    // most patterns; for isoline-blobs / isoline-stack their footprint, so a
    // mask hides only what lies under the foliage.
    cover(spec) {
      object(spec, "fills.cover");
      const { in: area, per, content, ...rest } = spec;
      if (per !== undefined || content !== undefined) fail("fills.cover: takes a pattern, not per or content");
      return make(Area, "areas", { tools_fill_cover: { in: need(area, Area, "fills.cover in"), ...rest } });
    },
  };

  const ROAD_OPT_KEYS = {
    widthMode: "width_mode",
    widthMultiplier: "width_multiplier",
    useWidthTag: "use_width_tag",
    multiplyByLanes: "multiply_by_lanes",
    inferLanesByClass: "infer_lanes_by_class",
    centerlineMinWidth: "centerline_min_width",
    jointClose: "joint_close",
    clearance: "clearance",
    classes: "classes",
  };
  const ROAD_CLASS_KEYS = {
    ground: "ground",
    paper: "paper",
    width: "width",
    lanes: "lanes",
    centerline: "centerline",
    singleLine: "single_line",
    clearance: "clearance",
  };
  function roadMeasure(v, where) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && (keys[0] === "ground" || keys[0] === "paper") && typeof v[keys[0]] === "number" && Number.isFinite(v[keys[0]])) {
        return { [keys[0]]: v[keys[0]] };
      }
    }
    fail(`${where} expects a number or { ground: number } / { paper: number }, got ${describe(v)}`);
  }

  const modules = {
    roads(options = {}) {
      object(options, "modules.roads options");
      const allowed = ["from", ...Object.keys(ROAD_OPT_KEYS)];
      const op = {};
      for (const [k, v] of Object.entries(options)) {
        if (v === undefined) continue;
        if (k === "from") {
          op.from = need(v, Features, "modules.roads from");
        } else if (k === "widthMode") {
          if (v !== "ground" && v !== "paper") fail(`modules.roads widthMode expects "ground" or "paper", got ${describe(v)}`);
          op.width_mode = v;
        } else if (k === "widthMultiplier") {
          if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) fail(`modules.roads widthMultiplier expects a positive number, got ${describe(v)}`);
          op.width_multiplier = v;
        } else if (k === "useWidthTag" || k === "multiplyByLanes" || k === "inferLanesByClass") {
          op[ROAD_OPT_KEYS[k]] = !!v;
        } else if (k === "centerlineMinWidth" || k === "jointClose" || k === "clearance") {
          op[ROAD_OPT_KEYS[k]] = roadMeasure(v, `modules.roads ${k}`);
        } else if (k === "classes") {
          object(v, "modules.roads classes");
          const classes = {};
          for (const [cls, spec] of Object.entries(v)) {
            if (spec === undefined) continue;
            const cwhere = `modules.roads classes.${cls}`;
            if (typeof spec === "number" && Number.isFinite(spec)) {
              classes[cls] = spec;
            } else {
              object(spec, cwhere);
              const entry = {};
              const classAllowed = Object.keys(ROAD_CLASS_KEYS);
              for (const [ck, cv] of Object.entries(spec)) {
                if (cv === undefined) continue;
                if (!(ck in ROAD_CLASS_KEYS)) fail(`${cwhere}: unknown key ${ck} (${classAllowed.join(", ")})`);
                if (ck === "ground" || ck === "paper" || ck === "width") {
                  if (typeof cv !== "number" || !Number.isFinite(cv)) fail(`${cwhere}.${ck} expects a number, got ${describe(cv)}`);
                  entry[ROAD_CLASS_KEYS[ck]] = cv;
                } else if (ck === "lanes") {
                  if (typeof cv !== "number" || !Number.isFinite(cv) || cv <= 0) fail(`${cwhere}.lanes expects a positive number, got ${describe(cv)}`);
                  entry.lanes = cv;
                } else if (ck === "centerline" || ck === "singleLine") {
                  entry[ROAD_CLASS_KEYS[ck]] = !!cv;
                } else if (ck === "clearance") {
                  entry.clearance = roadMeasure(cv, `${cwhere}.clearance`);
                }
              }
              classes[cls] = entry;
            }
          }
          op.classes = classes;
        } else {
          fail(`modules.roads: unknown option ${k} (${allowed.join(", ")})`);
        }
      }
      const ref = dl.node("areas", { module_roads: op });
      const out = (name) => new Lines(`roads.${name}`, "roads");
      return Object.freeze({
        area: new Area(ref, "roads.area"),
        outlines: out("outlines"),
        details: out("details"),
        trails: out("trails"),
        centerlines: out("centerlines"),
        seams: out("seams"),
        rails: out("rails"),
      });
    },
    // An atlas plate's graticule round the page rectangle `in` (its bounds):
    // meridians and parallels every `step` minutes of arc, a border band of
    // black-and-white keys every `ticks` minutes just outside it, and the
    // degree labels beyond the band. Found through the output's projection,
    // so it stays true wherever the plate is moved.
    graticule(options = {}) {
      object(options, "modules.graticule options");
      const { in: inArea, step, ticks, band, gap, size, font, ...rest } = options;
      const extra = Object.keys(rest);
      if (extra.length) fail(`modules.graticule: unknown option ${extra[0]} (in, step, ticks, band, gap, size, font)`);
      const within = need(inArea, Area, "modules.graticule in");
      if (typeof step !== "number" || !(step > 0)) fail(`modules.graticule: step is minutes of arc between lines, got ${describe(step)}`);
      if (ticks !== undefined && (typeof ticks !== "number" || ticks < 0)) fail(`modules.graticule: ticks is minutes of arc per border key, got ${describe(ticks)}`);
      const look = { in: within, step };
      if (ticks !== undefined) look.ticks = ticks;
      if (band !== undefined) look.band = band;
      if (gap !== undefined) look.gap = gap;
      if (size !== undefined) look.size = size;
      if (font !== undefined) look.font = labelFont(font, "modules.graticule font");
      const memo = {};
      const part = (kind, p) => {
        const k = `${kind === Lines ? "lines" : "area"}:${p}`;
        if (!memo[k]) {
          memo[k] = kind === Lines
            ? make(Lines, "lines", { tools_graticule: { ...look, part: p } })
            : make(Area, "areas", { tools_graticule_area: { ...look, part: p } });
        }
        return memo[k];
      };
      return Object.freeze({
        get lines() { return part(Lines, "grid"); },
        get keys() { return part(Area, "keys"); },
        get labels() { return part(Lines, "labels"); },
        get labelArea() { return part(Area, "labels"); },
      });
    },
    // Names written on the map, placed so that none covers another: along
    // the roads (bent with them where they curve), level inside areas, larger
    // the more the feature matters. Geometry only: `lines` are the letters'
    // strokes, `area` what they cover, for fills.fill, masks and the rest.
    labels(options = {}) {
      object(options, "modules.labels options");
      const { from, in: inArea, avoid, keys, rules, ...rest } = options;
      const sets = Array.isArray(from) ? from : [from];
      if (!sets.length) fail("modules.labels: from needs at least one feature set");
      const op = {
        from: sets.map((f, i) => need(f, Features, sets.length > 1 ? `modules.labels from (input ${i + 1})` : "modules.labels from")),
        ...labelLook(rest, "modules.labels", "option", ["from", "in", "avoid", "keys", "rules"]),
      };
      if (inArea !== undefined) op.in = need(inArea, Area, "modules.labels in");
      if (avoid !== undefined) op.avoid = need(avoid, Area, "modules.labels avoid");
      if (keys !== undefined) {
        const ks = Array.isArray(keys) ? keys : [keys];
        if (!ks.length || !ks.every((k) => typeof k === "string")) fail(`modules.labels: keys is a tag or a list of tags, got ${describe(keys)}`);
        op.keys = ks;
      }
      if (rules !== undefined) {
        if (!Array.isArray(rules) || !rules.length) fail(`modules.labels: rules is a non-empty list, got ${describe(rules)}`);
        const seen = new Set();
        op.rules = rules.map((rule, i) => {
          const where = `modules.labels rules[${i}]`;
          const { tags, id, ...look } = object(rule, where);
          object(tags, `${where}.tags`);
          if (!Object.keys(tags).length) fail(`${where}.tags needs at least one tag`);
          const entry = { tags, ...labelLook(look, where, "key", ["tags", "id"]) };
          if (id !== undefined) {
            if (typeof id !== "string" || !/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(id)) {
              fail(`${where}: id is a name (letters, digits, underscore), got ${describe(id)}`);
            }
            if (seen.has(id)) fail(`modules.labels: duplicate rule id ${id}`);
            seen.add(id);
            entry.id = id;
          }
          return entry;
        });
      }
      const ref = dl.node("lines", { tools_labels: op });
      let area = null;
      const pick = (rule) => (rule ? { of: ref, rule } : ref);
      const bucket = (id) => {
        const p = pick(id);
        let lines = null;
        let bucketArea = null;
        return Object.freeze({
          get lines() { return lines || (lines = make(Lines, "lines", { tools_label_lines: p })); },
          get area() { return bucketArea || (bucketArea = make(Area, "areas", { tools_label_area: p })); },
        });
      };
      const out = {
        lines: new Lines(ref),
        get area() { return area || (area = make(Area, "areas", { tools_label_area: pick() })); },
      };
      for (const rule of op.rules || []) {
        if (rule.id) out[rule.id] = bucket(rule.id);
      }
      return Object.freeze(out);
    },
  };

  // What a label looks like, as `modules.labels` and each of its rules write
  // it, in the graph's names.
  const LOOK = { size: "size", minSize: "min_size", padding: "padding", spacing: "spacing", curved: "curved", upper: "upper", font: "font", buffer: "buffer", bufferStep: "buffer_step", keepCenterline: "keep_centerline", marker: "marker" };
  function labelLook(look, where, what, others) {
    const out = {};
    for (const [k, v] of Object.entries(look)) {
      if (!(k in LOOK)) fail(`${where}: unknown ${what} ${k} (${[...others, ...Object.keys(LOOK)].join(", ")})`);
      if (v === undefined) continue;
      if (k === "font") out.font = labelFont(v, `${where} font`);
      else if (k === "curved" || k === "upper" || k === "keepCenterline") out[LOOK[k]] = !!v;
      else if (k === "buffer") {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`${where}: buffer is a non-negative integer, got ${describe(v)}`);
        out.buffer = v;
      } else out[LOOK[k]] = v;
    }
    return out;
  }

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

  const isLengthValue = (v) =>
    typeof v === "number" ||
    (typeof v === "string" && /^-?\d+(\.\d+)?\s*(mm|cm|in|pt|px)?$/i.test(v.trim()));

  const DIRECTION_PRESETS = new Set([
    "lr", "left-to-right", "e", "east",
    "tl-br", "nw-se", "se", "southeast",
    "tb", "top-to-bottom", "s", "south",
    "tr-bl", "ne-sw", "sw", "southwest",
    "rl", "right-to-left", "w", "west",
    "br-tl", "se-nw", "nw", "northwest",
    "bt", "bottom-to-top", "n", "north",
    "bl-tr", "sw-ne", "ne", "northeast",
  ]);
  const isDirectionValue = (v) =>
    (typeof v === "number" && Number.isFinite(v)) ||
    (typeof v === "string" && DIRECTION_PRESETS.has(v.trim().toLowerCase()));

  function parseOptimize(name, a, b, shorthandKey, keyMap, isShorthand = isLengthValue) {
    const where = `compose.${name}`;
    let layers = [];
    let rawOpts = undefined;
    if (a === undefined) {
      rawOpts = b;
    } else if (Array.isArray(a)) {
      layers = a.map(String);
      rawOpts = b;
    } else if (typeof a === "object" && a !== null) {
      if (b !== undefined) fail(`${where}: unexpected second argument when first is options`);
      rawOpts = a;
    } else if (typeof a === "string" || typeof a === "number") {
      if (b !== undefined) {
        if (typeof a !== "string") fail(`${where}: layers expects a draw id or list of draw ids, got ${describe(a)}`);
        layers = [a];
        rawOpts = b;
      } else if (shorthandKey && isShorthand(a)) {
        rawOpts = { [shorthandKey]: a };
      } else if (typeof a === "string") {
        layers = [a];
      } else {
        fail(`${where}: unexpected ${describe(a)}`);
      }
    } else {
      fail(`${where}: unexpected ${describe(a)}`);
    }

    const spec = {};
    let except = [];
    if (rawOpts !== undefined) {
      if (shorthandKey && isShorthand(rawOpts)) {
        spec[keyMap[shorthandKey]] = rawOpts;
      } else {
        object(rawOpts, where);
        const allowed = [...Object.keys(keyMap), "except"];
        for (const [k, v] of Object.entries(rawOpts)) {
          if (k === "except") {
            if (v !== undefined) {
              if (!Array.isArray(v)) fail(`${where}: except is a list of draw ids, got ${describe(v)}`);
              except = v.map(String);
            }
          } else if (k in keyMap) {
            if (v !== undefined) spec[keyMap[k]] = v;
          } else {
            fail(`${where}: unknown key ${k} (${allowed.join(", ")})`);
          }
        }
      }
    }
    const step = { [name]: spec };
    if (layers.length) step.layers = layers;
    if (except.length) step.except = except;
    dl.optimize(step);
  }

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
    deoverlap(a, b) {
      parseOptimize("deoverlap", a, b, "tolerance", {
        tolerance: "tolerance",
        selfOverlap: "self_overlap",
        acrossLayers: "across_layers",
        angle: "angle",
        prefer: "prefer",
        minLength: "min_length",
        drop: "drop",
      });
    },
    linemerge(a, b) {
      parseOptimize("linemerge", a, b, "tolerance", { tolerance: "tolerance" });
    },
    simplify(a, b) {
      parseOptimize("simplify", a, b, "tolerance", { tolerance: "tolerance" });
    },
    filter(a, b) {
      parseOptimize("filter", a, b, "minLength", { minLength: "min_length" });
    },
    reloop(a, b) {
      parseOptimize("reloop", a, b, null, {});
    },
    hand(a, b) {
      parseOptimize("hand", a, b, "preset", {
        preset: "preset",
        wobble: "wobble",
        wavelength: "wavelength",
        tremor: "tremor",
        bow: "bow",
        overshoot: "overshoot",
        close: "close",
        reach: "reach",
        corners: "corners",
        retrace: "retrace",
        retraceOffset: "retrace_offset",
        seed: "seed",
      }, (v) => v === "steady" || v === "sketch");
    },
    orient(a, b) {
      parseOptimize("orient", a, b, "direction", {
        direction: "direction",
        angle: "direction",
        maxLength: "max_length",
        splitReversals: "split_reversals",
      }, isDirectionValue);
    },
    linesort(a, b) {
      parseOptimize("linesort", a, b, "direction", {
        twoOpt: "two_opt",
        passes: "passes",
        follow: "follow",
        direction: "direction",
        angle: "direction",
        maxLength: "max_length",
        splitReversals: "split_reversals",
      }, isDirectionValue);
    },
  };

  // The scale the script's own `output` asked for, for sizes on the ground.
  let outputScale = null;
  const scaleOf = (s) => {
    const n = typeof s === "number" ? s : typeof s === "string" ? Number(s.trim().replace(/^1\s*:\s*/, "")) : NaN;
    return isFinite(n) && n > 0 ? n : null;
  };
  function output(spec) {
    object(spec, "output");
    // Inside a view the view's place wins: read the scale back from the
    // output as it will be.
    const effective = dl.output(spec);
    outputScale = scaleOf(effective?.scale) ?? scaleOf(spec.scale) ?? outputScale;
  }
  // Another place, at its own scale, drawn into a rectangle of this page:
  //   view({ id: "beach", at: [0, 0], size: [74, 50], lat, lng, scale: "1:6000" }, "city-grain")
  //   view({ id: "park", … }, () => { draw({ … }) })
  // `at` and `size` are in page millimetres. The style is a built-in preset
  // by name, or a function whose calls build the view's own graph. Returns
  // the view's id, for `compose.mask({ occludes: [id] })` on the page.
  function view(spec, style) {
    object(spec, "view");
    if (typeof spec.id !== "string" || !spec.id) fail("view needs an id, a name for it");
    if (typeof style === "string") return dl.viewPreset(spec, style);
    if (typeof style !== "function") fail(`view: the style is a preset name ("city-grain") or a function that draws, got ${describe(style)}`);
    const outer = outputScale;
    outputScale = scaleOf(spec.scale) ?? outer;
    dl.viewBegin(spec);
    let ok = false;
    try {
      style();
      ok = true;
    } finally {
      outputScale = outer;
      dl.viewEnd(ok);
    }
    return spec.id;
  }
  function title(text) {
    if (typeof text !== "string") fail(`title expects a string, got ${describe(text)}`);
    dl.title(text);
  }

  const lib = { features, areas, engine, lines, fills, burin, ink, modules, draw, compose, output, title, view };
  for (const [name, value] of Object.entries(lib)) {
    if (typeof value === "object") Object.freeze(value);
    Object.defineProperty(globalThis, name, { value, enumerable: false, writable: false, configurable: false });
  }
})(globalThis.__drawland);
delete globalThis.__drawland;
