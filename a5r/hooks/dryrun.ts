// A107 (rev 35): the conflict dry-run reads the main that will be merged. The holder's A5R fetches origin main before the
// cutoff's dry-run, and fetches and dry-runs again at T, just before it starts the worker. The fetch never prompts
// (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never), is killed after 5 min, and brings no LFS objects (a plain fetch never
// downloads them; `$.process.run` runs git with repo hooks off; GIT_LFS_SKIP_SMUDGE is not set because nothing is checked
// out). The fetch and the dry-run run off the tick chain (a hook may wait on a tick), one at a time, and the worker starts
// only when none runs, so A5R never runs two fetches at once nor one beside the worker's own. Pure: no `$`; register.ts
// runs git and writes sync.json.
import { isListAtT, type Conflict, type Phase, type SyncFile } from './coord.ts'

/** The fetch is killed after this long (a credential, network or server stall reads as a failed fetch). */
export const FETCH_MS = 5 * 60_000
/** Rule 11 for the conflicted paths stops after this long; the paths left count as foreign (the conservative side). */
export const CLASSIFY_BUDGET_MS = 3 * 60_000
/** The dry-run at T starts within this long after T or not at all, and the worker never waits longer for one to start. */
export const START_WAIT_MS = 10 * 60_000
export const FETCH_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } as const
/** Only origin's main, no tags, and no `git maintenance` left running behind it (A108: no git outlives A5R's own call). */
export const fetchArgv = (root: string): string[] => ['git', '-C', root, 'fetch', '--no-tags', '--no-auto-maintenance', 'origin', 'main']

/** Why the fetch failed, '' when it succeeded (`null`: it could not start, or was killed at FETCH_MS). */
export const fetchWhy = (r: { exitCode: number; stderr: string } | null): string => {
  if (r === null) return `it did not run or did not finish within ${FETCH_MS / 60_000} min`
  if (r.exitCode === 0) return ''
  const last = r.stderr.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() ?? ''
  return `exit ${r.exitCode}${last ? `: ${last.slice(0, 160)}` : ''}`
}
/** Why a list made after that fetch is stale ('' when the fetch succeeded). */
export const staleOf = (fetchFailed: string): string => (fetchFailed ? `git fetch origin main failed (${fetchFailed}); origin/main as last fetched` : '')
/** `git rev-parse --verify --quiet origin/main`: the full sha, or '' when git gave none. */
export const shaOf = (stdout: string | undefined): string => {
  const t = (stdout ?? '').trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(t) ? t : ''
}

export type DryRound = 'cutoff' | 'start'
/** The holder's last dry-run (its sync and round), and whether it ended, however it ended; null before any. */
export type DryJob = { key: string; isDone: boolean } | null
export const dryKey = (s: SyncFile, round: DryRound): string => `${s.id}:${s.at}:${round}`

/** The dry-run the sync is owed now: the cutoff's from the cutoff until a list is on file; T's once the freeze begins,
 * before the worker, unless a dry-run list made at T or later is on file (a cutoff dry-run that ended after T fetched
 * minutes before it), and only within START_WAIT_MS of T. */
const owedRound = (s: SyncFile, phase: Phase, now: number): DryRound | null => {
  if (phase === 'cutoff') return s.conflictsAt === null ? 'cutoff' : null
  return phase === 'frozen' && s.workerAt === null && !isListAtT(s) && now < s.at + START_WAIT_MS ? 'start' : null
}
/** T's dry-run is over: its list is on file, it ended (however it ended), or it can no longer start. */
const isStartOver = (s: SyncFile, job: DryJob, now: number): boolean => isListAtT(s) || now >= s.at + START_WAIT_MS || (job?.key === dryKey(s, 'start') && job.isDone)

/** What the holder's A5R does about the dry-run this minute: the round to start (one at a time, each once per sync: a
 * failed one is not retried in a loop; a reload may run it once more), and whether the worker may start (no dry-run
 * runs and T's is over). */
export const dryStep = (s: SyncFile, phase: Phase, job: DryJob, now: number): { start: DryRound | null; mayStartWorker: boolean } => {
  const isBusy = job !== null && !job.isDone
  const owed = owedRound(s, phase, now)
  const start = owed !== null && !isBusy && job?.key !== dryKey(s, owed) ? owed : null
  return { start, mayStartWorker: phase === 'frozen' && s.workerAt === null && start === null && !isBusy && isStartOver(s, job, now) }
}

/** The sync after a dry-run (written onto sync.json as it is then): its lists (untracked null when git could not give
 * them), when they were made, against which origin/main, and why they are stale ('' when the fetch just before succeeded). */
export const withDryRun = (s: SyncFile, run: { conflicts: Conflict[]; untracked: string[] | null; main: string; stale: string }, now: number): SyncFile => ({
  ...s,
  conflicts: run.conflicts,
  conflictsAt: now,
  conflictsSource: 'merge-tree',
  untracked: run.untracked,
  dry: { main: run.main, stale: run.stale },
  updatedAt: now,
})
/** The sync after a dry-run that did not finish: a list already on file is marked stale (the worker's task says so),
 * the holder's own list too (main may have moved since it was given). */
export const withDryRunFailed = (s: SyncFile, now: number): SyncFile =>
  s.conflicts === null ? s : { ...s, dry: { main: s.dry?.main ?? '', stale: 'the latest dry-run did not finish; this list is older' }, updatedAt: now }
