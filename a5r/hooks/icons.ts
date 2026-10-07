// Pixel icons for the tiles and the A5R seal. On the desktop they are SVG of 1×1 cells; SMIL moves them only
// when something changed: an ordered-dither reveal (a 4×4 Bayer threshold per cell) when a state turns
// over, a dither sweep while a task runs. Still otherwise. On the terminal each icon is one glyph. Pure.

/** A43: the first child of every SVG a5r draws: the sandboxed frame an interactive Svg runs in takes its colour scheme
 * and background from the document's own :root, which the svg root's `style` does not reach (Hai's dark-theme
 * screenshot: a white square beside each rule chip). With this rule the frame follows the app's scheme and stays
 * transparent, the fix Ather's avatar-frame intent proved for its running avatars. */
export const FRAME_STYLE = '<style>:root{color-scheme:light dark;background:transparent}</style>'

/** A43: an SVG document's opening tag with FRAME_STYLE as its first child. */
export const svgOpen = (attrs: string): string => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}${' style="color-scheme: light dark; background: transparent"'}>${FRAME_STYLE}`

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export const ICONS = {
  editor: ['............', '.##########.', '.#........#.', '.#.######.#.', '.#.#....#.#.', '.#.######.#.', '.#........#.', '.##########.', '.....##.....', '...######...', '............', '............'],
  memory: ['............', '............', '############', '#.##.##.##.#', '#.##.##.##.#', '#.##.##.##.#', '############', '.#.#.#.#.#.#', '.#.#.#.#.#.#', '............', '............', '............'],
  branch: ['.##.....##..', '.##.....##..', '..#......#..', '..#.....#...', '..#....#....', '..#..##.....', '..###.......', '..#.........', '..#.........', '.##.........', '.##.........', '............'],
} as const
export type IconName = keyof typeof ICONS
export const GLYPH: Record<IconName, string> = { editor: '▣', memory: '▥', branch: '⎇' }

export type Motion = { kind: 'still' } | { kind: 'reveal'; from: string; ms: number } | { kind: 'sweep' }

const at = (x: number, y: number) => (BAYER[y % 4]?.[x % 4] ?? 0) / 16

/** One cell, still, revealed (its fill set from `from` at its dither threshold) or sweeping. */
const cell = (x: number, y: number, fill: string, width: number, motion: Motion): string => {
  const box = `x="${x}" y="${y}" width="1" height="1"`
  if (motion.kind === 'reveal')
    return `<rect ${box} fill="${motion.from}"><set attributeName="fill" to="${fill}" begin="${((at(x, y) * motion.ms) / 1000).toFixed(3)}s" fill="freeze"/></rect>`
  if (motion.kind === 'sweep')
    return `<rect ${box} fill="${fill}"><animate attributeName="opacity" values="1;0.25;1" dur="1.2s" begin="${(((x + at(x, y) * 4) / width) * 1.2).toFixed(3)}s" repeatCount="indefinite"/></rect>`
  return `<rect ${box} fill="${fill}"/>`
}

/** An SVG of `rows` ('#' a lit cell, '.' empty), one color. */
export const pixelSvg = (rows: readonly string[], color: string, motion: Motion = { kind: 'still' }): string => {
  const width = Math.max(...rows.map(r => r.length))
  const cells: string[] = []
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && cells.push(cell(x, y, color, width, motion))))
  return `${svgOpen(`viewBox="0 0 ${width} ${rows.length}" shape-rendering="crispEdges"`)}${cells.join('')}</svg>`
}

// 5×7 glyphs for the seal: ★ A 5 R.
const FONT: Record<string, number[]> = {
  '★': [4, 21, 14, 31, 14, 21, 4],
  A: [14, 17, 17, 31, 17, 17, 17],
  '5': [31, 16, 30, 1, 1, 17, 14],
  R: [30, 17, 17, 30, 20, 18, 17],
}

/** The A5R seal as pixels: gold-cream glyphs on lacquer red. `stamp` dithers the red in, then the glyphs. */
export const sealSvg = (red: string, ink: string, stamp: boolean): string => {
  const chars = ['★', 'A', '5', 'R']
  const width = 2 + chars.length * 6 + 1
  const height = 11
  const cells: string[] = []
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) cells.push(stamp ? cell(x, y, red, width, { kind: 'reveal', from: 'transparent', ms: 450 }) : cell(x, y, red, width, { kind: 'still' }))
  chars.forEach((ch, i) =>
    (FONT[ch] ?? []).forEach((bits, j) => {
      for (let b = 0; b < 5; b += 1)
        if (bits & (16 >> b)) cells.push(stamp ? cell(2 + i * 6 + b, 2 + j, ink, width, { kind: 'reveal', from: red, ms: 650 }) : cell(2 + i * 6 + b, 2 + j, ink, width, { kind: 'still' }))
    }),
  )
  return `${svgOpen(`viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"`)}${cells.join('')}</svg>`
}

type El = { Svg?: (p: Record<string, unknown>) => unknown; Text: (p: Record<string, unknown>) => unknown }

/** The icon element for a surface: an SVG on the desktop (interactive only while it moves), a glyph elsewhere. */
export const icon = (el: El, name: IconName, color: string, motion: Motion, isDesktop: boolean): unknown =>
  isDesktop && el.Svg
    ? el.Svg({ source: pixelSvg(ICONS[name], color, motion), alt: name, width: 14, height: 14, ...(motion.kind === 'still' ? {} : { isInteractive: true }) })
    : el.Text({ color, children: GLYPH[name] })

// ---------- A37 / A38: pixel curtains laid over a block (an absolute box over it, its own SVG) ----------
/** A curtain's cells clear (opacity 1 → 0) or fill (0 → 1) in the 4×4 Bayer order, `step` ms apart from `begin`. */
export type Curtain = { color: string; begin: number; step: number; clear: boolean }

/** The latest moment (ms) a curtain's last cell finishes: what the entrance budget (≤ 300 ms) is checked against. */
export const curtainEnd = (c: Curtain): number => c.begin + 15 * c.step + c.step

// A51: the pace of the entrance and the event dithers. `motion: slow` (a review aid, to see whether the curtains are
// drawn at all) plays every one of them ten times slower; `on` keeps the ≤ 300 ms entrance and the ≤ 1 s events.
/** A37: the whole entrance (every block's curtain) ends within this, at `on`. */
export const ENTRANCE_BUDGET_MS = 300
/** A51: how long a curtain stays in the tree after its last cell: an SVG's SMIL clock starts when its frame loads, so a
 * frame that loads late still plays the entrance (a cleared curtain is transparent, so staying costs nothing). */
export const LATE_FRAME_MS = 1_700
/** A51: the entrance's time in the tree at `on` (≥ 2 s): its last cell by 300 ms, plus a late frame. */
export const ENTRANCE_MS = ENTRANCE_BUDGET_MS + LATE_FRAME_MS
/** A38: an event dither ends within this at `on` (sweep 900 ms, stamp 720 ms, score 664 ms) and leaves the tree then. */
export const FX_MS = 1_000
/** A51: how much slower `motion: slow` plays the entrance and the event dithers. */
export const SLOW = 10
export const paceOf = (motion: string | undefined): number => (motion === 'slow' ? SLOW : 1)
/** A51: how long the entrance stays in the tree at a pace: its last cell (300 ms × pace), then a late frame's margin. */
export const entranceLife = (pace = 1): number => ENTRANCE_BUDGET_MS * pace + LATE_FRAME_MS
/** A51: how long an event dither stays in the tree at a pace: each ends by 900 ms × pace, so 1 s × pace keeps a margin. */
export const fxLife = (pace = 1): number => FX_MS * pace

/** A37: the entrance: `n` blocks in turn (band, tools, sessions, card, rules) dither in from `color`, the whole sequence
 * ending within 300 ms × pace; the cells take 4 ms × pace apiece. */
export const entranceCurtains = (n: number, color: string, pace = 1): Curtain[] => {
  const step = 4
  const last = ENTRANCE_BUDGET_MS - 16 * step
  // the plan at `on`, then every time × pace, so slow is exactly ten times on
  return Array.from({ length: n }, (_, i) => ({ color, begin: (n > 1 ? Math.floor((i * last) / (n - 1)) : 0) * pace, step: step * pace, clear: true }))
}

/** A38: a new score resolves chip `n` (1–5) from a gold dither, the chips 150 ms × pace apart. */
export const scoreCurtain = (n: number, color: string, pace = 1): Curtain => ({ color, begin: (n - 1) * 150 * pace, step: 4 * pace, clear: true })

/** A full-block pixel curtain: one 8×8 pattern of 4×4 two-pixel cells, each animating once at its Bayer threshold, tiled
 * over a canvas wider and taller than any block (the box over it clips it to the block). One shot: `fill="freeze"`. */
export const curtainSvg = (c: Curtain): string => {
  const cells: string[] = []
  for (let y = 0; y < 4; y += 1)
    for (let x = 0; x < 4; x += 1) {
      const t = BAYER[y]?.[x] ?? 0
      const [from, to] = c.clear ? ['1', '0'] : ['0', '1']
      cells.push(`<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${c.color}" opacity="${from}"><animate attributeName="opacity" from="${from}" to="${to}" begin="${c.begin + t * c.step}ms" dur="${c.step}ms" fill="freeze"/></rect>`)
    }
  return `${svgOpen('width="2400" height="480" shape-rendering="crispEdges"')}<defs><pattern id="a5c" width="8" height="8" patternUnits="userSpaceOnUse">${cells.join('')}</pattern></defs><rect width="2400" height="480" fill="url(#a5c)"/></svg>`
}

/** A38: a one-shot stamp over a chip: each cell fills and clears once (opacity 0 → 1 → 0) at its Bayer threshold. */
export const stampSvg = (color: string, begin = 0, step = 8, dur = 600): string => {
  const cells: string[] = []
  for (let y = 0; y < 4; y += 1)
    for (let x = 0; x < 4; x += 1) {
      const t = BAYER[y]?.[x] ?? 0
      cells.push(`<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" begin="${begin + t * step}ms" dur="${dur}ms" fill="freeze"/></rect>`)
    }
  return `${svgOpen('width="2400" height="480" shape-rendering="crispEdges"')}<defs><pattern id="a5s" width="8" height="8" patternUnits="userSpaceOnUse">${cells.join('')}</pattern></defs><rect width="2400" height="480" fill="url(#a5s)"/></svg>`
}

/** A38: a one-shot sweep across a band: columns of cells fill and clear in turn, left to right (or right to left), with
 * a little Bayer jitter, the whole sweep within `ms` × `pace` (A51: every time in it scaled by the pace). */
export const sweepSvg = (color: string, reverse: boolean, ms = 900, cols = 120, rows = 2, pace = 1): string => {
  const cells: string[] = []
  const pass = (ms - 300) * pace
  for (let x = 0; x < cols; x += 1)
    for (let y = 0; y < rows; y += 1) {
      const order = reverse ? cols - 1 - x : x
      const begin = Math.round((order / cols) * pass + at(x, y) * 40 * pace)
      cells.push(`<rect x="${x * 20}" y="${y * 12}" width="20" height="12" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" begin="${begin}ms" dur="${250 * pace}ms" fill="freeze"/></rect>`)
    }
  return `${svgOpen(`width="${cols * 20}" height="${rows * 12}" shape-rendering="crispEdges"`)}${cells.join('')}</svg>`
}
