// @ts-check
// Ather Automata: the checkouts a session works with. The checkout holding the
// session folder, the folders the `repos` option names, and, for a session opened
// in a parent folder, its child checkouts. Pure apart from the files it is given.

/** @typedef {{ read: (path: string) => Promise<string | null>, exists: (path: string) => Promise<boolean>, list?: (path: string) => Promise<{ name: string, kind: string }[]> }} Files */

// How far up a folder is walked to find its checkout, and how many checkouts one session works with.
const MAX_DEPTH = 12
const MAX_CHECKOUTS = 8

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
const isAbsolute = folder => /^([A-Za-z]:)?[\\/]/.test(folder)

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

/**
 * The session's checkouts, in order and each once: the one holding the session folder, those the `repos`
 * option names, then, only when the session folder is in none, its child folders that are checkouts, by name.
 * `skipped`: option folders in no checkout.
 * @param {Files} files @param {string} sessionFolder @param {string} option
 * @returns {Promise<{ roots: string[], skipped: string[] }>}
 */
export const readWorkspace = async (files, sessionFolder, option) => {
  /** @type {string[]} */
  const roots = []
  /** @type {string[]} */
  const skipped = []
  /** @param {string | null} root */
  const add = root => {
    if (root !== null && !roots.includes(root)) roots.push(root)
  }
  const own = await checkoutOf(files, sessionFolder)
  add(own)
  for (const folder of parseRepos(option, sessionFolder)) {
    const root = await checkoutOf(files, folder)
    if (root === null) skipped.push(folder)
    add(root)
  }
  if (own === null && files.list) {
    const top = normalFolder(sessionFolder)
    const children = (await files.list(top).catch(() => [])).filter(entry => entry.kind === 'dir').map(entry => entry.name).sort()
    for (const name of children) {
      const child = normalFolder(`${top}/${name}`)
      if (await gitDirOf(files, child)) add(child)
    }
  }
  return { roots: roots.slice(0, MAX_CHECKOUTS), skipped }
}
