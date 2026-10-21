// A74 (rev 27, adversary review): git in the shared checkout that can discard work or move the tree, read segment by
// segment with the folder each one runs in. Pure: no `$`; register.ts reads git status and the touch files and decides.
import { blankQuotes, commandVerb, norm, segments, stripHeredocs, tokenize, under } from './a5r.ts'

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
  /** `side`: a `checkout --ours|--theirs` (A97: on an unmerged path during a merge it resolves, it does not discard). */
  | { kind: 'check'; sub: string; paths: string[]; untracked: boolean; side?: 'ours' | 'theirs' }
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
      // A97: --ours/--theirs take no ref: every word is a path.
      const side = has(rest, '--ours') ? 'ours' : has(rest, '--theirs') ? 'theirs' : undefined
      if (side) return { kind: 'check', sub: 'checkout', paths: pathsOf(rest), untracked: false, side }
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

/** A97: porcelain XY codes of an unmerged path (git status's "Unmerged paths"). */
const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
/** A97 (review F3): the files git leaves while a conflicted merge, revert or cherry-pick waits to be resolved. */
export const CONFLICT_HEADS = ['MERGE_HEAD', 'REVERT_HEAD', 'CHERRY_PICK_HEAD'] as const

/** The changed paths a discard would lose, from `git status --porcelain=v1 -z` (`XY path` entries, NUL-separated; a rename's
 * or copy's source path follows its entry as a field of its own, without XY, and is skipped: review F5). A97: while a
 * conflict waits to be resolved (`isResolving`: a `checkout --ours|--theirs` with one of CONFLICT_HEADS present) an
 * unmerged path is being resolved, not discarded. */
export const discardedPaths = (statusZ: string, isResolving: boolean): string[] => {
  const fields = statusZ.split(/\0|\r?\n/)
  const out: string[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const e = fields[i] ?? ''
    if (!/^.. \S/.test(e)) continue
    const xy = e.slice(0, 2)
    if (/[RC]/.test(xy)) i += 1 // the source path
    if (!(isResolving && UNMERGED.has(xy))) out.push(e.slice(3).trim())
  }
  return out.filter(Boolean)
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

/** A80 (rev 28): the branches a `git push --force-with-lease` (or `--force-if-includes`) writes on the remote, or null
 * when the segment is no such push. `''` is "the current branch of the folder it runs in" (no refspec, or `HEAD`); `*`
 * is a push that cannot be read by branch (`--all`, `--mirror`, a pattern). Plain `--force`/`-f`/`+refspec` stay rule
 * 1's (refused with the alternative `--force-with-lease`). */
export const leasePushTargets = (args: string[]): string[] | null => {
  if ((args[0] ?? '').toLowerCase() !== 'push') return null
  const rest = args.slice(1)
  if (!rest.some(a => /^--force-(with-lease|if-includes)(=|$)/.test(a))) return null
  if (rest.some(a => a === '--all' || a === '--mirror' || a === '--branches')) return ['*']
  const valued = new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option'])
  const words: string[] = []
  for (let i = 0; i < rest.length; i += 1) {
    let a = rest[i] ?? ''
    // Review 1: a pipe or a list operator ends the git command; a redirection (`2>&1`, `> log`, `&> log`, `x>log`) is no
    // refspec: an operator alone takes the next word as its target.
    const redirect = /^(\d*|&)(>>?|<)(.*)$/.exec(a)
    if (redirect) {
      if ((redirect[3] ?? '') === '') i += 1
      continue
    }
    if (/^(\||;|&)/.test(a)) break
    const at = a.search(/[<>]/)
    if (at > 0) {
      if (/[<>]&?$/.test(a)) i += 1
      a = a.slice(0, at)
    }
    if (a.startsWith('-')) {
      if (valued.has(a)) i += 1
      continue
    }
    words.push(a)
  }
  const refspecs = words.slice(1) // the first word is the remote
  if (refspecs.length === 0) return ['']
  return refspecs.map(r => {
    const dst = (r.includes(':') ? r.slice(r.indexOf(':') + 1) : r).replace(/^\+/, '').replace(/^refs\/heads\//, '')
    if (/[*$%`]/.test(dst)) return '*'
    return dst === '' || dst === 'HEAD' || dst === '@' ? '' : dst
  })
}


/** 0.16.1: verbs that only read files: a session that ran them inside the shared checkout changed nothing there. */
const READ_VERBS = new Set(['ls', 'cat', 'rg', 'grep', 'egrep', 'find', 'head', 'tail', 'echo', 'printf', 'wc', 'pwd', 'stat', 'du', 'tree', 'which', 'where', 'type', 'less', 'more', 'get-content', 'gc', 'select-string', 'sls', 'get-childitem', 'gci', 'dir', 'get-item', 'test-path', 'resolve-path'])
const GIT_READS = new Set(['log', 'status', 'diff', 'show', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'blame', 'describe', 'cat-file', 'merge-base', 'shortlog', 'grep', 'fetch', 'reflog'])

/** 0.16.1 (A82): whether a segment may change files inside `root`: a redirection or tee target there (from any folder), or
 * a command that is not a plain read run with its folder (after `cd`, or `git -C`) there. */
export const writesInside = (seg: Seg, root: string): boolean => {
  const inside = (p: string) => under(norm(p.replace(/\\/g, '/'), seg.dir), root)
  for (const m of seg.raw.matchAll(/(?:^|[^<>&\d])(?:\d*>>?|&>>?)\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&<>]+))/g)) {
    const target = m[1] ?? m[2] ?? m[3] ?? ''
    if (target && !/^(&\d|\/dev\/null$|nul$|\$null$)/i.test(target) && inside(target)) return true
  }
  if (['tee', 'tee-object', 'out-file', 'set-content', 'add-content', 'sc', 'ac'].includes(seg.verb) && seg.args.some(a => !a.startsWith('-') && inside(a))) return true
  const isGitSeg = seg.verb === 'git'
  const place = isGitSeg ? gitPlace(seg) : null
  if (!under(place?.dir ?? seg.dir, root)) return false
  if (READ_VERBS.has(seg.verb)) return false
  if (place) {
    const sub = (place.args[0] ?? '').toLowerCase()
    if (GIT_READS.has(sub)) return false
    if (sub === 'branch' && place.args.slice(1).every(a => /^(--list|-a|-r|-v|-vv|--all|--remotes|--show-current)$/.test(a))) return false
  }
  return true
}

/** A80: the branches no force push may rewrite, whatever its lease. */
export const PROTECTED_BRANCH = /^(main|master|develop)$/i
