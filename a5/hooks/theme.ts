// Two looks for Ather's pane. A5 off: Ather's own (one lime accent, quiet grey, near-black).
// A5 on: the accent turns gold, a small red seal stands beside the brand, one compact A5 line sits under the strip;
// borders and secondary text keep Ather's neutral greys. The A5 pane (its own) carries the rest.
// A33 (rev 9, Hai's approved mockup): the A5 pane in seal red, gold, pale gold and ivory; Ather's pane keeps only the
// seal, the gold accent and the red "★ A5 ›" button. Contrast (dataviz contrast()): pale gold on seal red ≈ 4.6:1,
// gold and ivory on the pane's near-black well above 7:1. Pure: no `$`.

export const ATHER = { accent: '#DDFF00', quiet: '#8E918A', line: '#3a3c36' } as const
export const A5_LOOK = { gold: '#F2C14E', sealBg: '#B3261E', sealText: '#F6D98A', ivory: '#E9E4D8', quiet: '#8E8A80', meter: '#E8473C', meterTrack: '#4A2220' } as const
/** A35/A36 (mockup v2): the thin band's darker red, the list's hairline, a chip's neutral rim, the section label grey. */
export const V2 = { band: '#7A1712', hair: '#2E2C29', rim: '#3A3833', label: '#8E8A80', gutter: 2 } as const
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
  ['D1', 'Love the project, love your fellow sessions'],
  ['D2', 'Study well, work well'],
  ['D3', 'Unity and discipline'],
  ['D4', 'Keep it clean'],
  ['D5', 'Modest, honest, brave'],
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

/** A34: the rules' short names, for the chips and the refusal gates. */
export const RULE_SHORT: Record<(typeof RULES)[number][0], string> = { D1: 'Love the project', D2: 'Study and work well', D3: 'Unity and discipline', D4: 'Keep it clean', D5: 'Modest, honest, brave' }

/** A36: a chip's rim: gold when selected, the seal red when its rule was hit today, else the neutral rim. */
export const chipRim = (selected: boolean, hit: boolean): string => (selected ? A5_LOOK.gold : hit ? A5_LOOK.sealBg : V2.rim)

/** A36 (mockup v2): the five rules as quiet outlined chips "<n> <short name>" in a wrapping row, under the section
 * label "THE FIVE RULES" (rule 1's country / project word beside it, A20). A chip's rim is neutral by default, red only
 * when its rule was hit today, gold when selected. Pressing a chip shows its card below a hairline: the full name, the
 * purpose, "At the action: …", "At acceptance: …", "Hits today: n" (red when above zero); pressing it again hides it.
 * `extra(n)` adds a chip's event marks (A38). */
export const rulesChips = (el: ElB, cards: readonly RuleCard[], hits: RuleHits, open: number | null, press: (n: number) => () => void, motto: unknown, look: { ink: string; quiet: string; hit: string }, extra: (n: number) => unknown[] = () => []): unknown => {
  const card = cards.find(c => c.n === open)
  return el.Box({
    key: 'hai-a5-rules',
    flexDirection: 'column',
    width: '100%',
    children: [
      el.Box({ key: 'hai-a5-rules-head', flexDirection: 'row', columnGap: 1, children: [el.Text({ color: V2.label, children: 'THE FIVE RULES' }), el.Text({ color: V2.label, children: '·' }), motto] }),
      el.Box({
        key: 'hai-a5-chips',
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 1,
        children: cards.map(c =>
          el.Box({
            key: `hai-a5-chip-${c.n}-box`,
            flexShrink: 0,
            flexDirection: 'row',
            borderStyle: 'round',
            borderColor: chipRim(open === c.n, hits[c.id] > 0),
            paddingX: 1,
            children: [el.Button({ key: `hai-a5-chip-${c.n}`, label: `${c.n} ${RULE_SHORT[c.id]}`, plain: true, onPress: press(c.n) }), ...extra(c.n)],
          }),
        ),
      }),
      ...(card
        ? [
            hairline(el, 'hai-a5-rule-hair'),
            el.Box({
              key: 'hai-a5-rule-card',
              flexDirection: 'column',
              width: '100%',
              children: [
                el.Text({ color: look.ink, bold: true, wrap: 'wrap', children: card.name }),
                ...(card.purpose ? [el.Text({ color: look.quiet, wrap: 'wrap', children: card.purpose })] : []),
                el.Text({ color: look.quiet, wrap: 'wrap', children: `At the action: ${card.action || '— (nothing is blocked at the call)'}` }),
                el.Text({ color: look.quiet, wrap: 'wrap', children: `At acceptance: ${card.accept || '—'}` }),
                el.Text({ color: hits[card.id] > 0 ? look.hit : look.quiet, wrap: 'wrap', children: `Hits today: ${hits[card.id]}` }),
              ],
            }),
          ]
        : []),
    ],
  })
}

/** A35: the hairline that divides rows and sets off the rule card: a full-width rule clipped to one line. */
export const hairline = (el: El, key: string, color: string = V2.hair): unknown =>
  el.Box({ key, width: '100%', height: 1, overflow: 'hidden', children: [el.Text({ color, children: '─'.repeat(240) })] })

/** A33: "A5 · THE FIVE RULES" letter-spaced (a space between letters, two between words). */
export const bandTitle = (s: string): string => s.toUpperCase().split(' ').map(w => [...w].join(' ')).join('  ')

/** A35 (mockup v2): the A5 pane's thin band: the darker seal red, full width, its words on the content gutter: a gold
 * ★ and "A 5" (pale gold, letter-spaced) on the left, "on" / "off" on the right. */
export const a5Band = (el: El, isOn = true, isFrozen = false): unknown =>
  el.Box({
    key: 'hai-a5-band',
    flexDirection: 'row',
    width: '100%',
    columnGap: 1,
    paddingX: V2.gutter,
    backgroundColor: V2.band,
    children: [
      el.Box({ key: 'hai-a5-band-star', flexShrink: 0, children: [el.Text({ color: A5_LOOK.gold, bold: true, children: '★' })] }),
      el.Box({ key: 'hai-a5-band-title', flexShrink: 0, children: [el.Text({ color: A5_LOOK.sealText, bold: true, children: bandTitle('A5') })] }),
      el.Box({ key: 'hai-a5-band-gap', flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(isFrozen ? [el.Box({ key: 'hai-a5-band-freeze', flexShrink: 0, children: [el.Text({ color: A5_LOOK.sealText, children: '❄' })] })] : []), // A38: the sync freeze
      el.Box({ key: 'hai-a5-band-on', flexShrink: 0, children: [el.Text({ color: A5_LOOK.sealText, children: isOn ? 'on' : 'off' })] }),
    ],
  })

// ---------- A39: the red Young Pioneer scarf on Ather's worker avatars (A5 on) ----------
/** The scarf, in the avatar's 100×100 badge: a red triangle under the face, knotted at the lower neck (y ≈ 84–104), a
 * dark red outline so it reads on every body colour. The badge clips it, as it clips the body. */
export const SCARF = {
  red: '#C8102E',
  line: '#6E0A16',
  svg: '<g data-a5="scarf"><path d="M33 85 L67 85 L50 104 Z" fill="#C8102E" stroke="#6E0A16" stroke-width="1.6" stroke-linejoin="round"/><path d="M47.5 88 L41 100 L46.5 99 Z M52.5 88 L59 100 L53.5 99 Z" fill="#C8102E" stroke="#6E0A16" stroke-width="1.4" stroke-linejoin="round"/><circle cx="50" cy="87.5" r="3.6" fill="#A50E25" stroke="#6E0A16" stroke-width="1.4"/></g>',
} as const

/** Whether an SVG is one of Ather's worker avatars (`squad.mjs avatarSvg`): the round clip and its body group. */
export const isAvatarSvg = (source: string): boolean => source.includes('<clipPath id="round">') && source.includes('translate(50 106) scale(1.32) translate(-50 -106)')

/** A39: Ather's avatar SVG with the scarf inside the clipped group, right after the body (and its eyes) and before the
 * prop it holds, so it bobs with the body and the prop stays in front; the ring, the badge and the root's transparency
 * are untouched. Any other SVG, or one already scarfed, comes back unchanged. */
export const withScarf = (source: string): string => {
  if (!isAvatarSvg(source) || source.includes('data-a5="scarf"')) return source
  const open = '<g transform="translate(50 106) scale(1.32) translate(-50 -106)">'
  const start = source.indexOf(open)
  if (start < 0) return source
  // The body group's own closing tag: count the group tags from its opening (a body may nest groups of its own).
  const tags = new RegExp('<g\\b[^>]*>|</g>', 'g')
  tags.lastIndex = start
  let depth = 0
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    depth += m[0] === '</g>' ? -1 : 1
    if (depth === 0) return source.slice(0, m.index + 4) + SCARF.svg + source.slice(m.index + 4)
  }
  return source
}

/** A39: every avatar Svg in a drawn tree, scarfed. */
export const scarfAvatars = <T>(node: T): T => {
  if (!node || typeof node !== 'object') return node
  const n = node as unknown as Node
  const props = n.type === 'Svg' && typeof n.props?.source === 'string' && isAvatarSvg(n.props.source) ? { ...n.props, source: withScarf(n.props.source) } : n.props
  const children = Array.isArray(n.children) ? n.children.map(scarfAvatars) : n.children
  return { ...n, ...(props ? { props } : {}), ...(children ? { children } : {}) } as unknown as T
}
