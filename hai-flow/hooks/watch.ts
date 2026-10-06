// The shared S2 Editor, this machine's memory and main, drawn as one row of three tiles under Ather's own
// summary strip, in its card language: label (quiet), value (bold, a status dot beside it), one quiet line.
// The desktop gets cards; the terminal three short lines. Values stay in text ink; state rides the dot
// and the meter (dataviz: status is never the text color). Pure: no `$`; register.ts reads and probes.
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
export type Tile = { key: string; label: string; icon?: unknown; dot?: string; value: string; meter?: unknown; lines: { text: string; color?: string }[]; buttons?: unknown[] }

export type EditorData = { lock?: LockView; vitals?: Vitals; me8: string; nowMin: number }

/** Editor: who may drive it now. */
export const editorTile = (d: EditorData): Tile => {
  const l = d.lock
  if (!l || l.isMissing) return { key: 'editor', label: 'Editor', dot: STATUS.warn, value: 'Lock missing', lines: [{ text: 'unknown, not free' }] }
  if (l.isFree) return { key: 'editor', label: 'Editor', dot: STATUS.ok, value: 'Free', lines: [{ text: l.freeSince ? `since ${l.freeSince}` : 'nobody holds it' }] }
  const isMine = Boolean(l.session && d.me8.startsWith(l.session.slice(0, 8)))
  const end = toMin(l.until)
  const left = end === undefined ? undefined : end - d.nowMin
  const isOver = left !== undefined && left < 0
  const when = l.until ? `until ${l.until}${left === undefined ? '' : isOver ? ` · ${-left} min over` : ` · ${left} min left`}` : 'no end time written'
  return {
    key: 'editor',
    label: 'Editor',
    dot: isOver ? STATUS.bad : isMine ? STATUS.ok : STATUS.warn,
    value: isMine ? 'This session' : (l.who ?? 'Held'),
    lines: [{ text: when, color: isOver ? STATUS.bad : undefined }, ...(l.next ? [{ text: `next: ${l.next}` }] : []), ...(l.dontSave > 0 ? [{ text: `Don't-Save: ${l.dontSave}`, color: STATUS.warn }] : [])],
  }
}

/** Memory: free RAM against the PIE gate, as a meter whose track is a dark step of its own hue. */
export const memoryTile = (el: El, v: Vitals | undefined): Tile => {
  if (!v) return { key: 'memory', label: 'Memory', value: '?', lines: [{ text: 'probe failed' }] }
  const band = ramBand(v.freeGb)
  const tone = band === 'ok' ? 'ok' : band === 'below-start' ? 'warn' : 'bad'
  const cells = 16
  const filled = Math.max(0, Math.min(cells, Math.round((v.freeGb / TOTAL_GB) * cells)))
  const meter = el.Text({ children: [el.Text({ color: STATUS[tone], children: '━'.repeat(filled) }), el.Text({ color: TRACK[tone], children: '━'.repeat(cells - filled) })] })
  const verdict = band === 'ok' ? `PIE ok · gate ${PIE_START_GB} GB` : band === 'below-start' ? `under the ${PIE_START_GB} GB PIE gate` : `abort PIE (under ${PIE_ABORT_GB} GB)`
  return {
    key: 'memory',
    label: 'Memory',
    dot: band === 'ok' ? undefined : STATUS[tone],
    value: `${v.freeGb} GB free`,
    meter,
    lines: [{ text: verdict, color: band === 'ok' ? undefined : STATUS[tone] }, ...(v.git >= 10 ? [{ text: `${v.git} git processes`, color: STATUS.warn }] : [])],
  }
}

/** Branch: this checkout's branch against origin/main, and the way to sync it. */
export const mainTile = (el: El, s: Sync | undefined, onSync: () => void, onRefresh: () => void, isDesktop: boolean, isSyncing = false): Tile => {
  const buttons = [
    el.Button({ key: 'hai-sync-run', label: isSyncing ? 'Syncing…' : 'Sync', plain: isDesktop ? undefined : true, onPress: onSync }),
    el.Button({ key: 'hai-sync-refresh', label: 'Refresh', plain: true, dimColor: true, onPress: onRefresh }),
  ]
  if (!s) return { key: 'main', label: 'Branch', value: 'Reading git…', lines: [], buttons }
  const behind = s.behind ?? 0
  return {
    key: 'main',
    label: s.branch || 'Branch',
    dot: s.flags.length > 0 ? STATUS.bad : behind > 0 ? STATUS.warn : STATUS.ok,
    value: s.behind === null ? 'unknown' : behind > 0 ? `${behind} behind` : 'Up to date',
    lines: [
      { text: `${s.ahead ?? '?'} ahead · fetched ${ago(s.fetchedMinAgo)}` },
      ...s.flags.map(f => ({ text: f, color: STATUS.bad })),
    ],
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
          Text({ color: ATHER.quiet, children: (t.key === 'main' ? 'Branch' : t.label).padEnd(7) }),
          value(t),
          ...(t.meter ? [t.meter] : []),
          ...t.lines.slice(0, 1).map(l => Text({ color: l.color ?? ATHER.quiet, children: `· ${l.text}` })),
          ...(t.buttons ?? []),
        ],
      }),
    ),
  })
}

/** The prompt the Sync button hands to the session: s2-sync-main's read-only phases, then wait. */
export const SYNC_PROMPT =
  'Run s2-sync-main Phase 0 and Phase 1 only: follow C:\\Users\\hai.huynh\\.claude\\skills-paused\\s2-sync-main\\SKILL.md ' +
  '(its preflight script is C:\\Users\\hai.huynh\\.claude\\skills-paused\\s2-sync-main\\preflight.sh). Read-only: no fetch that ' +
  'downloads LFS objects, no merge, no Editor restart. Post the one Vietnamese report the skill describes, then wait for my approval.'
