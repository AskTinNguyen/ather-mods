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
  ['D1', 'Yêu Project, yêu đồng bào'],
  ['D2', 'Học tập tốt, lao động tốt'],
  ['D3', 'Đoàn kết tốt, kỷ luật tốt'],
  ['D4', 'Giữ gìn vệ sinh thật tốt'],
  ['D5', 'Khiêm tốn, thật thà, dũng cảm'],
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


/** A32: one rule's card, read from rules-a5.md (D9's line for the rule, D10's [H] / [N] tags for when it is checked). */
export type RuleCard = { n: number; id: (typeof RULES)[number][0]; name: string; purpose: string; action: string; accept: string }

/** The first sentence of a tagged segment (the card stays short; rules-a5.md keeps the whole text). */
const firstSentence = (s: string): string => {
  const t = s.trim()
  const m = /^(.+?[.;])(\s|$)/.exec(t)
  return (m?.[1] ?? t).trim()
}

/** A32: the five cards from rules-a5.md's rule lines `- <n> <name> (<purpose>) [H] … [N] … [P] …`; a rule whose line
 * is missing falls back to D9's name with empty parts. */
export const ruleCards = (md: string): RuleCard[] =>
  RULES.map(([id, fallback]) => {
    const n = Number(id.slice(1))
    const line = md.split(/\r?\n/).find(l => new RegExp(`^-\\s*${n}\\s`).test(l)) ?? ''
    const head = /^-\s*\d+\s+(.+?)\s*\(([^)]*)\)/.exec(line)
    const tag = (t: 'H' | 'N') => {
      const parts = line.split(/\[(H|N|P)\]/)
      const out: string[] = []
      for (let i = 1; i < parts.length; i += 2) if (parts[i] === t) out.push(firstSentence(parts[i + 1] ?? ''))
      return out.join(' ')
    }
    return { n, id, name: head?.[1]?.trim() || fallback, purpose: head?.[2]?.trim() ?? '', action: tag('H'), accept: tag('N') }
  })

type ElB = El & { Button: (p: Record<string, unknown>) => unknown }

/** A32: the five rules as five round seals in one row (red fill, gold rim, gold numeral; the numeral is a Button so a
 * press opens its card), then the open rule's card under them (gold border): "<n> · <name>" in gold, the purpose,
 * "Lúc hành động: …", "Nghiệm thu: …", "Chạm hôm nay: <hits>" in red. Pressing the open seal again closes it. Rule 1's
 * tổ quốc / project word (A20) rides the heading. No paragraph of rule text. */
export const rulesSeals = (el: ElB, cards: readonly RuleCard[], hits: RuleHits, open: number | null, press: (n: number) => () => void, motto: unknown, look: { seal: string; rim: string; numeral: string; ink: string; quiet: string; hit: string }): unknown => {
  const card = cards.find(c => c.n === open)
  return el.Box({
    key: 'hai-a5-rules',
    flexDirection: 'column',
    width: '100%',
    marginTop: 1,
    children: [
      el.Box({ key: 'hai-a5-rules-head', flexDirection: 'row', columnGap: 1, children: [el.Text({ color: look.numeral, bold: true, children: 'Năm điều' }), el.Text({ color: look.quiet, children: '·' }), motto] }),
      el.Box({
        key: 'hai-a5-seals',
        flexDirection: 'row',
        columnGap: 1,
        children: cards.map(c =>
          el.Box({
            key: `hai-a5-seal-${c.n}-box`,
            flexShrink: 0,
            borderStyle: 'round',
            borderColor: look.rim,
            backgroundColor: look.seal,
            paddingX: 1,
            children: [el.Button({ key: `hai-a5-seal-${c.n}`, label: String(c.n), plain: true, onPress: press(c.n) })],
          }),
        ),
      }),
      ...(card
        ? [
            el.Box({
              key: 'hai-a5-rule-card',
              flexDirection: 'column',
              width: '100%',
              borderStyle: 'round',
              borderColor: look.rim,
              paddingX: 1,
              children: [
                el.Text({ color: look.numeral, bold: true, wrap: 'wrap', children: `${card.n} · ${card.name}` }),
                ...(card.purpose ? [el.Text({ color: look.ink, wrap: 'wrap', children: card.purpose })] : []),
                el.Text({ color: look.quiet, wrap: 'wrap', children: `Lúc hành động: ${card.action || '— (không chặn ở lời gọi)'}` }),
                el.Text({ color: look.quiet, wrap: 'wrap', children: `Nghiệm thu: ${card.accept || '—'}` }),
                el.Text({ color: look.hit, wrap: 'wrap', children: `Chạm hôm nay: ${hits[card.id]}` }),
              ],
            }),
          ]
        : []),
    ],
  })
}
