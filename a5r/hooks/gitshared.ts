// A74 (rev 27, adversary review): git in the shared checkout that can discard work or move the tree, read segment by
// segment with the folder each one runs in. Pure: no `$`; register.ts reads git status and the touch files and decides.
import { blankQuotes, commandVerb, norm, segments, stripHeredocs, tokenize } from './a5r.ts'

/** One command segment with the folder it runs in (after `cd`, `pushd`, `popd`, `Set-Location` before it). */
export type Seg = { raw: string; dir: string; verb: string; args: string[] }

const CHDIR = new Set(['cd', 'chdir', 'set-location', 'sl'])

/** The command's segments, each with its working folder (relative `cd` targets resolved against the one before; `~`
 * and a bare `cd` are the user's home, rev 27 follow-up). */
export const walk = (command: string, cwd: string, home = ''): Seg[] => {
  const out: Seg[] = []
  const stack: string[] = []
  let dir = norm(cwd)
  for (const raw of segments(stripHeredocs(command ?? ''))) {
    const [verb, args] = commandVerb(tokenize(raw))
    let target = args.filter(a => !/^(-path|-literalpath|\/d)$/i.test(a))[0]
    if (CHDIR.has(verb) || verb === 'pushd') {
      if (verb === 'pushd') stack.push(dir)
      if (home && (target === undefined ? verb !== 'pushd' : target === '~' || target.startsWith('~/') || target.startsWith('~\\'))) target = `${home}${(target ?? '~').slice(1)}`
      if (target && target !== '-' && !/^[$%~]/.test(target)) dir = norm(target, dir)
      continue
    }
    if (verb === 'popd') {
      dir = stack.pop() ?? dir
      continue
    }
    out.push({ raw, dir, verb, args })
  }
  return out
}

/** A git segment's folder: its last `-C <path>` (relative to the segment's folder), else the segment's folder; and its
 * arguments with every `-C <path>` and `-c <key=value>` removed. */
export const gitPlace = (seg: Seg): { dir: string; args: string[] } => {
  let dir = seg.dir
  let workTree: string | null = null
  let gitDir: string | null = null
  const args: string[] = []
  for (let i = 0; i < seg.args.length; i += 1) {
    const a = seg.args[i] ?? ''
    if (a === '-C') {
      dir = norm(seg.args[i + 1] ?? '', dir)
      i += 1
    } else if (a === '-c') i += 1
    // rev 27 follow-up: --work-tree / --git-dir name the tree a command acts on.
    else if (a === '--work-tree' || a === '--git-dir') {
      if (a === '--work-tree') workTree = norm(seg.args[i + 1] ?? '', dir)
      else gitDir = norm(seg.args[i + 1] ?? '', dir)
      i += 1
    } else if (a.startsWith('--work-tree=')) workTree = norm(a.slice(12), dir)
    else if (a.startsWith('--git-dir=')) gitDir = norm(a.slice(10), dir)
    else args.push(a)
  }
  if (workTree) dir = workTree
  else if (gitDir) dir = gitDir.replace(/\/\.git\/?$/i, '') || dir
  return { dir, args }
}

/** What a git command in the shared checkout needs: nothing, a refusal with its alternative, a check of the paths it
 * touches (pathspecs as written, relative to the folder; `untracked`: whether untracked files count), or a check
 * that no stash entry exists. */
export type GitAct =
  | null
  | { kind: 'refuse'; why: string; alt: string }
  | { kind: 'check'; sub: string; paths: string[]; untracked: boolean }
  | { kind: 'stash-drop' }
  /** rev 27 follow-up: a stash comes back over exactly the paths it holds (`git stash show --name-only <ref>`). */
  | { kind: 'stash-apply'; verb: string; ref: string }
  /** rev 27 follow-up: `git checkout <word>`: a file (then `checkout -- <word>`) or a branch (moves the tree). */
  | { kind: 'checkout-word'; word: string }

const WORKTREE = 'a worktree of your own (git worktree add <dir> <branch>)'
const refuse = (why: string, alt: string): GitAct => ({ kind: 'refuse', why, alt })
const opts = (args: string[]): string[] => args.filter(a => a.startsWith('-') && a !== '--')
const has = (args: string[], ...names: string[]) => opts(args).some(a => names.includes(a))
const shortHas = (args: string[], ch: string) => opts(args).some(a => /^-[a-zA-Z]+$/.test(a) && a.slice(1).includes(ch))
/** The pathspecs: what follows `--`, else the non-option words (values of the named options skipped). */
const pathsOf = (rest: string[], valued: string[] = []): string[] => {
  const dash = rest.indexOf('--')
  if (dash >= 0) return rest.slice(dash + 1)
  const out: string[] = []
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i] ?? ''
    if (valued.includes(a)) i += 1
    else if (!a.startsWith('-')) out.push(a)
  }
  return out
}

/** A git command's act in the shared checkout (args without -C/-c). */
export const classifyGit = (args: string[]): GitAct => {
  const subAt = args.findIndex(a => !a.startsWith('-'))
  const sub = (args[subAt] ?? '').toLowerCase()
  const rest = args.slice(subAt + 1)
  switch (sub) {
    case 'switch':
      return refuse('git switch moves the shared working tree under every session', `work in ${WORKTREE}`)
    case 'checkout': {
      if (has(rest, '-b', '-B', '--orphan')) return refuse('git checkout -b/-B moves the shared working tree (and -B resets a branch)', `create the branch in ${WORKTREE.replace('<branch>', '-b <name> <start>')}`)
      const dash = rest.indexOf('--')
      const words = pathsOf(rest.slice(0, dash >= 0 ? dash : rest.length))
      if (dash < 0 && words.length === 1 && words[0] !== '.') return { kind: 'checkout-word', word: words[0] ?? '' }
      const paths = dash >= 0 ? rest.slice(dash + 1) : words.length > 1 ? words.slice(1) : words
      return { kind: 'check', sub: 'checkout', paths, untracked: false }
    }
    case 'restore': {
      if (has(rest, '--staged', '-S') && !has(rest, '--worktree', '-W')) return null
      return { kind: 'check', sub: 'restore', paths: pathsOf(rest, ['-s', '--source']), untracked: false }
    }
    case 'reset':
      return has(rest, '--hard', '--merge', '--keep') ? refuse('git reset --hard rewinds the whole shared working tree', `use git checkout <ref> -- <paths> for the files you mean, or ${WORKTREE}`) : null
    case 'stash': {
      const verb = (rest.find(a => !a.startsWith('-')) ?? 'push').toLowerCase()
      if (verb === 'list' || verb === 'show' || verb === 'create') return null
      if (verb === 'drop' || verb === 'clear') return { kind: 'stash-drop' }
      if (verb === 'branch') return refuse('git stash branch moves the shared working tree to a new branch', 'apply the stash in a worktree of your own (git -C <worktree> stash apply)')
      if (verb === 'pop' || verb === 'apply') {
        const after = rest.slice(rest.findIndex(a => a.toLowerCase() === verb) + 1)
        return { kind: 'stash-apply', verb, ref: after.find(a => !a.startsWith('-')) ?? 'stash@{0}' }
      }
      const after = rest.slice(rest.findIndex(a => a.toLowerCase() === verb) + 1)
      // `save` takes a message, not paths; `push` (the default) takes paths after its options.
      const paths = rest.includes('--') ? rest.slice(rest.indexOf('--') + 1) : verb === 'push' ? pathsOf(after, ['-m', '--message']) : []
      return { kind: 'check', sub: 'stash', paths, untracked: has(rest, '-u', '--include-untracked', '-a', '--all') }
    }
    case 'clean': {
      if (has(rest, '-n', '--dry-run')) return null
      if (!has(rest, '--force', '-f') && !shortHas(rest, 'f')) return null
      if (shortHas(rest, 'x') || shortHas(rest, 'X') || has(rest, '-x', '-X')) return refuse('git clean -x/-X deletes ignored files, and the shared checkout keeps Saved/ (the Editor lock, A5R\'s files, autosaves), Intermediate/ and Binaries/ ignored', 'remove exact paths: git clean -f -- <paths> (without -x/-X)')
      return { kind: 'check', sub: 'clean', paths: pathsOf(rest, ['-e', '--exclude']), untracked: true }
    }
    case 'rm':
      return has(rest, '--cached') ? null : { kind: 'check', sub: 'rm', paths: pathsOf(rest), untracked: false }
    case 'apply':
      return (has(rest, '-R', '--reverse') && !has(rest, '--cached', '--check', '--stat', '--numstat')) ? refuse('git apply -R rewrites files in the shared working tree from a patch A5R cannot read', 'revert the commit (git revert <sha>), or apply it in a worktree of your own') : null
    case 'worktree':
      return (rest[0] ?? '').toLowerCase() === 'remove' && (has(rest, '--force', '-f') || shortHas(rest, 'f')) ? refuse('git worktree remove --force deletes a worktree with uncommitted changes', 'commit or move its changes, then git worktree remove without --force') : null
    case 'branch':
      return (has(rest, '-D') || ((has(rest, '-d', '--delete')) && has(rest, '-f', '--force'))) ? refuse('git branch -D deletes a branch even when its commits are merged nowhere', 'git branch -d <name> (merged branches only), or leave the branch') : null
    case 'submodule':
      return (rest[0] ?? '').toLowerCase() === 'update' && has(rest, '--force', '-f') ? refuse('git submodule update --force throws away changes inside the submodules', 'git submodule update without --force') : null
    default:
      return null
  }
}

/** The alternative for a discard that names no paths (or `.`, or a top folder, which a status cannot read in time on
 * the shared checkout): the same command with exact paths. */
export const exactAlternative = (sub: string): string =>
  sub === 'checkout' ? 'name the files: git checkout <ref> -- <paths>'
  : sub === 'restore' ? 'name the files: git restore -- <paths>'
  : sub === 'stash' ? 'name the files: git stash push -- <paths>'
  : sub === 'clean' ? 'name the files: git clean -f -- <paths>'
  : 'name the files: git rm -- <paths>'

/** A pathspec resolved to the repository: its repo-relative path, or why it cannot be read on facts (a variable, a glob,
 * the repository root or a top folder, outside the repository). */
export const repoPath = (spec: string, dir: string, root: string): { rel: string; top?: boolean } | { why: string } => {
  if (/[$%`]/.test(spec)) return { why: `${spec} is a variable` }
  if (/[*?[]/.test(spec) || spec.startsWith(':')) return { why: `${spec} is a pattern` }
  const abs = norm(spec.replace(/\\/g, '/'), dir)
  const r = norm(root).replace(/\/$/, '')
  if (abs.toLowerCase() === r.toLowerCase()) return { why: 'the whole repository' }
  if (!abs.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return { why: `${spec} is outside the repository` }
  const rel = abs.slice(r.length + 1).replace(/\/$/, '')
  // rev 27 follow-up: a dotless top-level name may be a file (LICENSE, Makefile): the caller checks which.
  if (!rel.includes('/') && !rel.includes('.')) return { rel, top: true }
  return { rel }
}

/** Whether a segment's (blanked) text is git at all (cheap pre-filter). */
export const isGit = (seg: Seg): boolean => seg.verb === 'git' && blankQuotes(seg.raw).length > 0
