# Fixes required — `1730_highland_pl_berkeley_ca_94709_.gcode`

This file is still wrong. Do **not** ship it. Apply every fix below in the **generator**.

## 1. Y is illegal (this is why it crashes)

- Current Y range: **-137 … -41**
- Required: **0 … 140**
- **22 730** moves have Y outside the bed

**Fix:** after scale, pin the **top** of the art to Y=140:

```text
Y_out = Y - ymax + 140
```

Then assert `0 ≤ Y_out ≤ 140` for every point.  
Negative Y is never OK. Y>140 is never OK.

## 2. Drawing sits too far south

Wrong: shift so bottom → Y=0.  
Right: shift so **top → Y=140** (formula above).

Home corner is `(X=0, Y=140)`. First ink should be near **Y≈140**, not Y≈−42 or Y≈95.

## 3. Missing homing / offset clear at file start

Current head:

```gcode
G21
G90
G94
G0 Z4
```

Required head:

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

## 4. Kill duplicate / zero-length G1

- ~**9600** consecutive duplicate `G1` lines (same X/Y twice)
- Drop exact duplicates and merge segments **&lt; 0.2 mm**

## 5. Feed

- Now: `F2000`
- Use: **`F3500`** (ok if paths are cleaned)

## 6. Done when

- [ ] All X in **[0, 200]**
- [ ] All Y in **[0, 140]** and **ymax ≈ 140**
- [ ] Preamble includes G54 clear + `$HZ` + `$H`
- [ ] Pen still `Z4` / `Z0` only
- [ ] No duplicate G1 crumbs
- [ ] Draw feed `F3500`
