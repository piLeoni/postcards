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
    { token: 'namespace', foreground: fg.mid, fontStyle: 'bold' },
    { token: 'member', foreground: fg.soft },
    { token: 'function', foreground: fg.mid },
    { token: 'type.identifier', foreground: fg.mid, fontStyle: 'bold' },
    { token: 'string', foreground: fg.soft },
    { token: 'regexp', foreground: fg.soft },
    { token: 'comment', foreground: fg.mute, fontStyle: 'italic' },
    { token: 'delimiter', foreground: fg.dim },
    { token: 'operators', foreground: fg.mid },
    { token: 'tag', foreground: fg.bold, fontStyle: 'bold' },
    { token: 'metatag', foreground: fg.mid },
  ]
}

/** High-readability palette (Silk, Abyss): distinct hues per syntactic role. */
export function readableSyntaxRules({
  base,
  keyword,
  type,
  namespace,
  variable,
  member,
  func,
  string,
  number,
  comment,
  dim,
  mid,
}) {
  return [
    { token: '', foreground: base },
    { token: 'keyword', foreground: keyword, fontStyle: 'bold' },
    { token: 'type', foreground: type, fontStyle: 'bold' },
    { token: 'type.identifier', foreground: type, fontStyle: 'bold' },
    { token: 'string.key', foreground: member, fontStyle: 'bold' },
    { token: 'attribute.name', foreground: member, fontStyle: 'bold' },
    { token: 'number', foreground: number, fontStyle: 'bold' },
    { token: 'identifier', foreground: variable },
    { token: 'variable', foreground: variable },
    { token: 'namespace', foreground: namespace, fontStyle: 'bold' },
    { token: 'member', foreground: member },
    { token: 'function', foreground: func },
    { token: 'string', foreground: string },
    { token: 'regexp', foreground: string },
    { token: 'comment', foreground: comment, fontStyle: 'italic' },
    { token: 'comment.doc', foreground: comment, fontStyle: 'italic' },
    { token: 'delimiter', foreground: dim },
    { token: 'delimiter.bracket', foreground: dim },
    { token: 'operators', foreground: mid },
    { token: 'tag', foreground: keyword, fontStyle: 'bold' },
    { token: 'metatag', foreground: func },
  ]
}

/** @deprecated use readableSyntaxRules */
export const accentSyntaxRules = readableSyntaxRules

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
    { token: 'namespace', foreground: 'b8ffb0', fontStyle: 'bold' },
    { token: 'member', foreground: '98e090' },
    { token: 'function', foreground: 'a8f0a0' },
    { token: 'type.identifier', foreground: '8ee878' },
    { token: 'string', foreground: '70b868' },
    { token: 'regexp', foreground: '70b868' },
    { token: 'comment', foreground: '488840', fontStyle: 'italic' },
    { token: 'delimiter', foreground: '386830' },
    { token: 'operators', foreground: '90d088' },
  ]
}
