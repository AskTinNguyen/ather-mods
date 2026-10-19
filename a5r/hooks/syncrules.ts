// A99 (rev 33): the sync holder's conflict rules for the sync worker. The holder gives them with the sync tool (with plan, or
// action rules until the worker starts); they are kept in Saved/A5R/sync.json, listed in the worker's task with each
// dry-run conflict they match, and the worker's rule 5 resolves a conflicted path a rule matches with that rule's side,
// whatever its kind. Pure: no `$`.
import { pathGlobMatch } from './a5r.ts'
import type { Conflict } from './coord.ts'

/** A conflicted path that matches `pattern` is resolved with `side` (`git checkout --<side> -- <path>`). */
export type SyncRule = { side: 'ours' | 'theirs'; pattern: string }
export const RULE_FORM = 'one rule per line: ours <path or glob> or theirs <path or glob> (* within a folder, ** any depth, a trailing / a whole folder; case-insensitive; the first match wins)'

/** The holder's rules from lines `ours <pattern>` / `theirs <pattern>` (a string array, or newline text); `bad`: the first
 * line that is neither. */
export const parseRules = (input: string | readonly string[]): { rules: SyncRule[] } | { bad: string } => {
  const lines = (typeof input === 'string' ? [input] : input).flatMap(l => String(l).split(/\r?\n/)).map(l => l.trim()).filter(Boolean)
  const rules: SyncRule[] = []
  for (const line of lines) {
    const m = /^(ours|theirs)\s+(.+)$/i.exec(line)
    const pattern = (m?.[2] ?? '').trim().replace(/^(["'`])(.*)\1$/, '$2').replace(/\\/g, '/').replace(/^\.\//, '')
    if (!m || !pattern) return { bad: line }
    rules.push({ side: m[1]?.toLowerCase() === 'ours' ? 'ours' : 'theirs', pattern })
  }
  return { rules }
}

/** The rules as sync.json holds them (anything else in the list is dropped; none: []). */
export const storedRules = (value: unknown): SyncRule[] =>
  (Array.isArray(value) ? (value as Partial<SyncRule>[]) : []).flatMap(r => ((r?.side === 'ours' || r?.side === 'theirs') && typeof r.pattern === 'string' && r.pattern !== '' ? [{ side: r.side, pattern: r.pattern }] : []))

/** The first rule whose pattern matches the repo-relative path, or null. */
export const ruleFor = (path: string, rules: readonly SyncRule[]): SyncRule | null => rules.find(r => pathGlobMatch(path, r.pattern)) ?? null
export const rulesLabel = (rules: readonly SyncRule[]): string => (rules.length ? rules.map(r => `${r.side} ${r.pattern}`).join('; ') : 'none')
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
