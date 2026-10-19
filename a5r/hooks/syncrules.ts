// A99 (rev 33): the sync holder's conflict rules for the sync worker. The holder gives them with the sync tool (with plan, or
// action rules until the worker starts); they are kept in Saved/A5R/sync.json, listed in the worker's task with each
// dry-run conflict they match, and the worker's rule 5 resolves a conflicted path a rule matches with that rule's side,
// whatever its kind. Pure: no `$`.
import { pathGlobMatch } from './a5r.ts'
import type { Conflict } from './coord.ts'

/** A conflicted path that matches `pattern` is resolved with `side` (`git checkout --<side> -- <path>`). */
export type SyncRule = { side: 'ours' | 'theirs'; pattern: string }
export const RULE_FORM = 'one rule per line: ours <path or glob> or theirs <path or glob>, relative to the checkout (* within a folder, ** any depth, a trailing / a whole folder; case-insensitive; the first match wins)'

/** Review of rev 33 (F4): a pattern is joined into the task of the worker, which A5R does not guard, so it is a plain path
 * or glob only: these characters, at most this long. */
const PATTERN_CHARS = /^[\w\-./*+@ ()]+$/
export const PATTERN_MAX = 200

/** A pattern as a rule keeps it (backslashes as `/`, no leading `./` or `/`), or why it cannot be one and what to give. */
export const rulePattern = (raw: string): { pattern: string } | { why: string; alt: string } => {
  const p = raw.trim().replace(/^(["'`])(.*)\1$/, '$2').replace(/\\/g, '/')
  if (/^[a-z]:\//i.test(p) || p.startsWith('//')) return { why: 'is an absolute path', alt: 'a path relative to the checkout' }
  const pattern = p.replace(/^\.?\/+/, '')
  if (!pattern) return { why: 'names no path', alt: RULE_FORM }
  if (pattern.length > PATTERN_MAX) return { why: `is longer than ${PATTERN_MAX} characters`, alt: 'a shorter folder or glob' }
  if (!PATTERN_CHARS.test(pattern)) return { why: 'has characters a path or glob here does not use (letters, digits, _ - . / * + @ space and parentheses only)', alt: 'a plain path or glob' }
  return { pattern }
}

/** The holder's rules from lines `ours <pattern>` / `theirs <pattern>` (a string array, or newline text); `bad`: the first
 * line that is not a rule, why, and what to give instead. */
export const parseRules = (input: string | readonly string[]): { rules: SyncRule[] } | { bad: string; why: string; alt: string } => {
  const lines = (typeof input === 'string' ? [input] : input).flatMap(l => String(l).split(/\r?\n/)).map(l => l.trim()).filter(Boolean)
  const rules: SyncRule[] = []
  for (const line of lines) {
    const m = /^(ours|theirs)\s+(.+)$/i.exec(line)
    if (!m) return { bad: line, why: 'is not ours <path or glob> or theirs <path or glob>', alt: RULE_FORM }
    const p = rulePattern(m[2] ?? '')
    if ('why' in p) return { bad: line, ...p }
    rules.push({ side: m[1]?.toLowerCase() === 'ours' ? 'ours' : 'theirs', pattern: p.pattern })
  }
  return { rules }
}

/** The rules as sync.json holds them (anything else in the list, a pattern rulePattern refuses included, is dropped). */
export const storedRules = (value: unknown): SyncRule[] =>
  (Array.isArray(value) ? (value as Partial<SyncRule>[]) : []).flatMap(r => {
    const p = typeof r?.pattern === 'string' ? rulePattern(r.pattern) : null
    return (r?.side === 'ours' || r?.side === 'theirs') && p && 'pattern' in p ? [{ side: r.side, pattern: p.pattern }] : []
  })

/** The first rule whose pattern matches the repo-relative path, or null. */
export const ruleFor = (path: string, rules: readonly SyncRule[]): SyncRule | null => rules.find(r => pathGlobMatch(path, r.pattern)) ?? null
/** The rules as the worker's task, status and the panel list them, each pattern in backticks. */
export const rulesLabel = (rules: readonly SyncRule[]): string => (rules.length ? rules.map(r => `${r.side} \`${r.pattern}\``).join('; ') : 'none')
/** `rule: <side> <pattern>` for the rule that resolves the path, or null. */
export const ruleNote = (path: string, rules: readonly SyncRule[]): string | null => {
  const rule = ruleFor(path, rules)
  return rule ? `rule: ${rulesLabel([rule])}` : null
}

/** A conflict as the worker's task, status and the conflicts action list it: its kind, the commit main holds, and the
 * holder's rule that resolves it. */
export const conflictLabel = (c: Conflict, rules: readonly SyncRule[]): string => {
  const rule = ruleNote(c.path, rules)
  return `${c.path} (${c.kind}${c.match ? `, main holds our ${c.match}` : ''}${rule ? `; ${rule}` : ''})`
}
