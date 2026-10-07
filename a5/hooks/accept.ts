// Nghiệm thu A5 (A18, D9, D10): the five rules scored over a whole branch right before a PR is opened and when an
// intent closes, never per turn. Pure: no `$`; register.ts gathers the inputs cheaply and path-scoped (the branch
// diff against origin/main, the added lines, the intent's four files, Ather's proof, the touch files) and acts on the score.
import { basename, globMatch, proofGap, proofProblems, rx, section, type A5Config, type Proof } from './a5.ts'

export type RuleId = 1 | 2 | 3 | 4 | 5
/** D9: the five rules as the workflow names them. */
export const RULES5: readonly [RuleId, string][] = [
  [1, 'Yêu Project, yêu đồng bào'],
  [2, 'Học tập tốt, lao động tốt'],
  [3, 'Đoàn kết tốt, kỷ luật tốt'],
  [4, 'Giữ gìn vệ sinh thật tốt'],
  [5, 'Khiêm tốn, thật thà, dũng cảm'],
]
export const ruleName = (r: RuleId): string => RULES5.find(([id]) => id === r)?.[1] ?? `rule ${r}`

export type Issue = { file?: string; what: string; todo: string }
export type RuleScore = { rule: RuleId; state: 'pass' | 'fail' | 'na'; line: string; issues: Issue[] }

export type AcceptInput = {
  /** The intent the branch works on, or null (then the light version: rules 3 by diff, 4, 5). */
  slug: string | null
  branch: string
  /** Why the branch diff could not be read whole (no base, a git failure or timeout, output cut), or null. Then
   * nothing is scored: every rule shows – with this, and the gate refuses (an unread diff never passes). */
  diffProblem?: string | null
  /** `git diff --name-only origin/main...HEAD` (main when origin/main is missing). */
  files: string[]
  /** Added lines per text file (`git diff -U0 origin/main...HEAD`, binaries excluded). */
  added: Map<string, string[]>
  prompt: string
  progress: string
  findings: string
  /** `git diff main...HEAD -- docs/intent/<slug>/prompt.md`. */
  promptDiff: string
  proof: Proof | null
  /** The PR body as the command gives it ('' when none, e.g. an intent closing). */
  body: string
  /** Paths other live sessions edit in the shared checkout (their touch files). */
  othersTouch: { lane: string; paths: string[] }[]
  /** Other active intents and the paths they name. */
  otherIntents: { slug: string; names: string[] }[]
  /** This session's files left untracked in the shared checkout. */
  untrackedLeft: string[]
  /** Worktrees checked out on the same branch besides the PR's own folder. */
  strayWorktrees: string[]
  /** This session's background agents still running (the sync worker excepted). */
  runningAgents: string[]
  cfg: Pick<A5Config, 'forbidden_added' | 'todo_regex' | 'secret_regex' | 'ask_paths' | 'ask_root_files'>
}

const lower = (s: string) => s.replace(/\\/g, '/').toLowerCase()

/** The repo paths an intent names: backticked paths and globs in prompt.md, plus its own folder. */
export const namedPaths = (prompt: string, slug: string): string[] => {
  const out = new Set<string>([`docs/intent/${slug}/`])
  for (const m of prompt.matchAll(/`([^`\s]+)`/g)) {
    const t = (m[1] ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (/^[A-Za-z]:\//.test(t) || t.startsWith('~') || t.startsWith('$') || t.includes('://')) continue // a machine path, not a repo path
    if (/^[\w.@{}*-]+(\/[\w.@{}*-]*)+$/.test(t) || /^[\w*-]+\.[A-Za-z*]{1,6}$/.test(t)) out.add(t)
  }
  return [...out]
}

/** A file is within the named paths when one names it, its folder, or a glob that matches it. */
export const inScope = (file: string, names: readonly string[]): boolean =>
  names.some(n => {
    const f = lower(file)
    const g = lower(n)
    if (g.endsWith('/')) return f.startsWith(g)
    if (/[*?{]/.test(g)) return globMatch(f, g.replace(/\{[^}]*\}/g, '*')) || globMatch(basename(f), g)
    return f === g || f.startsWith(`${g}/`)
  })

const mentions = (text: string, file: string): boolean => {
  const t = lower(text)
  return t.includes(lower(file)) || t.includes(lower(basename(file)))
}

/** The acceptance ids prompt.md lists (`- A1:`, `- A12 (rev 4):`). */
export const acceptanceIds = (prompt: string): string[] => [...prompt.matchAll(/^-\s+(A\d+)\b[^:\n]*:/gm)].map(m => m[1] ?? '').filter(Boolean)

/** progress.md's Acceptance table: id → verdict and evidence. */
export const progressRows = (progress: string): Map<string, { verdict: string; evidence: string }> => {
  const rows = new Map<string, { verdict: string; evidence: string }>()
  for (const m of progress.matchAll(/^\|\s*(A\d+)\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|?\s*$/gm)) rows.set(m[1] ?? '', { verdict: (m[2] ?? '').toLowerCase(), evidence: (m[3] ?? '').replace(/\|\s*$/, '').trim() })
  return rows
}

const isDoc = (f: string) => /\.(md|txt|rst)$/i.test(f) || lower(f).startsWith('docs/')

/** The five rules over the branch: each passes, fails with its issues, or does not apply. */
export const score = (x: AcceptInput): RuleScore[] => {
  if (x.diffProblem) return RULES5.map(([rule]) => ({ rule, state: 'na' as const, line: unreadLine(x.diffProblem ?? ''), issues: [] }))
  const scores: RuleScore[] = []
  const mk = (rule: RuleId, issues: Issue[], passLine: string, na = false): RuleScore => ({ rule, state: na ? 'na' : issues.length ? 'fail' : 'pass', line: na ? passLine : issues.length ? issues.map(i => `${i.file ? `${i.file}: ` : ''}${i.what}`).join('; ') : passLine, issues })
  const own = x.slug ? namedPaths(x.prompt, x.slug) : []

  // 1 Yêu Project, yêu đồng bào: nothing another live session or another intent holds; nothing straight onto main.
  const r1: Issue[] = []
  if (/^(main|master)$/i.test(x.branch)) r1.push({ what: `the branch is ${x.branch}`, todo: 'open the PR from a branch of its own, cut from main' })
  for (const f of x.files) {
    const s = x.othersTouch.find(t => t.paths.some(p => lower(p) === lower(f)))
    if (s) r1.push({ file: f, what: `${s.lane} is editing it too (its touch file)`, todo: 'settle it with that session first, or leave the file to it' })
    const o = x.otherIntents.find(i => inScope(f, i.names))
    if (o && !(x.slug && inScope(f, own))) r1.push({ file: f, what: `intent ${o.slug} names it`, todo: 'leave it to that intent, or record the overlap in findings.md' })
  }
  scores.push(mk(1, r1, 'no other session\'s or intent\'s paths; not on main'))

  // 2 Học tập tốt, lao động tốt: every row met with evidence, Ather's proof complete, new TODOs recorded.
  const r2: Issue[] = []
  if (x.slug) {
    const rows = progressRows(x.progress)
    for (const id of acceptanceIds(x.prompt)) {
      const row = rows.get(id)
      if (!row) r2.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} has no row`, todo: 'add the row with its verdict and evidence' })
      else if (row.verdict !== 'met') r2.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} is ${row.verdict || 'empty'}`, todo: 'prove it, or record in findings.md why this PR ships without it' })
      else if (!row.evidence) r2.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} is met without evidence`, todo: 'add the command and its result line' })
    }
    const gap = x.proof ? proofGap(x.proof) : null
    if (gap) r2.push({ what: `Ather's proof is incomplete for the role ${x.proof?.role || '(none)'}: still needs ${gap}`, todo: 'run it, or ask Hai' })
    for (const [f, lines] of x.added) {
      if (lower(f).startsWith('docs/intent/')) continue
      if (lines.some(l => rx(x.cfg.todo_regex).test(l)) && !mentions(x.progress, f) && !mentions(x.findings, f))
        r2.push({ file: f, what: 'a new TODO/FIXME is not listed in progress.md or findings.md', todo: 'list it under Open or as a finding' })
    }
  }
  scores.push(mk(2, r2, x.slug ? 'every acceptance row met with evidence; proof complete' : 'no intent: acceptance rows not scored', !x.slug))

  // 3 Đoàn kết tốt, kỷ luật tốt: the diff stays within the intent's paths, or says why.
  const r3: Issue[] = []
  if (x.slug) {
    for (const f of x.files) if (!inScope(f, own) && !mentions(x.progress, f) && !mentions(x.findings, f)) r3.push({ file: f, what: 'outside the paths the intent names', todo: 'explain it in progress.md or findings.md, or move it to its own PR' })
  } else {
    for (const f of x.files) {
      const isConfig = x.cfg.ask_root_files.some(r => lower(r) === lower(f)) || x.cfg.ask_paths.some(g => globMatch(f, g) || globMatch(basename(f), g))
      if (isConfig && !mentions(x.body, f)) r3.push({ file: f, what: 'shared repository config changed', todo: 'name it and why in the PR body' })
    }
  }
  scores.push(mk(3, r3, x.slug ? 'within the intent\'s paths' : 'no shared config changed without a word'))

  // 4 Giữ gìn vệ sinh thật tốt: no leftovers, secrets, stray files, worktrees or background work.
  const r4: Issue[] = []
  for (const [f, lines] of x.added) {
    const secret = lines.find(l => x.cfg.secret_regex.some(p => rx(p).test(l)))
    if (secret) r4.push({ file: f, what: 'a secret in the diff', todo: 'remove it and rotate it; keep secrets out of the repo' })
    if (isDoc(f)) continue
    const debug = lines.find(l => x.cfg.forbidden_added.some(p => rx(p).test(l)))
    if (debug) r4.push({ file: f, what: `a debug leftover (${debug.trim().slice(0, 40)})`, todo: 'remove it' })
  }
  for (const f of x.untrackedLeft) r4.push({ file: f, what: 'left untracked in the shared checkout', todo: 'commit it with the intent or move it out of the tree' })
  for (const w of x.strayWorktrees) r4.push({ file: w, what: 'a second worktree on this branch', todo: 'remove it once its work is in the branch (git worktree remove)' })
  for (const a of x.runningAgents) r4.push({ what: `background agent still running: ${a}`, todo: 'let it finish or stop it before the PR' })
  scores.push(mk(4, r4, 'no leftovers, secrets, stray files or background work'))

  // 5 Khiêm tốn, thật thà, dũng cảm: claims match the evidence; acceptance never rewritten without a rev.
  const r5: Issue[] = []
  if (x.proof && x.body) {
    const names = ['Verified', 'Validation', 'Test plan', 'Testing']
    const verified = names.map(n => section(x.body, n, names)).find((s): s is string => s !== null) ?? x.body
    for (const p of proofProblems(x.proof, verified).filter(p => p.startsWith('D5'))) r5.push({ what: `PR body: ${p.slice(3).split(' -> ')[0]}`, todo: p.split(' -> ')[1] ?? 'claim only what was measured' })
  }
  if (x.slug) {
    for (const [id, row] of progressRows(x.progress)) if (row.verdict === 'met' && /\b(chưa|not run|not yet|todo|pending)\b/i.test(row.evidence)) r5.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} is met but its evidence says it is not done`, todo: 'mark it open, or put the result line in' })
    const removed = x.promptDiff.split('\n').filter(l => /^-\s*-\s+A\d+\b/.test(l))
    const revised = x.promptDiff.split('\n').some(l => /^\+\s*-\s*Rev:/.test(l))
    if (removed.length && !revised) r5.push({ file: `docs/intent/${x.slug}/prompt.md`, what: `acceptance rewritten without a new rev (${removed.length} row${removed.length === 1 ? '' : 's'})`, todo: 'put the old rows back, or raise a finding so the director revises the intent' })
  }
  scores.push(mk(5, r5, 'claims match the evidence'))
  return scores
}

/** An unread branch diff is no pass: the card line and the gate text. */
export const unreadLine = (why: string): string => `could not read the whole branch diff (${why})`
export const unreadText = (why: string): string =>
  `A5 · Nghiệm thu — ${unreadLine(why)} → open the PR from a slice branch cut from origin/main, or Hai lets this one through`

export const failed = (scores: readonly RuleScore[]): RuleScore[] => scores.filter(s => s.state === 'fail')

/** The refusal (or the ask) that lists what to fix: rule, file, what to do. */
export const acceptText = (scores: readonly RuleScore[], what: string): string => {
  const bad = failed(scores)
  return `A5 · Nghiệm thu — ${bad.length} of 5 rules not met before ${what} → fix these, or ask Hai to let this one through:\n${bad
    .flatMap(s => s.issues.map(i => `- ${s.rule} ${ruleName(s.rule)}: ${i.file ? `${i.file}: ` : ''}${i.what} → ${i.todo}`))
    .join('\n')}`
}

/** A command that opens a PR: `gh pr create`, or `gh api …/pulls` as a POST (fields imply one). */
export const isPrCommand = (command: string): boolean =>
  /\bgh\s+pr\s+create\b/.test(command) ||
  (/\bgh\s+api\b[^\n|;&]*\/pulls\b(?!\/)/.test(command) && !/(-X|--method)\s+GET\b/i.test(command) && /(-X|--method)\s+POST\b|\s-[fF]\s|--(raw-)?field\b|--input\b/i.test(command))

/** An intent being closed: its prompt.md gains a closed Status line. */
export const closesIntent = (path: string, added: readonly string[]): string | null => {
  const m = /(?:^|\/)docs\/intent\/([^/]+)\/prompt\.md$/i.exec(path.replace(/\\/g, '/'))
  return m && added.some(l => /^-\s*Status:\s*(closed|done|complete|completed|shipped)\b/i.test(l.trim())) ? (m[1] ?? null) : null
}

/** A21: the intent an Ather Ship prompt hands over, from its wording (packs unreal, core, web: "Prepare intent <slug>
 * for landing", "Summarise intent <slug> for an owner to land" / "for landing", "Land intent <slug>:"), or null. */
export const shipSlugOf = (text: string): string | null => {
  const m = /\b(?:Prepare intent ([\w.-]+?) for landing\b|Summari[sz]e intent ([\w.-]+?) for (?:an owner to land|landing)\b|Land intent ([\w.-]+?):)/.exec(text)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

/** A21: the score added to the Ship prompt: five rows and what to fix before the PR (never a refusal). */
export const shipText = (scores: readonly RuleScore[], slug: string, branch: string, diffProblem?: string | null): string => {
  const mark = (s: RuleScore) => (s.state === 'pass' ? '✓' : s.state === 'fail' ? '✗' : '–')
  const bad = failed(scores)
  const head = diffProblem
    ? `A5 · Nghiệm thu at Ship (intent ${slug}, branch ${branch || '?'}): not scored, ${unreadLine(diffProblem)} → land it from a slice branch cut from origin/main; the PR call is scored again.`
    : bad.length
      ? `A5 · Nghiệm thu at Ship (intent ${slug}, branch ${branch || '?'}): ${bad.length} of 5 rules not met → fix these before you open the PR (the PR call is scored again and refused while any is open):`
      : `A5 · Nghiệm thu at Ship (intent ${slug}, branch ${branch || '?'}): 5 of 5 met; the PR call is scored again.`
  const rows = diffProblem ? [] : scores.map(s => `${mark(s)} ${s.rule} ${ruleName(s.rule)}: ${s.line}`)
  const todo = diffProblem ? [] : bad.flatMap(s => s.issues.map(i => `- ${s.rule}: ${i.file ? `${i.file}: ` : ''}${i.what} → ${i.todo}`))
  return [head, ...rows, ...(todo.length ? ['To fix:', ...todo] : [])].join('\n')
}
