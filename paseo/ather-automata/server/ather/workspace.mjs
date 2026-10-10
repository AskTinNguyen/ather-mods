// Ather Automata: the checkouts a session works with. The checkout holding the
// session folder, the folders the `repos` option names, those kept for the machine,
// and, for a session opened in a parent folder, its child checkouts; then the
// worktrees of each one's clone.
// Pure apart from the files it is given.

/**
 * @typedef {{
 *   read: (path: string) => Promise<string | null>, exists: (path: string) => Promise<boolean>,
 *   list?: (path: string) => Promise<{ name: string, kind: string }[]>,
 *   worktrees?: (root: string) => Promise<string | null>, real?: (folder: string) => Promise<string>
 * }} Files `worktrees`: what `git worktree list --porcelain` prints in the checkout at `root` ('' when git refused), or
 *   null when git could not say (the run was aborted, ran out of time, could not start).
 *   `real`: the folder a path really lands in, behind any symbolic link.
 */

// How far up a folder is walked to find its checkout, how many checkouts one session works with, and how
// many with their clones' worktrees.
const MAX_DEPTH = 12
export const MAX_CHECKOUTS = 8
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

// The `repos` option: folders separated by `;` or newlines, a relative one taken from the session folder.
/** @param {string} option @param {string} sessionFolder */
export const parseRepos = (option, sessionFolder) =>
  option
    .split(/[;\r\n]+/)
    .map(folder => folder.trim())
    .filter(Boolean)
    .map(folder => normalFolder(isAbsolute(folder) ? folder : `${sessionFolder}/${folder}`))

// `git worktree list --porcelain`: a block per worktree (`worktree <folder>`, then HEAD, `branch` or `detached`,
// and `bare`, `locked` or `prunable` when it is). `main`: the first one's folder, the clone's main worktree
// (or its bare repository). `folders`: those that are checkouts, in git's order: not bare, not prunable.
/** @param {string} text @returns {{ main: string, folders: string[] }} */
export const parseWorktrees = text => {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.split('\n'))
    .filter(lines => lines[0]?.startsWith('worktree '))
  /** @param {string[]} lines */
  const folderOf = lines => (lines[0] ?? '').slice('worktree '.length)
  return {
    main: blocks[0] ? folderOf(blocks[0]) : '',
    folders: blocks.filter(lines => !lines.some(line => /^(bare|prunable)( |$)/.test(line))).map(folderOf),
  }
}

/**
 * The session's checkouts, in order and each once: the one holding the session folder, those the `repos`
 * option names, those of the folders kept for the machine (`kept`, state.mjs readTraced), then, only when the
 * session folder is in none, its child folders that are checkouts, by name (at most 8). After them, the worktrees git names in each (parseWorktrees) that are still checkouts, each
 * once. A checkout is the same one by the folder its path really lands in, under its first name: git names
 * real paths, the session folder may be a link.
 * `skipped`: option and kept folders in no checkout. `named`: how many of `roots` were found before the
 * worktrees. `clones`: for each root, its clone's main folder, the same for a
 * checkout and its worktrees. `left`: the checkouts the two limits left out. `isSure` false: git could not
 * say for one of them (`worktrees` gave null), so worktrees may be missing: worth reading again.
 * @param {Files} files @param {string} sessionFolder @param {string} option @param {string[]} [kept]
 * @returns {Promise<{ roots: string[], skipped: string[], named: number, clones: string[], left: string[], isSure: boolean }>}
 */
export const readWorkspace = async (files, sessionFolder, option, kept = []) => {
  /** @type {string[]} */
  const found = []
  /** @type {string[]} */
  const skipped = []
  // A folder as two names for it compare: where it really lands, whatever the case.
  /** @param {string} folder */
  const landing = async folder => normalFolder(files.real ? await files.real(folder).catch(() => folder) : folder).toLowerCase()
  /** @type {Map<string, string>} each checkout as first named → where it lands */
  const lands = new Map()
  /** @param {string | null} root */
  const add = async root => {
    if (root === null || lands.has(root)) return
    const at = await landing(root)
    if ([...lands.values()].includes(at)) return
    lands.set(root, at)
    found.push(root)
  }
  const own = await checkoutOf(files, sessionFolder)
  await add(own)
  for (const folder of [...parseRepos(option, sessionFolder), ...kept.map(normalFolder)]) {
    const root = await checkoutOf(files, folder)
    if (root === null) skipped.push(folder)
    await add(root)
  }
  if (own === null && files.list) {
    const top = normalFolder(sessionFolder)
    const children = (await files.list(top).catch(() => [])).filter(entry => entry.kind === 'dir').map(entry => entry.name).sort()
    for (const name of children) {
      const child = normalFolder(`${top}/${name}`)
      if (await gitDirOf(files, child)) await add(child)
    }
  }
  const roots = found.slice(0, MAX_CHECKOUTS)
  const named = roots.length
  const left = found.slice(MAX_CHECKOUTS)
  /** @type {Map<string, string>} where a folder lands → its clone */
  const cloneOf = new Map()
  let isSure = true
  if (files.worktrees) {
    for (const root of [...roots]) {
      const text = await files.worktrees(root).catch(() => null)
      if (text === null) isSure = false
      const { main, folders } = parseWorktrees(text ?? '')
      if (main === '') continue
      const clone = normalFolder(main)
      cloneOf.set(lands.get(root) ?? '', clone)
      for (const listed of folders) {
        const folder = normalFolder(listed)
        const at = await landing(folder)
        cloneOf.set(at, clone)
        if ([...lands.values()].includes(at) || !(await gitDirOf(files, folder))) continue
        lands.set(folder, at)
        if (roots.length < MAX_WITH_WORKTREES) roots.push(folder)
        else left.push(folder)
      }
    }
  }
  const clones = roots.map(root => cloneOf.get(lands.get(root) ?? '') ?? root)
  return { roots, skipped, named, clones, left, isSure }
}

/**
 * Each checkout's short name, in the order given and each different: the last part of its repository's id
 * ("han-viet"), else of its folder. Those that would share one (two clones of one repository, `a/web` beside
 * `b/web`) are named by their folders instead, and a name already taken gets `-2`, `-3`, … in order. A name
 * holds only what `<name>#<number>` is read with (letters, digits, `_`, `.`, `-`): anything else becomes `-`.
 * `clone`: which clone a checkout is of (readWorkspace). A clone's first checkout is named as if its other
 * worktrees were not there, and each of those after it by its folder, numbered when taken.
 * `outside`: checkouts named after those, each taking a name none has (its repository's, else its folder's,
 * else numbered) and renaming none, so the names of `checkouts` do not depend on them.
 * @param {{ root: string, repo: string, clone?: string }[]} checkouts @param {{ root: string, repo: string }[]} [outside] @returns {string[]}
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
  const isFirst = checkouts.map((one, at) => one.clone === undefined || checkouts.findIndex(other => other.clone === one.clone) === at)
  const short = checkouts.filter((_, at) => isFirst[at]).map(shortOf)
  /** @type {string[]} */
  const names = []
  for (const [at, one] of checkouts.entries()) if (isFirst[at]) names[at] = free(short.indexOf(shortOf(one)) === short.lastIndexOf(shortOf(one)) ? shortOf(one) : folderOf(one))
  for (const [at, one] of checkouts.entries()) if (!isFirst[at]) names[at] = free(folderOf(one))
  return [...names, ...outside.map(one => free(taken.has(shortOf(one)) ? folderOf(one) : shortOf(one)))]
}
