// Pixel icons for the tiles and the A5 seal. On the desktop they are SVG of 1×1 cells; SMIL moves them only
// when something changed: an ordered-dither reveal (a 4×4 Bayer threshold per cell) when a state turns
// over, a dither sweep while a task runs. Still otherwise. On the terminal each icon is one glyph. Pure.

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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${rows.length}" shape-rendering="crispEdges">${cells.join('')}</svg>`
}

// 5×7 glyphs for the seal: ★ A 5.
const FONT: Record<string, number[]> = {
  '★': [4, 21, 14, 31, 14, 21, 4],
  A: [14, 17, 17, 31, 17, 17, 17],
  '5': [31, 16, 30, 1, 1, 17, 14],
}

/** The A5 seal as pixels: gold-cream glyphs on lacquer red. `stamp` dithers the red in, then the glyphs. */
export const sealSvg = (red: string, ink: string, stamp: boolean): string => {
  const chars = ['★', 'A', '5']
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${cells.join('')}</svg>`
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="480" shape-rendering="crispEdges"><defs><pattern id="a5c" width="8" height="8" patternUnits="userSpaceOnUse">${cells.join('')}</pattern></defs><rect width="2400" height="480" fill="url(#a5c)"/></svg>`
}

/** A38: a one-shot stamp over a chip: each cell fills and clears once (opacity 0 → 1 → 0) at its Bayer threshold. */
export const stampSvg = (color: string, begin = 0, step = 8, dur = 600): string => {
  const cells: string[] = []
  for (let y = 0; y < 4; y += 1)
    for (let x = 0; x < 4; x += 1) {
      const t = BAYER[y]?.[x] ?? 0
      cells.push(`<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" begin="${begin + t * step}ms" dur="${dur}ms" fill="freeze"/></rect>`)
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="480" shape-rendering="crispEdges"><defs><pattern id="a5s" width="8" height="8" patternUnits="userSpaceOnUse">${cells.join('')}</pattern></defs><rect width="2400" height="480" fill="url(#a5s)"/></svg>`
}

/** A38: a one-shot sweep across a band: columns of cells fill and clear in turn, left to right (or right to left), with
 * a little Bayer jitter, the whole sweep within `ms`. */
export const sweepSvg = (color: string, reverse: boolean, ms = 900, cols = 120, rows = 2): string => {
  const cells: string[] = []
  const pass = ms - 300
  for (let x = 0; x < cols; x += 1)
    for (let y = 0; y < rows; y += 1) {
      const order = reverse ? cols - 1 - x : x
      const begin = Math.round((order / cols) * pass + at(x, y) * 40)
      cells.push(`<rect x="${x * 20}" y="${y * 12}" width="20" height="12" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" begin="${begin}ms" dur="250ms" fill="freeze"/></rect>`)
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * 20}" height="${rows * 12}" shape-rendering="crispEdges">${cells.join('')}</svg>`
}
