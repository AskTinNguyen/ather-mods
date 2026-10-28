// A5R rev 42 (L-46; Hai, 2026-10-28: "nếu không tạo ra kết quả mà duy trì blocker thì đương nhiên nên đóng. Tuy nhiên cần
// tránh đóng nhầm"): A123, an Editor left by a gone session is closed, gracefully and only when it is certainly orphaned.
// MEASURED (audit): 22 Oct 20:49 to 23 Oct 10:21 a gone session's Editor held the lock 812 min. Safety first (machine
// trap 2026-10-22: a close script sent WM_CLOSE to every UnrealEditor and closed another project's Editor): one PID, whose
// command line names the shared checkout's .uproject, that the lock names or that started during that lease; a WM_CLOSE to
// its main window only (CloseMainWindow), never a kill; any condition unread or uncertain means no close. Pure: no `$`;
// register.ts probes, claims, runs the close and tells.
import { buildProcs, hhmm, isEditorProc, isUnrealProc, lockTimes, noticeText, type Claim, type LaneBeat, type LockLine, type LookRow, type Notice, type Probe, type Proc, type SessionFile } from './coord.ts'
import { psQuote } from './a5r.ts'
import { isQuietFor, lastSignOf, pieSeen } from './truth.ts'

const MIN = 60_000
/** The holder counts as gone for a close only after this long with no heartbeat, no lane beat, no turn and no agent. */
export const ORPHAN_GONE_MS = 30 * MIN
/** After the close, an Editor still running this long is the person's to look at (its save prompt, or a hang). */
export const CLOSE_WAIT_MS = 3 * MIN
/** Night (20:00-09:00, machine time): an orphan is closed even with nobody queued. */
export const isNight = (now: number): boolean => {
  const h = new Date(now).getHours()
  return h >= 20 || h < 9
}

const slash = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
/** Whether a command line names this .uproject as a whole path (quoted or bare, never a longer name that starts with it). */
export const namesProject = (cmd: string, uproject: string): boolean => {
  const want = slash(uproject)
  const at = want ? slash(cmd).indexOf(want) : -1
  if (at < 0) return false
  const before = slash(cmd)[at - 1] ?? ' '
  const after = slash(cmd)[at + want.length] ?? ' '
  return /[\s"'=]/.test(before) && /[\s"']/.test(after)
}

export type OrphanInput = { lock: LockLine; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; probe: Probe | null; uproject: string; queued: number; claim: Claim | null; pieDrivers: readonly string[] }
export type OrphanClose = { kind: 'close'; pid: number; cmd: string; id8: string; lane: string; since: number; why: string }
export type OrphanKeep = { kind: 'keep'; why: string }

/** A123: whether the lock's Editor is certainly orphaned and may be asked to close, and why (or why not). Every condition
 * must hold: the holder's session gone 30 min (no heartbeat and no lane beat, no turn, no agent); one windowed Unreal Editor
 * whose command line names the shared checkout's .uproject and whose PID is the one the lock names (when it names none: the
 * one that started during this lease and whose parent is gone, as a gone session's launch leaves it; an Editor the person
 * opened by hand keeps its parent); no build, headless run or PIE; someone queued, or night; no Focus on the holder. */
export const orphanOf = (x: OrphanInput): OrphanClose | OrphanKeep => {
  const keep = (why: string): OrphanKeep => ({ kind: 'keep', why })
  const { lock, now, probe } = x
  if (!probe) return keep('no process reading')
  if (!x.uproject) return keep('no .uproject known for the shared checkout')
  if (lock.kind !== 'held' || !lock.isStandard || lock.id8.length !== 8) return keep('no standard lease of one session')
  const t = lockTimes(lock, now)
  if (!t) return keep('the lease has no readable times')
  const f = x.files.find(s => s.id8 === lock.id8)
  if (!f) return keep('the holder has no A5R session file to read')
  if (!isQuietFor(lock.id8, x, ORPHAN_GONE_MS, true) || (f.agents ?? 0) > 0) return keep('the holder is not certainly gone')
  if (x.claim?.id8 === lock.id8) return keep('a Focus or the sync holds its lease')
  const editors = probe.procs.filter(isEditorProc)
  if (editors.some(p => !p.cmd)) return keep('an Unreal Editor\'s command line was not read')
  const isLeases = (p: Proc): boolean => (lock.pid !== null ? p.pid === lock.pid : !p.parentAlive && p.startedAt !== undefined && p.startedAt >= t.since && p.startedAt <= now)
  const [e, ...more] = editors.filter(p => namesProject(p.cmd ?? '', x.uproject) && isLeases(p))
  if (!e || more.length > 0) return keep(e ? 'more than one Editor of the shared checkout from this lease' : 'no Editor of the shared checkout from this lease')
  if (buildProcs(probe).length > 0) return keep('a build or a game runs')
  if (probe.procs.some(p => isUnrealProc(p) && !isEditorProc(p))) return keep('a headless Unreal run (a test) runs')
  if (pieSeen(probe, x.pieDrivers)) return keep('PIE runs')
  if (x.queued === 0 && !isNight(now)) return keep('nobody waits and it is day')
  const how = e.pid === lock.pid ? 'the PID its lock line names' : `started ${hhmm(e.startedAt ?? now)}, during the lease, its parent gone`
  return { kind: 'close', pid: e.pid, cmd: e.cmd ?? '', id8: lock.id8, lane: lock.lane || f.lane, since: t.since, why: `its session is gone (no heartbeat, lane, turn or agent since ${hhmm(lastSignOf(lock.id8, x.files, x.lanes) ?? now)}); Editor PID ${e.pid} opens the shared checkout's project (${how}); no build, headless run or PIE; ${x.queued > 0 ? `${x.queued} queued` : 'night'}` }
}

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

/** NEEDS A LOOK after a close: the Editor still runs 3 min after it was asked to close (its own save prompt, or a hang), or
 * the close never reached a window. A5R does not touch the prompt and never kills it. */
export const orphanLook = (r: OrphanRecord | null, probe: Probe | null, now: number): LookRow[] =>
  r && probe?.procs.some(p => p.pid === r.pid) && (now - r.at >= CLOSE_WAIT_MS || r.answer !== 'sent')
    ? [{ what: `the Editor (PID ${r.pid}) left by ${r.lane} (session ${r.id8}, gone) was asked to close at ${hhmm(r.at)} and still runs${r.answer === 'sent' ? ' (it may be showing its own save prompt)' : ` (the close got: ${r.answer})`}`, next: 'look at that Editor window: save or discard its work and close it; A5R never answers its prompt and never kills it' }]
    : []

const CLOSED_ID = 'editor:orphan-closed:'
/** The holder told when it comes back (its own A5R reads the record): its Editor was closed, and why (once, by its id). */
export const orphanNotice = (r: OrphanRecord | null, me8: string): Notice[] =>
  r && r.id8 === me8 && r.answer === 'sent' ? [{ id: `${CLOSED_ID}${r.pid}:${r.at}`, text: noticeText('Editor', `while this session was gone A5R asked your Editor (PID ${r.pid}) to close at ${hhmm(r.at)}: ${r.why}`, 'request the Editor again with the editor tool if your task still needs it (unsaved work, if any, waited in its save prompt)'), isActionable: true }] : []
