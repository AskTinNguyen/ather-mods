// A5R acceptance (nghiệm thu, A18, D9, D10): the five rules scored over a whole branch right before a PR is opened and when an
// intent closes, never per turn. Pure: no `$`; register.ts gathers the inputs cheaply and path-scoped (the branch
// diff against origin/main, the added lines, the intent's four files, Ather's proof, the touch files) and acts on the score.
import { basename, globMatch, proofGap, proofProblems, rx, section, type A5RConfig, type Proof } from './a5r.ts'
import { heredocs, prCalls, prRefs, type PrRefsRead } from './prcmd.ts'

export type RuleId = 1 | 2 | 3 | 4 | 5
/** D9: the five rules as the workflow names them. */
export const RULES5: readonly [RuleId, string][] = [
  [1, 'Love the project, love your fellow sessions'],
  [2, 'Study well, work well'],
  [3, 'Unity and discipline'],
  [4, 'Keep it clean'],
  [5, 'Modest, honest, brave'],
]
export const ruleName = (r: RuleId): string => RULES5.find(([id]) => id === r)?.[1] ?? `rule ${r}`

/** One thing to fix. `group` (A53): what a run of files in one folder share, for the card's grouped line
 * (`<folder> · <n> files: <group>`); `what` otherwise. */
export type Issue = { file?: string; what: string; todo: string; group?: string }
export type RuleScore = { rule: RuleId; state: 'pass' | 'fail' | 'na'; line: string; issues: Issue[] }

export type AcceptInput = {
  /** The intent the branch works on, or null (then the light version: rules 3 by diff, 4, 5). */
  slug: string | null
  branch: string
  /** Why the branch diff could not be read whole (no base, a git failure or timeout, output cut), or null. Then
   * nothing is scored: every rule shows – with this, and the gate refuses (an unread diff never passes). */
  diffProblem?: string | null
  /** A52: why the PR's head or base could not be found locally (no worktree, no origin/<head>, no base, another
   * repository): after the fact the PR is then read from GitHub instead (`gh pr diff`). */
  refProblem?: string | null
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
  cfg: Pick<A5RConfig, 'forbidden_added' | 'todo_regex' | 'secret_regex' | 'ask_paths' | 'ask_root_files'>
  /** A42: the a5r kit's own folders in this repository (its rules/ and tests/, where the markers are defined and
   * exercised); rule 4's debug-leftover scan skips them. */
  kitDirs?: string[]
  /** A75: actions that ran at the tool call and were recorded (kind: `tests` for removed assertions, `shared:…` for
   * shared config, `delete`, …), with the repository-relative path and who did it when. */
  recorded?: { kind: string; path: string; at: number; lane: string }[]
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
/** A42 / A72: files that define or quote the markers and words a scan looks for: docs and Markdown, and the a5r kit's
 * own rules/ and tests/. Rule 4's leftover scan and rule 2's TODO scan both skip them. */
const isKitOrDoc = (f: string, kitDirs: readonly string[] | undefined): boolean => isDoc(f) || (kitDirs ?? []).some(d => lower(f).startsWith(lower(d)))

/** A72: whether a met row's evidence says the work is not done. The words count only as a status: code spans
 * (`…`) are left out, as are the file PENDING.md (and its all-caps name), a "PENDING line", and "pending" as an
 * adjective of a noun (a pending request). "pending review", "pending Hai", "not run yet", "chưa chạy", "todo: rerun"
 * still count. */
export const saysNotDone = (evidence: string): boolean => {
  const prose = evidence
    .replace(/`[^`]*`/g, ' ')
    .replace(/PENDING\.md/gi, ' ')
    .replace(/\bpending\s+lines?\b/gi, ' ')
    .replace(/\bPENDING\b/g, ' ')
    .replace(/\bpending\s+(requests?|grants?|notices?|asks?|prompts?|alerts?|files?|entries|entry|items?|calls?|syncs?|leases?|wakes?)\b/gi, ' ')
  return /(^|[^\p{L}\p{N}])(chưa|not run|not yet|todo|pending)(?![\p{L}\p{N}])/iu.test(prose)
}

/** A56: whether an intent's checklist is complete: it has acceptance rows and every one is met or waived in
 * progress.md (Ather's done words count too: pass, done, ✓). */
export const checklistComplete = (prompt: string, progress: string): boolean => {
  const ids = acceptanceIds(prompt)
  const rows = progressRows(progress)
  return ids.length > 0 && ids.every(id => /^(met|waived|pass|passed|done|✓|✔|✅)(?![\p{L}\p{N}])/iu.test(rows.get(id)?.verdict ?? ''))
}

/** A56: Ather's `checklist` ("done/total") says complete. */
export const checklistFull = (checklist: string | undefined): boolean => {
  const m = /^(\d+)\/(\d+)$/.exec((checklist ?? '').trim())
  return Boolean(m) && Number(m?.[2]) > 0 && m?.[1] === m?.[2]
}

/** A57: what `/a5r pass` names: a PR (`#123`, `123`, a pull URL) as `#123`, or an intent slug; null when neither. */
export const passKey = (arg: string): string | null => {
  const t = arg.trim()
  const pr = /^#?(\d+)$/.exec(t) ?? /\/pull\/(\d+)/.exec(t)
  if (pr) return `#${pr[1]}`
  return /^[\w.-]+$/.test(t) && !/^\d/.test(t) ? t.toLowerCase() : null
}

/** Every rule – with why the diff could not be read (nothing scored). */
export const unscored = (why: string): RuleScore[] => RULES5.map(([rule]) => ({ rule, state: 'na' as const, line: unreadLine(why), issues: [] }))

/** The five rules over the branch: each passes, fails with its issues, or does not apply. */
export const score = (x: AcceptInput): RuleScore[] => {
  if (x.diffProblem) return unscored(x.diffProblem)
  const scores: RuleScore[] = []
  const mk = (rule: RuleId, issues: Issue[], passLine: string, na = false): RuleScore => ({ rule, state: na ? 'na' : issues.length ? 'fail' : 'pass', line: na ? passLine : issues.length ? issues.map(i => `${i.file ? `${i.file}: ` : ''}${i.what}`).join('; ') : passLine, issues })
  const own = x.slug ? namedPaths(x.prompt, x.slug) : []

  // 1 Love the project, love your fellow sessions: nothing another live session or another intent holds; nothing straight onto main.
  const r1: Issue[] = []
  if (/^(main|master)$/i.test(x.branch)) r1.push({ what: `the branch is ${x.branch}`, todo: 'open the PR from a branch of its own, cut from main' })
  for (const f of x.files) {
    const s = x.othersTouch.find(t => t.paths.some(p => lower(p) === lower(f)))
    if (s) r1.push({ file: f, what: `${s.lane} is editing it too (its touch file)`, todo: 'settle it with that session first, or leave the file to it', group: `edited by ${s.lane} too` })
    const o = x.otherIntents.find(i => inScope(f, i.names))
    if (o && !(x.slug && inScope(f, own))) r1.push({ file: f, what: `intent ${o.slug} names it`, todo: 'leave it to that intent, or record the overlap in findings.md', group: `named by intent ${o.slug}` })
  }
  scores.push(mk(1, r1, 'no other session\'s or intent\'s paths; not on main'))

  // 2 Study well, work well: every row met with evidence, Ather's proof complete, new TODOs recorded.
  const r2: Issue[] = []
  if (x.slug) {
    const rows = progressRows(x.progress)
    for (const id of acceptanceIds(x.prompt)) {
      const row = rows.get(id)
      if (!row) r2.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} has no row`, todo: 'add the row with its verdict and evidence' })
      else if (row.verdict === 'waived' || row.verdict.startsWith('waived ')) continue // A56: a row Hai waived is done
      else if (row.verdict !== 'met') r2.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} is ${row.verdict || 'empty'}`, todo: 'prove it, or record in findings.md why this PR ships without it' })
      else if (!row.evidence) r2.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} is met without evidence`, todo: 'add the command and its result line' })
    }
    const gap = x.proof ? proofGap(x.proof) : null
    if (gap) r2.push({ what: `Ather's proof is incomplete for the role ${x.proof?.role || '(none)'}: still needs ${gap}`, todo: 'run it so Ather reads it' })
    for (const [f, lines] of x.added) {
      // A72: like rule 4's marker scan, the TODO scan skips docs, Markdown and the kit's rules/ and tests/ (they define it).
      if (lower(f).startsWith('docs/intent/') || isKitOrDoc(f, x.kitDirs)) continue
      if (lines.some(l => rx(x.cfg.todo_regex).test(l)) && !mentions(x.progress, f) && !mentions(x.findings, f))
        r2.push({ file: f, what: 'a new TODO/FIXME is not listed in progress.md or findings.md', todo: 'list it under Open or as a finding' })
    }
  }
  scores.push(mk(2, r2, x.slug ? 'every acceptance row met with evidence; proof complete' : 'no intent: acceptance rows not scored', !x.slug))

  // 3 Unity and discipline: the diff stays within the intent's paths, or says why.
  const r3: Issue[] = []
  if (x.slug) {
    for (const f of x.files) if (!inScope(f, own) && !mentions(x.progress, f) && !mentions(x.findings, f)) r3.push({ file: f, what: 'outside the paths the intent names', todo: 'explain it in progress.md or findings.md, or move it to its own PR', group: 'outside the paths the intent names' })
    // A75: shared repository config edited at the action (it ran, recorded) is named in the PR body.
    if (x.body)
      for (const f of x.files) {
        const isConfig = x.cfg.ask_root_files.some(r => lower(r) === lower(f)) || x.cfg.ask_paths.some(g => globMatch(f, g) || globMatch(basename(f), g))
        if (isConfig && !mentions(x.body, f)) r3.push({ file: f, what: 'shared repository config changed', todo: 'name it and why in the PR body' })
      }
  } else {
    for (const f of x.files) {
      const isConfig = x.cfg.ask_root_files.some(r => lower(r) === lower(f)) || x.cfg.ask_paths.some(g => globMatch(f, g) || globMatch(basename(f), g))
      if (isConfig && !mentions(x.body, f)) r3.push({ file: f, what: 'shared repository config changed', todo: 'name it and why in the PR body' })
    }
  }
  scores.push(mk(3, r3, x.slug ? 'within the intent\'s paths' : 'no shared config changed without a word'))

  // 4 Keep it clean: no leftovers, secrets, stray files, worktrees or background work.
  const r4: Issue[] = []
  for (const [f, lines] of x.added) {
    const secret = lines.find(l => x.cfg.secret_regex.some(p => rx(p).test(l)))
    if (secret) r4.push({ file: f, what: 'a secret in the diff', todo: 'remove it and rotate it; keep secrets out of the repo' })
    // A42: Markdown, docs and the a5r kit's own rules/ and tests/ define or quote the markers; only other files can leave one.
    if (isKitOrDoc(f, x.kitDirs)) continue
    const debug = lines.find(l => x.cfg.forbidden_added.some(p => rx(p).test(l)))
    if (debug) r4.push({ file: f, what: `a debug leftover (${debug.trim().slice(0, 40)})`, todo: 'remove it' })
  }
  for (const f of x.untrackedLeft) r4.push({ file: f, what: 'left untracked in the shared checkout', todo: 'commit it with the intent or move it out of the tree' })
  for (const w of x.strayWorktrees) r4.push({ file: w, what: 'a second worktree on this branch', todo: 'remove it once its work is in the branch (git worktree remove)' })
  for (const a of x.runningAgents) r4.push({ what: `background agent still running: ${a}`, todo: 'let it finish or stop it before the PR' })
  scores.push(mk(4, r4, 'no leftovers, secrets, stray files or background work'))

  // 5 Modest, honest, brave: claims match the evidence; acceptance never rewritten without a rev.
  const r5: Issue[] = []
  if (x.proof && x.body) {
    const names = ['Verified', 'Validation', 'Test plan', 'Testing']
    const verified = names.map(n => section(x.body, n, names)).find((s): s is string => s !== null) ?? x.body
    for (const p of proofProblems(x.proof, verified).filter(p => p.startsWith('D5'))) r5.push({ what: `PR body: ${p.slice(3).split(' -> ')[0]}`, todo: p.split(' -> ')[1] ?? 'claim only what was measured' })
  }
  if (x.slug) {
    for (const [id, row] of progressRows(x.progress)) if (row.verdict === 'met' && saysNotDone(row.evidence)) r5.push({ file: `docs/intent/${x.slug}/progress.md`, what: `${id} is met but its evidence says it is not done`, todo: 'mark it open, or put the result line in' })
    const removed = x.promptDiff.split('\n').filter(l => /^-\s*-\s+A\d+\b/.test(l))
    const revised = x.promptDiff.split('\n').some(l => /^\+\s*-\s*Rev:/.test(l))
    if (removed.length && !revised) r5.push({ file: `docs/intent/${x.slug}/prompt.md`, what: `acceptance rewritten without a new rev (${removed.length} row${removed.length === 1 ? '' : 's'})`, todo: 'put the old rows back, or raise a finding so the director revises the intent' })
  }
  // A75: test assertions removed at the action (it ran, recorded) are listed with a reason in progress.md or findings.md.
  for (const r of x.recorded ?? [])
    if (r.kind === 'tests' && x.files.some(f => lower(f) === lower(r.path)) && !mentions(x.progress, r.path) && !mentions(x.findings, r.path))
      r5.push({ file: r.path, what: `test assertions were removed (recorded, ${r.lane})`, todo: 'say why in progress.md or findings.md, or put them back' })
  scores.push(mk(5, r5, 'claims match the evidence'))
  return scores
}

/** An unread branch diff is no pass: the card line and the gate text. */
export const unreadLine = (why: string): string => `could not read the whole branch diff (${why})`
export const unreadText = (why: string): string =>
  `A5R · Acceptance — ${unreadLine(why)} → open the PR from a slice branch cut from origin/main and call again (nothing waits on an answer; Hai lets one through with /a5r pass)`

export const failed = (scores: readonly RuleScore[]): RuleScore[] => scores.filter(s => s.state === 'fail')

/** A53: one line of a rule's list on the card or in the refusal, with what to do about it. */
export type ItemLine = { text: string; todo: string }
/** A53: the most lines a rule shows before its issues are grouped by folder. */
export const MAX_ITEMS = 3

/** A53: a rule's issues as at most `max` lines: each issue on its own line when they fit; else grouped by folder (as
 * deep as keeps the groups within `max`) with a count (`tools/TALab/scenarios/ · 38 files: named by intent x`), and
 * "and N more" past the last group shown. Each line carries the first issue's `todo` of its group. */
export const cappedItems = (issues: readonly Issue[], max = MAX_ITEMS): ItemLine[] => {
  const one = (i: Issue): ItemLine => ({ text: `${i.file ? `${i.file}: ` : ''}${i.what}`, todo: i.todo })
  if (issues.length <= max) return issues.map(one)
  const segs = (f: string) => f.replace(/\\/g, '/').split('/').slice(0, -1)
  const deepest = Math.max(1, ...issues.map(i => (i.file ? segs(i.file).length : 1)))
  type Group = { key: string; folder: string; phrase: string; issues: Issue[] }
  const groupAt = (depth: number): Group[] => {
    const out = new Map<string, Group>()
    for (const i of issues) {
      const dir = i.file ? segs(i.file).slice(0, depth).join('/') : ''
      const folder = i.file ? (dir ? `${dir}/` : '(repository root)') : ''
      const phrase = i.group ?? i.what
      const key = `${folder} | ${phrase}`
      const g = out.get(key) ?? { key, folder, phrase, issues: [] }
      g.issues.push(i)
      out.set(key, g)
    }
    return [...out.values()].sort((a, b) => b.issues.length - a.issues.length || a.key.localeCompare(b.key))
  }
  // The deepest folders that fit in `max` lines; when none fit, the depth whose first `max` groups cover most issues
  // (the deeper on a tie), the rest counted in "and N more".
  let groups: Group[] | null = null
  let best: { g: Group[]; covered: number } | null = null
  for (let d = deepest; d >= 1 && !groups; d -= 1) {
    const g = groupAt(d)
    if (g.length <= max) groups = g
    const covered = g.slice(0, max).reduce((n, x) => n + x.issues.length, 0)
    if (!best || covered > best.covered) best = { g, covered }
  }
  groups ??= best?.g ?? []
  const line = (g: Group): ItemLine => {
    const first = g.issues[0] as Issue
    if (g.issues.length === 1) return one(first)
    if (!g.folder) return { text: `${g.phrase} (${g.issues.length} times)`, todo: first.todo }
    return { text: `${g.folder} · ${g.issues.length} files: ${g.phrase}`, todo: first.todo }
  }
  const shown = groups.slice(0, max).map(line)
  const rest = groups.slice(max).reduce((n, g) => n + g.issues.length, 0)
  return rest > 0 ? [...shown, { text: `and ${rest} more (/a5r accept lists them all)`, todo: '' }] : shown
}

/** The refusal (or the ask) that lists what to fix: rule, file, what to do; A53: each rule capped as on the card. */
export const acceptText = (scores: readonly RuleScore[], what: string): string => {
  const bad = failed(scores)
  return `A5R · Acceptance — ${bad.length} of 5 rules not met before ${what} → fix these and call again (nothing waits on an answer; Hai lets one through with /a5r pass):\n${bad
    .flatMap(s => cappedItems(s.issues).map(i => `- ${s.rule} ${ruleName(s.rule)}: ${i.text}${i.todo ? ` → ${i.todo}` : ''}`))
    .join('\n')}`
}

/** A52: the worst state of each rule over several scores (one per PR): a fail anywhere is a fail, else a pass anywhere. */
export const worstOf = (lists: readonly (readonly RuleScore[])[]): RuleScore[] =>
  RULES5.map(([rule]) => {
    const all = lists.map(l => l.find(s => s.rule === rule)).filter((s): s is RuleScore => Boolean(s))
    const fail = all.filter(s => s.state === 'fail')
    const pick = fail[0] ?? all.find(s => s.state === 'pass') ?? all[0]
    return pick ? { ...pick, issues: fail.length ? fail.flatMap(s => s.issues) : pick.issues } : { rule, state: 'na' as const, line: '', issues: [] }
  })

/** A45 (rev 14): a command opens a PR when any command it runs is `gh pr create` or a POSTing `gh api …/pulls`, however
 * it is written (prcmd.ts: quote-aware commands, env prefixes and wrappers, PowerShell `if (…) { … }` and `&`, nested
 * shells, a here-document fed to a shell). Text inside quotes or in a data here-document is not a command. */
export const isPrCommand = (raw: string): boolean => prCalls(raw).length > 0

/** A22: a tool whose name creates a pull request, in any MCP server (`mcp__github__create_pull_request`,
 * `mcp__plugin_engineering_github__create_pull_request`, `…pull_request_create…`, `createPullRequest`); a review
 * or a comment on a PR is not one. */
export const isPrTool = (tool: string): boolean =>
  /create_?pull_?requests?(?!_?(review|comment))|pull_?requests?_?create|pulls_create/i.test(tool)

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
    ? `A5R · Acceptance at Ship (intent ${slug}, branch ${branch || '?'}): not scored, ${unreadLine(diffProblem)} → land it from a slice branch cut from origin/main; the PR call is scored again.`
    : bad.length
      ? `A5R · Acceptance at Ship (intent ${slug}, branch ${branch || '?'}): ${bad.length} of 5 rules not met → fix these before you open the PR (the PR call is scored again and refused while any is open):`
      : `A5R · Acceptance at Ship (intent ${slug}, branch ${branch || '?'}): 5 of 5 met; the PR call is scored again.`
  const rows = diffProblem ? [] : scores.map(s => `${mark(s)} ${s.rule} ${ruleName(s.rule)}: ${s.line}`)
  const todo = diffProblem ? [] : bad.flatMap(s => s.issues.map(i => `- ${s.rule}: ${i.file ? `${i.file}: ` : ''}${i.what} → ${i.todo}`))
  return [head, ...rows, ...(todo.length ? ['To fix:', ...todo] : [])].join('\n')
}

/** A23: the PR numbers on an intent's `- PR:` / `- PRs:` lines (in the header, before the first `## `), read as
 * Ather reads them: `#123`, `owner/repo#123`, `…/pull/123`; progress.md first, then a legacy prompt.md line. */
/** A52: each PR on an intent's `- PR:` lines with the repository its link names (`owner/repo#123`,
 * `https://github.com/owner/repo/pull/123`), or null for a bare `#123` (the checkout's own repository). */
export type PrLink = { n: number; repo: string | null }
export const prLinksOf = (progress: string, prompt: string): PrLink[] => {
  const header = (text: string) => text.split(/^##\s/m)[0] ?? ''
  const out = new Map<number, PrLink>()
  for (const text of [progress, prompt])
    for (const line of header(text).matchAll(/^\s*-\s*PRs?\s*:\s*(.+)$/gim))
      for (const m of (line[1] ?? '').matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|\b([\w.-]+\/[\w.-]+)#(\d+)|#(\d+)|pull\/(\d+)/g)) {
        const n = Number(m[2] ?? m[4] ?? m[5] ?? m[6])
        const repo = m[1] ?? m[3] ?? null
        if (Number.isInteger(n) && n > 0 && (!out.has(n) || (repo && !out.get(n)?.repo))) out.set(n, { n, repo })
      }
  return [...out.values()]
}

export const prNumbersOf = (progress: string, prompt: string): number[] => {
  const header = (text: string) => text.split(/^##\s/m)[0] ?? ''
  const numbers = [progress, prompt].flatMap(text =>
    [...header(text).matchAll(/^\s*-\s*PRs?\s*:\s*(.+)$/gim)].flatMap(line => [...(line[1] ?? '').matchAll(/#(\d+)|pull\/(\d+)/g)].map(m => Number(m[1] ?? m[2]))),
  )
  return [...new Set(numbers)].filter(n => Number.isInteger(n) && n > 0)
}

/** A41 / A46: what the PR call names (its repository, head, base, the folder a `cd` before it moved to, and a reason it
 * cannot be read), from the first PR call's own words (prcmd.ts `prRefs`). */
export type PrCommandRefs = PrRefsRead
export const prCommandRefs = (command: string): PrCommandRefs => {
  const call = prCalls(command)[0]
  return call ? prRefs(call) : {}
}

/** A41 / A46: the command lines a shell command runs, here-document bodies removed (exact terminators; a `<<` after a
 * `#` comment opens none). A body a shell reads as commands is checked by `isPrCommand` itself. */
export const commandText = (command: string): string => heredocs(command).text

/** A23: the PR numbers a PR-opening call reports (`gh pr create` prints the URL; an MCP tool returns its number). */
export const openedPrs = (result: string): number[] =>
  [...new Set([...result.matchAll(/\/pull\/(\d+)|\\?"number\\?"\s*:\s*(\d+)/g)].map(m => Number(m[1] ?? m[2])))].filter(n => Number.isInteger(n) && n > 0)
