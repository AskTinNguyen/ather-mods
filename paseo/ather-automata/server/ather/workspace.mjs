// Ather Automata: the checkouts a session works with. The checkout holding the
// session folder, then the worktrees of its clone. A session opened in a folder
// that is in no checkout works with none.
// Pure apart from the files it is given.

/**
 * @typedef {{
 *   read: (path: string) => Promise<string | null>, exists: (path: string) => Promise<boolean>,
 *   worktrees?: (root: string) => Promise<string | null>, real?: (folder: string) => Promise<string>
 * }} Files `worktrees`: what `git worktree list --porcelain` prints in the checkout at `root` ('' when git refused), or
 *   null when git could not say (the run was aborted, ran out of time, could not start).
 *   `real`: the folder a path really lands in, behind any symbolic link.
 */

// How far up a folder is walked to find its checkout, and how many checkouts one session works with,
// its clone's worktrees included.
const MAX_DEPTH = 12
const MAX_WITH_WORKTREES = 24

// A folder as compared and joined: forward slashes, no trailing slash, `.` and `..` folded away
// so that walking up from `<root>/../web` walks up from `web`, not from `..`.
/** @param {string} folder */
export const normalFolder = folder => {
  const slashed = folder.replace(/\\/g, '/')
  const lead = /^([A-Za-z]:)?\/?/.exec(slashed)?.[0] ?? ''
  /** @type {string[]} */
  const parts = []
  for (const part of slashed.slice(lead.length).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (part !== '..' || lead === '') parts.push(part)
  }
  const joined = lead + parts.join('/')
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined
}

/** @param {string} folder */
export const isAbsolute = folder => /^([A-Za-z]:)?[\\/]/.test(folder)

// The git directory of a checkout's top folder: its .git folder, or the gitdir a worktree's .git file names.
/** @param {Files} files @param {string} folder @returns {Promise<string | null>} */
export const gitDirOf = async (files, folder) => {
  if (await files.exists(`${folder}/.git/HEAD`)) return `${folder}/.git`
  return /gitdir:\s*(.+)/.exec((await files.read(`${folder}/.git`)) ?? '')?.[1]?.trim() || null
}

// The checkout holding a folder, or null: `cd Plugins/X && git push` pushes the checkout's branch.
/** @param {Files} files @param {string} folder @returns {Promise<string | null>} */
export const checkoutOf = async (files, folder) => {
  for (let at = normalFolder(folder), depth = 0; at !== '' && depth < MAX_DEPTH; depth += 1) {
    if (await gitDirOf(files, at)) return at
    const parent = at.replace(/\/[^/]*$/, '')
    at = parent === at || parent === '' ? '' : parent
  }
  return null
}

// `git worktree list --porcelain`: a block per worktree (`worktree <folder>`, then HEAD, `branch` or `detached`,
// and `bare`, `locked` or `prunable` when it is). The folders of those that are checkouts, in git's order: not
// bare, not prunable.
/** @param {string} text @returns {string[]} */
export const parseWorktrees = text =>
  text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.split('\n'))
    .filter(lines => lines[0]?.startsWith('worktree ') && !lines.some(line => /^(bare|prunable)( |$)/.test(line)))
    .map(lines => (lines[0] ?? '').slice('worktree '.length))

/**
 * The session's checkouts, in order and each once: the one holding the session folder (none when it is in
 * no checkout), then the worktrees git names in its clone (parseWorktrees) that are still checkouts. A
 * checkout is the same one by the folder its path really lands in, under its first name: git names real
 * paths, the session folder may be a link.
 * `left`: the worktrees the limit left out. `isSure` false: git could not say (`worktrees` gave null), so
 * worktrees may be missing: worth reading again.
 * @param {Files} files @param {string} sessionFolder
 * @returns {Promise<{ roots: string[], left: string[], isSure: boolean }>}
 */
export const readWorkspace = async (files, sessionFolder) => {
  const own = await checkoutOf(files, sessionFolder)
  if (own === null) return { roots: [], left: [], isSure: true }
  // A folder as two names for it compare: where it really lands, whatever the case.
  /** @param {string} folder */
  const landing = async folder => normalFolder(files.real ? await files.real(folder).catch(() => folder) : folder).toLowerCase()
  // Where each checkout found so far lands.
  const lands = new Set([await landing(own)])
  const roots = [own]
  /** @type {string[]} */
  const left = []
  let isSure = true
  if (files.worktrees) {
    const text = await files.worktrees(own).catch(() => null)
    if (text === null) isSure = false
    for (const listed of parseWorktrees(text ?? '')) {
      const folder = normalFolder(listed)
      const at = await landing(folder)
      if (lands.has(at) || !(await gitDirOf(files, folder))) continue
      lands.add(at)
      if (roots.length < MAX_WITH_WORKTREES) roots.push(folder)
      else left.push(folder)
    }
  }
  return { roots, left, isSure }
}

/**
 * Each checkout's short name, in the order given and each different: the first (the session's checkout) by the
 * last part of its repository's id ("han-viet"), else of its folder; each after it (a worktree of its clone) by
 * its folder. A name already taken gets `-2`, `-3`, … in order. A name holds only what `<name>#<number>` is read
 * with (letters, digits, `_`, `.`, `-`): anything else becomes `-`.
 * `outside`: checkouts named after those, each taking a name none has (its repository's, else its folder's,
 * else numbered) and renaming none, so the names of `checkouts` do not depend on them.
 * @param {{ root: string, repo: string }[]} checkouts @param {{ root: string, repo: string }[]} [outside] @returns {string[]}
 */
export const checkoutNames = (checkouts, outside = []) => {
  /** @param {string} text */
  const lastPart = text => (text.split('/').pop() ?? '').replace(/[^\w.-]/g, '-')
  /** @param {{ root: string, repo: string }} one */
  const folderOf = one => lastPart(normalFolder(one.root))
  /** @param {{ root: string, repo: string }} one */
  const shortOf = one => (one.repo ? lastPart(one.repo) : folderOf(one))
  /** @type {Set<string>} */
  const taken = new Set()
  /** @param {string} base */
  const free = base => {
    let unique = base
    for (let count = 2; taken.has(unique); count += 1) unique = `${base}-${count}`
    taken.add(unique)
    return unique
  }
  return [...checkouts.map((one, at) => free(at === 0 ? shortOf(one) : folderOf(one))), ...outside.map(one => free(taken.has(shortOf(one)) ? folderOf(one) : shortOf(one)))]
}
