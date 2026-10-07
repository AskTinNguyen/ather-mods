// Two looks for Ather's pane. A5 off: Ather's own (one lime accent, quiet grey, near-black).
// A5 on: the accent alone turns lacquer gold, a small red seal stands beside the brand, and the five
// rules sit in one quiet line at the foot. Borders and secondary text keep Ather's neutral greys.
// Contrast (dataviz contrast()): gold on the pane 9.25:1, seal text on seal red 5.47:1. Pure: no `$`.

export const ATHER = { accent: '#DDFF00', quiet: '#8E918A', line: '#3a3c36' } as const
export const A5_LOOK = { gold: '#E8B84A', sealBg: '#A3201B', sealText: '#F6D98A' } as const
export const STATUS = { ok: '#5FB87A', warn: '#E0A93B', bad: '#E5534B' } as const
// The unfilled part of a meter: a dark step of the fill's own hue (dataviz: same-ramp track).
export const TRACK = { ok: '#2E4A37', warn: '#4A3D1E', bad: '#4A2220' } as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[]; [k: string]: unknown }

/** The same tree with Ather's lime accent in lacquer gold (the mark's lime too); nothing else changes. */
export const recolor = <T>(node: T): T => {
  if (!node || typeof node !== 'object') return node
  const n = node as unknown as Node
  let props = n.props
  if (props) {
    props = { ...props }
    for (const k of ['color', 'borderColor', 'backgroundColor']) {
      const v = props[k]
      if (typeof v === 'string' && v.toLowerCase() === ATHER.accent.toLowerCase()) props[k] = A5_LOOK.gold
    }
    if (typeof props.source === 'string') props.source = props.source.replace(/#DDFF00/gi, A5_LOOK.gold)
  }
  const children = Array.isArray(n.children) ? n.children.map(recolor) : n.children
  return { ...n, ...(props ? { props } : {}), ...(children ? { children } : {}) } as unknown as T
}

/** A copy of the tree with the Box keyed `key` replaced by `fn(box)` (trees from `next` are frozen). */
export const replaceKeyed = <T>(node: T, key: string, fn: (box: Node) => unknown): T => {
  if (!node || typeof node !== 'object') return node
  const n = node as unknown as Node
  if (n.props?.key === key) return fn(n) as T
  if (!Array.isArray(n.children)) return node
  return { ...n, children: n.children.map(c => replaceKeyed(c, key, fn)) } as unknown as T
}

export const spaced = (text: string, width: number): string => {
  const s = text.toUpperCase().split('').join(' ')
  return s.length <= width ? s : text.toUpperCase().slice(0, Math.max(4, width))
}

export const RULES = [
  ['D1', 'Yêu Tổ quốc'],
  ['D2', 'Học tập tốt'],
  ['D3', 'Kỷ luật tốt'],
  ['D4', 'Vệ sinh'],
  ['D5', 'Thật thà'],
] as const
export type RuleHits = Record<(typeof RULES)[number][0], number>
export const noHits = (): RuleHits => ({ D1: 0, D2: 0, D3: 0, D4: 0, D5: 0 })

type El = { Box: (p: Record<string, unknown>) => unknown; Text: (p: Record<string, unknown>) => unknown }

/** The red seal that stands beside the brand while A5 is on. */
export const seal = (el: El): unknown => el.Text({ backgroundColor: A5_LOOK.sealBg, color: A5_LOOK.sealText, bold: true, children: ' ★ A5 ' })

/** The masthead's first line (the brand) with the seal after it: `sealEl` (the pixel seal on the desktop)
 * or the text seal. */
export const withSeal = (el: El, words: Node, sealEl?: unknown): unknown => {
  const [brand, ...rest] = words.children ?? []
  return { ...words, children: [el.Box({ key: 'hai-brand', flexDirection: 'row', gap: 1, alignItems: 'center', children: [brand, sealEl ?? seal(el)] }), ...rest] }
}

/** The five rules in one quiet line at the foot; a rule that fired this session shows its count in gold. */
export const rulesFooter = (el: El, hits: RuleHits): unknown =>
  el.Box({
    key: 'hai-a5-rules',
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    marginTop: 1,
    children: [
      el.Text({ children: 'A5 · Năm điều' }),
      ...RULES.map(([id, name]) =>
        el.Text({
          color: ATHER.quiet,
          children: [`${id.slice(1)} ${name}`, ...(hits[id] > 0 ? [' ', el.Text({ color: A5_LOOK.gold, bold: true, children: String(hits[id]) })] : [])],
        }),
      ),
    ],
  })
