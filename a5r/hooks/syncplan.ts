// Rev 44 (L-48): the sync freeze in steps and the times every session waits for. A131: what each step of a sync still
// holds (merging, building, a failed build, testing, finishing by hand). A132: who is told and woken at each step. A133:
// one timeline line with estimates (`~`, from the measured durations of the last syncs; "time unknown" without data; `late`
// 15 min past one) and what each Editor wait waits for. A134: the band above the prompt, the prompt's context line, the
// toast, and Saved/A5R/status.json. Pure: no `$`; register.ts reads the files and logs, decides with these, and writes.
import { CUTOFF_MS, RELEASE_BEFORE_MS, hhmm, type Phase, type SyncFile } from './coord.ts'
import type { BuildLogRead, SyncStage } from './syncstage.ts'

// ---------- A131: the steps of a freeze and what each holds ----------
export type FreezeStep = 'cutoff' | 'merging' | 'building' | 'build-failed' | 'testing' | 'manual'
/** What a session may need that a freeze can hold: git writes, edits in the shared checkout, edits under Source/ and
 * Plugins/ (and the files the merge changed), the Editor (launch, PIE, MCP), a build of the shared project. */
export type Need = 'git' | 'edit' | 'source' | 'editor' | 'build'
export const NEEDS: readonly Need[] = ['git', 'edit', 'source', 'editor', 'build']
const ALL: ReadonlySet<Need> = new Set(NEEDS)
/** A131: what each step holds. The merge writes the tree (everything waits); after the merge commit the build reads
 * Source/ and Plugins/ (other edits are allowed again); once the build's own `Result: Succeeded` is read git and every
 * edit are free, and only the Editor and builds wait for the tests and done; a failed build, or a sync handed back to its
 * holder, keeps everything. The cutoff holds nothing (it asks). */
export const HELD: Readonly<Record<FreezeStep, ReadonlySet<Need>>> = {
  cutoff: new Set(),
  merging: ALL,
  building: new Set<Need>(['git', 'source', 'editor', 'build']),
  'build-failed': ALL,
  testing: new Set<Need>(['editor', 'build']),
  manual: ALL,
}
/** The step of a sync now (null: none open, or only planned). `build`: what the sync's build log of this run says. */
export const freezeStepOf = (phase: Phase, stage: SyncStage | null, build: BuildLogRead | null): FreezeStep | null => {
  if (phase === 'cutoff') return 'cutoff'
  if (phase !== 'frozen') return null
  if (stage === null) return 'merging'
  if (stage === 'building') return build === 'Failed' ? 'build-failed' : 'building'
  return stage
}
/** A131: an edit of `rel` (repo-relative) needs `source` under Source/ or Plugins/ or on a path the merge changed, else `edit`. */
export const editNeed = (rel: string, mergeChanged: ReadonlySet<string>): Need => (/^(source|plugins)\//i.test(rel) || mergeChanged.has(rel.toLowerCase()) ? 'source' : 'edit')
const NEED_WORDS: Record<Need, string> = { git: 'git writes', edit: 'edits in the shared checkout', source: 'edits under Source/ and Plugins/ (and of the files the merge changed)', editor: 'the Editor (launch, PIE, MCP)', build: 'builds of the shared project' }
export const needWords = (needs: Iterable<Need>): string => [...needs].map(n => NEED_WORDS[n]).join(', ')
const STEP_WORDS: Record<FreezeStep, string> = { cutoff: 'cutoff', merging: 'merging', building: 'building', 'build-failed': 'build failed', testing: 'testing', manual: 'finishing by hand' }
export const stepWord = (step: FreezeStep): string => STEP_WORDS[step]

// ---------- A133: measured durations ----------
/** The step durations measured on the last syncs (ms), each list newest last. */
export type SyncTimes = { merge: number[]; build: number[]; tests: number[] }
export const NO_TIMES: SyncTimes = { merge: [], build: [], tests: [] }
export const SYNC_TIMES_FILE = 'sync-times.jsonl'
const KEEP = 5
/** UnrealBuildTool's own last `Total execution time: N seconds` line of a build log, in ms (null: none). */
export const buildMsOf = (log: string): number | null => {
  let last: number | null = null
  for (const m of log.matchAll(/Total execution time:\s*([\d.]+)\s*seconds/g)) last = Math.round(Number(m[1]) * 1000)
  return last !== null && Number.isFinite(last) ? last : null
}
/** The merge and tests durations the holders recorded (one JSON line each: { id, step, ms, at }). */
export const parseSyncTimes = (text: string | null, builds: readonly number[]): SyncTimes => {
  const out: SyncTimes = { merge: [], build: builds.slice(-KEEP), tests: [] }
  for (const l of (text ?? '').split(/\r?\n/)) {
    try {
      const v = JSON.parse(l) as { step?: unknown; ms?: unknown }
      if ((v.step === 'merge' || v.step === 'tests') && typeof v.ms === 'number' && v.ms > 0) out[v.step].push(v.ms)
    } catch {
      // a half-written or foreign line
    }
  }
  return { ...out, merge: out.merge.slice(-KEEP), tests: out.tests.slice(-KEEP) }
}
export const timesLine = (id: string, step: 'merge' | 'tests', ms: number, at: number): string => JSON.stringify({ id, step, ms: Math.max(0, Math.round(ms)), at })
export const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] ?? null) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2)
}

// ---------- A133: the timeline ----------
/** A step still ahead: its words, its estimated end (null: unknown), its estimated length (null: unknown), whether it is
 * the current one, and `late` (15 min or more past its estimate). */
export type Ahead = { key: 'merge' | 'build' | 'tests' | 'hand'; word: string; end: number | null; ms: number | null; isNow: boolean; isLate: boolean }
export const LATE_MS = 15 * 60_000
const KEYS = (s: SyncFile): Ahead['key'][] => (s.build ? ['merge', 'build', 'tests'] : ['merge', 'tests'])
const WORD: Record<Ahead['key'], [string, string]> = { merge: ['merging', 'merge'], build: ['building', 'build'], tests: ['testing', 'tests'], hand: ['finishing by hand', 'finishing by hand'] }
/** The steps still ahead of a sync in its freeze (or all of them before it), with their estimates, and the lift (null:
 * unknown). A failed build or a sync handed back has no estimate: only its hard end. */
export const aheadOf = (s: SyncFile, step: FreezeStep | null, times: SyncTimes, now: number): { steps: Ahead[]; lift: number | null } => {
  if (step === 'build-failed' || step === 'manual') return { steps: [{ key: 'hand', word: step === 'manual' ? 'finishing by hand' : 'build failed: the holder reverts or fixes it', end: null, ms: null, isNow: true, isLate: false }], lift: null }
  const keys = KEYS(s)
  const from = step === 'building' ? keys.indexOf('build') : step === 'testing' ? keys.indexOf('tests') : 0
  const isRunning = step === 'merging' || step === 'building' || step === 'testing'
  const start = step === 'merging' ? (s.workerAt ?? s.at) : isRunning ? s.stageAt : s.at
  const msOf = (k: Ahead['key']): number | null => median(k === 'merge' ? times.merge : k === 'build' ? times.build : k === 'tests' ? times.tests : [])
  let at: number | null = start
  const steps = keys.slice(from).map((key, i): Ahead => {
    const ms = msOf(key)
    const isNow = isRunning && i === 0
    const end = at === null || ms === null ? null : at + ms
    const isLate = isNow && end !== null && now - end >= LATE_MS
    at = end === null ? null : isNow ? Math.max(end, now) : end
    return { key, word: WORD[key][isNow ? 0 : 1], end, ms, isNow, isLate }
  })
  return { steps, lift: at }
}
const est = (a: Ahead): string => (a.end !== null ? ` ~${hhmm(a.end)}` : a.ms !== null ? ` ~${Math.round(a.ms / 60_000)} min` : ' (time unknown)')
const stepText = (a: Ahead): string => `${a.isNow ? '▸ ' : ''}${a.word}${a.key === 'hand' ? '' : est(a)}${a.isLate ? ' late' : ''}`
/** When the sync's last step ends: `~HH:MM`, or that it is unknown and the freeze's hard end. */
const liftText = (lift: number | null, s: SyncFile): string => (lift === null ? `the sync is done (time unknown, at the latest ${hhmm(s.hardEnd)})` : `~${hhmm(lift)}`)
const until = (lift: number | null, s: SyncFile): string => `until ${liftText(lift, s)}`
/** The cutoff and the freeze window as a planned sync's line and the cutoff's band name them. */
const cutoffText = (s: SyncFile): string => `cutoff ${hhmm(s.at - CUTOFF_MS)}`
const windowText = (s: SyncFile, lift: number | null): string => `freeze ${lift === null ? `from ${hhmm(s.at)}, end time unknown (at the latest ${hhmm(s.hardEnd)})` : `~${hhmm(s.at)}–${hhmm(lift)}`}`
/** A133: the sync's one line: before the freeze its cutoff and freeze window; in the freeze only the steps still ahead, the
 * current one marked ▸, then when builds (and the Editor) are free again. */
export const timelineLine = (s: SyncFile, phase: Phase, step: FreezeStep | null, times: SyncTimes, now: number): string => {
  const head = `Sync main ${hhmm(s.at)}`
  const { steps, lift } = aheadOf(s, step, times, now)
  if (phase === 'planned' || phase === 'cutoff') return `${head} · ${cutoffText(s)} · ${windowText(s, lift)}`
  return `${head} · ${steps.map(stepText).join(' → ')} → you can build again ${lift === null ? 'when ' : ''}${liftText(lift, s)}`
}

/** A133: the compact line's few words: before the freeze its cutoff and window; in it the current step and when builds
 * are free again. */
export const shortLine = (s: SyncFile, phase: Phase, step: FreezeStep | null, times: SyncTimes, now: number): string => {
  const { steps, lift } = aheadOf(s, step, times, now)
  if (phase !== 'frozen') return `${cutoffText(s)} · ${windowText(s, lift)}`
  return `${steps[0] ? stepText(steps[0]) : ''} · builds again ${lift === null ? `at the latest ${hhmm(s.hardEnd)}` : `~${hhmm(lift)}`}`
}

// ---------- A131 / A132: refusals and step notices ----------
const whatWaits = (s: SyncFile, step: FreezeStep, need: Need, verb: string): string => {
  const isStuck = step === 'build-failed' || step === 'manual'
  const merged = isStuck ? 'the holder ends the sync' : s.build ? 'its build succeeds' : 'the merge is committed'
  if (need === 'git') return `no git ${verb} in the shared checkout until ${merged}`
  if (need === 'edit') return `no edits in the shared checkout until ${isStuck ? merged : 'the merge is committed'}`
  if (need === 'source') return `no edits under Source/ and Plugins/ (or of the files the merge changed) until ${merged}`
  return need === 'editor' ? 'the Editor waits until the sync is done' : 'builds of the shared project wait until the sync is done'
}
/** A131: the freeze's refusal of one need: why, with the timeline, and what to do meanwhile. */
export const freezeWhy = (s: SyncFile, step: FreezeStep, need: Need, verb: string, line: string): { why: string; next: string } => ({
  why: `${s.holder.lane} merges origin/main since ${hhmm(s.at)}: ${whatWaits(s, step, need, verb)} (now ${stepWord(step)}) · ${line}`,
  next: need === 'editor' || need === 'build' ? 'do work that needs no Editor and no build of the shared project; A5R tells you (and wakes you) when it is allowed again' : need === 'git' ? 'leave your changes as they are (never stash or reset them); commit after this step, or work in your own worktree; A5R wakes you when git is free' : `edit what is allowed now${step === 'building' ? ' (outside Source/ and Plugins/)' : ''}, or plan and read; A5R wakes you when these edits are allowed again`,
})
/** A131 / A132: one step's notice: what is allowed again now, what still waits, the timeline. `freed`: what this step frees
 * that this session was refused (it is woken for those). */
export const stepNotice = (s: SyncFile, step: FreezeStep, prev: FreezeStep | null, line: string): string => {
  const was = prev ? HELD[prev] : ALL
  const allowed = NEEDS.filter(n => was.has(n) && !HELD[step].has(n))
  const still = NEEDS.filter(n => HELD[step].has(n))
  const what = step === 'build-failed' ? 'the build failed: everything stays frozen until the holder reverts or fixes it and calls done' : `${stepWord(step)}${allowed.length > 0 ? `: allowed again: ${needWords(allowed)}` : ''}`
  return `A5R · Sync main — ${what}${still.length > 0 ? `; still waiting: ${needWords(still)}` : ''} · ${line} → ${allowed.length > 0 ? 'go on with what is allowed again now' : 'keep working without what waits; you are told at the next step'}`
}
/** A132: whether this step frees anything the session was refused (then an idle session is woken). */
export const freesAny = (step: FreezeStep, refused: ReadonlySet<Need>): boolean => [...refused].some(n => !HELD[step].has(n))
/** A132: the lift estimate moved by 15 min or more since the session was told it. */
export const isMoved = (told: number | null, lift: number | null): boolean => told !== null && lift !== null && Math.abs(lift - told) >= LATE_MS

// ---------- A133: Editor waits ----------
/** A133: what each queued session waits for, with estimated starts: the sync (its last step, until the lift) and the
 * turn before it (the holder's, else the row above). `starts`: each row's expected start (lease.ts expectedStarts from the
 * moment the Editor comes back); `isKnown`: whether those starts rest on known times. */
export const editorWaits = (x: { holder: { lane: string; isSyncSlot: boolean } | null; rows: readonly { id8: string; lane: string }[]; sync: { lane: string; word: string; at: number | null } | null; starts: ReadonlyMap<string, number>; isKnown: boolean }): Map<string, string> => {
  const out = new Map<string, string>()
  x.rows.forEach((r, i) => {
    const prev = i === 0 ? (x.holder && !x.holder.isSyncSlot ? x.holder : null) : x.rows[i - 1]
    const start = x.starts.get(r.id8)
    const parts = [
      ...(x.sync ? [`${x.sync.lane}'s ${x.sync.word} (${x.sync.at === null ? 'time unknown' : `~${hhmm(x.sync.at)}`})`] : []),
      ...(prev ? [`${prev.lane}'s turn (${x.isKnown && start !== undefined ? `~${hhmm(start)}` : 'time unknown'})`] : []),
    ]
    if (parts.length > 0) out.set(r.id8, `after ${parts.join(' and ')}`)
  })
  return out
}

// ---------- A134: the band, the prompt's line, the toast ----------
const waitWords = (held: ReadonlySet<Need>): string => ['git', 'editor', 'build'].filter(n => held.has(n as Need)).map(n => (n === 'git' ? 'git' : n === 'editor' ? 'Editor' : 'build')).join('/')
const editWords = (held: ReadonlySet<Need>): string => (held.has('edit') ? 'edits wait too' : held.has('source') ? 'edits OK outside Source/ and Plugins/' : 'edits OK')
/** A134: the one line above the prompt during the cutoff and the freeze. */
export const bandLine = (s: SyncFile, step: FreezeStep, times: SyncTimes, now: number): string => {
  const { steps, lift } = aheadOf(s, step, times, now)
  if (step === 'cutoff') return `⏸ Sync main ${hhmm(s.at)} · cutoff: commit your own paths, the Editor is released by ${hhmm(s.at - RELEASE_BEFORE_MS)} · ${windowText(s, lift)}`
  const held = HELD[step]
  return `⏸ Sync main · ${steps.map(stepText).join(' → ').replace(/^▸ /, '')} · new ${waitWords(held)} work waits ${until(lift, s)} · ${editWords(held)}`
}
/** A134: the context line a person's prompt carries for the model during the cutoff and the freeze. */
export const promptLine = (s: SyncFile, step: FreezeStep, times: SyncTimes, now: number): string => {
  const { lift } = aheadOf(s, step, times, now)
  const held = HELD[step]
  return step === 'cutoff'
    ? `A5R · Sync main at ${hhmm(s.at)} is in its cutoff: commit your own paths now (git commit -m "…" -- <your paths>), and release the Editor by ${hhmm(s.at - RELEASE_BEFORE_MS)}; from ${hhmm(s.at)} git writes, the Editor and builds wait ${until(lift, s)}. Plan, edit and read meanwhile.`
    : `A5R · Sync main is ${stepWord(step)}: ${needWords(held)} wait ${until(lift, s)}; nothing is blocked for plans, reads${held.has('edit') ? '' : held.has('source') ? ' and edits outside Source/ and Plugins/' : ', edits and git'}. Plan, edit what is allowed and read meanwhile; do not start work that needs what waits.`
}
/** A134: the person's toast, once per session per sync. */
export const toastText = (s: SyncFile, step: FreezeStep, times: SyncTimes, now: number): string => `Sync main in progress ${until(aheadOf(s, step, times, now).lift, s)}: this session can plan and edit; git, Editor and builds wait`

// ---------- A134: Saved/A5R/status.json ----------
export const STATUS_FILE = 'status.json'
/** The `at` a status.json text carries (0 when none): a rewrite is due only when the rest changed. */
export const statusAtOf = (text: string | null): number => {
  try {
    const at = (JSON.parse(text ?? '') as { at?: unknown } | null)?.at
    return typeof at === 'number' ? at : 0
  } catch {
    return 0
  }
}
export type StatusQueueRow = { place: number; lane: string; id8: string; startsAt: number | null; waitsFor: string }
/** A134: the machine-readable state outside viewers read (README "status.json"): written by the minute tick. */
export const statusOf = (x: { now: number; sync: SyncFile | null; phase: Phase; step: FreezeStep | null; times: SyncTimes; holder: { lane: string; id8: string; end: number | null } | null; queue: readonly StatusQueueRow[]; focus: { lane: string; id8: string; end: number } | null }) => {
  const s = x.sync && (x.phase === 'planned' || x.phase === 'cutoff' || x.phase === 'frozen') ? x.sync : null
  const a = s ? aheadOf(s, x.step, x.times, x.now) : null
  return {
    v: 1,
    at: x.now,
    sync: s && a
      ? { id: s.id, at: s.at, holder: s.holder.lane, holderId8: s.holder.id8, phase: x.phase, stage: s.stage, step: x.step, held: x.step ? NEEDS.filter(n => HELD[x.step as FreezeStep].has(n)) : [], steps: a.steps.map(t => ({ step: t.key, word: t.word, endsAt: t.end, isNow: t.isNow, isLate: t.isLate })), liftAt: a.lift, hardEnd: s.hardEnd, line: timelineLine(s, x.phase, x.step, x.times, x.now), band: x.step ? bandLine(s, x.step, x.times, x.now) : null }
      : null,
    editor: { holder: x.holder, queue: x.queue },
    focus: x.focus,
  }
}
