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

  /** Draw.land Hershey id (`"futural"`) or `{ origin: "drawland" | "google", … }`. */
  function labelFont(font, where) {
    if (typeof font === "string") {
      if (!font) fail(`${where}: font id is a non-empty string`);
      return font;
    }
    const o = object(font, where);
    if (o.origin === "drawland") {
      if (typeof o.id !== "string" || !o.id) fail(`${where}: drawland font needs id`);
      return { origin: "drawland", id: o.id };
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
    fail(`${where}: font origin is "drawland" or "google"`);
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
    if (spec.font != null) op.font = spec.font;
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
      const { in: area, regions } = options;
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
        rails: out("rails"),
      });
    },
    // Names written on the map, placed so that none covers another: along
    // the roads (bent with them where they curve), level inside areas, larger
    // the more the feature matters. Geometry only: `lines` are the letters'
    // strokes, `area` what they cover, for fills.fill, masks and the rest.
    labels(options = {}) {
      object(options, "modules.labels options");
      const { from, keys, rules, ...rest } = options;
      const sets = Array.isArray(from) ? from : [from];
      if (!sets.length) fail("modules.labels: from needs at least one feature set");
      const op = {
        from: sets.map((f, i) => need(f, Features, sets.length > 1 ? `modules.labels from (input ${i + 1})` : "modules.labels from")),
        ...labelLook(rest, "modules.labels", "option", ["from", "keys", "rules"]),
      };
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
  const LOOK = { size: "size", minSize: "min_size", padding: "padding", spacing: "spacing", curved: "curved", upper: "upper", font: "font", buffer: "buffer", bufferStep: "buffer_step", keepCenterline: "keep_centerline" };
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

  const lib = { features, areas, engine, lines, fills, burin, ink, modules, draw, compose, output, title };
  for (const [name, value] of Object.entries(lib)) {
    if (typeof value === "object") Object.freeze(value);
    Object.defineProperty(globalThis, name, { value, enumerable: false, writable: false, configurable: false });
  }
})(globalThis.__drawland);
delete globalThis.__drawland;
