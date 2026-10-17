/**
 * Monaco token rules: mostly grey steps, optional cool (slightly blue) bias.
 * Paper keeps the strongest contrast; accent themes use hue only in chrome/map.
 */

/** @param {{ base: string, bold: string, mid: string, soft: string, mute: string, dim: string }} fg */
export function graySyntaxRules(fg) {
  return [
    { token: '', foreground: fg.base },
    { token: 'keyword', foreground: fg.bold, fontStyle: 'bold' },
    { token: 'type', foreground: fg.mid, fontStyle: 'bold' },
    { token: 'string.key', foreground: fg.mid, fontStyle: 'bold' },
    { token: 'attribute.name', foreground: fg.mid, fontStyle: 'bold' },
    { token: 'number', foreground: fg.soft, fontStyle: 'bold' },
    { token: 'identifier', foreground: fg.base },
    { token: 'variable', foreground: fg.base },
    { token: 'type.identifier', foreground: fg.base },
    { token: 'string', foreground: fg.soft },
    { token: 'regexp', foreground: fg.soft },
    { token: 'comment', foreground: fg.mute, fontStyle: 'italic' },
    { token: 'delimiter', foreground: fg.dim },
    { token: 'operators', foreground: fg.mid },
    { token: 'tag', foreground: fg.bold, fontStyle: 'bold' },
    { token: 'metatag', foreground: fg.mid },
    { token: 'function', foreground: fg.mid },
  ]
}

/** Readable Monaco palette with distinct semantic hues (Silk, Abyss). */
export function accentSyntaxRules({ base, bold, type, string, number, comment, dim, mid, func }) {
  return [
    { token: '', foreground: base },
    { token: 'keyword', foreground: bold, fontStyle: 'bold' },
    { token: 'type', foreground: type, fontStyle: 'bold' },
    { token: 'string.key', foreground: type, fontStyle: 'bold' },
    { token: 'attribute.name', foreground: type, fontStyle: 'bold' },
    { token: 'number', foreground: number, fontStyle: 'bold' },
    { token: 'identifier', foreground: base },
    { token: 'variable', foreground: base },
    { token: 'type.identifier', foreground: mid },
    { token: 'string', foreground: string },
    { token: 'regexp', foreground: string },
    { token: 'comment', foreground: comment, fontStyle: 'italic' },
    { token: 'delimiter', foreground: dim },
    { token: 'operators', foreground: mid },
    { token: 'tag', foreground: bold, fontStyle: 'bold' },
    { token: 'metatag', foreground: func },
    { token: 'function', foreground: func },
  ]
}

/** Phosphor green luminance ladder (no unrelated hues). */
export function phosphorSyntaxRules() {
  return [
    { token: '', foreground: '8ee878' },
    { token: 'keyword', foreground: 'b8ffb0', fontStyle: 'bold' },
    { token: 'type', foreground: 'a0e898', fontStyle: 'bold' },
    { token: 'string.key', foreground: 'a0e898', fontStyle: 'bold' },
    { token: 'attribute.name', foreground: 'a0e898', fontStyle: 'bold' },
    { token: 'number', foreground: '78c870', fontStyle: 'bold' },
    { token: 'identifier', foreground: '8ee878' },
    { token: 'variable', foreground: '8ee878' },
    { token: 'type.identifier', foreground: '8ee878' },
    { token: 'string', foreground: '70b868' },
    { token: 'regexp', foreground: '70b868' },
    { token: 'comment', foreground: '488840', fontStyle: 'italic' },
    { token: 'delimiter', foreground: '386830' },
    { token: 'operators', foreground: '90d088' },
    { token: 'function', foreground: '98e090' },
  ]
}
