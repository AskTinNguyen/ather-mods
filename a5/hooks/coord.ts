// A5's coordination core for the sessions that share one S2 checkout and one machine: the Editor holder,
// RAM and the Sync main holder. Pure: no `$`; register.ts reads the files, probes the machine, writes and
// delivers. Every session computes the same answers from the same files, so there is no arbiter to keep
// alive: each session writes only its own files (Saved/A5/editor/<id8>.json, touch/<id8>.json), the
// sync holder alone writes Saved/A5/sync.json, and the head of the queue alone takes a free lock.
// Files are the truth; a notice is only a doorbell.
import { commandVerb, nestedCommand, segments, stripHeredocs, tokenize } from './a5.ts'

export const DIR = 'Saved/A5'
export const HEARTBEAT_STALE_MS = 3 * 60_000 // a session file not refreshed for 3 min: that session is gone
export const LANE_STALE_MS = 10 * 60_000 // Ather's lane heartbeat (30 s) not written for 10 min: gone
export const YIELD_MAX_MIN = 20 // a request this short, without a build, may ask the holder to yield
export const YIELD_EVERY_MS = 60 * 60_000 // at most one interruption per holder per hour
export const CUTOFF_MS = 30 * 60_000 // cutoff = sync − 30 min
export const RELEASE_BEFORE_MS = 10 * 60_000 // the Editor is released by sync − 10 min
export const LEASE_WARN_MS = 5 * 60_000 // the holder is told 5 min before its lease ends
export const IDLE_RELEASE_MS = 15 * 60_000 // an Editor unused this long is released (S2 standard)
export const REAP_BELOW_GB = 14
export const DISK_MIN_GB = 20
export const PIE_START_GB = 5 // fixed, never raised (Hai, 25/09)
export const PIE_ABORT_GB = 3
export const DEFAULT_GATES = { pieGb: 31, nopieGb: 28 } as const // D5: Editor ≈ 25.7 GB idle, ≈ 31.4 GB at PIE peak (L_TALab, 28/09)
export const GATE_MIN_GB = 10
export const GATE_MAX_GB = 60
export const MARK = 'A5 ·'

// ---------- time ----------
const pad = (n: number): string => String(n).padStart(2, '0')
export const hhmm = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const ymd = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** `HH:MM YYYY-MM-DD`, the lock's `since=` stamp. */
export const stampOf = (ms: number): string => `${hhmm(ms)} ${ymd(ms)}`

/** The moment a clock time names, nearest to `now` (an end written as HH:MM can fall either side of midnight). */
export const atNearest = (text: string, now: number): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  let t = d.getTime()
  if (t - now > 12 * 3_600_000) t -= 24 * 3_600_000
  else if (now - t > 12 * 3_600_000) t += 24 * 3_600_000
  return t
}

/** The next time a clock time comes round: today when still ahead, else tomorrow. Null for a bad HH:MM. */
export const atNext = (text: string, now: number): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime() > now ? d.getTime() : d.getTime() + 24 * 3_600_000
}

/** Three sync times the panel offers: the first half hour at least 45 min ahead (a cutoff notice still lands
 * before its cutoff), then one and two hours later. */
export const presetTimes = (now: number): number[] => {
  const d = new Date(now + 45 * 60_000)
  const extra = d.getMinutes() === 0 || d.getMinutes() === 30 ? 0 : d.getMinutes() < 30 ? 30 - d.getMinutes() : 60 - d.getMinutes()
  d.setMinutes(d.getMinutes() + extra, 0, 0)
  const first = d.getTime()
  return [first, first + 3_600_000, first + 7_200_000]
}

// ---------- session files (Saved/A5/editor/<id8>.json, one writer each) ----------
export type Mode = 'interactive' | 'unattended'
/** What a session asked the Editor for. */
export type Want = { minutes: number; pie: boolean; build: boolean; what: string; mode: Mode; pausable: boolean; nextSafe: string; requestedAt: number; launch?: boolean }
/** The lease a session holds, as it took it. */
export type Holding = { since: number; end: number; extended: number }
/** A request to a holder to yield (or a standard `UE request:` line sent to a holder without a5). */
export type YieldAsk = { holder: string; at: number; via: 'file' | 'send'; minutes: number; lane: string }
export type SessionFile = {
  v: 1
  session: string
  id8: string
  lane: string
  title: string
  heartbeatAt: number
  want: Want | null
  holding: Holding | null
  yieldAsks: YieldAsk[]
  /** Notice ids this session has delivered, so a reload never repeats one. */
  delivered: string[]
}

export const blankSession = (session: string, lane: string, title: string, now: number): SessionFile => ({
  v: 1,
  session,
  id8: session.slice(0, 8).toLowerCase(),
  lane,
  title,
  heartbeatAt: now,
  want: null,
  holding: null,
  yieldAsks: [],
  delivered: [],
})

export const parseSessionFile = (text: string | null): SessionFile | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<SessionFile>
    if (typeof v?.id8 !== 'string' || typeof v.heartbeatAt !== 'number') return null
    return { v: 1, session: String(v.session ?? v.id8), id8: v.id8.toLowerCase(), lane: String(v.lane ?? v.id8), title: String(v.title ?? ''), heartbeatAt: v.heartbeatAt, want: v.want ?? null, holding: v.holding ?? null, yieldAsks: Array.isArray(v.yieldAsks) ? v.yieldAsks : [], delivered: Array.isArray(v.delivered) ? v.delivered : [] }
  } catch {
    return null
  }
}

/** Ather's lane heartbeat (Saved/AtherAutomata/lanes/<sessionId>.json): liveness, and the intent and branch it
 * names (A16). */
export type LaneBeat = { sessionId: string; hasEnded: boolean; mtimeMs: number; intent?: string; branch?: string }
export type Liveness = 'alive' | 'gone' | 'unknown'

/** Whether the session named by its first 8 hex is alive, from files only: Ather's lane says ended or is older
 * than 10 min, or its session file is older than 3 min while no fresh lane vouches for it, means gone. With
 * neither file it is unknown, which is never treated as gone. */
export const livenessOf = (id8: string, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): Liveness => {
  if (!id8) return 'unknown'
  const lane = lanes.find(l => l.sessionId.toLowerCase().startsWith(id8))
  if (lane && (lane.hasEnded || now - lane.mtimeMs > LANE_STALE_MS)) return 'gone'
  const file = files.find(f => f.id8 === id8)
  if ((file && now - file.heartbeatAt <= HEARTBEAT_STALE_MS) || lane) return 'alive'
  return file ? 'gone' : 'unknown'
}

// ---------- the Editor owner lock: S2 standard lines (D2) ----------
export type LockKind = 'missing' | 'free' | 'held' | 'handed'
export type LockLine = {
  kind: LockKind
  /** Written in the S2 standard's form (HELD / HANDED / FREE), not a legacy free-text line. */
  isStandard: boolean
  raw: string
  lane: string
  sessionName: string
  id8: string
  since: string
  pid: number | null
  end: string
  mode: string
  pausable: boolean
  nextSafe: string
  note: string
  by: string
  background: string
}

const field = (text: string, re: RegExp): string => re.exec(text)?.[1]?.trim() ?? ''
const blank = (raw: string, kind: LockKind): LockLine => ({ kind, isStandard: false, raw, lane: '', sessionName: '', id8: '', since: '', pid: null, end: '', mode: '', pausable: true, nextSafe: '', note: '', by: '', background: '' })

/** The lock's first line, read the S2 standard's way (HELD / HANDED / FREE) or as an older free-text line: a
 * line without a prefix is FREE when it says "free since", else HELD (the standard, section 1). */
export const parseLockLine = (raw: string | null): LockLine => {
  if (raw === null) return blank('', 'missing')
  const first = (raw.replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim() !== '') ?? '').trim()
  if (first === '') return blank('', 'missing')
  const id8 = /\bsession\s+([0-9a-f]{8})/i.exec(first)?.[1]?.toLowerCase() ?? ''
  const pidText = field(first, /\bpid=(\d+|none)\b/)
  const pid = /^\d+$/.test(pidText) ? Number(pidText) : null
  if (/^FREE\b/.test(first))
    return { ...blank(first, 'free'), isStandard: true, since: field(first, /\bsince=(\d{1,2}:\d{2}(?: \d{4}-\d{2}-\d{2})?)/), by: field(first, /\bby=(\S+)/), note: field(first, /\bnote=(.*?)(?=\s+background=|\s+·\s|$)/), background: field(first, /\bbackground=(\S+)/), pid: /open PID (\d+)/i.test(first) ? Number(/open PID (\d+)/i.exec(first)?.[1]) : null }
  if (/^HELD\b/.test(first))
    return {
      ...blank(first, 'held'),
      isStandard: true,
      lane: field(first, /\blane=(\S+)/),
      sessionName: field(first, /\bsession=(\S+)/),
      id8,
      since: field(first, /\bsince=(\d{1,2}:\d{2}(?: \d{4}-\d{2}-\d{2})?)/),
      pid,
      end: field(first, /\bend=(\d{1,2}:\d{2})/),
      mode: field(first, /\bmode=(\w+)/),
      pausable: field(first, /\bpausable=(yes|no)\b/) !== 'no',
      nextSafe: field(first, /\bnext_safe=(.*?)(?=\s+note=|\s+·\s|$)/),
      note: field(first, /\bnote=(.*?)(?=\s+·\s|$)/),
    }
  if (/^HANDED\b/.test(first))
    return { ...blank(first, 'handed'), isStandard: true, lane: field(first, /\blane=(\S+)/), by: field(first, /\bfrom=(\S+)/), id8, since: field(first, /\bat=(\d{1,2}:\d{2})/), pid, end: field(first, /\breturn_by=(\d{1,2}:\d{2})/), note: field(first, /\bnote=(.*)$/) }
  if (/\bfree since\b/i.test(first) || /^free\b/i.test(first)) return { ...blank(first, 'free'), since: field(first, /free since\s+(\d{1,2}:\d{2})/i) }
  const named = /(?:holder|owner)\s*[:=]\s*([^,;\n]+)|held by\s+([^,;\n]+)/i.exec(first)
  const span = /(\d{1,2}:\d{2})\s*(?:->|→)\s*~?(\d{1,2}:\d{2})/.exec(first)
  return {
    ...blank(first, 'held'),
    lane: (named?.[1] ?? named?.[2] ?? first.split(/\s+/)[0] ?? '').replace(/\buntil\b.*$/i, '').trim().slice(0, 60),
    id8,
    since: span?.[1] ?? field(first, /\bsince\s+(\d{1,2}:\d{2})/i),
    end: span?.[2] ?? field(first, /(?:until|expected end|ends?)\s+~?(\d{1,2}:\d{2})/i),
    note: first.slice(0, 120),
  }
}

/** A word for a key=value field: no spaces, commas, semicolons or the separator. */
export const safeWord = (s: string, max = 40): string =>
  s.replace(/[\s,;·=]+/g, '-').replace(/[\u0000-\u001f"'`]+/g, '').replace(/^-+|-+$/g, '').slice(0, max) || 'unnamed'

/** A note that no lock reader can mistake for a lock field: Ather's and the older parsers look for "free since",
 * "until HH:MM", "held by", "holder:", "session <hex>" and "expected end" anywhere on the line. */
export const safeNote = (s: string, max = 140): string =>
  s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*·\s*/g, '; ')
    .replace(/=/g, ':')
    .replace(/\bfree\b/gi, 'clear')
    .replace(/\buntil\b/gi, 'till')
    .replace(/\bheld by\b/gi, 'held-by')
    .replace(/\bholder\b/gi, 'holding lane')
    .replace(/\bowner\b/gi, 'owning lane')
    .replace(/\bexpected end\b/gi, 'expected finish')
    .replace(/\bsession\s+(?=[0-9a-f]{4})/gi, 'session-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'none'

const safeNextSafe = (s: string): string => (/^\d{1,2}:\d{2}$/.test(s.trim()) ? s.trim() : 'after save')

export type Held = { lane: string; sessionName: string; id8: string; since: number; pid: number | null; end: number; mode: Mode; pausable: boolean; nextSafe: string; note: string }

/** D2: the standard's HELD line, then the words Ather's parser reads (held by, session <id8>, until). */
export const heldLine = (h: Held): string => {
  const lane = safeWord(h.lane)
  return `HELD lane=${lane} session=${safeWord(h.sessionName)} since=${stampOf(h.since)} pid=${h.pid ?? 'none'} end=${hhmm(h.end)} mode=${h.mode} pausable=${h.pausable ? 'yes' : 'no'} next_safe=${safeNextSafe(h.nextSafe)} note=${safeNote(h.note)} · held by ${lane}, session ${h.id8}, until ${hhmm(h.end)}`
}

/** D2: the standard's FREE line, then the words every older reader takes for free. */
export const freeLine = (f: { since: number; by: string; note: string; background: 'none' | 'unknown' }): string =>
  `FREE since=${stampOf(f.since)} by=${safeWord(f.by)} note=${safeNote(f.note)} background=${f.background} · free since ${hhmm(f.since)}`

// ---------- the queue and the grant ----------
export type Gates = { pieGb: number; nopieGb: number }
export const clampGate = (n: number): number => Math.max(GATE_MIN_GB, Math.min(GATE_MAX_GB, Math.round(n)))
/** The launch gate in force: the panel's setting (shared through the plugin's store) over the plugin options. */
export const gatesOf = (stored: unknown, pieOpt: unknown, nopieOpt: unknown): Gates & { source: 'panel' | 'options' } => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clampGate(v) : typeof v === 'string' && Number.isFinite(Number(v)) && v.trim() !== '' ? clampGate(Number(v)) : d)
  const s = stored as Partial<Gates> | null | undefined
  const fromOpts = { pieGb: num(pieOpt, DEFAULT_GATES.pieGb), nopieGb: num(nopieOpt, DEFAULT_GATES.nopieGb) }
  if (s && typeof s.pieGb === 'number' && typeof s.nopieGb === 'number') return { pieGb: clampGate(s.pieGb), nopieGb: clampGate(s.nopieGb), source: 'panel' }
  return { ...fromOpts, source: 'options' }
}

export type Proc = { name: string; pid: number; gb: number; parentAlive: boolean }
export type Probe = { freeGb: number; diskGb: number | null; procs: Proc[] }

const isName = (p: Proc, name: string) => p.name.toLowerCase().replace(/\.exe$/, '') === name.toLowerCase()
export const editorPid = (probe: Probe | null): number | null => probe?.procs.find(p => isName(p, 'UnrealEditor'))?.pid ?? null

/** The machine probe's JSON (`ramProbe`), or null when it did not answer. */
export const parseProbe = (stdout: string): Probe | null => {
  try {
    const v = JSON.parse(stdout.trim()) as { freeGb?: unknown; diskGb?: unknown; procs?: unknown }
    const free = Number(v.freeGb)
    if (!Number.isFinite(free) || free <= 0) return null
    const disk = Number(v.diskGb)
    const raw = Array.isArray(v.procs) ? v.procs : v.procs && typeof v.procs === 'object' ? [v.procs] : []
    const procs = raw
      .map(p => p as Record<string, unknown>)
      .map(p => ({ name: String(p.name ?? '').replace(/\.exe$/i, ''), pid: Number(p.pid), gb: Number(p.gb ?? 0), parentAlive: p.parentAlive !== false }))
      .filter(p => p.name && Number.isFinite(p.pid))
    return { freeGb: free, diskGb: Number.isFinite(disk) && disk >= 0 ? disk : null, procs }
  } catch {
    return null
  }
}

/** Saved/A5/probe.json: the last machine reading, shared by every A5 session (A9). A session probes only when
 * it is older than this; the session probing writes it (a claim first, then the reading). */
export const PROBE_FRESH_MS = 50_000
export type SharedProbe = { at: number; by: string; probe: Probe | null }
export const parseSharedProbe = (text: string | null): SharedProbe | null => {
  try {
    const v = JSON.parse(text ?? '') as { at?: unknown; by?: unknown; probe?: unknown }
    if (typeof v?.at !== 'number') return null
    return { at: v.at, by: String(v.by ?? ''), probe: v.probe ? parseProbe(JSON.stringify(v.probe)) : null }
  } catch {
    return null
  }
}

/** One PowerShell probe: free RAM, the checkout drive's free space, and the heavy processes (pid, working set,
 * whether the parent is alive), as one JSON line. */
export const ramProbe = (drive: string): string[] => [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  [
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)',
    `$d = Get-PSDrive -Name '${drive.replace(/[^A-Za-z]/g, '').slice(0, 1) || 'E'}' -ErrorAction SilentlyContinue`,
    '$disk = if ($d) { [math]::Round($d.Free / 1GB, 1) } else { -1 }',
    '$alive = @{}; Get-Process | ForEach-Object { $alive[[int]$_.Id] = 1 }',
    "$names = @('git.exe','LiveCodingConsole.exe','UnrealEditor.exe','UnrealEditor-Cmd.exe','ShaderCompileWorker.exe','python.exe')",
    "$procs = @(Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | ForEach-Object { [pscustomobject]@{ name = $_.Name -replace '\\.exe$',''; pid = [int]$_.ProcessId; gb = [math]::Round($_.WorkingSetSize / 1GB, 2); parentAlive = $alive.ContainsKey([int]$_.ParentProcessId) } })",
    '[pscustomobject]@{ freeGb = $free; diskGb = $disk; procs = $procs } | ConvertTo-Json -Compress -Depth 3',
  ].join('; '),
]

/** The safe cleanup before a grant: the S2 orphan-git reaper below 14 GB free, LiveCodingConsole stopped only
 * while no Editor runs; everything else is named, never killed. */
export const cleanupPlan = (probe: Probe): { reap: boolean; stopLiveCoding: number[]; report: string[] } => {
  const hasEditor = probe.procs.some(p => isName(p, 'UnrealEditor'))
  const live = probe.procs.filter(p => isName(p, 'LiveCodingConsole'))
  const orphans = probe.procs.filter(p => isName(p, 'git') && !p.parentAlive).length
  const report: string[] = []
  if (hasEditor && live.length) report.push(`LiveCodingConsole kept (an Editor runs): ${live.map(p => `pid ${p.pid}`).join(', ')}`)
  for (const name of ['UnrealEditor-Cmd', 'ShaderCompileWorker', 'python']) {
    const ps = probe.procs.filter(p => isName(p, name))
    if (ps.length) report.push(`${name} ×${ps.length} ${round(ps.reduce((a, p) => a + p.gb, 0))} GB (not killed)`)
  }
  if (orphans && probe.freeGb >= REAP_BELOW_GB) report.push(`${orphans} orphan git (reaped only under ${REAP_BELOW_GB} GB free)`)
  return { reap: probe.freeGb < REAP_BELOW_GB, stopLiveCoding: hasEditor ? [] : live.map(p => p.pid), report }
}

const round = (n: number): number => Math.round(n * 10) / 10

/** What holds memory, heaviest first: the line the Memory tile and a waiting slot show. */
export const heavyList = (probe: Probe, max = 4): string => {
  const by = new Map<string, { n: number; gb: number }>()
  for (const p of probe.procs) {
    const k = p.name
    const was = by.get(k) ?? { n: 0, gb: 0 }
    by.set(k, { n: was.n + 1, gb: was.gb + p.gb })
  }
  const rows = [...by.entries()].sort((a, b) => b[1].gb - a[1].gb).slice(0, max)
  return rows.length ? rows.map(([k, v]) => `${k}${v.n > 1 ? ` ×${v.n}` : ''} ${round(v.gb)} GB`).join(', ') : 'no heavy process'
}

/** D8: whether the session holding a sync is gone (files only; unknown is not gone). */
export const isSyncHolderGone = (s: SyncFile | null, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): boolean =>
  Boolean(s) && livenessOf(s?.holder.id8 ?? '', files, lanes, now) === 'gone'

/** The order every session computes alike: live waiting requests, first requested first served, the sync holder
 * first while a sync is in its cutoff or freeze. */
export const queueOf = (files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number, sync: SyncFile | null): SessionFile[] => {
  const phase = syncPhase(sync, now, isSyncHolderGone(sync, files, lanes, now))
  const first = phase === 'cutoff' || phase === 'frozen' ? sync?.holder.id8 : undefined
  const rank = (f: SessionFile) => (first && f.id8 === first ? 0 : 1)
  return files
    .filter(f => f.want && !f.holding && livenessOf(f.id8, files, lanes, now) === 'alive')
    .sort((a, b) => rank(a) - rank(b) || (a.want?.requestedAt ?? 0) - (b.want?.requestedAt ?? 0) || a.id8.localeCompare(b.id8))
}

export type WaitCode = 'missing' | 'held' | 'gone-editor' | 'queue' | 'sync' | 'ram' | 'probe'
export type Decision =
  | { kind: 'none' }
  | { kind: 'mine' }
  | { kind: 'grant'; end: number; reuse: number | null }
  | { kind: 'recover'; holder: string }
  | { kind: 'wait'; code: WaitCode; why: string; next: string; place: number }

export type GrantInput = {
  me8: string
  lock: LockLine
  files: readonly SessionFile[]
  lanes: readonly LaneBeat[]
  now: number
  sync: SyncFile | null
  probe: Probe | null
  gates: Gates
}

/** Whether this session may take the Editor now, and if not why and what next. Only the head of the queue takes
 * a free lock; the slot must end by the next sync's cutoff (or wait out a cutoff and freeze, the sync holder
 * excepted); launching an Editor needs the launch gate (an Editor already open is reused, its memory counted). */
export const decide = (x: GrantInput): Decision => {
  const { me8, lock, now, sync } = x
  const queue = queueOf(x.files, x.lanes, now, sync)
  const mine = x.files.find(f => f.id8 === me8)
  if (lock.id8 === me8 && (lock.kind === 'held' || lock.kind === 'handed')) return { kind: 'mine' }
  if (!mine?.want) return { kind: 'none' }
  const place = Math.max(1, queue.findIndex(f => f.id8 === me8) + 1)
  const wait = (code: WaitCode, why: string, next: string): Decision => ({ kind: 'wait', code, why, next, place })
  const pid = editorPid(x.probe)
  if (lock.kind === 'missing') return wait('missing', 'Saved/EDITOR_OWNER.txt is missing or empty: unknown, not free', 'nobody takes it until a lane writes it; ask Hai if it stays missing')
  if (lock.kind === 'held' || lock.kind === 'handed') {
    const who = lock.lane || 'another lane'
    const until = lock.end ? ` until ${lock.end}` : ''
    const live = livenessOf(lock.id8, x.files, x.lanes, now)
    if (live === 'gone' && pid === null && queue[0]?.id8 === me8) return { kind: 'recover', holder: lock.id8 }
    if (live === 'gone' && pid !== null) return wait('gone-editor', `${who} (session ${lock.id8}) is gone but UnrealEditor PID ${pid} still runs`, 'never kill it or drive it; ask Hai what to do with that Editor')
    return wait('held', `${who}${lock.id8 ? ` (session ${lock.id8})` : ''} holds the Editor${until}`, place > 1 ? `you are ${ordinal(place)} in the queue; do work that needs no Editor meanwhile` : 'you are next; do work that needs no Editor meanwhile')
  }
  if (queue[0]?.id8 !== me8) return wait('queue', `the Editor is free but ${queue[0]?.lane ?? 'another session'} asked first`, `you are ${ordinal(place)} in the queue; do work that needs no Editor meanwhile`)
  const want = mine.want
  const end = now + want.minutes * 60_000
  const phase = syncPhase(sync, now, isSyncHolderGone(sync, x.files, x.lanes, now))
  if (sync && phase === 'planned' && end > sync.at - CUTOFF_MS) {
    const room = Math.floor((sync.at - CUTOFF_MS - now) / 60_000)
    return wait('sync', `a ${want.minutes}-min slot would end at ${hhmm(end)}, past the cutoff ${hhmm(sync.at - CUTOFF_MS)} of the sync at ${hhmm(sync.at)}`, room >= 5 ? `ask again for ≤ ${room} min, or wait until the sync is done` : 'wait until the sync is done')
  }
  if (sync && (phase === 'cutoff' || phase === 'frozen') && sync.holder.id8 !== me8)
    return wait('sync', `the sync at ${hhmm(sync.at)} is in its ${phase === 'cutoff' ? 'cutoff' : 'freeze'}`, 'Editor grants wait until it is done')
  // The launch gate guards a launch: a slot that never launches the Editor (the sync worker's) skips it.
  if (pid === null && want.launch !== false) {
    if (!x.probe) return wait('probe', 'the RAM probe did not answer', 'the slot waits for a reading (the launch gate fails closed)')
    const gate = want.pie ? x.gates.pieGb : x.gates.nopieGb
    if (x.probe.freeGb < gate)
      return wait('ram', `free RAM is ${x.probe.freeGb} GB after cleanup, under the launch gate of ${gate} GB for a slot ${want.pie ? 'with' : 'without'} PIE`, `the slot waits; memory is held by ${heavyList(x.probe)}`)
  }
  return { kind: 'grant', end, reuse: pid }
}

export const ordinal = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

/** Whether a request may ask the holder to yield now: ≤ 20 min without a build, at the head of the queue, the
 * holder alive and pausable, and nobody asked that holder in the last hour. */
export const mayAskYield = (x: GrantInput): { holder: string } | null => {
  const mine = x.files.find(f => f.id8 === x.me8)
  const want = mine?.want
  if (!want || want.build || want.minutes > YIELD_MAX_MIN) return null
  if (x.lock.kind !== 'held' || !x.lock.id8 || x.lock.id8 === x.me8 || !x.lock.pausable) return null
  if (livenessOf(x.lock.id8, x.files, x.lanes, x.now) !== 'alive') return null
  if (queueOf(x.files, x.lanes, x.now, x.sync)[0]?.id8 !== x.me8) return null
  const asked = x.files.some(f => f.yieldAsks.some(a => a.holder === x.lock.id8 && x.now - a.at < YIELD_EVERY_MS))
  return asked ? null : { holder: x.lock.id8 }
}

/** The standard's request line (section 6) for a holder that runs without a5. */
export const ueRequestLine = (lane: string, minutes: number, what: string, waitUntil: number): string =>
  `UE request: ${lane} cần Editor ~${minutes} phút để ${what.replace(/\s+/g, ' ').slice(0, 120)}, build=no, chờ được tới ${hhmm(waitUntil)}.`

// ---------- the sync timeline (Saved/A5/sync.json, written by the holder alone) ----------
export type SyncState = 'planned' | 'done' | 'aborted' | 'cancelled' | 'expired'
/** D8: how long a freeze may last past T (its hard end), by default: a merge, or a merge with a build. */
export const SYNC_MERGE_MIN = 45
export const SYNC_BUILD_MIN = 90
export const HARD_END_WARN_MS = 10 * 60_000 // the holder is told this long before the hard end
export type Conflict = { path: string; kind: 'self' | 'foreign'; match?: string }
export type SyncHolder = { session: string; id8: string; lane: string }
export type SyncFile = {
  v: 1
  id: string
  at: number
  holder: SyncHolder
  plannedBy: string
  state: SyncState
  conflicts: Conflict[] | null
  conflictsAt: number | null
  conflictsSource: 'merge-tree' | 'holder' | null
  /** Paths origin/main adds that already exist on disk in the shared checkout (A11): the merge would refuse or
   * overwrite them, and merge-tree does not see them. Null until the holder's dry-run lists them. */
  untracked: string[] | null
  /** D8: the sync includes a build; its freeze may last longer. */
  build: boolean
  /** D8: the freeze's hard end (T + 45 min, T + 90 min with a build): past it the sync expires. */
  hardEnd: number
  /** D7: the sync worker the holder's a5 spawned at T (once per sync), and when. */
  workerId: string | null
  workerAt: number | null
  /** A16: sessions without a5 0.4 the holder has sent the standard message to (by session id). */
  messaged: string[]
  endedAt: number | null
  note: string
  updatedAt: number
}
export type Phase = 'none' | 'planned' | 'cutoff' | 'frozen' | 'done' | 'aborted' | 'cancelled' | 'expired'

export const parseSyncFile = (text: string | null): SyncFile | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<SyncFile>
    if (typeof v?.at !== 'number' || !v.holder || typeof v.holder.id8 !== 'string') return null
    const build = v.build === true
    return {
      v: 1,
      id: String(v.id ?? `sync-${v.at}`),
      at: v.at,
      holder: v.holder,
      plannedBy: String(v.plannedBy ?? ''),
      state: (v.state as SyncState) ?? 'planned',
      conflicts: v.conflicts ?? null,
      conflictsAt: v.conflictsAt ?? null,
      conflictsSource: v.conflictsSource ?? null,
      untracked: Array.isArray(v.untracked) ? v.untracked.map(String) : null,
      build,
      hardEnd: typeof v.hardEnd === 'number' ? v.hardEnd : v.at + (build ? SYNC_BUILD_MIN : SYNC_MERGE_MIN) * 60_000, // a 0.4 file: the default end
      workerId: typeof v.workerId === 'string' ? v.workerId : null,
      workerAt: typeof v.workerAt === 'number' ? v.workerAt : null,
      messaged: Array.isArray(v.messaged) ? v.messaged.map(String) : [],
      endedAt: v.endedAt ?? null,
      note: String(v.note ?? ''),
      updatedAt: Number(v.updatedAt ?? 0),
    }
  } catch {
    return null
  }
}

/** planned → cutoff at T − 30 → frozen at T → done / aborted (or cancelled before T). D8: the freeze is a lease:
 * past its hard end, or once the holder session is gone while frozen, it is `expired` for every reader at once,
 * whoever writes that down first. */
export const syncPhase = (s: SyncFile | null, now: number, isHolderGone = false): Phase => {
  if (!s) return 'none'
  if (s.state !== 'planned') return s.state
  if (now < s.at - CUTOFF_MS) return 'planned'
  if (now < s.at) return 'cutoff'
  return now >= s.hardEnd || isHolderGone ? 'expired' : 'frozen'
}
export const isOpenPhase = (p: Phase): boolean => p === 'planned' || p === 'cutoff' || p === 'frozen'

export const newSync = (at: number, holder: SyncHolder, plannedBy: string, now: number, build = false, freezeMin = build ? SYNC_BUILD_MIN : SYNC_MERGE_MIN): SyncFile => ({
  v: 1,
  id: `sync-${ymd(at).replace(/-/g, '')}-${hhmm(at).replace(':', '')}-${holder.id8}`,
  at,
  holder,
  plannedBy,
  state: 'planned',
  conflicts: null,
  conflictsAt: null,
  conflictsSource: null,
  untracked: null,
  build,
  hardEnd: at + freezeMin * 60_000,
  workerId: null,
  workerAt: null,
  messaged: [],
  endedAt: null,
  note: '',
  updatedAt: now,
})
/** A move keeps the sync's id and the length of its freeze; its notices are keyed by its time too, so a moved
 * sync gets them again. */
export const movedSync = (s: SyncFile, at: number, now: number): SyncFile => ({ ...s, at, hardEnd: at + (s.hardEnd - s.at), conflicts: null, conflictsAt: null, conflictsSource: null, untracked: null, messaged: [], updatedAt: now })
/** The build flag of a planned sync, with its freeze length to match (D8). */
export const withBuild = (s: SyncFile, build: boolean, freezeMin: number, now: number): SyncFile => ({ ...s, build, hardEnd: s.at + freezeMin * 60_000, updatedAt: now })
export const withUntracked = (s: SyncFile, paths: readonly string[], now: number): SyncFile => ({ ...s, untracked: [...paths], updatedAt: now })

/** `git diff --name-only -z --diff-filter=A HEAD origin/main`: the paths main adds, NUL-separated (no quoting). */
export const parseAdded = (stdout: string): string[] => [...new Set(stdout.split('\0').map(p => p.replace(/[\r\n]+/g, '').trim()).filter(Boolean))]
export const endedSync = (s: SyncFile, state: 'done' | 'aborted' | 'cancelled' | 'expired', note: string, now: number): SyncFile => ({ ...s, state, note: note.slice(0, 200), endedAt: now, updatedAt: now })
export const withConflicts = (s: SyncFile, conflicts: Conflict[], source: 'merge-tree' | 'holder', now: number): SyncFile => ({ ...s, conflicts, conflictsAt: now, conflictsSource: source, updatedAt: now })

/** `git merge-tree --write-tree --name-only HEAD origin/main`: the tree, then the conflicted paths up to the
 * first blank line (informational messages follow it). Exit 1 means conflicts, 0 a clean merge. */
export const parseMergeTree = (stdout: string): { tree: string; paths: string[] } => {
  const lines = stdout.replace(/\r/g, '').split('\n')
  const paths: string[] = []
  for (const l of lines.slice(1)) {
    if (l.trim() === '') break
    if (!paths.includes(l.trim())) paths.push(l.trim())
  }
  return { tree: (lines[0] ?? '').trim(), paths }
}

/** Every blob a path has had in this branch's history (`git log --format=%H --raw --no-abbrev HEAD -- <path>`),
 * mapped to the commit that wrote it. */
export const historyBlobs = (rawLog: string): Map<string, string> => {
  const out = new Map<string, string>()
  let commit = ''
  for (const l of rawLog.replace(/\r/g, '').split('\n')) {
    if (/^[0-9a-f]{40}$/.test(l.trim())) commit = l.trim()
    const m = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) /.exec(l)
    if (m?.[2] && !/^0+$/.test(m[2]) && !out.has(m[2])) out.set(m[2], commit)
  }
  return out
}

/** Runbook-sync-lane rule 11: main's blob for the path equals one this branch had, so main only holds an older
 * version of ours (a self-conflict, resolved to ours); otherwise main carries a foreign change. */
export const classify = (path: string, mainBlob: string, blobs: Map<string, string>): Conflict => {
  const match = mainBlob ? blobs.get(mainBlob) : undefined
  return match ? { path, kind: 'self', match: match.slice(0, 12) } : { path, kind: 'foreign' }
}

/** Saved/A5/touch/<id8>.json: the repo-relative paths a session and its workers edited in the shared
 * checkout, so a conflict reaches the session that owns it. */
export type Touch = { session: string; id8: string; lane: string; paths: string[]; updatedAt: number }
export const parseTouch = (text: string | null): Touch | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<Touch>
    return typeof v?.id8 === 'string' && Array.isArray(v.paths) ? { session: String(v.session ?? v.id8), id8: v.id8, lane: String(v.lane ?? v.id8), paths: v.paths.map(String), updatedAt: Number(v.updatedAt ?? 0) } : null
  } catch {
    return null
  }
}
const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
export const ownersOf = (path: string, touches: readonly Touch[]): Touch[] => touches.filter(t => t.paths.some(p => samePath(p, path)))
export const isBinaryAsset = (path: string): boolean => /\.(uasset|umap)$/i.test(path)

// ---------- freeze: git writes and Editor use in the shared checkout ----------
export const FREEZE_VERBS = new Set(['commit', 'add', 'rm', 'mv', 'checkout', 'switch', 'restore', 'reset', 'stash', 'merge', 'rebase', 'pull', 'push', 'cherry-pick', 'revert', 'clean', 'am'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'])

/** The git writes a command makes (`git [-C dir] [-c k=v] <verb>`), each with the folder it runs in ('' = the
 * working directory). `git stash list|show` only reads. */
export const gitWrites = (command: string, depth = 0): { verb: string; dir: string }[] => {
  const out: { verb: string; dir: string }[] = []
  for (const seg of segments(stripHeredocs(command ?? ''))) {
    const [verb, args] = commandVerb(tokenize(seg))
    if (SHELLS.has(verb) && depth < 2) {
      out.push(...gitWrites(nestedCommand(verb, args), depth + 1))
      continue
    }
    if (verb !== 'git') continue
    let dir = ''
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i] ?? ''
      if (a === '-C') {
        dir = args[i + 1] ?? ''
        i += 1
      } else if (a === '-c' || ((a === '--git-dir' || a === '--work-tree' || a === '--namespace') && !a.includes('='))) i += 1
      else if (a.startsWith('-')) continue
      else {
        const next = (args[i + 1] ?? '').toLowerCase()
        if (FREEZE_VERBS.has(a.toLowerCase()) && !(a.toLowerCase() === 'stash' && (next === 'list' || next === 'show'))) out.push({ verb: a.toLowerCase(), dir })
        break
      }
    }
  }
  return out
}

/** A15: whether a command is only the sync's own git work, which the holder and its worker may run during their
 * frozen phase without A5's asks: `git merge [--no-edit|--no-ff|--no-commit] origin/main`, `git merge --abort`,
 * `git checkout --ours|--theirs -- <paths>`, `git revert -m 1 <sha> [--no-edit]`, `git add -- <paths>`,
 * `git commit [-m <msg>|--no-edit|-F <file>|-q]`, beside git reads; every segment must be git (env assignments such
 * as GIT_TERMINAL_PROMPT=0 allowed), no nested shell, no `.` or `-A` path, no `--amend` or `-a`. */
export const isSyncCommandOnly = (command: string): boolean => {
  const segs = segments(stripHeredocs(command ?? ''))
  if (segs.length === 0) return false
  return segs.every(seg => {
    const [verb, args] = commandVerb(tokenize(seg))
    if (verb !== 'git') return false
    if (gitWrites(seg).length === 0) return true // a read
    let i = 0
    while (i < args.length) {
      const a = args[i] ?? ''
      if (a === '-C' || a === '-c') i += 2
      else if (a === '--no-pager' || /^--(git-dir|work-tree)=/.test(a)) i += 1
      else break
    }
    const sub = (args[i] ?? '').toLowerCase()
    const rest = args.slice(i + 1)
    const isPath = (p: string) => p !== '' && p !== '.' && p !== '*' && !p.startsWith('-')
    const pathsAfterDashes = (xs: string[]) => xs.length >= 2 && xs[0] === '--' && xs.slice(1).every(isPath)
    if (sub === 'merge') {
      if (rest.length === 1 && rest[0] === '--abort') return true
      const opts = rest.filter(r => r.startsWith('-'))
      const targets = rest.filter(r => !r.startsWith('-'))
      return targets.length === 1 && targets[0] === 'origin/main' && opts.every(o => ['--no-edit', '--no-ff', '--no-commit'].includes(o))
    }
    if (sub === 'checkout') return (rest[0] === '--ours' || rest[0] === '--theirs') && pathsAfterDashes(rest.slice(1))
    if (sub === 'revert') {
      const r = rest.filter(x => x !== '--no-edit')
      return r.length === 3 && r[0] === '-m' && r[1] === '1' && /^([0-9a-f]{7,40}|HEAD)$/i.test(r[2] ?? '')
    }
    if (sub === 'add') return pathsAfterDashes(rest)
    if (sub === 'commit') {
      for (let n = 0; n < rest.length; n += 1) {
        const r = rest[n] ?? ''
        if (r === '-m' || r === '--message' || r === '-F' || r === '--file') n += 1
        else if (!(r === '--no-edit' || r === '-q' || r === '--quiet' || /^--(message|file)=/.test(r))) return false
      }
      return true
    }
    return false
  })
}

/** An Edit/Write path that is the Editor owner lock. */
export const isLockPath = (path: string): boolean => /(^|\/)Saved\/EDITOR_OWNER\.txt$/i.test((path ?? '').replace(/\\/g, '/'))

const LOCK_WRITERS = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee', 'tee-object', 'new-item', 'ni', 'copy-item', 'cp', 'copy', 'cpi', 'move-item', 'mv', 'move', 'mi', 'rm', 'del', 'erase', 'remove-item', 'ri', 'clear-content', 'clc', 'truncate', 'dd'])

/** A shell command that writes the lock: a redirect into it, a writing verb that names it, an in-place sed,
 * or a .NET file write. Reading it is fine. */
export const writesLock = (command: string): boolean =>
  segments(stripHeredocs(command ?? '')).some(seg => {
    if (!/EDITOR_OWNER\.txt/i.test(seg)) return false
    if (/(>>?|\|\s*(tee|Out-File|Set-Content|Add-Content)\b)[^|]*EDITOR_OWNER\.txt/i.test(seg)) return true
    if (/WriteAll(Text|Lines|Bytes)|AppendAll(Text|Lines)/i.test(seg)) return true
    const [verb, args] = commandVerb(tokenize(seg))
    if (verb === 'sed' && args.some(a => /^-i/.test(a))) return true
    if (SHELLS.has(verb)) return writesLock(nestedCommand(verb, args))
    return LOCK_WRITERS.has(verb)
  })

// ---------- notices (D6): one shape, one delivery per id per session ----------
export type Notice = { id: string; text: string; isActionable: boolean }
export const noticeText = (gate: string, what: string, todo: string): string => `${MARK} ${gate} — ${what} → ${todo}`
export const isIntentFile = (path: string): boolean => /(^|\/)docs\/intent\//i.test((path ?? '').replace(/\\/g, '/'))
export const addsNotice = (added: readonly string[]): boolean => added.some(l => l.includes(MARK))
/** A shell command that writes a a5 line into an intent file (a redirect, tee or a PowerShell writer, a
 * heredoc body included). Best effort, like every shell check here. */
export const writesNoticeToIntent = (command: string): boolean =>
  (command ?? '').includes(MARK) && /(>>?|\btee\b|Out-File|Set-Content|Add-Content)\s*(-\w+\s+)*['"]?[^|;&\n]*docs[\\/]+intent[\\/]/i.test(command ?? '')

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const NOTICES = {
  granted: (end: number, pie: boolean, reuse: number | null, cleanup: string): Notice['text'] =>
    noticeText('Editor', `granted to this session until ${hhmm(end)}${reuse ? ` (UnrealEditor PID ${reuse} is open: reuse it)` : ''}${cleanup ? `; cleanup: ${cleanup}` : ''}`, `${reuse ? 'use that Editor' : 'launch the Editor'}${pie ? ' (PIE needs 5 GB free to start)' : ''}; release with the editor tool (action release) when done, and before ${hhmm(end)}`),
  leaseEnding: (end: number): string => noticeText('Editor lease', `your lease ends at ${hhmm(end)}`, 'finish to a checkpoint (PIE stopped, your own assets saved), then release with the editor tool, or extend it if it still fits'),
  overrun: (end: number): string => noticeText('Editor lease', `your lease ended at ${hhmm(end)}`, 'stop at the nearest checkpoint and release now with the editor tool; ask again for the rest (almost done is no reason to overrun)'),
  idle: (min: number): string => noticeText('Editor lease', `this session holds the Editor but has not used it for ${min} min`, 'release it with the editor tool (the Editor may stay open: say so in the note)'),
  yield: (lane: string, minutes: number): string => noticeText('Editor yield', `${lane} asks for the Editor for ~${minutes} min, no build`, 'at your next safe point (≤ 10 min): stop PIE, save only your own assets, release with the editor tool; if you cannot pause, keep it and finish by your end time'),
  recovered: (holder: string): string => noticeText('Editor', `the lease of session ${holder} was stale (its lane is gone, no UnrealEditor runs) and was freed`, 'nothing to do: the queue goes on'),
  goneEditor: (who: string, pid: number): string => noticeText('Editor', `${who} is gone but UnrealEditor PID ${pid} still runs`, 'never kill it or drive it; tell Hai and wait (AGENTS.md: force-kill only a hung Editor whose holder is confirmed gone)'),
  pieAbort: (free: number): string => noticeText('RAM', `free RAM is ${free} GB, under the ${PIE_ABORT_GB} GB abort line, while this session's PIE runs`, 'stop PIE now, then free memory before starting it again'),
  disk: (drive: string, free: number): string => noticeText('Disk', `${drive} has ${free} GB free, under ${DISK_MIN_GB} GB (the DDC refuses writes under 10 GB)`, 'tell Hai; move old Saved/_restore_backup or _train_residue copies to another drive, never delete them'),
  cutoff: (s: SyncFile, isHolder: boolean, lockMine: boolean): string =>
    isHolder
      ? noticeText('Sync main', `cutoff: you hold the sync at ${hhmm(s.at)}`, `checkpoint your own work now and release the Editor by ${hhmm(s.at - RELEASE_BEFORE_MS)}; the conflict dry-run runs now and lands in sync.json; at ${hhmm(s.at)} a5 starts the sync worker, which runs the merge and ends it with done or abort (at the latest ${hhmm(s.hardEnd)})`)
      : noticeText('Sync main', `cutoff: ${s.holder.lane} merges origin/main at ${hhmm(s.at)}`, `commit your own paths now (exact paths, wip: is fine), write your resume note in Saved/LANE_NOTES/<session id>.md, stop PIE and ${lockMine ? 'release the Editor' : 'leave the Editor alone'} by ${hhmm(s.at - RELEASE_BEFORE_MS)}; keep Source/ and Plugins/ edits out of the shared tree from now; from ${hhmm(s.at)} git writes and the Editor wait until the sync is done`),
  releaseBy: (s: SyncFile): string => noticeText('Sync main', `the sync at ${hhmm(s.at)} needs the Editor free by ${hhmm(s.at - RELEASE_BEFORE_MS)} and this session still holds it`, 'stop PIE, save your own assets, release with the editor tool now'),
  frozen: (s: SyncFile): string => noticeText('Sync main', `frozen: ${s.holder.lane} merges origin/main since ${hhmm(s.at)}`, 'no git writes in the shared checkout and no Editor use until it is done; keep working without them (or in your own worktree); you will be told when it lifts'),
  frozenHolder: (s: SyncFile): string => noticeText('Sync main', `it is ${hhmm(s.at)}: every other session's git writes and Editor use are held for your sync, and the sync worker runs the merge in the background`, `leave git and the Editor in the shared checkout to it; it ends with done or abort (at the latest ${hhmm(s.hardEnd)}); you are told when it ends`),
  workerFailed: (s: SyncFile, why: string): string => noticeText('Sync main', `the sync worker for ${hhmm(s.at)} could not start (${why})`, `run the merge yourself by the sync procedure (git non-interactive, rule 11, abort on a logic or .uasset/.umap conflict), then call the sync tool with done or abort before ${hhmm(s.hardEnd)}`),
  workerEnded: (s: SyncFile): string => noticeText('Sync main', `the sync worker ended without done or abort, so the sync at ${hhmm(s.at)} was aborted for it (${s.note})`, 'check the shared checkout (git status, .git/MERGE_HEAD) before anything else and tell Hai what you find; plan a new sync once it is clean'),
  lifted: (s: SyncFile): string =>
    s.state === 'done'
      ? noticeText('Sync main', `done at ${hhmm(s.endedAt ?? s.updatedAt)}${s.note ? ` (${s.note})` : ''}`, 'git and the Editor are open again: resume from your resume note and re-check the files main changed before trusting old measurements')
      : noticeText('Sync main', `${s.state} at ${hhmm(s.endedAt ?? s.updatedAt)}${s.note ? ` (${s.note})` : ''}`, 'git and the Editor are open again; your work stays as it is; the next sync is planned on the A5 panel'),
  holderConflicts: (s: SyncFile, rows: { c: Conflict; owners: string[] }[]): string => {
    const self = rows.filter(r => r.c.kind === 'self')
    const foreign = rows.filter(r => r.c.kind === 'foreign')
    const list = foreign.map(r => `${r.c.path}${isBinaryAsset(r.c.path) ? ' (binary)' : ''} → ${r.owners.length ? r.owners.join(', ') : 'owner unknown'}`).join('; ')
    return noticeText('Sync main', `dry-run for ${hhmm(s.at)}: ${plural(rows.length, 'conflict')} (${self.length} self, ${foreign.length} foreign)${list ? `: ${list}` : ''}`, `${self.length ? 'self-conflicts resolve to ours at the merge (rule 11, log each with its commit); ' : ''}${foreign.length ? 'a mechanical text conflict (both sides additive) you resolve and check with git diff --check; a logic or .uasset/.umap conflict → git merge --abort and the path goes to its owner; owner unknown → 🟥 to Hai' : 'nothing else to do'}`)
  },
  ownerConflicts: (s: SyncFile, mine: Conflict[]): string => {
    const self = mine.filter(c => c.kind === 'self')
    const foreign = mine.filter(c => c.kind === 'foreign')
    const parts = [
      foreign.length ? `foreign change on main in ${foreign.map(c => c.path).join(', ')}` : '',
      self.length ? `self-conflict in ${self.map(c => `${c.path} (main holds our ${c.match})`).join(', ')}` : '',
    ].filter(Boolean)
    return noticeText('Sync main', `${parts.join('; ')} for the sync at ${hhmm(s.at)}; this session edited ${mine.length === 1 ? 'that path' : 'those paths'}`, `${foreign.length ? `before ${hhmm(s.at)}: commit your own version (exact paths) and tell ${s.holder.lane} how the two sides combine; a logic or .uasset/.umap conflict means the merge is aborted and you resolve it after the sync (the owner decides, never discard either side)` : ''}${foreign.length && self.length ? '; ' : ''}${self.length ? 'a self-conflict needs nothing from you: the holder resolves it to ours (rule 11)' : ''}`)
  },
  ownerUntracked: (s: SyncFile, paths: readonly string[]): string =>
    noticeText('Sync main', `origin/main adds ${paths.join(', ')}, which already ${paths.length === 1 ? 'exists' : 'exist'} untracked in the shared checkout and ${paths.length === 1 ? 'was' : 'were'} written by this session; the merge at ${hhmm(s.at)} would refuse to overwrite ${paths.length === 1 ? 'it' : 'them'} (merge-tree does not see this)`, `before ${hhmm(s.at)}: commit ${paths.length === 1 ? 'it' : 'them'} with exact paths (then it is an ordinary conflict, yours to settle) or move ${paths.length === 1 ? 'it' : 'them'} out of the tree; never delete a file that may be someone else's`),
  holderUntracked: (s: SyncFile, rows: { path: string; owners: string[] }[]): string =>
    noticeText('Sync main', `origin/main adds ${plural(rows.length, 'file')} that already ${rows.length === 1 ? 'exists' : 'exist'} untracked in the shared checkout ("untracked would be overwritten"): ${rows.map(r => `${r.path} → ${r.owners.length ? r.owners.join(', ') : 'owner unknown'}`).join('; ')}`, `the owners are told to commit or move theirs before ${hhmm(s.at)}; owner unknown → 🟥 to Hai; never delete or overwrite one to get the merge through`),
  holderWithoutMod: (s: SyncFile, rows: { n: NoMod; isDelivered: boolean }[]): string =>
    noticeText('Sync main', `${plural(rows.length, 'live S2 session')} without a5 0.4 cannot be frozen for the sync at ${hhmm(s.at)}: ${rows.map(r => `${r.n.intent} (session ${r.n.id8}${r.n.branch ? `, ${r.n.branch}` : ''})${r.isDelivered ? '' : ' — the message did not reach it'}`).join('; ')}`, `each got the standard message once; before the merge check that their paths are committed and that they are off git and the Editor; one that is not → tell Hai before ${hhmm(s.at)}`),
  hardEndSoon: (s: SyncFile): string =>
    noticeText('Sync main', `the freeze of the sync at ${hhmm(s.at)} ends at ${hhmm(s.hardEnd)} (its hard end) and the sync is not done`, 'finish it with done or abort before then; at the hard end it expires, git and the Editor open again for every session, and Hai is asked'),
  expired: (s: SyncFile): string =>
    noticeText('Sync main', `the sync at ${hhmm(s.at)} expired at ${hhmm(s.endedAt ?? s.updatedAt)} without done or abort (${s.note || 'its lease ran out'})`, 'git and the Editor are open again (a merge left in .git/MERGE_HEAD still blocks git writes: leave it to its holder and Hai); your work stays as it is'),
  expiredRed: (s: SyncFile, why: string): string => `Sync main ${hhmm(s.at)} (holder ${s.holder.lane}) expired without done or abort: ${why}. Check the shared checkout (git status, .git/MERGE_HEAD) and decide: finish the merge, abort it, or plan a new sync`,
  syncHolderNamed: (s: SyncFile): string => noticeText('Sync main', `you were named holder of the sync at ${hhmm(s.at)} (planned by ${s.plannedBy})`, `at ${hhmm(s.at - CUTOFF_MS)} the cutoff notice reaches every session; at ${hhmm(s.at)} this session's a5 starts the sync worker, which ends the sync with done or abort (at the latest ${hhmm(s.hardEnd)}); keep this session open until then`),
} as const

export const noticeIds = {
  granted: (since: number) => `editor:granted:${since}`,
  leaseEnding: (since: number, end: number) => `editor:ending:${since}:${end}`,
  overrun: (since: number, end: number) => `editor:overrun:${since}:${end}`,
  idle: (since: number) => `editor:idle:${since}`,
  yield: (asker: string, at: number) => `editor:yield:${asker}:${at}`,
  recovered: (holder: string, at: number) => `editor:recovered:${holder}:${Math.floor(at / 60_000)}`,
  goneEditor: (holder: string, pid: number) => `editor:gone:${holder}:${pid}`,
  pieAbort: (n: number) => `ram:pie-abort:${n}`,
  disk: (day: string) => `disk:${day}`,
  cutoff: (s: SyncFile) => `sync:${s.id}:${s.at}:cutoff`,
  releaseBy: (s: SyncFile) => `sync:${s.id}:${s.at}:release`,
  frozen: (s: SyncFile) => `sync:${s.id}:${s.at}:frozen`,
  lifted: (s: SyncFile) => `sync:${s.id}:${s.at}:${s.state}`,
  conflicts: (s: SyncFile, paths: readonly string[]) => `sync:${s.id}:${s.at}:conflicts:${paths.slice().sort().join('|').length}:${hash(paths.slice().sort().join('|'))}`,
  holderNamed: (s: SyncFile) => `sync:${s.id}:named`,
  hardEndSoon: (s: SyncFile) => `sync:${s.id}:${s.at}:hard-end-soon:${s.hardEnd}`,
  withoutMod: (s: SyncFile, ids: readonly string[]) => `sync:${s.id}:${s.at}:without-mod:${hash(ids.slice().sort().join('|'))}`,
  untracked: (s: SyncFile, paths: readonly string[]) => `sync:${s.id}:${s.at}:untracked:${hash(paths.slice().sort().join('|'))}`,
} as const

// ---------- A16: the session overview ----------
/** One row of the client's own session list (`mcp__ccd_session_mgmt__list_sessions`); its id is the client's, not
 * the CLI session id the files use. */
export type ClientRow = { id: string; title: string; cwd: string; isRunning: boolean; lastActivityAt: number; isArchived: boolean }
export const CLIENT_ACTIVE_MS = 30 * 60_000 // a client session active within this counts as running

/** The client's session list, or null when the tool is missing, refused or answered something else. */
export const parseClients = (text: string): ClientRow[] | null => {
  try {
    const v = JSON.parse(text) as unknown
    const rows = Array.isArray(v) ? v : Array.isArray((v as { sessions?: unknown })?.sessions) ? (v as { sessions: unknown[] }).sessions : null
    if (!rows) return null
    return rows
      .map(r => r as Record<string, unknown>)
      .filter(r => typeof r.sessionId === 'string')
      .map(r => ({ id: String(r.sessionId), title: String(r.title ?? ''), cwd: String(r.cwd ?? '').replace(/\\/g, '/'), isRunning: r.isRunning === true, lastActivityAt: Date.parse(String(r.lastActivityAt ?? '')) || 0, isArchived: r.isArchived === true }))
  } catch {
    return null
  }
}

export type NoMod = { sessionId: string; id8: string; intent: string; branch: string }
export type Overview = { active: number | null; s2: number; elsewhere: number | null; intents: [string, number][]; editor: string; waiting: string[]; sync: string; withoutMod: NoMod[] }

/** Live S2 sessions that run without a5 0.4: a fresh Ather lane with no fresh a5 session file. */
export const withoutModOf = (me8: string, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): NoMod[] => {
  const fresh = new Set(files.filter(f => now - f.heartbeatAt <= HEARTBEAT_STALE_MS).map(f => f.id8))
  return lanes
    .filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
    .map(l => ({ sessionId: l.sessionId, id8: l.sessionId.slice(0, 8).toLowerCase(), intent: l.intent || 'no intent', branch: l.branch ?? '' }))
    .filter(l => l.id8 !== me8 && !fresh.has(l.id8))
}

/** What the panel says about the sessions on this machine: how many run (the client's list), how many in S2 (Ather's
 * lanes and a5's files), by intent, who holds or waits for the Editor, who holds the sync, and the live S2
 * sessions without a5 0.4. */
export const overviewOf = (x: { me8: string; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; clients: readonly ClientRow[] | null; isS2Cwd: (cwd: string) => boolean; lock: LockLine; sync: SyncFile | null; now: number; phase: Phase }): Overview => {
  const { now } = x
  const liveLanes = x.lanes.filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
  const ids = new Set<string>([x.me8, ...liveLanes.map(l => l.sessionId.slice(0, 8).toLowerCase()), ...x.files.filter(f => now - f.heartbeatAt <= HEARTBEAT_STALE_MS).map(f => f.id8)].filter(Boolean))
  const intentOf = (id8: string) => liveLanes.find(l => l.sessionId.toLowerCase().startsWith(id8))?.intent || 'no intent'
  const counts = new Map<string, number>()
  for (const id8 of ids) counts.set(intentOf(id8), (counts.get(intentOf(id8)) ?? 0) + 1)
  const active = x.clients?.filter(r => !r.isArchived && (r.isRunning || now - r.lastActivityAt <= CLIENT_ACTIVE_MS)) ?? null
  const laneOf = (id8: string) => x.files.find(f => f.id8 === id8)?.lane ?? id8
  const editor = x.lock.kind === 'free' ? 'free' : x.lock.kind === 'missing' ? 'lock missing' : `${x.lock.lane || 'held'}${x.lock.id8 === x.me8 ? ' (this session)' : ''}`
  return {
    active: active ? active.length + 1 : null, // the list leaves out the session reading it
    s2: ids.size,
    elsewhere: active ? active.filter(r => !x.isS2Cwd(r.cwd)).length : null,
    intents: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    editor,
    waiting: queueOf(x.files, x.lanes, now, x.sync).map(f => laneOf(f.id8)),
    sync: x.sync && isOpenPhase(x.phase) ? `${x.sync.holder.id8 === x.me8 ? 'this session' : x.sync.holder.lane} ${hhmm(x.sync.at)} ${x.phase}` : 'none',
    withoutMod: withoutModOf(x.me8, x.files, x.lanes, now),
  }
}

/** The overview in one line (the terminal) or the same words wrapped (the desktop). */
export const overviewLine = (o: Overview): string =>
  [
    o.active === null ? `Sessions: S2 ${o.s2} live (client list unavailable)` : `Sessions: ${o.active} active · S2 ${o.s2} · elsewhere ${o.elsewhere ?? 0}`,
    o.intents.length ? `by intent: ${o.intents.map(([i, n]) => `${i} ${n}`).join(', ')}` : '',
    `Editor: ${o.editor}${o.waiting.length ? ` (waiting: ${o.waiting.join(', ')})` : ''}`,
    `Sync: ${o.sync}`,
    o.withoutMod.length ? `without a5 0.4: ${o.withoutMod.map(n => `${n.intent} (session ${n.id8})`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

/** A16: the one standard message a live S2 session without a5 0.4 gets at the cutoff (it cannot be frozen). */
export const noModMessage = (s: SyncFile, checkout: string): string =>
  `Sync main (a5): ${s.holder.lane} merges origin/main into ${checkout} at ${hhmm(s.at)}. This session runs without a5 0.4, so nothing freezes it: before ${hhmm(s.at)} commit your own paths (exact paths), write your resume note, stop PIE and release the Editor by ${hhmm(s.at - RELEASE_BEFORE_MS)}; from ${hhmm(s.at)} until the holder is done (at the latest ${hhmm(s.hardEnd)}) make no git writes in that checkout and do not use the Editor.`

/** D7: the sync worker's system prompt, the procedure of runbook-sync-lane and s2-sync-main as A12 fixes it. */
export const SYNC_WORKER_PROMPT = [
  'You are the a5 sync worker for the shared S2 checkout. The sync holder\'s a5 started you at the planned sync time T, in the holder\'s session. Every other session is frozen (no git writes, no Editor) until you call the tool mcp__a5__sync with action "done" or "abort", or until the hard end, when the sync expires and Hai is asked. End with exactly one of those calls; never leave without it.',
  'Rules (the checkout\'s AGENTS.md and the user\'s machine profile win over this list):',
  '1. Git never prompts. Run every git command with GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never in its environment (Bash: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> …`; PowerShell: set $env:GIT_TERMINAL_PROMPT=\'0\' and $env:GCM_INTERACTIVE=\'never\' first) and a timeout on the tool call: fetch and merge 10 min at most, everything else 2 min. A credential, network or LFS failure is an abort, never a retry loop. Never set GIT_LFS_SKIP_SMUDGE.',
  '2. Always `git -C <checkout>`. Never rebase, reset --hard, stash, clean, push or switch branches. Your git writes are exactly: `git merge --no-edit origin/main`, `git merge --abort`, `git checkout --ours|--theirs -- <paths>`, `git add -- <paths>`, `git commit --no-edit`, `git revert -m 1 <merge sha> --no-edit`. If any command is refused, abort the sync with the refusal as the reason.',
  '3. The Editor. Before any merge, take the Editor lock for the sync with mcp__a5__editor (action "request", minutes up to the hard end, launch false, build true when the sync builds). If another lane holds it: never close, kill or drive that Editor; wait a few minutes and request again (you are first in the queue); if it is not yours 10 minutes before the hard end, abort. If an Editor is open while the lock is yours (or a FREE line says it was left open): list its dirty packages first with an Unreal MCP read; any dirty package → abort (never save it, never discard it); none → close it gracefully as AGENTS.md says and confirm UnrealEditor.exe is gone. Release the lock with mcp__a5__editor (action "release") before you end.',
  '4. Before the merge: record the pre-merge HEAD (`git -C <checkout> rev-parse HEAD`). Abort if .git/MERGE_HEAD, .git/REBASE_HEAD or an .git/index.lock older than 10 minutes exists. Fetch: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> fetch origin main`. If a file origin/main adds still exists untracked in the checkout, abort and name it (its owner was told).',
  '5. Merge: `git merge --no-edit origin/main` (never rebase). For each conflicted path (`git diff --name-only --diff-filter=U`): rule 11 — when origin/main\'s blob for the path (`git rev-parse origin/main:<path>`) equals a blob in this branch\'s history (`git log --format=%H --raw --no-abbrev HEAD -- <path>`), it is a self-conflict: `git checkout --ours -- <path>` then `git add -- <path>`. A text conflict where both sides only add lines: resolve it, check `git diff --check`, `git add -- <path>`. Any other conflict (logic, or any .uasset/.umap): `git merge --abort`, then abort the sync naming each path and its owner from the conflict notice. Then `git commit --no-edit`.',
  '6. Build, only when the sync builds: the engine root comes from the machine profile; a build succeeded only when its own `Result: Succeeded` line says so (Build.bat exits 0 on failure). A failed build: `git revert -m 1 <merge sha> --no-edit`, then abort with its first error lines.',
  '7. End: release the Editor lock, then mcp__a5__sync with "done" (note: merge sha, pre-merge HEAD, conflicts and how they were resolved, build result) or "abort" (note: why, and the state the checkout is in). Your final answer is one short report of the same.',
].join('\n')

/** The task the holder's a5 hands the sync worker: this sync's facts. */
export const syncWorkerTask = (s: SyncFile, checkout: string, lock: string): string =>
  [
    `Run the sync of origin/main planned for ${hhmm(s.at)} in ${checkout} (holder ${s.holder.lane}, session ${s.holder.id8}). Hard end ${hhmm(s.hardEnd)}: by then call the sync tool with done or abort. Build: ${s.build ? 'yes' : 'no'}.`,
    `Dry-run at the cutoff: ${s.conflicts === null ? 'not run' : s.conflicts.length === 0 ? 'no conflicts' : s.conflicts.map(c => `${c.path} (${c.kind}${c.match ? `, main holds our ${c.match}` : ''})`).join('; ')}.`,
    `Untracked files origin/main adds: ${s.untracked === null ? 'not listed' : s.untracked.length === 0 ? 'none' : s.untracked.join('; ')}.`,
    `Editor lock now: ${lock || 'missing'}.`,
  ].join('\n')

/** A short stable hash (FNV-1a) for notice ids built from long lists. */
export const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
