// The shared S2 Editor, this machine's memory and main, drawn as one row of three tiles under Ather's own
// summary strip, in its card language: label (quiet), value (bold, a status dot beside it), one quiet line.
// The desktop gets cards; the terminal three short lines. Values stay in text ink; state rides the dot
// and the meter (dataviz: status is never the text color). Pure: no `$`; register.ts reads and probes.
import { parseLockLine } from './coord.ts'
import { ATHER, STATUS, TRACK } from './theme.ts'

export const PIE_START_GB = 5
export const PIE_ABORT_GB = 3
export const TOTAL_GB = 63

export type Vitals = { freeGb: number; claude: number; git: number; editorGb: number }
export type LockView = {
  isMissing: boolean
  isFree: boolean
  freeSince?: string
  who?: string
  session?: string
  from?: string
  until?: string
  task?: string
  next?: string
  dontSave: number
}
export type Sync = {
  branch: string
  ahead: number | null
  behind: number | null
  mainHead: string
  fetchedMinAgo: number | null
  lastMerge: string
  flags: string[]
  checkedAt: string
}

// Free RAM, claude and git process counts, the Editor's working set: one line "free;claude;git;editorGb".
export const VITALS_PROBE = [
  'powershell', '-NoProfile', '-NonInteractive', '-Command',
  [
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)',
    '$c = @(Get-Process claude -ErrorAction SilentlyContinue).Count',
    '$g = @(Get-Process git -ErrorAction SilentlyContinue).Count',
    '$u = Get-Process UnrealEditor -ErrorAction SilentlyContinue | Select-Object -First 1',
    '$ue = if ($u) { [math]::Round($u.WorkingSet64 / 1GB, 1) } else { 0 }',
    '"$free;$c;$g;$ue"',
  ].join('; '),
]

export const parseVitals = (stdout: string): Vitals | undefined => {
  const [free, c, g, ue] = stdout.trim().split(';').map(Number)
  if ([free, c, g, ue].some(n => n === undefined || Number.isNaN(n))) return undefined
  return { freeGb: free ?? 0, claude: c ?? 0, git: g ?? 0, editorGb: ue ?? 0 }
}

export const toMin = (hhmm: string | undefined): number | undefined => {
  const m = hhmm?.match(/(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined
}

/** The lock's first line, read both ways lanes write it: "<slot> <user> (intent x, session y) 14:30->~15:10: task"
 * and "<slot> (worker) since 14:30, expected end 15:10. task". */
export const parseLockView = (raw: string | null): LockView => {
  if (raw === null) return { isMissing: true, isFree: false, dontSave: 0 }
  const first = (raw.replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim() !== '') ?? '').trim()
  // The S2 standard's lines (HELD / HANDED / FREE, D2) are read field by field.
  const std = parseLockLine(raw)
  if (std.isStandard) {
    if (std.kind === 'free') return { isMissing: false, isFree: true, freeSince: std.since.slice(0, 5) || undefined, dontSave: 0 }
    return { isMissing: false, isFree: false, who: std.lane || undefined, session: std.id8 || undefined, from: std.since.slice(0, 5) || undefined, until: std.end || undefined, task: std.note || undefined, dontSave: /Don't-Save:\s*([^;]+)/i.exec(std.note)?.[1]?.split(',').length ?? 0 }
  }
  const free = /^free since (\d{1,2}:\d{2})/i.exec(first)
  if (first === '' || free || /\bfree (for|to use)\b|\bno (agent|one|lane) holds it\b/i.test(first))
    return { isMissing: first === '', isFree: first !== '', freeSince: free?.[1], dontSave: 0 }
  const span = /(\d{1,2}:\d{2})\s*(?:->|→)\s*~?(\d{1,2}:\d{2})/.exec(first)
  const from = span?.[1] ?? /\bsince\s+(\d{1,2}:\d{2})/i.exec(first)?.[1]
  const until = span?.[2] ?? /(?:until|expected end|ends?)\s+~?(\d{1,2}:\d{2})/i.exec(first)?.[1]
  const rest = span ? first.slice(first.indexOf(span[0]) + span[0].length).replace(/^[:\s]+/, '') : first.split(/(?<=\.)\s+/).slice(1).join(' ')
  const dontSave = /Don't-Save list[^:]*:\s*([^.]+)/i.exec(first)?.[1]
  return {
    isMissing: false,
    isFree: false,
    who: /intent ([\w.-]+)/i.exec(first)?.[1] ?? first.split(/\s+/)[0],
    session: /\bsession\s+([0-9a-f]{4,})/i.exec(raw)?.[1]?.toLowerCase(),
    from,
    until,
    task: rest.split(/(?<=\.)\s/)[0]?.trim() || undefined,
    next: /Waiting:\s*([^.;]+)/i.exec(first)?.[1]?.replace(/\s*\(.*$/, '').trim(),
    dontSave: dontSave ? dontSave.split(',').length : 0,
  }
}

export const lockLine = (l: LockView | undefined): string => {
  if (!l || l.isMissing) return 'Editor: lock missing (unknown, not free)'
  if (l.isFree) return `Editor free${l.freeSince ? ` since ${l.freeSince}` : ''}`
  return `Editor: ${l.who ?? 'held'}${l.until ? ` until ${l.until}` : ''}${l.next ? ` · next: ${l.next}` : ''}`
}

export const ramBand = (freeGb: number): 'ok' | 'below-start' | 'below-abort' =>
  freeGb < PIE_ABORT_GB ? 'below-abort' : freeGb < PIE_START_GB ? 'below-start' : 'ok'

export const ago = (minutes: number | null): string =>
  minutes === null ? 'never fetched' : minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`

type El = {
  Box: (p: Record<string, unknown>) => unknown
  Text: (p: Record<string, unknown>) => unknown
  Button: (p: Record<string, unknown>) => unknown
}
/** One tile: `lines` on the desktop card, `short` (else the first line) on the terminal's one line. */
export type Tile = { key: string; label: string; icon?: unknown; dot?: string; value: string; meter?: unknown; lines: { text: string; color?: string }[]; short?: { text: string; color?: string }[]; buttons?: unknown[] }

/** What the Editor holder tile says about this session: its place in the queue, or that it holds the lease. */
export type EditorData = { lock?: LockView; me8: string; nowMin: number; place: string; waiting: number }

/** Editor holder: who holds it until when, and this session's place in the queue. */
export const editorTile = (d: EditorData): Tile => {
  const l = d.lock
  const queue = d.place ? [{ text: d.place }] : d.waiting > 0 ? [{ text: `queue: ${d.waiting} waiting` }] : []
  if (!l || l.isMissing) return { key: 'editor', label: 'Editor holder', dot: STATUS.warn, value: 'Lock missing', lines: [{ text: 'unknown, not free' }, ...queue], short: [{ text: 'unknown, not free' }, ...queue] }
  if (l.isFree) {
    const since = [{ text: l.freeSince ? `since ${l.freeSince}` : 'nobody holds it' }, ...queue]
    return { key: 'editor', label: 'Editor holder', dot: STATUS.ok, value: 'Free', lines: since, short: since }
  }
  const isMine = Boolean(l.session && d.me8.startsWith(l.session.slice(0, 8)))
  const end = toMin(l.until)
  const left = end === undefined ? undefined : end - d.nowMin
  const isOver = left !== undefined && left < 0
  const when = l.until ? `until ${l.until}${left === undefined ? '' : isOver ? ` · ${-left} min over` : ` · ${left} min left`}` : 'no end time written'
  return {
    key: 'editor',
    label: 'Editor holder',
    dot: isOver ? STATUS.bad : isMine ? STATUS.ok : STATUS.warn,
    value: isMine ? 'This session' : (l.who ?? 'Held'),
    lines: [{ text: when, color: isOver ? STATUS.bad : undefined }, ...queue, ...(l.next ? [{ text: `next: ${l.next}` }] : []), ...(l.dontSave > 0 ? [{ text: `Don't-Save: ${l.dontSave}`, color: STATUS.warn }] : [])],
    short: [{ text: when, color: isOver ? STATUS.bad : undefined }, ...queue],
  }
}

/** What the Memory tile reads beside the probe: the launch gate in force, the last cleanup, the disk. */
export type MemoryData = { pieGb: number; nopieGb: number; isFromPanel: boolean; cleanup: string; diskGb: number | null; drive: string }

/** Memory: free RAM against the launch gate (adjustable: − / + / Reset, every session reads it) and the PIE gate
 * (fixed), as a meter whose track is a dark step of its own hue; what the last cleanup did. */
export const memoryTile = (el: El, v: Vitals | undefined, m: MemoryData, buttons: unknown[]): Tile => {
  const gate = { text: `launch ≥ ${m.pieGb} GB with PIE · ${m.nopieGb} GB without${m.isFromPanel ? ' (set here)' : ''}` }
  if (!v) return { key: 'memory', label: 'Memory', value: '?', lines: [{ text: 'probe failed' }, gate], buttons }
  const band = ramBand(v.freeGb)
  const tone = band === 'ok' ? 'ok' : band === 'below-start' ? 'warn' : 'bad'
  const cells = 16
  const filled = Math.max(0, Math.min(cells, Math.round((v.freeGb / TOTAL_GB) * cells)))
  const meter = el.Text({ children: [el.Text({ color: STATUS[tone], children: '━'.repeat(filled) }), el.Text({ color: TRACK[tone], children: '━'.repeat(cells - filled) })] })
  const launch = v.freeGb >= m.pieGb ? 'a launch with PIE fits' : v.freeGb >= m.nopieGb ? 'a launch fits without PIE' : 'under the launch gate'
  const pie = band === 'ok' ? `PIE ≥ ${PIE_START_GB} GB ok` : band === 'below-start' ? `under the ${PIE_START_GB} GB PIE gate` : `abort PIE (under ${PIE_ABORT_GB} GB)`
  return {
    key: 'memory',
    label: 'Memory',
    dot: band === 'ok' ? undefined : STATUS[tone],
    value: `${v.freeGb} GB free`,
    meter,
    lines: [
      { text: `${launch} · ${pie}`, color: band === 'ok' ? undefined : STATUS[tone] },
      gate,
      ...(m.cleanup ? [{ text: `cleanup ${m.cleanup}` }] : []),
      ...(m.diskGb !== null && m.diskGb < 20 ? [{ text: `${m.drive} ${m.diskGb} GB free (under 20)`, color: STATUS.warn }] : []),
      ...(v.git >= 10 ? [{ text: `${v.git} git processes`, color: STATUS.warn }] : []),
    ],
    short: [{ text: `${launch} · ${pie}`, color: band === 'ok' ? undefined : STATUS[tone] }, { text: `gate ${m.pieGb}/${m.nopieGb} GB` }],
    buttons,
  }
}

/** What the Sync main tile says about the planned sync. */
export type SyncData = { line: string; color?: string; conflicts: string; isRunning: boolean }

/** Sync main: the branch against origin/main, the next sync and its phase, its conflicts, and the controls to
 * plan, move or cancel it (the holder ends it). */
export const mainTile = (s: Sync | undefined, plan: SyncData, buttons: unknown[]): Tile => {
  const planLines = [{ text: plan.line, color: plan.color }, ...(plan.conflicts ? [{ text: plan.conflicts, color: STATUS.warn }] : [])]
  if (!s) return { key: 'main', label: 'Sync main', value: 'Reading git…', lines: planLines, short: planLines, buttons }
  const behind = s.behind ?? 0
  return {
    key: 'main',
    label: 'Sync main',
    dot: s.flags.length > 0 ? STATUS.bad : plan.isRunning ? STATUS.warn : behind > 0 ? STATUS.warn : STATUS.ok,
    value: s.behind === null ? 'unknown' : behind > 0 ? `${behind} behind` : 'Up to date',
    lines: [{ text: `${s.branch || 'branch'} · ${s.ahead ?? '?'} ahead · fetched ${ago(s.fetchedMinAgo)}` }, ...planLines, ...s.flags.map(f => ({ text: f, color: STATUS.bad }))],
    short: [{ text: `${s.ahead ?? '?'} ahead` }, ...planLines, ...s.flags.slice(0, 1).map(f => ({ text: f, color: STATUS.bad }))],
    buttons,
  }
}

/** The three tiles: cards on the desktop (Ather's strip language), three aligned lines on the terminal. */
export const tilesRow = (el: El, tiles: Tile[], isDesktop: boolean): unknown => {
  const { Box, Text } = el
  // State rides the icon's color when there is one, else a dot; the value stays in text ink.
  const value = (t: Tile) => Text({ bold: true, children: [...(t.dot && !t.icon ? [Text({ color: t.dot, children: '● ' })] : []), t.value] })
  if (isDesktop) {
    return Box({
      key: 'hai-tiles',
      flexDirection: 'row',
      gap: 1,
      width: '100%',
      marginTop: 1,
      children: tiles.map(t =>
        Box({
          key: `hai-tile-${t.key}`,
          flexDirection: 'column',
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          borderStyle: 'round',
          borderColor: ATHER.line,
          paddingX: 1,
          children: [
            // minWidth 0 lets a long label (the branch name) shrink and end in "…" instead of overflowing the card.
            Box({ key: `hai-tile-${t.key}-head`, flexDirection: 'row', gap: 1, alignItems: 'center', minWidth: 0, flexShrink: 1, overflow: 'hidden', children: [...(t.icon ? [t.icon] : []), Text({ color: ATHER.quiet, wrap: 'truncate-end', children: t.label })] }),
            value(t),
            ...(t.meter ? [t.meter] : []),
            ...t.lines.map(l => Text({ color: l.color ?? ATHER.quiet, wrap: 'wrap', children: l.text })),
            ...(t.buttons ? [Box({ key: `hai-tile-${t.key}-buttons`, flexDirection: 'row', gap: 1, marginTop: 1, children: t.buttons })] : []),
          ],
        }),
      ),
    })
  }
  return Box({
    key: 'hai-tiles',
    flexDirection: 'column',
    width: '100%',
    marginTop: 1,
    children: tiles.map(t =>
      Box({
        key: `hai-tile-${t.key}`,
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 1,
        children: [
          ...(t.icon ? [t.icon] : []),
          Text({ color: ATHER.quiet, children: (TERMINAL_LABEL[t.key] ?? t.label).padEnd(6) }),
          value(t),
          ...(t.meter ? [t.meter] : []),
          ...(t.short ?? t.lines.slice(0, 1)).map(l => Text({ color: l.color ?? ATHER.quiet, children: `· ${l.text}` })),
          ...(t.buttons ?? []),
        ],
      }),
    ),
  })
}

const TERMINAL_LABEL: Record<string, string> = { editor: 'Editor', memory: 'Memory', main: 'Sync' }

/** A19: one rule's row on the Nghiệm thu A5 card. */
export type AcceptRow = { rule: number; name: string; state: 'pass' | 'fail' | 'na'; line: string }
const MARK = { pass: '✓', fail: '✗', na: '–' } as const

/** A19: the Nghiệm thu A5 card, in Ather's card language: a quiet label, a bold verdict, then the five rules,
 * one line each, ✓ / ✗ / – carried by the mark's color (never the text's). Terminal: one line per rule. */
export const acceptCard = (el: El, title: string, sub: string, rows: readonly AcceptRow[], isDesktop: boolean): unknown => {
  const { Box, Text } = el
  const bad = rows.filter(r => r.state === 'fail').length
  const color = (r: AcceptRow) => (r.state === 'pass' ? STATUS.ok : r.state === 'fail' ? STATUS.bad : ATHER.quiet)
  const head = [Text({ color: ATHER.quiet, children: title }), Text({ bold: true, children: [Text({ color: bad ? STATUS.bad : STATUS.ok, children: '● ' }), bad ? `${bad} of 5 not met` : '5 of 5 met'] }), ...(sub ? [Text({ color: ATHER.quiet, children: sub })] : [])]
  const row = (r: AcceptRow) =>
    Box({
      key: `hai-accept-${r.rule}`,
      flexDirection: 'row',
      columnGap: 1,
      ...(isDesktop ? { minWidth: 0 } : { flexWrap: 'wrap' }),
      children: [Text({ color: color(r), bold: true, children: MARK[r.state] }), Text({ children: `${r.rule} ${r.name}` }), Text({ color: ATHER.quiet, ...(isDesktop ? { wrap: 'wrap' } : {}), children: `· ${r.line}` })],
    })
  if (isDesktop)
    return Box({ key: 'hai-accept', flexDirection: 'column', width: '100%', marginTop: 1, borderStyle: 'round', borderColor: ATHER.line, paddingX: 1, children: [Box({ key: 'hai-accept-head', flexDirection: 'row', columnGap: 1, children: head }), ...rows.map(row)] })
  return Box({ key: 'hai-accept', flexDirection: 'column', width: '100%', marginTop: 1, children: [Box({ key: 'hai-accept-head', flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: head }), ...rows.map(row)] })
}
