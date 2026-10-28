// A5R rev 42 (L-46; Hai, 2026-10-28: "nếu không tạo ra kết quả mà duy trì blocker thì đương nhiên nên đóng. Tuy nhiên cần
// tránh đóng nhầm"): A123, an Editor left by a gone session is closed, gracefully and only when it is certainly orphaned.
// MEASURED (audit): 22 Oct 20:49 to 23 Oct 10:21 a gone session's Editor held the lock 812 min. Safety first (machine
// trap 2026-10-22: a close script sent WM_CLOSE to every UnrealEditor and closed another project's Editor): only the PID the
// holder's own lock line names, when its command line names the shared checkout's .uproject; a WM_CLOSE to its main window
// only (CloseMainWindow), never a kill; any condition unread or uncertain means no close. Fable review D1: with no PID in the
// lock, nothing ties an Editor to the gone holder, so the person is shown the candidate and A5R closes nothing. Pure: no
// `$`; register.ts probes, claims, runs the close and tells.
import { buildProcs, hhmm, isEditorProc, isUnrealProc, lockTimes, noticeText, type Claim, type LaneBeat, type LockLine, type LookRow, type Notice, type Probe, type Proc, type SessionFile } from './coord.ts'
import { psQuote } from './a5r.ts'
import { isQuietFor, lastSignOf, namesPath, pieSeen, slash, type Shared } from './truth.ts'

const MIN = 60_000
/** The holder counts as gone for a close only after this long with no heartbeat, no lane beat, no turn and no agent, and
 * only once this session's A5R has itself watched that long (Fable review D3). */
export const ORPHAN_GONE_MS = 30 * MIN
/** After the close, an Editor still running this long is the person's to look at (its save prompt, or a hang). */
export const CLOSE_WAIT_MS = 3 * MIN
/** Night (20:00-09:00, machine time): an orphan is closed with nobody queued only while the workstation is idle or locked. */
export const isNight = (now: number): boolean => {
  const h = new Date(now).getHours()
  return h >= 20 || h < 9
}
/** Fable review D5: the workstation counts as left this long after its last keyboard or mouse input (or while it is locked). */
export const IDLE_MIN = 30
/** The workstation's last input (minutes ago) and whether it is locked (the lock screen, LogonUI, runs). */
export type Idle = { idleMin: number; locked: boolean }

/** The PID the HELD line should name (A66): the first windowed Editor whose command line names the shared .uproject, never
 * another project's (Fable review D2); null when none (or no command line was read). */
export const sharedEditorPid = (probe: Probe | null, uproject: string): number | null => probe?.procs.find(p => isEditorProc(p) && namesPath(p.cmd ?? '', uproject))?.pid ?? null

export type OrphanInput = { lock: LockLine; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; probe: Probe | null; shared: Shared; queued: number; claim: Claim | null; pieDrivers: readonly string[]; watchedSince: number; idle: Idle | null }
type Orphan = { pid: number; cmd: string; id8: string; lane: string; since: number; why: string }
/** `close`: ask that PID to close; `ask` (Fable review D1): the lock names no PID, so the person is shown the one Editor of
 * the shared checkout started during the lease, and nothing is closed; `keep`: neither, and why (`needsIdle`: only an idle
 * reading is missing, at night with nobody queued). */
export type OrphanClose = Orphan & { kind: 'close' }
export type OrphanAsk = Orphan & { kind: 'ask' }
export type OrphanKeep = { kind: 'keep'; why: string; needsIdle?: true }

/** A123: whether the lock's Editor is certainly orphaned and may be asked to close, and why (or why not). Every condition
 * must hold: the holder's session gone 30 min (no heartbeat and no lane beat, no turn, no agent) as this A5R watched it for
 * 30 min itself; one windowed Unreal Editor whose command line names the shared checkout's .uproject and whose PID the lock
 * names; no build, headless run or PIE; someone queued, or night with the workstation idle 30 min or locked; no Focus on the
 * holder. */
export const orphanOf = (x: OrphanInput): OrphanClose | OrphanAsk | OrphanKeep => {
  const keep = (why: string): OrphanKeep => ({ kind: 'keep', why })
  const { lock, now, probe } = x
  if (!probe) return keep('no process reading')
  if (!x.shared.uproject) return keep('no .uproject known for the shared checkout')
  if (lock.kind !== 'held' || !lock.isStandard || lock.id8.length !== 8) return keep('no standard lease of one session')
  const t = lockTimes(lock, now)
  if (!t) return keep('the lease has no readable times')
  const f = x.files.find(s => s.id8 === lock.id8)
  if (!f) return keep('the holder has no A5R session file to read')
  if (!isQuietFor(lock.id8, x, ORPHAN_GONE_MS, true) || (f.agents ?? 0) > 0) return keep('the holder is not certainly gone')
  if (now - x.watchedSince < ORPHAN_GONE_MS) return keep('this A5R has watched under 30 min (just turned on, or just started)')
  if (x.claim?.id8 === lock.id8) return keep('a Focus or the sync holds its lease')
  const editors = probe.procs.filter(isEditorProc)
  if (editors.some(p => !p.cmd)) return keep('an Unreal Editor\'s command line was not read')
  const isLeases = (p: Proc): boolean => (lock.pid !== null ? p.pid === lock.pid : p.startedAt !== undefined && p.startedAt >= t.since && p.startedAt <= now)
  const [e, ...more] = editors.filter(p => namesPath(p.cmd ?? '', x.shared.uproject) && isLeases(p))
  if (!e || more.length > 0) return keep(e ? 'more than one Editor of the shared checkout from this lease' : 'no Editor of the shared checkout from this lease')
  if (buildProcs(probe).length > 0) return keep('a build or a game runs')
  if (probe.procs.some(p => isUnrealProc(p) && !isEditorProc(p))) return keep('a headless Unreal run (a test) runs')
  if (pieSeen(probe, x.pieDrivers, null)) return keep('PIE runs (any PIE window or PIE driver run: one that names no project may be this one\'s)')
  const gone = `its session is gone (no heartbeat, lane, turn or agent since ${hhmm(lastSignOf(lock.id8, x.files, x.lanes) ?? now)})`
  const orphan = { pid: e.pid, cmd: e.cmd ?? '', id8: lock.id8, lane: lock.lane || f.lane, since: t.since }
  if (lock.pid === null) return { kind: 'ask', ...orphan, why: `${gone}; Editor PID ${e.pid} of the shared checkout started ${hhmm(e.startedAt ?? now)}, during the lease, but the lock line names no PID` }
  if (x.queued === 0 && !isNight(now)) return keep('nobody waits and it is day')
  if (x.queued === 0 && !x.idle) return { ...keep('night with nobody queued, and no reading of the workstation\'s last input'), needsIdle: true }
  if (x.queued === 0 && x.idle && !x.idle.locked && x.idle.idleMin < IDLE_MIN) return keep(`night with nobody queued, and the workstation was used ${x.idle.idleMin} min ago`)
  return { kind: 'close', ...orphan, why: `${gone}; Editor PID ${e.pid} opens the shared checkout's project (the PID its lock line names); no build, headless run or PIE; ${x.queued > 0 ? `${x.queued} queued` : `night, the workstation ${x.idle?.locked ? 'locked' : `idle ${x.idle?.idleMin} min`}`}` }
}

/** The workstation's last input and lock, read only when a night close with nobody queued needs it: GetLastInputInfo against
 * GetTickCount (both the same 32-bit tick, so the wrap holds; review pass 3: Windows PowerShell 5.1 has no TickCount64), the
 * tick itself as the uptime it can check against, and whether LogonUI (the lock screen) runs, as one JSON line. Measured on
 * this machine, PowerShell 5.1: {"idleMin":0,"upMin":5711,"locked":false}. */
export const idleArgv = (): string[] => [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Add-Type -Name LastInput -Namespace A5R -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [DllImport("kernel32.dll")] public static extern uint GetTickCount(); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }'; $i = New-Object A5R.LastInput+LASTINPUTINFO; $i.cbSize = 8; if (-not [A5R.LastInput]::GetLastInputInfo([ref]$i)) { exit 1 }; $now = [uint64][A5R.LastInput]::GetTickCount(); $d = ($now + 4294967296 - [uint64]$i.dwTime) % 4294967296; [pscustomobject]@{ idleMin = [math]::Floor($d / 60000); upMin = [math]::Floor($now / 60000); locked = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue) } | ConvertTo-Json -Compress`,
]
/** The idle reading, or null when it did not answer or cannot be true (idle longer than the tick it is counted on: a broken
 * reading never means idle; no reading: no night close with nobody queued). */
export const parseIdle = (stdout: string | undefined): Idle | null => {
  try {
    const v = JSON.parse((stdout ?? '').trim()) as { idleMin?: unknown; upMin?: unknown; locked?: unknown }
    return typeof v.idleMin === 'number' && typeof v.upMin === 'number' && v.idleMin >= 0 && v.idleMin <= v.upMin && typeof v.locked === 'boolean' ? { idleMin: v.idleMin, locked: v.locked } : null
  } catch {
    return null
  }
}

/** NEEDS A LOOK for an Editor A5R will not close because the lock names no PID (Fable review D1): the person decides. */
export const askLook = (o: ReturnType<typeof orphanOf>): LookRow[] =>
  o.kind === 'ask' ? [{ what: `${o.lane} (session ${o.id8}) looks gone and the shared checkout's Editor PID ${o.pid} may be its own: ${o.why}`, next: 'A5R closes only an Editor its holder\'s lock line names: if this one is that session\'s, save or discard its work and close it yourself' }] : []

/** The close: PowerShell checks the PID once more (an Unreal Editor whose command line names the .uproject, so a PID reused
 * since the probe is never touched) and asks its main window to close (WM_CLOSE); it prints `sent`, `no window` or
 * `mismatch`. Never Stop-Process. */
export const closeArgv = (pid: number, uproject: string): string[] => [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Math.trunc(pid)}'; if ($p -and $p.Name -like 'UnrealEditor*' -and $p.Name -notlike 'UnrealEditor-Cmd*' -and ([string]$p.CommandLine).Replace('\\','/').ToLower().Contains(${psQuote(slash(uproject))})) { if ((Get-Process -Id ${Math.trunc(pid)}).CloseMainWindow()) { 'sent' } else { 'no window' } } else { 'mismatch' }`,
]
export type CloseAnswer = 'sent' | 'no window' | 'mismatch' | 'failed'
export const closeAnswer = (stdout: string | undefined): CloseAnswer => {
  const t = (stdout ?? '').trim()
  return t === 'sent' || t === 'no window' || t === 'mismatch' ? t : 'failed'
}

/** Saved/A5R/orphan-close.json: the last close A5R asked for (one writer: the alert claim). */
export const ORPHAN_FILE = 'orphan-close.json'
export type OrphanRecord = { v: 1; pid: number; at: number; id8: string; lane: string; cmd: string; why: string; by: string; answer: CloseAnswer }
export const parseOrphan = (text: string | null): OrphanRecord | null => {
  try {
    const v = JSON.parse(text ?? '') as Record<string, unknown>
    if (typeof v.pid !== 'number' || typeof v.at !== 'number' || typeof v.id8 !== 'string') return null
    return { v: 1, pid: v.pid, at: v.at, id8: v.id8, lane: String(v.lane ?? ''), cmd: String(v.cmd ?? ''), why: String(v.why ?? ''), by: String(v.by ?? ''), answer: closeAnswer(String(v.answer ?? '')) }
  } catch {
    return null
  }
}

/** NEEDS A LOOK after a close: that same Editor (a windowed Editor started before the close) still runs 3 min after it was asked to close (its own save prompt, or a hang), or
 * the close never reached a window. A5R does not touch the prompt and never kills it. */
export const orphanLook = (r: OrphanRecord | null, probe: Probe | null, now: number): LookRow[] =>
  r && probe?.procs.some(p => p.pid === r.pid && isEditorProc(p) && (p.startedAt === undefined || p.startedAt <= r.at)) && (now - r.at >= CLOSE_WAIT_MS || r.answer !== 'sent') // Fable review D4: never a reused PID
    ? [{ what: `the Editor (PID ${r.pid}) left by ${r.lane} (session ${r.id8}, gone) was asked to close at ${hhmm(r.at)} and still runs${r.answer === 'sent' ? ' (it may be showing its own save prompt)' : ` (the close got: ${r.answer})`}`, next: 'look at that Editor window: save or discard its work and close it; A5R never answers its prompt and never kills it' }]
    : []

const CLOSED_ID = 'editor:orphan-closed:'
/** The holder told when it comes back (its own A5R reads the record): its Editor was closed, and why (once, by its id). */
export const orphanNotice = (r: OrphanRecord | null, me8: string): Notice[] =>
  r && r.id8 === me8 && r.answer === 'sent' ? [{ id: `${CLOSED_ID}${r.pid}:${r.at}`, text: noticeText('Editor', `while this session was gone A5R asked your Editor (PID ${r.pid}) to close at ${hhmm(r.at)}: ${r.why}`, 'request the Editor again with the editor tool if your task still needs it (unsaved work, if any, waited in its save prompt)'), isActionable: true }] : []
