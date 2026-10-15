/**
 * Browser-side `vpype-gcode` (`gwrite`) TOML profile parser and G-code generator.
 *
 * Compatible with `vpype-gcode` TOML profiles (`[gwrite.<profile>]` and
 * `[gwrite.<profile>.default_values]`), including Python-style `{var}` / `{var:.3f}`
 * template interpolation, coordinate transforms (`unit`, `scale_x`, `scale_y`,
 * `offset_x`, `offset_y`, `horizontal_flip`, `vertical_flip`, `invert_x`,
 * `invert_y`, `relative_values`), and optional bed dimensions (`bed_width`,
 * `bed_height`) + fit-to-bed margin (`svg2gcode.sh` workflow).
 */

export const HBOT_MARLIN_TOML = `# vpype gwrite profile for the H-Bot pen plotter (Marlin on MKS TinyBee).
#
# Compatible with: vpype -c hbot_marlin.toml read art.svg ... gwrite -p hbot_marlin job.gco
# Bed is 200x140mm: vertical_flip mirrors Y around bed_height (140mm), so
# SVG (0,0) top-left lands on machine X0 Y140 (the Y home edge).

[gwrite.hbot_marlin]
unit = "mm"
bed_width = 200
bed_height = 140
vertical_flip = true
document_start = """; H-Bot plotter job (Marlin)
G21
G90
M211 S1
G28
M203 X{cap_feed_xy_mms} Y{cap_feed_xy_mms} Z{cap_feed_z_mms}
M201 X{cap_accel_xy} Y{cap_accel_xy} Z{cap_accel_z}
M204 P{xy_accel} T{xy_accel}
M205 J{junction_j}
G1 Z{z_safe} F{z_feed}
"""
segment_first = """G0 X{x:.3f} Y{y:.3f} F{xy_travel_feed}
G1 Z{z_draw} F{z_feed}
G1 F{xy_draw_feed}
"""
segment = """G1 X{x:.3f} Y{y:.3f}
"""
line_end = """G1 Z{z_travel} F{z_feed}
"""
document_end = """G1 Z{z_safe} F{z_feed}
G0 X0 Y140 F{xy_travel_feed}
M400
M84 X Y
"""

[gwrite.hbot_marlin.default_values]
# Pen heights (mm)
z_draw = 4
z_travel = 7
z_safe = 10

# Feed rates (mm/min) — F on moves
xy_draw_feed = 30000
xy_travel_feed = 30000
z_feed = 20000

# Planner (sent once after G28 in document_start)
xy_accel = 5000              # M204 P/T mm/s²
cap_feed_xy_mms = 500        # M203 X/Y: 30000 mm/min -> 500 mm/s
cap_feed_z_mms = 500         # M203 Z: 30000 mm/min
cap_accel_xy = 5000          # M201 X/Y mm/s²
cap_accel_z = 30000          # M201 Z mm/s²
junction_j = 0.013           # M205 J mm
`

export const FLUIDNC_Z_TOML = `# FluidNC / GRBL pen plotter with Z-axis pen lift.
# Compatible with vpype-gcode (gwrite -p fluidnc_z).

[gwrite.fluidnc_z]
unit = "mm"
bed_width = 200
bed_height = 140
vertical_flip = true
document_start = """; FluidNC Z-pen job
G21
G90
G0 Z{z_safe} F{z_feed}
"""
segment_first = """G0 X{x:.3f} Y{y:.3f} F{xy_travel_feed}
G1 Z{z_draw} F{z_feed}
G1 F{xy_draw_feed}
"""
segment = """G1 X{x:.3f} Y{y:.3f}
"""
line_end = """G0 Z{z_travel} F{z_feed}
"""
document_end = """G0 Z{z_safe} F{z_feed}
G0 X0 Y0 F{xy_travel_feed}
"""

[gwrite.fluidnc_z.default_values]
z_draw = 0
z_travel = 3
z_safe = 6
xy_draw_feed = 6000
xy_travel_feed = 12000
z_feed = 3000
`

export const FLUIDNC_SERVO_TOML = `# FluidNC / GRBL pen plotter with RC servo pen lift (M3 S<pwm> + G4 dwell).
# Compatible with vpype-gcode (gwrite -p fluidnc_servo).

[gwrite.fluidnc_servo]
unit = "mm"
bed_width = 200
bed_height = 140
vertical_flip = true
document_start = """; FluidNC servo-pen job
G21
G90
M3 S{pen_up}
G4 P{servo_delay}
"""
segment_first = """G0 X{x:.3f} Y{y:.3f} F{xy_travel_feed}
M3 S{pen_down}
G4 P{servo_delay}
G1 F{xy_draw_feed}
"""
segment = """G1 X{x:.3f} Y{y:.3f}
"""
line_end = """M3 S{pen_up}
G4 P{servo_delay}
"""
document_end = """M3 S{pen_up}
G4 P{servo_delay}
M5
G0 X0 Y0 F{xy_travel_feed}
"""

[gwrite.fluidnc_servo.default_values]
pen_up = 40
pen_down = 80
servo_delay = 0.15
xy_draw_feed = 5000
xy_travel_feed = 10000
`

export const GCODE_PRESETS = [
  { id: 'hbot_marlin', name: 'H-Bot Marlin (Z pen)', toml: HBOT_MARLIN_TOML },
  { id: 'fluidnc_z', name: 'FluidNC / GRBL (Z pen)', toml: FLUIDNC_Z_TOML },
  { id: 'fluidnc_servo', name: 'FluidNC / GRBL (RC servo)', toml: FLUIDNC_SERVO_TOML },
]

export const DEFAULT_GCODE_CONFIG = {
  toml: HBOT_MARLIN_TOML,
  fitMarginMm: '',
  ext: 'gco',
}

/**
 * Unescape a basic TOML double-quoted string.
 */
function unescapeTomlBasic(str) {
  return str.replace(/\\(\\|"|n|r|t|u[0-9a-fA-F]{4})/g, (_, esc) => {
    if (esc === '\\') return '\\'
    if (esc === '"') return '"'
    if (esc === 'n') return '\n'
    if (esc === 'r') return '\r'
    if (esc === 't') return '\t'
    if (esc.startsWith('u')) return String.fromCharCode(parseInt(esc.slice(1), 16))
    return esc
  })
}

/**
 * Strip an inline `# comment` outside quoted strings.
 */
function stripInlineComment(raw) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\' && inDouble) {
      i++
      continue
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble) return raw.slice(0, i).trim()
  }
  return raw.trim()
}

/**
 * Parse a `vpype-gcode` TOML string into `{ profileName, profile, defaultValues }`.
 * Supports `[gwrite.<name>]` and `[gwrite.<name>.default_values]`, multi-line
 * `"""..."""` and `'''...'''` strings, single-line strings, numbers, and booleans.
 */
export function parseGwriteToml(tomlText) {
  const src = String(tomlText ?? '').replace(/\r\n/g, '\n')
  const sections = {}
  let currentSection = ''
  let pos = 0
  const len = src.length

  const skipWhitespaceAndComments = () => {
    while (pos < len) {
      const ch = src[pos]
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        pos++
      } else if (ch === '#') {
        const nl = src.indexOf('\n', pos)
        pos = nl < 0 ? len : nl + 1
      } else {
        break
      }
    }
  }

  while (pos < len) {
    skipWhitespaceAndComments()
    if (pos >= len) break

    if (src[pos] === '[') {
      const close = src.indexOf(']', pos)
      if (close < 0) throw new Error('Unclosed section header `[` in TOML')
      currentSection = src.slice(pos + 1, close).trim()
      if (!sections[currentSection]) sections[currentSection] = {}
      const nl = src.indexOf('\n', close)
      pos = nl < 0 ? len : nl + 1
      continue
    }

    const eq = src.indexOf('=', pos)
    const nl = src.indexOf('\n', pos)
    if (eq < 0 || (nl >= 0 && eq > nl)) {
      throw new Error(`Expected key = value near: ${src.slice(pos, nl < 0 ? len : nl).trim()}`)
    }

    const key = src.slice(pos, eq).trim()
    if (!key) throw new Error('Empty key in TOML')
    pos = eq + 1
    while (pos < len && (src[pos] === ' ' || src[pos] === '\t')) pos++

    let value
    if (src.startsWith('"""', pos)) {
      pos += 3
      if (src[pos] === '\n') pos++
      const end = src.indexOf('"""', pos)
      if (end < 0) throw new Error(`Unclosed multi-line string for '${key}'`)
      value = unescapeTomlBasic(src.slice(pos, end))
      pos = end + 3
      const lineEnd = src.indexOf('\n', pos)
      pos = lineEnd < 0 ? len : lineEnd + 1
    } else if (src.startsWith("'''", pos)) {
      pos += 3
      if (src[pos] === '\n') pos++
      const end = src.indexOf("'''", pos)
      if (end < 0) throw new Error(`Unclosed multi-line literal string for '${key}'`)
      value = src.slice(pos, end)
      pos = end + 3
      const lineEnd = src.indexOf('\n', pos)
      pos = lineEnd < 0 ? len : lineEnd + 1
    } else {
      const lineEnd = src.indexOf('\n', pos)
      const rawLine = stripInlineComment(src.slice(pos, lineEnd < 0 ? len : lineEnd))
      pos = lineEnd < 0 ? len : lineEnd + 1

      if (rawLine.startsWith('"') && rawLine.endsWith('"') && rawLine.length >= 2) {
        value = unescapeTomlBasic(rawLine.slice(1, -1))
      } else if (rawLine.startsWith("'") && rawLine.endsWith("'") && rawLine.length >= 2) {
        value = rawLine.slice(1, -1)
      } else if (rawLine === 'true') {
        value = true
      } else if (rawLine === 'false') {
        value = false
      } else {
        const num = Number(rawLine.replace(/_/g, ''))
        if (rawLine !== '' && Number.isFinite(num)) {
          value = num
        } else {
          throw new Error(`Invalid TOML value for '${key}': ${rawLine}`)
        }
      }
    }

    if (!sections[currentSection]) sections[currentSection] = {}
    sections[currentSection][key] = value
  }

  // Locate `[gwrite.<name>]` and `[gwrite.<name>.default_values]`
  let profileName = null
  for (const sec of Object.keys(sections)) {
    const m = sec.match(/^gwrite\.([^.]+)$/)
    if (m) {
      profileName = m[1]
      break
    }
  }
  if (!profileName) {
    for (const sec of Object.keys(sections)) {
      const m = sec.match(/^gwrite\.([^.]+)\.default_values$/)
      if (m) {
        profileName = m[1]
        break
      }
    }
  }

  const profileSection = profileName ? sections[`gwrite.${profileName}`] ?? {} : sections[''] ?? {}
  const defaultValues = profileName
    ? { ...(sections[`gwrite.${profileName}.default_values`] ?? {}) }
    : { ...(sections['default_values'] ?? {}) }

  // Also merge any nested `default_values` if someone wrote `[default_values]`
  if (sections['default_values'] && profileName) {
    Object.assign(defaultValues, sections['default_values'])
  }

  return {
    profileName: profileName || 'default',
    profile: profileSection,
    defaultValues,
  }
}

/**
 * Python `str.format()`-style template formatter supporting `{name}`, `{name:spec}`,
 * and escaped `{{` / `}}`.
 */
export function formatGcodeTemplate(template, context) {
  if (!template) return ''
  let out = ''
  let i = 0
  const n = template.length

  while (i < n) {
    const ch = template[i]
    if (ch === '{') {
      if (template[i + 1] === '{') {
        out += '{'
        i += 2
        continue
      }
      const close = template.indexOf('}', i + 1)
      if (close < 0) throw new Error(`Unclosed '{' in template: ${template}`)
      const expr = template.slice(i + 1, close)
      const colon = expr.indexOf(':')
      const key = (colon < 0 ? expr : expr.slice(0, colon)).trim()
      const spec = colon < 0 ? '' : expr.slice(colon + 1)

      if (!(key in context)) {
        throw new Error(`Unknown template variable '{${key}}'`)
      }
      const val = context[key]
      out += formatPythonValue(val, spec)
      i = close + 1
    } else if (ch === '}') {
      if (template[i + 1] === '}') {
        out += '}'
        i += 2
        continue
      }
      throw new Error(`Single '}' in template: ${template}`)
    } else {
      out += ch
      i++
    }
  }
  return out
}

function formatPythonValue(val, spec) {
  if (!spec) {
    if (typeof val === 'number' && Object.is(val, -0)) return '0'
    return String(val)
  }

  // Parse Python format spec: [[fill]align][sign][0][width][.precision][type]
  const m = spec.match(/^(?:(.)?([<>=^]))?([+\- ])?(0)?(\d+)?(?:\.(\d+))?([fFdeEgGs%])?$/)
  if (!m) return String(val)

  const [, fillChar, alignChar, signChar, zeroPad, widthStr, precStr, typeChar] = m
  const num = Number(val)
  let formatted

  if (typeChar === 's' || (!typeChar && typeof val === 'string' && precStr === undefined)) {
    formatted = String(val)
    if (precStr !== undefined) formatted = formatted.slice(0, Number(precStr))
  } else if (Number.isFinite(num)) {
    const cleanNum = Object.is(num, -0) || Math.abs(num) < 1e-12 ? 0 : num
    const absNum = Math.abs(cleanNum)
    const isNeg = cleanNum < 0
    const prec = precStr !== undefined ? Number(precStr) : undefined

    let body
    if (typeChar === 'd') {
      body = String(Math.round(absNum))
    } else if (typeChar === 'e' || typeChar === 'E') {
      body = absNum.toExponential(prec ?? 6)
      if (typeChar === 'E') body = body.toUpperCase()
    } else if (typeChar === 'f' || typeChar === 'F' || prec !== undefined) {
      body = absNum.toFixed(prec ?? 6)
    } else {
      body = String(absNum)
    }

    const isZeroBody = /^0(?:\.0+)?(?:[eE][+-]?0+)?$/.test(body)
    const signPrefix = isNeg && !isZeroBody ? '-' : signChar === '+' ? '+' : signChar === ' ' ? ' ' : ''
    formatted = signPrefix + body

    if (widthStr !== undefined) {
      const width = Number(widthStr)
      const pad = fillChar ?? (zeroPad ? '0' : ' ')
      const align = alignChar ?? (zeroPad ? '=' : '>')
      if (formatted.length < width) {
        const diff = width - formatted.length
        if (align === '<') formatted = formatted + pad.repeat(diff)
        else if (align === '^') {
          const left = Math.floor(diff / 2)
          formatted = pad.repeat(left) + formatted + pad.repeat(diff - left)
        } else if (align === '=' && signPrefix) {
          formatted = signPrefix + pad.repeat(diff) + body
        } else {
          formatted = pad.repeat(diff) + formatted
        }
      }
      return formatted
    }
    return formatted
  } else {
    formatted = String(val)
  }

  if (widthStr !== undefined) {
    const width = Number(widthStr)
    const pad = fillChar ?? ' '
    const align = alignChar ?? '<'
    if (formatted.length < width) {
      const diff = width - formatted.length
      if (align === '>') formatted = pad.repeat(diff) + formatted
      else if (align === '^') {
        const left = Math.floor(diff / 2)
        formatted = pad.repeat(left) + formatted + pad.repeat(diff - left)
      } else {
        formatted = formatted + pad.repeat(diff)
      }
    }
  }
  return formatted
}

/**
 * Parse an SVG `<polyline points="...">` or simple `<path d="M... L... Z">` into
 * an array of polylines `[[x, y], ...]`, grouped by top-level `<g id="...">`.
 * Skips filled polygon groups (`stroke:none`) such as solid backgrounds.
 */
export function extractSvgGeometry(svgText) {
  const src = String(svgText ?? '')
  const svgTagMatch = src.match(/<svg\b[^>]*>/)
  let widthMm = 0
  let heightMm = 0

  if (svgTagMatch) {
    const tag = svgTagMatch[0]
    const vb = tag.match(/\bviewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*"/)
    if (vb) {
      widthMm = Number(vb[3]) || 0
      heightMm = Number(vb[4]) || 0
    }
    if (!widthMm) {
      const wm = tag.match(/\bwidth="([-\d.]+)(?:mm)?"/)
      if (wm) widthMm = Number(wm[1]) || 0
    }
    if (!heightMm) {
      const hm = tag.match(/\bheight="([-\d.]+)(?:mm)?"/)
      if (hm) heightMm = Number(hm[1]) || 0
    }
  }

  const layers = []
  const gRegex = /<g\b([^>]*)>([\s\S]*?)<\/g>/g
  let gm
  while ((gm = gRegex.exec(src)) !== null) {
    const attrs = gm[1]
    const body = gm[2]
    // Skip solid fill groups (`stroke:none`)
    if (/stroke\s*:\s*none/i.test(attrs)) continue
    const idMatch = attrs.match(/\bid="([^"]+)"/)
    const id = idMatch ? idMatch[1] : `layer_${layers.length + 1}`
    const lines = parseSvgGroupLines(body)
    if (lines.length > 0) {
      layers.push({ id, lines })
    }
  }

  return { widthMm, heightMm, layers }
}

function parseSvgGroupLines(body) {
  const lines = []
  const tokenRe = /<(polyline|line|path)\b([^>]*)\/?>/g
  let m
  while ((m = tokenRe.exec(body)) !== null) {
    const tag = m[1]
    const attrs = m[2]
    if (/stroke\s*:\s*none/i.test(attrs)) continue

    if (tag === 'polyline') {
      const pm = attrs.match(/\bpoints="([^"]+)"/)
      if (!pm) continue
      const pts = parsePointList(pm[1])
      if (pts.length >= 2) lines.push(pts)
    } else if (tag === 'line') {
      const x1 = Number(attrs.match(/\bx1="([-\d.]+)"/)?.[1])
      const y1 = Number(attrs.match(/\by1="([-\d.]+)"/)?.[1])
      const x2 = Number(attrs.match(/\bx2="([-\d.]+)"/)?.[1])
      const y2 = Number(attrs.match(/\by2="([-\d.]+)"/)?.[1])
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        lines.push([
          [x1, y1],
          [x2, y2],
        ])
      }
    } else if (tag === 'path') {
      // Skip filled paths without stroke (from multipolygon_filled)
      if (/\bfill="[^"]+"/i.test(attrs) && !/\bstroke=/i.test(attrs)) continue
      const dm = attrs.match(/\bd="([^"]+)"/)
      if (!dm) continue
      for (const poly of parseSimplePathD(dm[1])) {
        if (poly.length >= 2) lines.push(poly)
      }
    }
  }
  return lines
}

function parsePointList(pointsStr) {
  const nums = pointsStr
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const pts = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
      pts.push([nums[i], nums[i + 1]])
    }
  }
  return pts
}

function parseSimplePathD(d) {
  const polys = []
  let current = []
  const tokens = d.match(/[MLZmlz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
  if (!tokens) return polys

  let i = 0
  let cmd = 'M'
  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[MLZmlz]$/.test(t)) {
      cmd = t
      i++
      if ((cmd === 'Z' || cmd === 'z') && current.length >= 2) {
        const first = current[0]
        const last = current[current.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) {
          current.push([first[0], first[1]])
        }
        polys.push(current)
        current = []
      }
      continue
    }
    const x = Number(tokens[i])
    const y = Number(tokens[i + 1])
    i += 2
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (cmd === 'M') {
      if (current.length >= 2) polys.push(current)
      current = [[x, y]]
      cmd = 'L'
    } else if (cmd === 'L') {
      current.push([x, y])
    }
  }
  if (current.length >= 2) polys.push(current)
  return polys
}

/**
 * Convert an SVG string to G-code using a `vpype-gcode` TOML configuration.
 *
 * @param {string} svgText
 * @param {object} options
 * @param {string} options.toml `vpype-gcode` TOML string
 * @param {number|string|null} [options.fitMarginMm] optional margin in mm to fit SVG inside bed (like `svg2gcode.sh --margin`)
 * @param {string} [options.filename] output filename for `{filename}` template variable
 * @returns {{
 *   gcode: string,
 *   profileName: string,
 *   bedWidthMm: number,
 *   bedHeightMm: number,
 *   bounds: { minX: number, maxX: number, minY: number, maxY: number, outOfBounds: boolean } | null,
 *   layerCount: number,
 *   lineCount: number,
 *   segmentCount: number,
 * }}
 */
export function svgToGcode(svgText, options = {}) {
  const { profileName, profile, defaultValues } = parseGwriteToml(options.toml ?? HBOT_MARLIN_TOML)
  const { widthMm: svgWidthMm, heightMm: svgHeightMm, layers } = extractSvgGeometry(svgText)

  const unit = profile.unit ?? 'mm'
  const unitScale = unit === 'in' ? 1 / 25.4 : 1.0

  const bedWidthMm = Number(profile.bed_width) > 0 ? Number(profile.bed_width) : svgWidthMm
  const bedHeightMm = Number(profile.bed_height) > 0 ? Number(profile.bed_height) : svgHeightMm

  const scaleX = Number.isFinite(Number(profile.scale_x)) ? Number(profile.scale_x) : 1.0
  const scaleY = Number.isFinite(Number(profile.scale_y)) ? Number(profile.scale_y) : 1.0
  const offsetX = Number.isFinite(Number(profile.offset_x)) ? Number(profile.offset_x) : 0.0
  const offsetY = Number.isFinite(Number(profile.offset_y)) ? Number(profile.offset_y) : 0.0
  const horizontalFlip = Boolean(profile.horizontal_flip)
  const verticalFlip = Boolean(profile.vertical_flip)
  const invertX = Boolean(profile.invert_x)
  const invertY = Boolean(profile.invert_y)
  const relativeValues = Boolean(profile.relative_values)

  // Optional `svg2gcode.sh --margin <mm>`: uniform scale to fit inside (bed - 2*margin), aligned top-left
  const hasMargin =
    options.fitMarginMm !== undefined &&
    options.fitMarginMm !== null &&
    String(options.fitMarginMm).trim() !== '' &&
    Number.isFinite(Number(options.fitMarginMm))
  const marginMm = hasMargin ? Math.max(0, Number(options.fitMarginMm)) : null

  let fitScale = 1.0
  let fitOffsetX = 0.0
  let fitOffsetY = 0.0
  if (marginMm !== null && bedWidthMm > 2 * marginMm && bedHeightMm > 2 * marginMm && svgWidthMm > 0 && svgHeightMm > 0) {
    const availW = bedWidthMm - 2 * marginMm
    const availH = bedHeightMm - 2 * marginMm
    fitScale = Math.min(availW / svgWidthMm, availH / svgHeightMm)
    fitOffsetX = marginMm
    fitOffsetY = marginMm
  }

  // Transform a point in SVG mm into final G-code coordinates (following vpype-gcode order)
  const transformPoint = (rawX, rawY) => {
    let x = rawX * fitScale + fitOffsetX
    let y = rawY * fitScale + fitOffsetY

    if (horizontalFlip) x = bedWidthMm - x
    if (verticalFlip) y = bedHeightMm - y

    x = x * unitScale * scaleX + offsetX
    y = y * unitScale * scaleY + offsetY

    if (invertX) x = -x
    if (invertY) y = -y

    return [x, y]
  }

  const baseCtx = {
    ...defaultValues,
    filename: options.filename ?? 'output.gco',
  }

  const chunks = []
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let totalLines = 0
  let totalSegments = 0

  let lastX = 0
  let lastY = 0
  let layerIndex = 0
  let linesIndex = 0
  let segmentIndex = 0

  const makeCtx = (extra = {}) => {
    const x = extra.x ?? lastX
    const y = extra.y ?? lastY
    const dx = extra.dx ?? 0
    const dy = extra.dy ?? 0
    const outX = relativeValues && extra.isSegment ? dx : x
    const outY = relativeValues && extra.isSegment ? dy : y
    return {
      ...baseCtx,
      x: outX,
      y: outY,
      dx,
      dy,
      _x: -outX,
      _y: -outY,
      _dx: -dx,
      _dy: -dy,
      ix: Math.round(outX),
      iy: Math.round(outY),
      index: extra.index ?? 0,
      index1: (extra.index ?? 0) + 1,
      layer_index: layerIndex,
      layer_index1: layerIndex + 1,
      layer_name: extra.layerName ?? '',
      lines_index: linesIndex,
      lines_index1: linesIndex + 1,
      segment_index: segmentIndex,
      segment_index1: segmentIndex + 1,
    }
  }

  if (profile.document_start) {
    chunks.push(formatGcodeTemplate(profile.document_start, makeCtx({ index: 0 })))
  }

  for (let li = 0; li < layers.length; li++) {
    layerIndex = li
    const layer = layers[li]
    const layerName = layer.id

    if (li > 0 && profile.layer_join) {
      chunks.push(formatGcodeTemplate(profile.layer_join, makeCtx({ index: li, layerName })))
    }
    if (profile.layer_start) {
      chunks.push(formatGcodeTemplate(profile.layer_start, makeCtx({ index: li, layerName })))
    }

    for (let lni = 0; lni < layer.lines.length; lni++) {
      const poly = layer.lines[lni]
      if (poly.length < 2) continue
      linesIndex = lni
      totalLines++

      if (lni > 0 && profile.line_join) {
        chunks.push(formatGcodeTemplate(profile.line_join, makeCtx({ index: lni, layerName })))
      }
      if (profile.line_start) {
        chunks.push(formatGcodeTemplate(profile.line_start, makeCtx({ index: lni, layerName })))
      }

      const nPts = poly.length
      for (let si = 0; si < nPts; si++) {
        segmentIndex = si
        totalSegments++
        const [x, y] = transformPoint(poly[si][0], poly[si][1])
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y

        const dx = x - lastX
        const dy = y - lastY
        lastX = x
        lastY = y

        let tmpl = profile.segment
        if (si === 0 && profile.segment_first != null) {
          tmpl = profile.segment_first
        } else if (si === nPts - 1 && profile.segment_last != null) {
          tmpl = profile.segment_last
        }

        if (tmpl) {
          chunks.push(
            formatGcodeTemplate(
              tmpl,
              makeCtx({ x, y, dx, dy, index: si, layerName, isSegment: true }),
            ),
          )
        }
      }

      if (profile.line_end) {
        chunks.push(formatGcodeTemplate(profile.line_end, makeCtx({ index: lni, layerName })))
      }
    }

    if (profile.layer_end) {
      chunks.push(formatGcodeTemplate(profile.layer_end, makeCtx({ index: li, layerName })))
    }
  }

  if (profile.document_end) {
    chunks.push(formatGcodeTemplate(profile.document_end, makeCtx({ index: 0 })))
  }

  const hasBounds = Number.isFinite(minX) && Number.isFinite(maxX)
  const eps = 1e-4
  const maxBedX = bedWidthMm * unitScale
  const maxBedY = bedHeightMm * unitScale
  const outOfBounds =
    hasBounds &&
    maxBedX > 0 &&
    maxBedY > 0 &&
    (minX < -eps || minY < -eps || maxX > maxBedX + eps || maxY > maxBedY + eps)

  return {
    gcode: chunks.join(''),
    profileName,
    bedWidthMm,
    bedHeightMm,
    bounds: hasBounds ? { minX, maxX, minY, maxY, outOfBounds } : null,
    layerCount: layers.length,
    lineCount: totalLines,
    segmentCount: totalSegments,
  }
}
