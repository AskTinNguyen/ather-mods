// @ts-check
// Ather Automata: the team's intents as origin/main has them, each dated by its folder's
// last commit there, merged with the folders only this checkout has (D1-D3). Pure: git
// and the files come through a Repo of closures built where `$` lives (console.mjs).
// Every git call here reads, and never the working tree or the index; the fetch writes
// only the remote-tracking ref.

/**
 * `isAborted`: the app took the run back before it ended (it never ran to an exit code).
 * @typedef {{ exitCode: number, stdout: string, stderr?: string, isAborted?: boolean }} Ran
 * @typedef {{
 *   git: (args: readonly string[], options?: { stdin?: string, timeoutMs?: number }) => Promise<Ran>,
 *   read: (path: string) => Promise<string | null>,
 *   list: (path: string) => Promise<readonly { name: string, kind: string }[]>,
 *   mtime: (path: string) => Promise<number>,
 * }} Repo `git` runs in the checkout with GIT_ENV; one that could not start or ran out of time answers exit code -1, the reason in stderr
 * @typedef {{ files: string[], at: number, firstAuthor: string, prompt: string, progress: string, findings: string }} MainFolder `at`: the folder's last commit, ms
 * @typedef {{ sha: string, folders: Map<string, MainFolder> }} MainSnapshot what origin/main held at `sha`
 * @typedef {{ key: string, dirty: Set<string>, committed: Set<string> }} LocalState which folders are uncommitted, and which this branch committed since main, as of `key`
 * @typedef {{ main: MainSnapshot | null, local: LocalState | null }} TeamCache what the last read learned; each part is read again only when what it depends on moved
 * @typedef {import('./model.mjs').IntentFiles} IntentFiles
 */

// Every git call Ather makes reads without taking the index lock, and never asks for a password (D2).
export const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
export const MAIN = 'origin/main'
const INTENTS = 'docs/intent'
// The fetch (D2): origin's main into origin/main by an explicit refspec (a narrowed remote.origin.fetch
// would not move it otherwise), no tags, no FETCH_HEAD, no submodules, and no automatic gc or
// maintenance: a background fetch in a shared checkout must not start a repack.
export const FETCH_ARGS = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', 'origin', '+refs/heads/main:refs/remotes/origin/main']
export const FETCH_EVERY_MS = 10 * 60 * 1000
// As long as the engine lets a process run: a slow fetch is not a failed one.
export const FETCH_TIMEOUT_MS = 10 * 60 * 1000
export const EMPTY_CACHE = /** @type {TeamCache} */ ({ main: null, local: null })

/** @param {string} text */
const lf = text => text.replace(/\r\n/g, '\n')

// The intent folder a repository path is in: "docs/intent/lead-vfx/prompt.md" → "lead-vfx".
/** @param {string} path */
const slugOf = path => /^docs\/intent\/([^/]+)\/./.exec(path.trim())?.[1] ?? ''

// `git ls-tree -r --name-only` under docs/intent: each folder with the names of its files.
/** @param {string} text @returns {Map<string, string[]>} */
export const parseTree = text => {
  /** @type {Map<string, string[]>} */
  const folders = new Map()
  for (const line of lf(text).split('\n')) {
    const slug = slugOf(line)
    if (!slug) continue
    folders.set(slug, [...(folders.get(slug) ?? []), line.trim().slice(`${INTENTS}/${slug}/`.length)])
  }
  return folders
}

// `git log --format=%x00%ct%x09%an --name-only` under docs/intent, newest first: each folder's
// last commit time (ms) and the author of its first commit.
/** @param {string} text @returns {Map<string, { at: number, firstAuthor: string }>} */
export const parseLog = text => {
  /** @type {Map<string, { at: number, firstAuthor: string }>} */
  const folders = new Map()
  for (const record of lf(text).split('\0').slice(1)) {
    const [head = '', ...paths] = record.split('\n')
    const [seconds = '', author = ''] = head.split('\t')
    const at = Number(seconds) * 1000
    if (!Number.isFinite(at) || at <= 0) continue
    for (const slug of new Set(paths.map(slugOf).filter(Boolean))) folders.set(slug, { at: folders.get(slug)?.at ?? at, firstAuthor: author.trim() })
  }
  return folders
}

// `git cat-file --batch` output, one entry per object asked for: its text, or null when missing.
// Sizes count bytes, so the text is walked as UTF-8.
/** @param {string} text @param {number} count @returns {(string | null)[]} */
export const parseBatch = (text, count) => {
  const bytes = new TextEncoder().encode(text)
  const decoder = new TextDecoder()
  /** @type {(string | null)[]} */
  const out = []
  let at = 0
  while (out.length < count && at < bytes.length) {
    const end = bytes.indexOf(10, at)
    if (end < 0) break
    const head = decoder.decode(bytes.subarray(at, end))
    at = end + 1
    const blob = / blob (\d+)$/.exec(head)
    if (!blob) {
      out.push(null)
      continue
    }
    const size = Number(blob[1])
    out.push(decoder.decode(bytes.subarray(at, at + size)))
    at += size + 1
  }
  while (out.length < count) out.push(null)
  return out
}

// `git status --porcelain=v1 -z` under docs/intent: the folders with uncommitted or untracked files.
/** @param {string} text */
export const parseStatus = text => new Set(text.split('\0').map(entry => slugOf(entry.replace(/^.. /, ''))).filter(Boolean))

/** @param {string} prompt */
const isCompleted = prompt => /^\s*-\s*Status:\s*completed/im.test(prompt)

/** @param {Repo} repo @param {string} sha @param {readonly string[]} paths */
const blobs = async (repo, sha, paths) => {
  if (paths.length === 0) return []
  const ran = await repo.git(['cat-file', '--batch'], { stdin: paths.map(path => `${sha}:${path}\n`).join('') })
  return ran.exitCode === 0 ? parseBatch(ran.stdout, paths.length) : paths.map(() => null)
}

/** @param {string} a @param {string} b */
const isSamePath = (a, b) => {
  const norm = (/** @type {string} */ path) => path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** @param {Repo} repo @param {string} ref */
const shaOf = async (repo, ref) => {
  const ran = await repo.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

// What origin/main holds under docs/intent: every folder's files, last commit and first author, its
// prompt.md, and the progress and findings of open ones. Read again only when the ref moved:
// `previous` is returned as it is while origin/main is still at its commit. null: no origin/main.
/** @param {Repo} repo @param {MainSnapshot | null} previous @returns {Promise<MainSnapshot | null>} */
export const readMain = async (repo, previous) => {
  const sha = await shaOf(repo, MAIN)
  if (!sha) return null
  if (previous?.sha === sha) return previous
  const [tree, log] = await Promise.all([repo.git(['ls-tree', '-r', '--name-only', sha, '--', INTENTS]), repo.git(['log', sha, '--format=%x00%ct%x09%an', '--name-only', '--', INTENTS])])
  if (tree.exitCode !== 0 || log.exitCode !== 0) return previous
  const files = parseTree(tree.stdout)
  const dates = parseLog(log.stdout)
  const slugs = [...files.keys()].filter(slug => files.get(slug)?.includes('prompt.md'))
  const prompts = await blobs(repo, sha, slugs.map(slug => `${INTENTS}/${slug}/prompt.md`))
  const open = slugs.filter((_, index) => !isCompleted(prompts[index] ?? ''))
  const more = await blobs(repo, sha, open.flatMap(slug => [`${INTENTS}/${slug}/progress.md`, `${INTENTS}/${slug}/findings.md`]))
  /** @type {Map<string, MainFolder>} */
  const folders = new Map()
  slugs.forEach((slug, index) => {
    const at = open.indexOf(slug)
    folders.set(slug, {
      files: files.get(slug) ?? [],
      at: dates.get(slug)?.at ?? 0,
      firstAuthor: dates.get(slug)?.firstAuthor ?? '',
      prompt: lf(prompts[index] ?? ''),
      progress: at < 0 ? '' : lf(more[at * 2] ?? ''),
      findings: at < 0 ? '' : lf(more[at * 2 + 1] ?? ''),
    })
  })
  return { sha, folders }
}

// Which local folders are uncommitted, and which this branch committed since main. Both calls load
// the whole index of a large checkout, so readTeam asks only when `key` (main, HEAD and the intent
// files' times) moved.
/** @param {Repo} repo @param {string} sha @param {string} key @returns {Promise<LocalState>} */
const readLocal = async (repo, sha, key) => {
  const [status, ahead] = await Promise.all([repo.git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', INTENTS]), repo.git(['log', `${sha}..HEAD`, '--format=%x00%ct%x09%an', '--name-only', '--', INTENTS])])
  return { key, dirty: parseStatus(status.exitCode === 0 ? status.stdout : ''), committed: new Set(parseLog(ahead.exitCode === 0 ? ahead.stdout : '').keys()) }
}

// The checkout's copy of an intent main has too wins when it says something else and is newer:
// uncommitted, or committed on this branch since main (D1). Main's progress and findings count only
// where main kept them (for open intents).
/** @param {{ prompt: string, progress: string, findings: string }} local @param {MainFolder} onMain @param {boolean} isNewer */
export const localWins = (local, onMain, isNewer) =>
  isNewer && (local.prompt !== onMain.prompt || (onMain.progress !== '' && local.progress !== onMain.progress) || (onMain.findings !== '' && local.findings !== onMain.findings))

// The intents to show: origin/main's, and the checkout's own folders. A folder on both is read from
// main unless the checkout's copy wins (localWins); the tracked one (`pinned`) always from the
// checkout, where its session writes. Main's are dated by their last commit there, the checkout's by
// their files (D3). `isRepo` false: not a git checkout of its own, so only its folders are read, untagged.
/**
 * @param {Repo} repo @param {string} root
 * @param {{ cache: TeamCache, pinned: string | null }} options
 * @returns {Promise<{ isRepo: boolean, cache: TeamCache, intents: IntentFiles[] }>}
 */
export const readTeam = async (repo, root, { cache, pinned }) => {
  const top = await repo.git(['rev-parse', '--show-toplevel'])
  const isRepo = top.exitCode === 0 && isSamePath(top.stdout, root)
  const main = isRepo ? await readMain(repo, cache.main) : null
  const folders = []
  for (const entry of await repo.list(`${root}/${INTENTS}`).catch(() => [])) {
    if (entry.kind !== 'dir') continue
    const dir = `${root}/${INTENTS}/${entry.name}`
    const prompt = await repo.read(`${dir}/prompt.md`)
    if (prompt === null) continue
    const isOpen = !isCompleted(prompt)
    const [progress, findings] = await Promise.all([repo.read(`${dir}/progress.md`), repo.read(`${dir}/findings.md`)])
    const times = await Promise.all(['prompt.md', 'progress.md', 'findings.md', 'log.md'].map(name => repo.mtime(`${dir}/${name}`)))
    const text = { prompt: lf(prompt), progress: isOpen || entry.name === pinned ? lf(progress ?? '') : '', findings: isOpen ? lf(findings ?? '') : '' }
    folders.push({ slug: entry.name, dir, text, times })
  }
  const key = main ? [main.sha, await shaOf(repo, 'HEAD'), ...folders.map(one => `${one.slug}:${one.times.join(',')}`)].join('|') : ''
  const local = !main ? null : cache.local?.key === key ? cache.local : await readLocal(repo, main.sha, key)
  /** @type {Map<string, IntentFiles>} */
  const out = new Map()
  for (const [slug, folder] of main?.folders ?? []) {
    out.set(slug, { slug, prompt: folder.prompt, progress: folder.progress, findings: folder.findings, files: folder.files, hasDebrief: false, updatedAt: folder.at, source: 'main', firstAuthor: folder.firstAuthor })
  }
  for (const { slug, dir, text, times } of folders) {
    const onMain = main?.folders.get(slug)
    if (onMain && slug !== pinned && !localWins(text, onMain, Boolean(local && (local.dirty.has(slug) || local.committed.has(slug))))) continue
    const [prompt = 0, progress = 0, , log = 0] = times
    out.set(slug, {
      slug,
      ...text,
      files: slug === pinned ? (await repo.list(dir).catch(() => [])).map(one => one.name) : [],
      hasDebrief: false,
      updatedAt: Math.max(prompt, progress, log),
      source: 'local',
      firstAuthor: onMain?.firstAuthor ?? '',
    })
  }
  return { isRepo, cache: { main, local }, intents: [...out.values()] }
}

/**
 * Where the background fetch stands, for the sync line. `lock`: the git lock a failed fetch ran into.
 * @typedef {{ isRepo: boolean, hasMain: boolean, isFetching: boolean, triedAt: number, fetchedAt: number, failedAt: number, error: string, lock: string }} Sync
 */

/** @type {Sync} */
export const NO_SYNC = { isRepo: false, hasMain: false, isFetching: false, triedAt: 0, fetchedAt: 0, failedAt: 0, error: '', lock: '' }

// A fetch may start on its own: a git checkout, none running, the last try at least ten minutes ago (or never).
/** @param {Sync} sync @param {number} now */
export const isFetchDue = (sync, now) => sync.isRepo && !sync.isFetching && (sync.triedAt === 0 || now - sync.triedAt >= FETCH_EVERY_MS)

// ↻ fetches at once, except after a fetch that ran into a git lock: that one waits for its next due time.
/** @param {Sync} sync @param {number} now */
export const canFetchNow = (sync, now) => sync.isRepo && !sync.isFetching && (!sync.lock || isFetchDue(sync, now))

// The lock a failed git call names ("refs/remotes/origin/main.lock", "index.lock"), inside .git; '' when none.
/** @param {string} text */
export const lockOf = text => {
  const path = (/([^\s'"]+\.lock)\b/.exec(text)?.[1] ?? '').replace(/\\/g, '/')
  return path.includes('/.git/') ? path.slice(path.lastIndexOf('/.git/') + 6) : path.split('/').pop() ?? ''
}

// Fetches origin's main. Synced means git said so and origin/main resolves after it (`moved`: it moved).
// On a failure: git's last line of complaint, and the lock it ran into, if any. `isAborted`: the app took the
// run back, so nothing was tried.
/** @param {Repo} repo @returns {Promise<{ error: string, lock: string, moved: boolean, isAborted?: true }>} */
export const fetchMain = async repo => {
  const before = await shaOf(repo, MAIN)
  const ran = await repo.git(FETCH_ARGS, { timeoutMs: FETCH_TIMEOUT_MS })
  const after = await shaOf(repo, MAIN)
  if (ran.exitCode === 0 && after) return { error: '', lock: '', moved: after !== before }
  const stderr = ran.stderr ?? ''
  return { error: (stderr.trim().split('\n').pop() || `git fetch exited with ${ran.exitCode}`).slice(0, 200), lock: lockOf(stderr), moved: false, ...(ran.isAborted ? { isAborted: /** @type {const} */ (true) } : {}) }
}

// One sync line for several checkouts: a failed fetch in any of them, else one running, else the least
// recently synced (never synced counts as the least). One checkout's is its own.
/** @param {readonly Sync[]} syncs @returns {Sync} */
export const syncSummary = syncs => {
  const repos = syncs.filter(one => one.isRepo)
  const failed = repos.find(one => one.failedAt > one.fetchedAt && !one.isFetching)
  return failed ?? repos.find(one => one.isFetching) ?? [...repos].sort((a, b) => a.fetchedAt - b.fetchedAt)[0] ?? syncs[0] ?? NO_SYNC
}

/** @param {number} ms */
const agoText = ms => {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`
}

// "synced 4 min ago ↻": how fresh the list is. A failed fetch says so, naming the git lock it ran
// into, and keeps the last good time.
/** @param {Sync} sync @param {number} now */
export const syncText = (sync, now) => {
  if (!sync.isRepo) return ''
  if (sync.isFetching) return 'syncing…'
  const synced = sync.fetchedAt ? `synced ${agoText(now - sync.fetchedAt)}` : ''
  if (sync.failedAt > sync.fetchedAt) return `${sync.lock ? `sync waits on ${sync.lock}` : 'sync failed'}${synced ? ` · ${synced}` : ''} ↻`
  if (synced) return `${synced} ↻`
  return sync.hasMain ? 'not synced yet ↻' : 'no origin/main ↻'
}
