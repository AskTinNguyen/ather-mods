// A73 / A75 (rev 27; moved out of register.ts in rev 43): what a rule-1 match does at the action, and what a recorded
// action is about. Pure: no `$`.
import { commandVerb, deleteTargets, tokenize, type Decision } from './a5r.ts'

/** A73: what a rule-1 match does at the action. Nothing asks and nothing waits: a call is refused only with an alternative
 * the agent can carry out itself (`refuse`), runs after a check of the facts (`check`, A74: git that can discard work in
 * the shared checkout), or runs and is recorded for nghiem thu (`record`, A75: shared config, recursive deletes, removed
 * test assertions, edits outside a scope file, global git config). The permission mode and an away window change nothing. */
export type Act = { act: 'refuse' | 'check' | 'record'; alt?: string }
const ACTIONS: Record<string, Act> = {
  'no-verify': { act: 'refuse', alt: 'fix what the hook reports, then commit without --no-verify' },
  'lfs-skip-smudge': { act: 'refuse', alt: 'let LFS fetch the objects (git lfs pull), or work in a worktree of your own' },
  'sparse-checkout': { act: 'refuse', alt: 'make a worktree of your own and set its sparse layout there' },
  kit: { act: 'refuse', alt: 'change the mod in a worktree of its repository (git -C <repository> worktree add <folder of your own> <branch>), never in the live plugin folder' },
  secret: { act: 'refuse', alt: 'keep the secret in an environment variable or a config file outside the repository' },
  'force-push': { act: 'refuse', alt: 'use git push --force-with-lease to a branch of your own (it runs), or push to a new branch and open a PR; never rewrite shared history' },
  'push-main': { act: 'refuse', alt: 'push your branch and open a PR' },
  'add-all': { act: 'refuse', alt: 'stage exact paths: git add -- <path> ...' },
  // git-discard and git-switch are read by gitSharedProblem (segment by segment, on facts).
  'git-switch': { act: 'check' },
  'git-discard': { act: 'check' },
}
/** A75 (review 6): global git keys whose change breaks every repository on the machine; p4 obliterate cannot be undone. */
const GLOBAL_CONFIG_REFUSED = /\bconfig\s+--global\s+(?:--\S+\s+)*(credential\.|lfs\.|core\.(autocrlf|eol|hookspath|fsmonitor)\b|filter\.)/i
export const actOf = (d: Decision, command = ''): Act => {
  if (d.key === 'git-config-global' && GLOBAL_CONFIG_REFUSED.test(command)) return { act: 'refuse', alt: 'set it for this repository (git config --local <key> <value>) or for one command (git -c <key>=<value> <command>)' }
  if (d.key === 'p4-destructive' && /\bp4\s+obliterate\b/i.test(command)) return { act: 'refuse', alt: 'p4 obliterate cannot be undone: use p4 delete (a recoverable revision), or leave the files' }
  return ACTIONS[d.key] ?? (d.kind === 'deny' ? { act: 'refuse', alt: 'do it another way' } : { act: 'record' })
}

/** A75: one action that ran and is recorded for nghiem thu: Saved/A5R/recorded/<id8>.json, this session's file. */
export type Recorded = { at: number; id8: string; lane: string; kind: string; rule: string; path: string; target?: string; root: string | null; why: string }
/** A75 (review 6): what a recorded shell action is about, for nghiem thu to look for in progress.md or findings.md: a
 * delete's targets, a config key, a depot path; else the command. */
export const recordTarget = (kind: string, command: string): string => {
  const [, args] = commandVerb(tokenize(command))
  if (kind === 'delete') return deleteTargets(args).join(' ') || command.slice(0, 120)
  if (kind === 'git-config-global') return /--global\s+(?:--\S+\s+)*(\S+)/.exec(command)?.[1] ?? command.slice(0, 120)
  return args.filter(a => !a.startsWith('-')).slice(-1)[0] ?? command.slice(0, 120)
}
