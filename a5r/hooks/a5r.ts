// A5R for Claude Code: the five agent rules, ported from the Hermes plugin's a5_core.py and read
// from the same config.json schema. Pure: no `$`; register.ts does the reading and writing.
// Paths are compared with forward slashes and without case (Windows).

/** `where: 'shared'`: the rule guards the shared checkout only; a worker's own worktree is its own business. */
export type Rule = { id: string; re: string; why: string; where?: 'shared' }
/** What Ather has read as proof for the tracked intent (its `status` tool), or null with no intent tracked. */
export type Proof = { intent: string; role: string; evidence: Record<string, { state: string; detail?: string }> }
export type A5RConfig = {
  deny_abs_paths: string[]
  ask_abs_paths: string[]
  ask_root_files: string[]
  ask_paths: string[]
  project_roots: string[]
  shell_deny: Rule[]
  shell_ask: Rule[]
  delete_safe_roots: string[]
  secret_regex: string[]
  test_paths: string[]
  assert_regex: string
  verify_regex: string
  forbidden_added: string[]
  todo_regex: string
  report_sections: string[]
  gate_ignore: string[]
  no_verify_needed: string[]
  max_gate_blocks: number
  /** Hermes-only keys, kept so one config.json serves both engines. */
  ask_action?: string
  claude_ask_action?: string
}
export type Decision = { kind: 'deny' | 'ask'; rule: string; why: string; key: string }
/** Placeholders config paths may use: KIT, HOME, TEMP, LOCALAPPDATA, HERMES_HOME, PROJECT. */
export type Places = Record<string, string | undefined>
/** Where a file lives: its git project root and its path inside it, or nulls outside any project. */
export type Located = { root: string | null; rel: string | null }
// A segment whose verb only reads may mention protected paths and never counts as a verify run.
const READERS = new Set(['cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'findstr', 'select-string', 'sls', 'ls', 'dir',
  'get-childitem', 'gci', 'get-content', 'gc', 'wc', 'stat', 'file', 'test-path', 'get-item', 'gi', 'resolve-path', 'echo', 'write-output', 'write-host'])
const DELETE_VERBS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri'])
const NESTED_SHELLS = new Set(['bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'])
const WRAPPERS = new Set(['&', 'sudo', 'command', 'builtin', 'exec', 'time', 'nohup', 'xargs', 'call'])
const PS_VALUE_PARAMS = new Set(['-erroraction', '-ea', '-exclude', '-include', '-filter', '-warningaction', '-wa'])


/** A config pattern as a JS RegExp; a leading Python `(?i)` becomes the `i` flag. */
const compiled = new Map<string, RegExp>()
export const rx = (pattern: string): RegExp => {
  let hit = compiled.get(pattern)
  if (!hit) {
    hit = pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern)
    compiled.set(pattern, hit)
  }
  return hit
}

// ---------- shell parsing ----------
export const stripHeredocs = (cmd: string): string =>
  cmd.replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, '').replace(/@'[\s\S]*?'@|@"[\s\S]*?"@/g, "''")

/** Split on && || ; | and newlines, outside quotes. */
export const segments = (cmd: string): string[] => {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i] ?? ''
    if (quote) {
      cur += c
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      cur += c
    } else if (cmd.startsWith('&&', i) || cmd.startsWith('||', i)) {
      out.push(cur)
      cur = ''
      i += 1
    } else if (c === ';' || c === '|' || c === '\n') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim()).filter(Boolean)
}

/** Drop quoted text holding spaces (commit messages); keep quoted single words and paths. */
export const blankQuotes = (seg: string): string => seg.replace(/"[^"]*"|'[^']*'/g, m => (/\s/.test(m.slice(1, -1)) ? '""' : m))

export const tokenize = (seg: string): string[] =>
  (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(t => (t.length > 1 && t[0] === t[t.length - 1] && (t[0] === '"' || t[0] === "'") ? t.slice(1, -1) : t))

/** [verb, args]: env assignments and wrappers skipped; verb lowercased, path and .exe dropped. */
export const commandVerb = (tokens: string[]): [string, string[]] => {
  let i = 0
  while (i < tokens.length && (/^\w+=/.test(tokens[i] ?? '') || WRAPPERS.has((tokens[i] ?? '').toLowerCase()))) i += 1
  if (i >= tokens.length) return ['', []]
  const verb = (tokens[i] ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return [verb.endsWith('.exe') ? verb.slice(0, -4) : verb, tokens.slice(i + 1)]
}

/** The command handed to `bash -c`, `powershell -Command`, `cmd /c`. */
export const nestedCommand = (verb: string, args: string[]): string => {
  for (let n = 0; n < args.length; n += 1) {
    const low = (args[n] ?? '').toLowerCase()
    if ((verb === 'cmd' && (low === '/c' || low === '/k')) || ((verb === 'powershell' || verb === 'pwsh') && (low === '-command' || low === '-c'))
      || ((verb === 'bash' || verb === 'sh' || verb === 'zsh') && /^-\w*c$/.test(low))) return args.slice(n + 1).join(' ')
  }
  return ''
}

/** The directory a git segment runs in: its `-C <path>` (the last one), else the working directory. */
export const gitTarget = (seg: string, workdir: string): string => {
  const all = [...seg.matchAll(/\bgit\b|\s-C\s+("[^"]*"|'[^']*'|\S+)/g)].map(m => m[1]).filter((x): x is string => Boolean(x))
  const last = all[all.length - 1]
  return last ? last.replace(/^["']|["']$/g, '') : workdir
}

/** Every `-C <path>` a command names, for register.ts to locate before the pure check runs. */
export const gitTargets = (command: string): string[] =>
  [...(command ?? '').matchAll(/\s-C\s+("[^"]*"|'[^']*'|\S+)/g)].map(m => (m[1] ?? '').replace(/^["']|["']$/g, '')).filter(Boolean)

export const isRecursiveDelete = (args: string[]): boolean =>
  args.some(a => {
    const low = a.toLowerCase()
    return low === '-recurse' || low === '/s' || low.startsWith('-recurse:') || (/^-[a-z]{1,4}$/.test(low) && low.includes('r'))
  })

export const deleteTargets = (args: string[]): string[] => {
  const out: string[] = []
  let skip = false
  for (const a of args) {
    if (skip) {
      skip = false
      continue
    }
    if (PS_VALUE_PARAMS.has(a.toLowerCase())) {
      skip = true
      continue
    }
    if (a.startsWith('-') || /^\/[a-zA-Z]$/.test(a)) continue
    out.push(a)
  }
  return out
}

// ---------- paths ----------
/** Absolute path with forward slashes, `.` and `..` resolved; Git Bash /c/x becomes C:/x. A relative
 * path without a base stays relative. */
export const norm = (path: string, base = ''): string => {
  if (!path) return ''
  let p = path.replace(/\\/g, '/')
  const msys = /^\/([a-zA-Z])(\/|$)/.exec(p)
  if (msys) p = `${(msys[1] ?? '').toUpperCase()}:/${p.slice(3)}`
  if (!isAbs(p) && base) p = `${norm(base).replace(/\/$/, '')}/${p}`
  const out: string[] = []
  p.split('/').forEach((seg, n) => {
    if (seg === '..') {
      if (out.length > 1) out.pop()
    } else if (seg !== '.' && (seg !== '' || n === 0)) out.push(seg)
  })
  return out.join('/') || p
}

export const isAbs = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')
const key = (p: string): string => norm(p).toLowerCase()
export const under = (path: string, root: string): boolean => {
  const a = key(path)
  const b = key(root).replace(/\/$/, '')
  return a === b || a.startsWith(`${b}/`)
}
export const basename = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? ''

/** Literal directory part of a glob: 'C:/kit/*' -> 'C:/kit'. */
export const globPrefix = (pattern: string): string => {
  const cut = pattern.search(/[*?[]/)
  return (cut < 0 ? pattern : pattern.slice(0, cut)).replace(/\/+$/, '')
}

/** fnmatch: `*` crosses `/`, `?` is one character, no case. */
const globs = new Map<string, RegExp>()
export const globMatch = (text: string, glob: string): boolean => {
  let hit = globs.get(glob)
  if (!hit) {
    hit = new RegExp(`^${glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
    globs.set(glob, hit)
  }
  return hit.test(text.replace(/\\/g, '/'))
}

/** Globs with '/' match the project-relative path (or the path as typed); others the file name. */
export const matchRel = (rel: string | null, raw: string | null, list: readonly string[]): string | null => {
  const names = [rel, raw].filter((x): x is string => Boolean(x))
  for (const g of list) for (const n of names) if (globMatch(n, g) || (!g.includes('/') && globMatch(basename(n), g))) return g
  return null
}

export const matchAbs = (path: string, list: readonly string[]): string | null =>
  list.find(g => under(path, globPrefix(g)) && (globMatch(path, g) || g === globPrefix(g))) ?? null

const lines = (text: string): string[] => (text ?? '').split(/\r?\n/)
/** Lines in `neu` that `old` does not contain (whitespace-insensitive). */
export const newLines = (old: string, neu: string): string[] => {
  const seen = new Set(lines(old).map(x => x.trim()))
  return lines(neu).filter(x => x.trim() && !seen.has(x.trim()))
}

export const section = (msg: string, name: string, names: readonly string[]): string | null => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const other = names.filter(n => n !== name).map(esc).join('|')
  const m = new RegExp(`^[\\W_]*${esc(name)}[\\W_]*:([\\s\\S]*?)(?=^[\\W_]*(?:${other})[\\W_]*:|(?![\\s\\S]))`, 'im').exec(msg)
  return m ? (m[1] ?? '') : null
}

// The honest "not yet" words a Verified line may use (UNVERIFIED kept for old reports).
const NOT_YET = /chưa|not proven|still needed|unverified|fail/i

// Ather's proof rungs (Unreal pack), the words a report uses for them, and what each role needs.
const RUNGS: readonly [string, RegExp, string][] = [
  ['build', /\bbuild\b/, 'build'],
  ['automation', /\btests?\b/, 'tests'],
  ['readback', /read-?back/, 'read-back'],
  ['pie', /\bPIE\b/, 'PIE'],
  ['editor', /editor check/, 'Editor check'],
]
const REQUIRED: Record<string, string[]> = { techart: ['editor', 'pie'], engineer: ['build', 'automation'], designer: ['pie'] }
const wordOf = (rung: string): string => RUNGS.find(r => r[0] === rung)?.[2] ?? rung

/** What Ather's proof still lacks for the role (its isProven), or null once it is complete. */
export const proofGap = (proof: Proof): string | null => {
  const state = (k: string) => proof.evidence[k]?.state ?? 'none'
  const required = REQUIRED[proof.role] ?? []
  const missing = required.filter(k => state(k) !== 'pass')
  const proven = required.length ? missing.length === 0 : state('pie') === 'pass' || (state('build') === 'pass' && state('automation') === 'pass')
  return proven ? null : required.length ? missing.map(wordOf).join(' and ') : 'PIE, or build and tests'
}

/** A Verified line held to Ather's proof: claim only what Ather read pass, say FAILED for a failed rung,
 * and say "chưa: …" while the role's proof is incomplete (not a block in itself: Ather's Next asks to prove). */
export const proofProblems = (proof: Proof, verified: string): string[] => {
  const probs: string[] = []
  const state = (k: string) => proof.evidence[k]?.state ?? 'none'
  for (const [k, re, word] of RUNGS) {
    const claimed = new RegExp(`${re.source}[^,;·\\n]{0,14}(✓|✔|\\bpass(ed)?\\b|\\bok\\b|succeeded)`, 'i').test(verified)
    if (claimed && state(k) !== 'pass') probs.push(`D5 'Verified' claims ${word}, but Ather has read no passing ${word} for ${proof.intent} -> claim only what Ather read from tool output`)
  }
  const failed = RUNGS.filter(([k]) => state(k) === 'fail').map(r => r[2])
  if (failed.length && !/fail|✗/i.test(verified)) probs.push(`D5 Ather's proof has a failed ${failed.join(', ')} -> 'Verified' must say FAILED`)
  // Ather's isProven (packs/unreal.mjs): a role's rungs all pass; with no role, PIE, or build and tests.
  const required = REQUIRED[proof.role] ?? []
  const missing = required.filter(k => state(k) !== 'pass')
  const proven = required.length ? missing.length === 0 : state('pie') === 'pass' || (state('build') === 'pass' && state('automation') === 'pass')
  if (!proven && !NOT_YET.test(verified))
    probs.push(`D2 ${proof.intent} is not proven yet (Ather still needs ${required.length ? missing.map(wordOf).join(' and ') : 'PIE, or build and tests'}) -> 'Verified' says "chưa: <what is still needed>"`)
  return probs
}

const decision = (kind: Decision['kind'], rule: string, why: string, k: string): Decision => ({ kind, rule, why, key: k })

export class A5R {
  readonly cfg: A5RConfig
  readonly denyAbs: string[]
  readonly askAbs: string[]
  readonly safeRoots: string[]
  readonly roots: string[]
  private readonly kitMentions: [RegExp, string][] = []

  constructor(cfg: A5RConfig, places: Places) {
    this.cfg = cfg
    const expand = (list: readonly string[]) =>
      list.flatMap(p => {
        let missing = false
        const out = p.replace(/\{(\w+)\}/g, (_, name: string) => {
          const v = places[name]
          if (!v) missing = true
          return (v ?? '').replace(/\\/g, '/').replace(/\/$/, '')
        })
        return missing ? [] : [norm(out)]
      })
    this.denyAbs = expand(cfg.deny_abs_paths)
    this.askAbs = expand(cfg.ask_abs_paths)
    this.safeRoots = expand(cfg.delete_safe_roots)
    this.roots = expand(cfg.project_roots)
    // What a command must mention to touch a protected path: the full path, or its last two parts.
    for (const p of this.denyAbs) {
      const lit = globPrefix(p).toLowerCase()
      this.kitMentions.push([new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), lit])
      const tail = lit.split('/').slice(-2).join('/')
      if (tail.split('/').length === 2) this.kitMentions.push([new RegExp(`(?<![\\w.-])${tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`), tail])
    }
  }

  // ---------- before a tool runs ----------
  /** `isShared(dir)`: whether a directory is (in) the shared checkout; a rule marked `where: 'shared'` skips
   * a git command that runs elsewhere (`git -C <own worktree> …`). Unknown means shared. */
  preShell(command: string, workdir = '', env: Places = {}, depth = 0, isShared: (dir: string) => boolean = () => true): Decision | null {
    let firstAsk: Decision | null = null
    for (const raw of segments(stripHeredocs(command ?? ''))) {
      const bare = blankQuotes(raw)
      const applies = (r: Rule) => rx(r.re).test(bare) && (r.where !== 'shared' || isShared(gitTarget(raw, workdir)))
      for (const r of this.cfg.shell_deny) if (applies(r)) return decision('deny', 'D1/D5', r.why, r.id)
      const [verb, args] = commandVerb(tokenize(raw))
      const hit = this.writesProtected(raw, verb)
      if (hit) return decision('deny', 'D1', `This command touches the A5R kit (${hit}). Agents may not change the enforcement kit.`, 'kit')
      if (NESTED_SHELLS.has(verb) && depth < 2) {
        const inner = this.preShell(nestedCommand(verb, args), workdir, env, depth + 1, isShared)
        if (inner?.kind === 'deny') return inner
        firstAsk ??= inner
      }
      if (DELETE_VERBS.has(verb) && isRecursiveDelete(args) && !this.allSafe(deleteTargets(args), workdir, env))
        firstAsk ??= decision('ask', 'D1', 'Recursive delete outside the temp folders.', 'delete')
      if (!firstAsk) {
        const r = this.cfg.shell_ask.find(applies)
        if (r) firstAsk = decision('ask', 'D1', r.why, r.id)
      }
    }
    return firstAsk
  }

  private writesProtected(raw: string, verb: string): string | null {
    const low = raw.replace(/\\/g, '/').toLowerCase()
    const hit = this.kitMentions.find(([re]) => re.test(low))
    if (!hit) return null
    const redirected = />>?\s*['"]?([^\s'"]+)/.exec(low)
    // A reader, or a bare assignment (`D="<kit>"`), writes nothing unless it redirects into the kit.
    if ((READERS.has(verb) || verb === '') && !(redirected && this.kitMentions.some(([re]) => re.test(redirected[1] ?? '')))) return null
    return hit[1]
  }

  /** True when every delete target resolves inside a temp folder (delete_safe_roots). */
  private allSafe(targets: string[], workdir: string, env: Places): boolean {
    if (!targets.length || !this.safeRoots.length) return false
    return targets.every(t0 => {
      let t = t0.replace(/\$\{?env:(\w+)\}?/gi, (_, n: string) => env[n.toUpperCase()] ?? `$${n}`)
      t = t.replace(/\$\{(\w+)\}|\$(\w+)|%(\w+)%/g, (m, a?: string, b?: string, c?: string) => env[(a ?? b ?? c ?? '').toUpperCase()] ?? m)
      if (t.startsWith('~')) t = (env.USERPROFILE ?? '$HOME') + t.slice(1)
      if (/[$%]/.test(t)) return false // a variable left unexpanded (a ~ inside is an 8.3 short name, fine)
      let p: string
      if (/^\/[a-zA-Z]\//.test(t) || /^[a-zA-Z]:[\\/]/.test(t)) p = norm(t)
      else if (workdir && !/^[\\/]/.test(t)) p = norm(t, workdir)
      else return false
      return this.safeRoots.some(r => under(p, r))
    })
  }

  /** Checks for a file write. `loc` is where register.ts found the file; `scope` the task scope file's globs;
   * `isShared`: the file is in the shared checkout (repository config asks only there, not in a worktree). */
  preEdit(path: string, old: string, neu: string, loc: Located, scope: readonly string[] = [], isShared = true): Decision | null {
    const raw = (path ?? '').replace(/\\/g, '/')
    const p = norm(raw)
    const relRaw = isAbs(raw) ? null : raw
    const { rel } = loc
    const g0 = matchAbs(p, this.denyAbs)
    if (g0) return decision('deny', 'D1', `${p} is part of the A5R kit (${g0}). Agents may not edit the enforcement kit.`, 'kit')
    const s = this.secret(neu)
    if (s) return decision('deny', 'D4', `Content looks like a secret (pattern ${s}). Keep secrets in env/config outside the repo.`, 'secret')
    if (scope.length && !(matchRel(rel, relRaw, scope.filter(g => !isAbs(g))) || matchAbs(p, scope.filter(isAbs).map(g => norm(g)))))
      return decision('ask', 'D3', `${rel ?? p} is outside the task scope (${scope.join(', ')}).`, 'scope')
    const rootFile = isShared ? this.cfg.ask_root_files.find(f => f === rel || f === relRaw) : undefined
    if (rootFile) return decision('ask', 'D1', `${rootFile} is shared repository config.`, `shared:${rootFile}`)
    const g1 = isShared ? matchRel(rel, relRaw, this.cfg.ask_paths) : null
    if (g1) return decision('ask', 'D1', `${rel ?? relRaw} is shared config (${g1}).`, `shared:${g1}`)
    const g2 = matchAbs(p, this.askAbs)
    if (g2) return decision('ask', 'D1', `${p} is shared agent config.`, `shared:${basename(g2)}`)
    if (matchRel(rel, relRaw, this.cfg.test_paths)) {
      const count = (t: string) => (t.match(new RegExp(rx(this.cfg.assert_regex).source, `g${rx(this.cfg.assert_regex).flags}`)) ?? []).length
      const [a, b] = [count(old ?? ''), count(neu ?? '')]
      if (b < a) return decision('ask', 'D5', `Edit reduces assertions in test ${rel ?? p} (${a} -> ${b}). Weakening tests needs human approval.`, 'tests')
    }
    return null
  }

  secret(text: string): string | null {
    return this.cfg.secret_regex.find(p => rx(p).test(text ?? '')) ?? null
  }
}
