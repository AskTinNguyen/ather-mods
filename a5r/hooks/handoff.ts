// a5r-hosts S-a (L0): the hand-off file, Saved/A5R/handoffs/<id>.json, "this lane runs elsewhere" (a machine label, the
// branch, the pushed base, the claimed paths, one line of task), with its origin-side states only (proposed, cancelled,
// merged) and the result once it is known. One writer: this machine's a5r (the host tool's handoff actions and
// /a5r handoff). D7: the base is on the remote. D13: no secret is ever written. Pure: no `$`; handoffhost.ts reads and
// writes through closures.
import { rx } from './a5r.ts'
import { claimsOf, claimsText, type Claim } from './claims.ts'
import type { StatusHandoff } from './syncplan.ts'
import { isObj, textOf } from './shape.ts'

export const HANDOFF_GATE = 'handoff'
export const HANDOFFS_DIR = 'handoffs'
/** This machine's origin id (generated once): `{ v: 1, originId }`, beside the hand-offs. */
export const ORIGIN_FILE = 'origin.json'
export const HANDOFF_STATES = ['proposed', 'cancelled', 'merged'] as const
export type HandoffState = (typeof HANDOFF_STATES)[number]
export const RESULT_KINDS = ['pr', 'branch', 'report'] as const
export type ResultKind = (typeof RESULT_KINDS)[number]
export const kindOf = (v: unknown): ResultKind => RESULT_KINDS.find(k => k === v) ?? 'pr'

/** prompt.md "Data structures" 3, with L0's fields: `host` is a free-text machine label (no hosts option before S-b),
 * `by` the session that recorded it (its own claim never blocks it), `result.ref` where the answer landed. */
export type Handoff = {
  v: 1
  id: string
  createdAt: number
  from: string
  by?: { id8: string; lane: string }
  intent: { slug: string; branch?: string }
  task: string
  wants: string[]
  base: { remote: string; ref: string; sha: string }
  claims: Claim[]
  needs: { ramGb?: number; minutes?: number; pie?: boolean; build?: boolean; readOnly?: boolean }
  proof: string
  result: { kind: ResultKind; target?: string; ref?: string }
  host: string
  lane?: string
  state: HandoffState
  note?: string
  /** S-d (L2): how it reaches the host (`adapter`: an inbox copy written through it; `manual`: a person carries the
   * packet); absent for an L0 record. `deliveredAt`: when the inbox copy was written (the tick retries until then). */
  via?: 'adapter' | 'manual'
  deliveredAt?: number
  /** S-d: the result PR's number (decision 6), its last score's failing lines, and when GitHub was last read. */
  resultPr?: number
  scoreLines?: string[]
  scoredAt?: number
  /** C12's no-op job: the host answers it and writes done at once. */
  noop?: boolean
  updatedAt: number
}

const text = textOf

/** A hand-off file as read, or null when it is not one (a half-written file, another kind of JSON). */
export const parseHandoff = (raw: string | null): Handoff | null => {
  let v: unknown
  try {
    v = JSON.parse(raw ?? '')
  } catch {
    return null
  }
  if (!isObj(v) || v.v !== 1 || !text(v.id) || !text(v.from) || !isObj(v.base) || !isObj(v.intent) || !isObj(v.result) || !Array.isArray(v.claims)) return null
  if (!(HANDOFF_STATES as readonly string[]).includes(text(v.state)) || typeof v.createdAt !== 'number' || typeof v.updatedAt !== 'number') return null
  const claims = v.claims.filter((c): c is Claim => isObj(c) && typeof c.path === 'string' && typeof c.exclusive === 'boolean')
  const by = isObj(v.by) && text(v.by.id8) ? { id8: text(v.by.id8), lane: text(v.by.lane) } : undefined
  const result = v.result
  return {
    v: 1,
    id: text(v.id),
    createdAt: v.createdAt,
    from: text(v.from),
    ...(by ? { by } : {}),
    intent: { slug: text(v.intent.slug), ...(text(v.intent.branch) ? { branch: text(v.intent.branch) } : {}) },
    task: text(v.task),
    wants: Array.isArray(v.wants) ? v.wants.map(String) : [],
    base: { remote: text(v.base.remote) || 'origin', ref: text(v.base.ref), sha: text(v.base.sha) },
    claims,
    needs: needsOf(v.needs),
    proof: text(v.proof),
    result: { kind: kindOf(result.kind), ...(text(result.target) ? { target: text(result.target) } : {}), ...(text(result.ref) ? { ref: text(result.ref) } : {}) },
    host: text(v.host),
    ...(text(v.lane) ? { lane: text(v.lane) } : {}),
    state: text(v.state) as HandoffState,
    ...(text(v.note) ? { note: text(v.note) } : {}),
    ...(v.via === 'adapter' || v.via === 'manual' ? { via: v.via } : {}),
    ...(typeof v.deliveredAt === 'number' ? { deliveredAt: v.deliveredAt } : {}),
    ...(typeof v.resultPr === 'number' ? { resultPr: v.resultPr } : {}),
    ...(Array.isArray(v.scoreLines) ? { scoreLines: v.scoreLines.map(String) } : {}),
    ...(typeof v.scoredAt === 'number' ? { scoredAt: v.scoredAt } : {}),
    ...(v.noop === true ? { noop: true } : {}),
    updatedAt: v.updatedAt,
  }
}

/** Section 3's `needs`, typed field by field (unknown keys dropped). */
export const needsOf = (v: unknown): Handoff['needs'] => {
  if (!isObj(v)) return {}
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined)
  const b = (x: unknown) => x === true
  return {
    ...(n(v.ramGb) !== undefined ? { ramGb: n(v.ramGb) } : {}),
    ...(n(v.minutes) !== undefined ? { minutes: n(v.minutes) } : {}),
    ...(b(v.pie) ? { pie: true } : {}),
    ...(b(v.build) ? { build: true } : {}),
    ...(b(v.readOnly) ? { readOnly: true } : {}),
  }
}

/** Open: its claims hold (D9). Cancelled and merged hand-offs claim nothing. */
export const isOpen = (h: { state: string }): boolean => h.state === 'proposed'

/** prompt.md section 5, the origin's part: a new one is proposed; proposed → proposed (an update) | cancelled | merged;
 * nothing leaves cancelled or merged. */
export const mayMove = (from: HandoffState | null, to: HandoffState): boolean => (from === null ? to === 'proposed' : from === 'proposed')

/** `<origin id8>-<yymmddhhmm>-<n>` (local time). */
export const handoffId = (origin: string, now: number, n: number): string => {
  const d = new Date(now)
  const two = (x: number) => String(x).padStart(2, '0')
  return `${origin.slice(-8).toLowerCase()}-${two(d.getFullYear() % 100)}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}-${n}`
}

/** Where a result landed, from its ref: a PR (`#12`, a pull URL), a report (a file path), else a branch. */
export const resultKindOf = (ref: string): ResultKind => (prNumberOf(ref) !== null ? 'pr' : /\.(md|txt|json|log|html)$/i.test(ref.trim()) ? 'report' : 'branch')
/** A PR number from a ref (`#12`, a pull URL), or null. */
export const prNumberOf = (ref: string): number | null => {
  const m = /^#(\d+)$/.exec(ref.trim()) ?? /\/pull\/(\d+)/.exec(ref)
  return m ? Number(m[1]) : null
}

/** D13: whether a text holds a secret (the rules' secret_regex). */
export const hasSecret = (body: string, patterns: readonly string[]): boolean => patterns.some(p => rx(p).test(body))

/** The writer guard (D5, D13, section 5): what is wrong with writing `next` over `prev` from this origin, or null. */
export const writeProblem = (prev: Handoff | null, next: Handoff, originId: string, secrets: readonly string[]): [string, string] | null => {
  if (prev && prev.from !== originId) return [`hand-off ${prev.id} was written by another origin (${prev.from})`, 'leave it to its writer; record a hand-off of your own']
  if (next.from !== originId) return [`a hand-off from ${next.from} cannot be written by this origin (${originId})`, 'record it from its own machine']
  if (prev && !mayMove(prev.state, next.state)) return [`hand-off ${prev.id} is ${prev.state}; it cannot become ${next.state}`, 'record a new hand-off']
  if (!prev && next.state !== 'proposed') return [`a new hand-off starts as proposed, not ${next.state}`, 'record it, then change it']
  if (next.state === 'merged' && !next.result.ref) return [`hand-off ${next.id} has no result yet`, `record it first (result ${next.id} <ref>)`]
  if (hasSecret(JSON.stringify(next), secrets)) return ['the hand-off holds a secret (D13: hand-offs carry none)', 'take the credential out; each host keeps its own']
  return null
}

/** D7's refusal: the base is not on the remote. */
export const baseWhy = (what: string, remote: string): [string, string] => [`base ${what} is not on ${remote}`, 'push the branch, then create the hand-off']

/** A base as the remote names it: `origin/x`, `refs/remotes/origin/x` and `refs/heads/x` are `x` (normalized once, in fieldsOf). */
export const baseRefOf = (remote: string, ref: string): string => {
  let r = ref.trim()
  for (const p of [`refs/remotes/${remote}/`, `${remote}/`, 'refs/heads/']) if (r.startsWith(p)) r = r.slice(p.length)
  return r
}

/** D7: the base ref and sha as the remote has them, or why not (`git` runs one git command and answers null when it
 * could not run). `ls-remote` names the ref's tip; a given sha must be that tip or an ancestor of it (`merge-base
 * --is-ancestor`, which needs the tip fetched: unfetched, it fails and the hand-off is refused). */
export const checkBase = async (
  git: (args: string[]) => Promise<{ exitCode: number; stdout: string } | null>,
  base: { remote: string; ref: string; sha?: string },
): Promise<{ sha: string } | { why: [string, string] }> => {
  const ref = base.ref
  const shown = (base.sha ?? '').slice(0, 7) || ref
  const listed = await git(['ls-remote', base.remote, ref])
  if (!listed || (listed.exitCode !== 0 && listed.exitCode !== 2)) return { why: [`${base.remote} could not be read (git ls-remote ${listed ? `exited ${listed.exitCode}` : 'did not run'})`, 'check the remote and the network, then create the hand-off again'] }
  const lines = listed.stdout.split(/\r?\n/).map(l => l.split(/\s+/)).filter(([sha, name]) => sha && name)
  const tip = (lines.find(([, name]) => name === `refs/heads/${ref}`) ?? lines.find(([, name]) => name === ref || name === `refs/tags/${ref}`) ?? lines[0])?.[0]
  if (!tip) return { why: baseWhy(shown, base.remote) }
  const sha = (base.sha ?? '').toLowerCase()
  if (!sha || tip.toLowerCase().startsWith(sha)) return { sha: tip }
  const ancestor = await git(['merge-base', '--is-ancestor', sha, tip])
  return ancestor?.exitCode === 0 ? { sha } : { why: baseWhy(shown, base.remote) }
}

/** What a hand-off is recorded from (the tool's create or `/a5r handoff record`), before D7's check. */
export type RecordFields = { label: string; branch: string; slug: string; base: string; sha: string; remote: string; claims: (string | { path?: unknown; exclusive?: unknown })[]; task: string; kind: ResultKind; note: string }

/** `key=value` words (`"…"` keeps spaces); a word with no `=` is positional. */
export const words = (args: string): { pos: string[]; keys: Record<string, string> } => {
  const pos: string[] = []
  const keys: Record<string, string> = {}
  for (const m of args.matchAll(/([\w-]+)=("([^"]*)"|'([^']*)'|\S*)|"([^"]*)"|'([^']*)'|(\S+)/g)) {
    if (m[1]) keys[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[2] ?? ''
    else pos.push(m[5] ?? m[6] ?? m[7] ?? '')
  }
  return { pos, keys }
}

export const HANDOFF_USAGE = '/a5r handoff record label="<machine>" branch=<branch> [base=<ref>[@<sha>]] [claims="<path>,!<exclusive>,~<shared>"] task="<one line>" · /a5r handoff list · /a5r handoff cancel <id> · /a5r handoff result <id> <ref> · /a5r handoff packet <id> · /a5r handoff merged <id>'

/** `/a5r handoff …` as typed: the sub-command and its fields; null for an unknown sub-command. */
export type HandoffCommand = { op: 'list' } | { op: 'record'; fields: RecordFields } | { op: 'cancel' | 'packet' | 'merged'; id: string } | { op: 'result'; id: string; ref: string }
export const parseHandoffCommand = (args: string): HandoffCommand | null => {
  const { pos, keys } = words(args)
  const [sub = 'list', a = '', b = ''] = pos
  if (sub === 'list') return { op: 'list' }
  if (sub === 'cancel' || sub === 'packet' || sub === 'merged') return a ? { op: sub, id: a } : null
  if (sub === 'result') return a && b ? { op: 'result', id: a, ref: b } : null
  if (sub !== 'record') return null
  const [base = '', sha = ''] = (keys.base ?? '').split('@')
  return { op: 'record', fields: fieldsOf({ label: keys.label ?? keys.host, branch: keys.branch, slug: keys.slug, base, sha: keys.sha ?? sha, remote: keys.remote, claims: keys.claims ?? '', task: keys.task ?? pos.slice(1).join(' '), kind: keys.kind, note: keys.note }) }
}

/** Fields with their defaults: the base is the branch (else main) on origin; the slug is the branch's `intent/<slug>`. */
export const fieldsOf = (x: { label?: unknown; branch?: unknown; slug?: unknown; base?: unknown; sha?: unknown; remote?: unknown; claims?: unknown; task?: unknown; kind?: unknown; note?: unknown }): RecordFields => {
  const branch = text(x.branch).trim()
  const remote = text(x.remote).trim() || 'origin'
  return {
    label: text(x.label).trim(),
    branch,
    slug: text(x.slug).trim() || (/^intent\/([\w.-]+)$/.exec(branch)?.[1] ?? ''),
    base: baseRefOf(remote, text(x.base).trim() || branch || 'main'),
    sha: text(x.sha).trim(),
    remote,
    claims: Array.isArray(x.claims) ? (x.claims as RecordFields['claims']) : typeof x.claims === 'string' ? x.claims.split(',').map(c => c.trim()).filter(Boolean) : [],
    task: text(x.task).trim(),
    kind: kindOf(x.kind),
    note: text(x.note).trim(),
  }
}

/** What is missing or wrong in the fields before anything is read from git, or null. */
export const fieldsProblem = (f: RecordFields, globs: readonly string[]): [string, string] | null => {
  if (!f.label) return ['a hand-off names the machine it runs on', `give label="<machine>" (${HANDOFF_USAGE})`]
  if (!f.task) return ['a hand-off says in one line what is done there', 'give task="<one line>"']
  const bad = claimsOf(f.claims, globs).bad
  if (bad.length) return [`claims must be repo-relative paths or globs: ${bad.join(', ')}`, 'name them from the repository root (Content/X.uasset, Source/Y/)']
  return null
}

/** A new hand-off from checked fields (its base already read on the remote). */
export const newHandoff = (f: RecordFields, x: { id: string; from: string; by: { id8: string; lane: string }; sha: string; now: number; globs: readonly string[] }): Handoff => ({
  v: 1,
  id: x.id,
  createdAt: x.now,
  from: x.from,
  by: x.by,
  intent: { slug: f.slug, ...(f.branch ? { branch: f.branch } : {}) },
  task: f.task,
  wants: [],
  base: { remote: f.remote, ref: f.base, sha: x.sha },
  claims: claimsOf(f.claims, x.globs).claims,
  needs: {},
  proof: '',
  result: { kind: f.kind, ...(f.branch ? { target: f.branch } : {}) },
  host: f.label,
  state: 'proposed',
  ...(f.note ? { note: f.note } : {}),
  updatedAt: x.now,
})

/** One line per hand-off: id, state, machine, branch, claims (`!` exclusive), task. */
export const handoffLine = (h: Handoff): string =>
  `${h.id} · ${h.state} · on ${h.host} · ${h.intent.branch ?? h.base.ref}${h.claims.length ? ` · claims ${claimsText(h.claims)}` : ''}${h.result.ref ? ` · result ${h.result.ref}` : ''} · ${h.task}`

/** D17 in S-a: what status.json carries of each open hand-off. */
export const statusRows = (all: readonly Handoff[]): StatusHandoff[] =>
  all.filter(isOpen).map(h => ({ id: h.id, state: h.state, host: h.host, claims: h.claims, updatedAt: h.updatedAt }))
