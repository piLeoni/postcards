# G-code export handoff — H-Bot drawing machine (FluidNC)

Pass this to the SVG/G-code export agent. Target controller: **FluidNC v4 on MKS TinyBee** (Grbl dialect), **not** Marlin.

Config source of truth: `example_configs/config.yaml` (upload to board after changes).

**Do not hand-patch bad exports.** Fix the generator so every file is correct on the first write.

---

## 1. Machine geometry (hard limits)

| Axis | Allowed range after home | Home switch | Machine pos at switch |
|------|--------------------------|-------------|------------------------|
| **X** | **0 … 200 mm** | Min / negative end | **X = 0** |
| **Y** | **0 … 140 mm** | Max / positive end | **Y = 140** |
| **Z** | **0 … 6 mm** | Top (pen up) | **Z = 6** |

- Soft limits are **OFF**. Any X/Y/Z outside that box will **drive into the frame** and skip steps.
- After home, carriage is at about **`(0, 140, 6)`** — that is the **top-left** of the usable sheet (X min, Y max), pen up.
- Kinematics: CoreXY (export still emits normal Cartesian X/Y).

### Y placement (this bit was wrong before)

**The top of the artwork must sit on Y = 140** (the home edge).  
**Not** pushed down to Y≈0. “South” = decreasing Y.

After scaling the drawing to fit width/height inside 200×140:

1. Let content bbox after scale be `xmin..xmax`, `ymin..ymax` (in machine mm).
2. **Anchor top to home:**
   ```text
   Y_out = Y_scaled - ymax + 140
   ```
   so `ymax → 140` and the drawing hangs downward toward smaller Y.
3. **Anchor left to X home (optional but preferred):**
   ```text
   X_out = X_scaled - xmin + 0
   ```
   so `xmin → 0`. Or center in X if desired, but keep all X in [0, 200].
4. **Validate:** every point must satisfy `0 ≤ X ≤ 200`, `0 ≤ Y ≤ 140`.
5. **Never** emit negative Y. A “fix” that did `Y_old - 280` produced Y∈[-137,-41] and crashed the same way as Y>140.

Wrong: shift so `ymin → 0` (drawing sits at the bottom / too south).  
Right: shift so `ymax → 140` (drawing top on the Y home rail).

---

## 2. Pen up / down

| Action | Command |
|--------|---------|
| Pen up | `G0 Z4` (3–5 OK; ≤ 6) |
| Pen down | `G0 Z0` |

Do **not** use `M3`/`M5`/`M4` or long `G4` dwells for pen.

---

## 3. Homing — **include at the start of every job file**

On FluidNC, `$H` **blocks until homing finishes**, so it **is** valid at the top of an SD job (unlike many generic senders / Marlin assumptions).

Homing cycles in config (after update): **Z cycle 1 → X cycle 2 → Y cycle 3**.

**Required file preamble:**

```gcode
G21
G90
G94
G10 L2 P1 X0 Y0 Z0
G92.1
$HZ
$H
G0 Z4
```

Notes:

- `G10 L2 P1 X0 Y0 Z0` + `G92.1` clears stale work offsets (G54 junk caused “homes but still goes to −350”).
- `$HZ` then `$H` homes Z, then X, then Y (with Z in cycle 1, `$H` alone also homes Z→X→Y; keeping `$HZ` first is extra-safe).
- **Do not use Marlin `G28` for switch homing.** FluidNC `G28` = go to stored park only.
- After this preamble, machine coords are X≈0, Y≈140, Z≈6 (then pen-up Z4). Drawing moves are absolute in that frame.

---

## 4. Feeds

- Draw: **`F3000`–`F4000`** is fine **if** paths are simplified (see below).
- XY machine max is 12000 mm/min; the limiter is ESP32 planner load, not the stepper ceiling.
- Travels: `G0` (no feed needed).
- Avoid `F5000+` combined with tens of thousands of sub‑0.1 mm segments.

---

## 5. Path quality (required — this is what killed “simple” drawings)

| Rule | Target |
|------|--------|
| Simplify | Douglas–Peucker / equivalent, tolerance **0.2–0.5 mm** |
| Min segment | Merge/drop moves **&lt; 0.2 mm**; drop exact duplicate consecutive points |
| Arcs | **No `G2`/`G3`** unless rare and large-R; prefer G1 only |
| Line count | Prefer **&lt; 15k** motion lines for a full page; denser → crash/hang on ESP32 |
| Bed | All coords inside **X[0,200] Y[0,140] Z[0,6]** |

Density, not “visual complexity,” crashes FluidNC. Marlin-on-printer can eat denser files; this ESP32 + 16 planner blocks cannot.

---

## 6. Required file skeleton (generator must emit this)

```gcode
G21
G90
G94
G10 L2 P1 X0 Y0 Z0
G92.1
$HZ
$H
G0 Z4
; --- path ---
G0 X... Y...          ; first point; Y near 140 if path starts at top of art
G0 Z0
G1 X... Y... F3500
...
G0 Z4
; more paths...
G0 Z4
```

Run from **SD** (`$SD/Run=/job.gcode`), not WebUI streaming, when files are large.

---

## 7. Failure examples (generator regressions to avoid)

| Bad export | What was wrong |
|------------|----------------|
| Y up to ~238 | Past bed → slam |
| Y ∈ [-137, -41] | Negative Y → slam the other way; top not at 140 |
| Top of art at Y≈95 after “fix” | Anchored to Y=0 instead of Y=140 → drawing too south |
| ~13k tiny G2/G3 @ F5000 | Planner/watchdog crash |
| 20k+ G1 crumbs + duplicate zeros | Still overload |
| M3/M5 + G4 pen | Wrong pen model for this machine |
| Missing offset clear | Stale G54 → huge W coordinates |

---

## 8. Checklist (export agent)

- [ ] Scale art to fit inside **200 × 140**
- [ ] **`Y_out = Y - ymax + 140`** (top of art on Y=140)
- [ ] **`X_out`** so all X ∈ [0, 200] (prefer xmin → 0)
- [ ] Assert no negative X/Y; no Y>140; no X>200
- [ ] Preamble: units + **clear G54** + **`$HZ` + `$H`** + pen up
- [ ] Pen: **Z4 / Z0** only
- [ ] G1-only, simplified, no dup/zero crumbs
- [ ] Draw feed **F3000–F4000**
- [ ] No Marlin `G28` as home; no `G10 L20` unless user asked for a custom origin

---

## 9. One-line summary

**Every job file: clear offsets, `$HZ`/`$H`, pen Z4/Z0, absolute mm, art top on Y=140, all points inside 200×140×6, sparse G1 at F3500 — generate it right; do not hand-fix.**
