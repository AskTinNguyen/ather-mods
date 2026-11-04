// Rev 44 (L-48): the sync freeze in steps and the times every session waits for. A131: what each step of a sync still
// holds (merging, building, a failed build, testing, finishing by hand). A132: who is told and woken at each step. A133:
// one timeline line with estimates (`~`, from the measured durations of the last syncs; "time unknown" without data; `late`
// 15 min past one) and what each Editor wait waits for. A134: the band above the prompt, the prompt's context line, the
// toast, and Saved/A5R/status.json. Pure: no `$`; register.ts reads the files and logs, decides with these, and writes.
import type { WakeStatus } from './wake.ts'
import { CUTOFF_MS, RELEASE_BEFORE_MS, hhmm, type Phase, type SyncFile } from './coord.ts'
import { writtenIn, type Seg } from './gitshared.ts'
import type { BuildLogRead, SyncStage } from './syncstage.ts'

// ---------- A131: the steps of a freeze and what each holds ----------
export type FreezeStep = 'cutoff' | 'merging' | 'building' | 'build-failed' | 'testing' | 'manual'
/** What a session may need that a freeze can hold: git writes, edits in the shared checkout, edits under Source/ and
 * Plugins/ (and the files the merge changed), the Editor (launch, PIE, MCP), a build of the shared project. */
export type Need = 'git' | 'edit' | 'source' | 'editor' | 'build'
export const NEEDS: readonly Need[] = ['git', 'edit', 'source', 'editor', 'build']
const ALL: ReadonlySet<Need> = new Set(NEEDS)
/** The sync's timed runs, in order (a sync without a build has no build run), and their words, current and ahead. */
export type Run = 'merge' | 'build' | 'tests'
const RUNS: Record<Run, { now: string; ahead: string }> = { merge: { now: 'merging', ahead: 'merge' }, build: { now: 'building', ahead: 'build' }, tests: { now: 'testing', ahead: 'tests' } }
/** A131: each step: what it holds, its word, the run it times (null: none), and whether it stays stuck until the holder
 * ends the sync. The merge writes the tree (everything waits); after the merge commit the build reads Source/ and Plugins/
 * (other edits are allowed again); once the build's own `Result: Succeeded` is read git and every edit are free, and only
 * the Editor and builds wait for the tests and done; a failed build, or a sync handed back to its holder, keeps
 * everything. The cutoff holds nothing (it asks). */
export const STEPS: Readonly<Record<FreezeStep, { held: ReadonlySet<Need>; word: string; run: Run | null; isStuck: boolean }>> = {
  cutoff: { held: new Set(), word: 'cutoff', run: null, isStuck: false },
  merging: { held: ALL, word: 'merging', run: 'merge', isStuck: false },
  building: { held: new Set<Need>(['git', 'source', 'editor', 'build']), word: 'building', run: 'build', isStuck: false },
  'build-failed': { held: ALL, word: 'build failed', run: null, isStuck: true },
  testing: { held: new Set<Need>(['editor', 'build']), word: 'testing', run: 'tests', isStuck: false },
  manual: { held: ALL, word: 'finishing by hand', run: null, isStuck: true },
}
export const heldIn = (step: FreezeStep): ReadonlySet<Need> => STEPS[step].held
/** The step of a sync now (null: none open, or only planned). `build`: what the sync's build log of this run says. */
export const freezeStepOf = (phase: Phase, stage: SyncStage | null, build: BuildLogRead | null): FreezeStep | null => {
  if (phase === 'cutoff') return 'cutoff'
  if (phase !== 'frozen') return null
  if (stage === null) return 'merging'
  if (stage === 'building') return build === 'Failed' ? 'build-failed' : build === 'Succeeded' ? 'testing' : 'building' // Fable 8: lifted on the log's own line
  return stage
}
/** A131: an edit of `rel` (repo-relative) needs `source` under Source/ or Plugins/ or on a path the merge changed, else `edit`. */
export const editNeed = (rel: string, mergeChanged: ReadonlySet<string>): Need => (/^(source|plugins)(\/|$)/i.test(rel) || mergeChanged.has(rel.toLowerCase()) ? 'source' : 'edit')
/** Fable 9: the edit needs of a shell command's segments (gitshared.ts walkDeep): where each segment but git (a git write)
 * may write in the shared tree (gitshared.ts writtenIn), by the same rule as an edit (editNeed: a folder under Source/ or
 * Plugins/ is one there). Known limit: a command run at the checkout's top folder that writes under Source/ by an argument
 * (`cd <checkout> && cp x Source/y`) counts as a plain edit: copy and move arguments are not read as targets. */
export const shellNeeds = (segs: readonly Seg[], root: string, mergeChanged: ReadonlySet<string>): Need[] => {
  const top = root.replace(/\/$/, '').length + 1
  return segs.filter(seg => seg.verb !== 'git').flatMap(seg => writtenIn(seg, root)).map(p => editNeed(p.slice(top), mergeChanged))
}
const WAIT_NEXT = 'do work that needs no Editor and no build of the shared project; A5R tells you (and wakes you) when it is allowed again'
/** Each need: its words, its word in the band's "new … work" (null: an edit, said apart), why a refusal of it waits
 * (`merged`: when git and Source/ edits are free again) and what to do meanwhile. */
const NEED: Record<Need, { words: string; band: string | null; waits: (verb: string, merged: string, isStuck: boolean) => string; next: (step: FreezeStep) => string }> = {
  git: { words: 'git writes', band: 'git', waits: (verb, merged) => `no git ${verb} in the shared checkout until ${merged}`, next: () => 'leave your changes as they are (never stash or reset them); commit after this step, or work in your own worktree; A5R wakes you when git is free' },
  edit: { words: 'edits in the shared checkout', band: null, waits: (_, merged, isStuck) => `no edits in the shared checkout until ${isStuck ? merged : 'the merge is committed'}`, next: () => 'edit what is allowed now, or plan and read; A5R wakes you when these edits are allowed again' },
  source: { words: 'edits under Source/ and Plugins/ (and of the files the merge changed)', band: null, waits: (_, merged) => `no edits under Source/ and Plugins/ (or of the files the merge changed) until ${merged}`, next: step => `edit what is allowed now${step === 'building' ? ' (outside Source/ and Plugins/)' : ''}, or plan and read; A5R wakes you when these edits are allowed again` },
  editor: { words: 'the Editor (launch, PIE, MCP)', band: 'Editor', waits: () => 'the Editor waits until the sync is done', next: () => WAIT_NEXT },
  build: { words: 'builds of the shared project', band: 'build', waits: () => 'builds of the shared project wait until the sync is done', next: () => WAIT_NEXT },
}
export const needWords = (needs: Iterable<Need>): string => [...needs].map(n => NEED[n].words).join(', ')

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
/** A step still ahead: its run (null: a stuck step, no estimate), its words, its estimated end and length (null:
 * unknown), whether it is the current one, and `late` (15 min or more past its estimate). */
export type Ahead = { run: Run | null; word: string; end: number | null; ms: number | null; isNow: boolean; isLate: boolean }
export const LATE_MS = 15 * 60_000
/** The steps still ahead of a sync in its freeze (or all of them before it), with their estimates, and the lift (null:
 * unknown). A stuck step (a failed build, a sync handed back) has no estimate: only its hard end. */
export const aheadOf = (s: SyncFile, step: FreezeStep | null, times: SyncTimes, now: number): { steps: Ahead[]; lift: number | null } => {
  const at = step ? STEPS[step] : null
  if (at?.isStuck) return { steps: [{ run: null, word: step === 'manual' ? at.word : 'build failed: the holder reverts or fixes it', end: null, ms: null, isNow: true, isLate: false }], lift: null }
  const order: Run[] = s.build ? ['merge', 'build', 'tests'] : ['merge', 'tests']
  const current = at?.run ?? null
  let t: number | null = current === null ? s.at : current === 'merge' ? (s.workerAt ?? s.at) : s.stageAt
  const steps = order.slice(current ? order.indexOf(current) : 0).map((run): Ahead => {
    const ms = median(times[run])
    const isNow = run === current
    const end = t === null || ms === null ? null : t + ms
    const isLate = isNow && end !== null && now - end >= LATE_MS
    t = end === null ? null : isNow ? Math.max(end, now) : end
    return { run, word: isNow ? RUNS[run].now : RUNS[run].ahead, end, ms, isNow, isLate }
  })
  return { steps, lift: t }
}
const est = (a: Ahead): string => (a.run === null ? '' : a.end !== null ? ` ~${hhmm(a.end)}` : a.ms !== null ? ` ~${Math.round(a.ms / 60_000)} min` : ' (time unknown)')
const stepText = (a: Ahead): string => `${a.isNow ? '▸ ' : ''}${a.word}${est(a)}${a.isLate ? ' late' : ''}`
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
/** A131: the freeze's refusal of one need: why, with the timeline, and what to do meanwhile. */
export const freezeWhy = (s: SyncFile, step: FreezeStep, need: Need, verb: string, line: string): { why: string; next: string } => {
  const { isStuck, word } = STEPS[step]
  const merged = isStuck ? 'the holder ends the sync' : s.build ? 'its build succeeds' : 'the merge is committed'
  return { why: `${s.holder.lane} merges origin/main since ${hhmm(s.at)}: ${NEED[need].waits(verb, merged, isStuck)} (now ${word}) · ${line}`, next: NEED[need].next(step) }
}
/** A131 / A132: one step's notice: what is allowed again since `prev` (null: the freeze's start), what still waits, and
 * the timeline. */
export const stepNotice = (step: FreezeStep, prev: FreezeStep | null, line: string): string => {
  const was = prev ? heldIn(prev) : ALL
  const allowed = NEEDS.filter(n => was.has(n) && !heldIn(step).has(n))
  const still = NEEDS.filter(n => heldIn(step).has(n))
  const what = step === 'build-failed' ? 'the build failed: everything stays frozen until the holder reverts or fixes it and calls done' : `${STEPS[step].word}${allowed.length > 0 ? `: allowed again: ${needWords(allowed)}` : ''}`
  return `A5R · Sync main — ${what}${still.length > 0 ? `; still waiting: ${needWords(still)}` : ''} · ${line} → ${allowed.length > 0 ? 'go on with what is allowed again now' : 'keep working without what waits; you are told at the next step'}`
}
/** A132: whether this step frees anything the session was refused (then an idle session is woken). */
export const freesAny = (step: FreezeStep, refused: ReadonlySet<Need>): boolean => [...refused].some(n => !heldIn(step).has(n))
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
const waitWords = (held: ReadonlySet<Need>): string => NEEDS.flatMap(n => (held.has(n) ? (NEED[n].band ?? []) : [])).join('/')
const editWords = (held: ReadonlySet<Need>): string => (held.has('edit') ? 'edits wait too' : held.has('source') ? 'edits OK outside Source/ and Plugins/' : 'edits OK')
/** A134: the one line above the prompt during the cutoff and the freeze. */
export const bandLine = (s: SyncFile, step: FreezeStep, times: SyncTimes, now: number): string => {
  const { steps, lift } = aheadOf(s, step, times, now)
  if (step === 'cutoff') return `⏸ Sync main ${hhmm(s.at)} · cutoff: commit your own paths, the Editor is released by ${hhmm(s.at - RELEASE_BEFORE_MS)} · ${windowText(s, lift)}`
  const held = heldIn(step)
  return `⏸ Sync main · ${steps.map(stepText).join(' → ').replace(/^▸ /, '')} · new ${waitWords(held)} work waits ${until(lift, s)} · ${editWords(held)}`
}
/** A134: the context line a person's prompt carries for the model during the cutoff and the freeze. */
export const promptLine = (s: SyncFile, step: FreezeStep, times: SyncTimes, now: number): string => {
  const { lift } = aheadOf(s, step, times, now)
  const held = heldIn(step)
  return step === 'cutoff'
    ? `A5R · Sync main at ${hhmm(s.at)} is in its cutoff: commit your own paths now (git commit -m "…" -- <your paths>), and release the Editor by ${hhmm(s.at - RELEASE_BEFORE_MS)}; from ${hhmm(s.at)} git writes, the Editor and builds wait ${until(lift, s)}. Plan, edit and read meanwhile.`
    : `A5R · Sync main is ${STEPS[step].word}: ${needWords(held)} wait ${until(lift, s)}; nothing is blocked for plans, reads${held.has('edit') ? '' : held.has('source') ? ' and edits outside Source/ and Plugins/' : ', edits and git'}. Plan, edit what is allowed and read meanwhile; do not start work that needs what waits.`
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
export type StatusQueueRow = { place: number; lane: string; id8: string; startsAt: number | null; waitsFor: string; stopped?: true } // stopped: A139
/** A134: Saved/A5R/status.json as outside viewers read it (README "status.json"). */
export type StatusFile = {
  v: 1
  at: number
  sync: { id: string; at: number; holder: string; holderId8: string; phase: Phase; stage: SyncStage | null; step: FreezeStep | null; held: Need[]; steps: { run: Run | null; word: string; endsAt: number | null; isNow: boolean; isLate: boolean }[]; liftAt: number | null; hardEnd: number; line: string; band: string | null } | null
  editor: { holder: { lane: string; id8: string; end: number | null } | null; queue: readonly StatusQueueRow[] }
  focus: { lane: string; id8: string; end: number } | null
  /** A139 / A141: how many queued sessions have stopped, the start in flight, and the idle-with-work minutes. */
  wake?: WakeStatus
}
/** A134: the state the minute tick writes for outside viewers. */
export const statusOf = (x: { now: number; sync: SyncFile | null; phase: Phase; step: FreezeStep | null; times: SyncTimes; holder: { lane: string; id8: string; end: number | null } | null; queue: readonly StatusQueueRow[]; focus: { lane: string; id8: string; end: number } | null; wake?: WakeStatus }): StatusFile => {
  const s = x.sync && (x.phase === 'planned' || x.phase === 'cutoff' || x.phase === 'frozen') ? x.sync : null
  const a = s ? aheadOf(s, x.step, x.times, x.now) : null
  const step = x.step
  return {
    v: 1,
    at: x.now,
    sync: s && a
      ? { id: s.id, at: s.at, holder: s.holder.lane, holderId8: s.holder.id8, phase: x.phase, stage: s.stage, step, held: step ? NEEDS.filter(n => heldIn(step).has(n)) : [], steps: a.steps.map(t => ({ run: t.run, word: t.word, endsAt: t.end, isNow: t.isNow, isLate: t.isLate })), liftAt: a.lift, hardEnd: s.hardEnd, line: timelineLine(s, x.phase, step, x.times, x.now), band: step ? bandLine(s, step, x.times, x.now) : null }
      : null,
    editor: { holder: x.holder, queue: x.queue },
    focus: x.focus,
    ...(x.wake ? { wake: x.wake } : {}),
  }
}
