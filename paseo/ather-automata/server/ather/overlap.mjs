// Ather Automata: open work that changes the same lines (overlap-check D1-D6). Which open intents'
// branches to compare, with the base branch and with each other, and what `git merge-tree` says of
// each pair: the files in conflict, where in them, and each side's first changed line. Ather Board
// draws it, and so does Needs you for this checkout's own branch (collide.mjs words both). Pure: git
// comes through a Repo (team.mjs) built where `$` lives. Every call here reads, never the working tree
// or the index; the one fetch writes only remote-tracking refs.

import { FETCH_TIMEOUT_MS, INTENTS, complaintOf, fetchArgs, slugOf } from './team.mjs'

/**
 * @typedef {import('./team.mjs').Repo} Repo
 * @typedef {{ key: string, branch: string, tip?: string }} Side a piece of open work and the branch it is on: an intent, or this checkout's
 *   branch with its own `tip` (collision-alert), which needs no copy on origin
 * @typedef {{ path: string, line: number, kind: 'lines' | 'binary' | 'deleted', ours: string, theirs: string }} Spot one place both sides changed.
 *   'lines': `line` is where it starts in the first side's file, `ours` and `theirs` each side's first changed line;
 *   'binary': a file git cannot merge by lines; 'deleted': one side deleted the file the other changed (`ours`, `theirs`: 'changed' or 'deleted')
 * @typedef {{ who: string, at: number, via: string[] }} BaseChange when the first side is the base: its last author and commit time on
 *   the files, and the intent folders the change that brought that commit into the base also wrote (overlap-hardening D2)
 * @typedef {{ files: string[], spots: Spot[], count: number, base: BaseChange | null }} Merge what merging two tips conflicts on:
 *   `count` every place, `spots` the first SPOTS_KEPT; `base`: null for two intents
 * @typedef {Merge & { key: string, a: string, b: string }} Overlap two sides that conflict: `a` an intent's key, or '' for the base branch
 *   (the base is always `a`), `b` an intent's key; `key`: pairKey(a, b)
 * @typedef {{ version: string, files: Map<string, string[]>, merges: Map<string, Merge | null> }} OverlapCache what earlier reads learned:
 *   git's version, each branch's changed files by "<base tip>...<tip>", each merge by "<tip>..<tip>" (null: it merges cleanly)
 * @typedef {{ overlaps: Overlap[], note: string, cache: OverlapCache, isPartial: boolean, compared: string[] }} OverlapRead `note`: why nothing could be checked,
 *   '' when it ran; `isPartial`: the time budget ran out first, so another run goes on from where this one stopped (overlap-hardening D1);
 *   `compared`: the sides this run merged with the base, so one with no overlap there merges cleanly (ship-pill D1)
 */

/** @type {OverlapCache} */
export const EMPTY_OVERLAPS = { version: '', files: new Map(), merges: new Map() }

// `git merge-tree --write-tree`, a merge with no working tree or index, arrived in git 2.38 (D4).
export const MIN_GIT = /** @type {const} */ ([2, 38])
// The places kept per pair; `count` says how many there are.
export const SPOTS_KEPT = 6
// How long one run may start new git work (overlap-hardening D1): past it, the run returns what it has and the next goes on.
export const BUDGET_MS = 15000

// "git version 2.43.0.windows.1" → [2, 43]; null when it is not git's answer.
/** @param {string} text @returns {[number, number] | null} */
export const gitVersion = text => {
  const found = /git version (\d+)\.(\d+)/.exec(text)
  return found ? [Number(found[1]), Number(found[2])] : null
}

/** @param {[number, number] | null} version */
export const canMergeTree = version => version !== null && (version[0] > MIN_GIT[0] || (version[0] === MIN_GIT[0] && version[1] >= MIN_GIT[1]))

// One key per pair whichever way round, the base's side ('') first.
/** @param {string} a @param {string} b */
export const pairKey = (a, b) => (a === '' || a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Which pairs to merge (D3): every side whose branch changed something, against the base; two sides only
 * when their branches change a file in common, so the merges stay near one per side. Two intents on one
 * branch are one piece of work.
 * @param {readonly Side[]} sides @param {ReadonlyMap<string, readonly string[]>} files each side's changed files, by its key
 * @returns {{ a: string, b: string }[]}
 */
export const pairsToCheck = (sides, files) => {
  const busy = sides.filter(side => (files.get(side.key) ?? []).length > 0)
  const across = busy.flatMap((one, at) => {
    const changed = new Set(files.get(one.key))
    return busy.slice(at + 1).filter(other => other.branch !== one.branch && (files.get(other.key) ?? []).some(path => changed.has(path))).map(other => (one.key < other.key ? { a: one.key, b: other.key } : { a: other.key, b: one.key }))
  })
  return [...busy.map(side => ({ a: '', b: side.key })), ...across]
}

/**
 * `git merge-tree --write-tree` output: the merged tree, each conflicted file's stages ("<mode> <sha> <stage>\t<path>":
 * 2 the first side, 3 the second), a blank line, then git's messages, which name the binary files it could not merge.
 * @param {string} text
 */
export const parseMergeTree = text => {
  const [head = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n')
  const blank = rest.indexOf('')
  /** @type {Map<string, Set<number>>} */
  const stages = new Map()
  for (const line of blank < 0 ? rest : rest.slice(0, blank)) {
    const staged = /^\d+ [0-9a-f]+ ([123])\t(.+)$/.exec(line)
    if (staged?.[2]) stages.set(staged[2], (stages.get(staged[2]) ?? new Set()).add(Number(staged[1])))
  }
  const binary = new Set((blank < 0 ? [] : rest.slice(blank + 1)).flatMap(line => /Cannot merge binary files: (.+) \(.+ vs\. .+\)$/.exec(line)?.slice(1, 2) ?? []))
  return { tree: head.trim(), stages, binary }
}

/** @param {readonly string[]} lines */
const firstLine = lines => (lines.find(line => line.trim() !== '') ?? '').trim().slice(0, 160)

/**
 * The places a conflicted file's markers mark, each with its line in the first side's file and each side's
 * first changed line. A diff3-style base section ("||||||| ") is skipped.
 * @param {string} path @param {string} text @returns {Spot[]}
 */
export const spotsIn = (path, text) => {
  /** @type {Spot[]} */
  const spots = []
  /** @type {Record<'ours' | 'base' | 'theirs', string[]>} */
  let parts = { ours: [], base: [], theirs: [] }
  /** @type {'' | keyof typeof parts} */
  let part = ''
  let line = 0
  let start = 0
  for (const one of text.replace(/\r\n/g, '\n').split('\n')) {
    if (one.startsWith('<<<<<<< ')) [part, parts, start] = ['ours', { ours: [], base: [], theirs: [] }, line + 1]
    else if (part && one.startsWith('||||||| ')) part = 'base'
    else if (part && one === '=======') part = 'theirs'
    else if (part && one.startsWith('>>>>>>> ')) {
      spots.push({ path, line: start, kind: 'lines', ours: firstLine(parts.ours), theirs: firstLine(parts.theirs) })
      part = ''
    } else {
      if (part) parts[part].push(one)
      // The first side's own lines count: outside a block, and its part of one.
      if (part === '' || part === 'ours') line += 1
    }
  }
  return spots
}

// Branch tips from lines of a tip then a name ("<sha> <name>", "<sha>\trefs/heads/<name>"): name → tip.
/** @param {string} text @param {RegExp} line its tip and name in groups 1 and 2 @returns {Map<string, string>} */
const tipsIn = (text, line) =>
  new Map(
    text.split('\n').flatMap(one => {
      const found = line.exec(one.trim())
      return found?.[1] && found[2] && found[2] !== 'HEAD' ? [/** @type {[string, string]} */ ([found[2], found[1]])] : []
    }),
  )

// The branches origin has as this clone last fetched them.
/** @param {Repo} repo */
const remoteTips = async repo => {
  const ran = await repo.git(['for-each-ref', '--format=%(objectname) %(refname:strip=3)', 'refs/remotes/origin'])
  return tipsIn(ran.exitCode === 0 ? ran.stdout : '', /^([0-9a-f]+) (.+)$/)
}

// What a branch changed since it left the base: the files of "<base>...<tip>".
/** @param {Repo} repo @param {string} base @param {string} tip */
const changedFiles = async (repo, base, tip) => {
  const ran = await repo.git(['diff', '--name-only', '-z', `${base}...${tip}`])
  return ran.exitCode === 0 ? ran.stdout.split('\0').filter(Boolean) : []
}

/**
 * Merges two tips with no working tree: null when they merge cleanly (or cannot be merged at all, such as
 * unrelated histories); else the places they conflict. `brought`: `ours` is the base, whose last change is named;
 * the intents behind each commit, kept for the run (several branches often collide with one change).
 * @param {Repo} repo @param {string} ours @param {string} theirs @param {Map<string, Promise<string[]>> | null} brought @returns {Promise<Merge | null>}
 */
const mergeOf = async (repo, ours, theirs, brought) => {
  const ran = await repo.git(['merge-tree', '--write-tree', ours, theirs])
  if (ran.exitCode !== 1) return null
  const { tree, stages, binary } = parseMergeTree(ran.stdout)
  /** @type {Spot[]} */
  const spots = []
  for (const [path, staged] of stages) {
    if (!staged.has(2) || !staged.has(3)) spots.push({ path, line: 0, kind: 'deleted', ours: staged.has(2) ? 'changed' : 'deleted', theirs: staged.has(3) ? 'changed' : 'deleted' })
    else {
      const merged = binary.has(path) ? null : await repo.git(['cat-file', '-p', `${tree}:${path}`])
      const found = merged?.exitCode === 0 ? spotsIn(path, merged.stdout) : []
      spots.push(...(found.length > 0 ? found : [{ path, line: 0, kind: /** @type {const} */ ('binary'), ours: '', theirs: '' }]))
    }
  }
  if (spots.length === 0) return null
  const files = [...stages.keys()]
  const kept = { files, spots: spots.slice(0, SPOTS_KEPT), count: spots.length }
  if (!brought) return { ...kept, base: null }
  const last = await repo.git(['log', '-1', '--format=%H%x09%an%x09%ct', ours, '--', ...files])
  const [sha = '', who = '', at = '0'] = last.exitCode === 0 ? last.stdout.trim().split('\t') : []
  if (sha && !brought.has(sha)) brought.set(sha, broughtBy(repo, sha, ours))
  return { ...kept, base: { who, at: Number(at) * 1000, via: sha ? await (brought.get(sha) ?? []) : [] } }
}

// The intent folders a list of paths names, each once ("docs/intent/hitstop-retune/progress.md" → "hitstop-retune").
/** @param {string} text one path a line */
export const intentsIn = text => [...new Set(text.split('\n').map(slugOf).filter(Boolean))]

// Where a commit reached the base's own line: the commit itself when it is on that line (the tip, or the line's next
// commit is its child), else the first commit of the line that contains it (a pull request's merge). '' when neither.
/** @param {string} sha @param {string} base @param {readonly string[][]} steps the line after it, oldest first, each with its parents @param {ReadonlySet<string>} descendants */
const landingOf = (sha, base, steps, descendants) => {
  const isOnLine = sha === base || steps[0]?.[1] === sha
  return isOnLine ? sha : (steps.find(([one = '']) => descendants.has(one))?.[0] ?? '')
}

/**
 * The intents that brought a commit into the base (overlap-hardening D2): the change on the base's own line that
 * brought it there (a pull request's merge, or the commit itself when it is on that line, a squash), and the intent
 * folders that change also wrote. A pull request that moved its intent's progress names it.
 * @param {Repo} repo @param {string} sha @param {string} base the base's tip
 */
const broughtBy = async (repo, sha, base) => {
  // The base's own line after the commit, oldest first, each with its parents; and every descendant of the commit.
  const [line, after] = await Promise.all([repo.git(['rev-list', '--first-parent', '--reverse', '--parents', `${sha}..${base}`]), repo.git(['rev-list', '--ancestry-path', `${sha}..${base}`])])
  const descendants = new Set(after.exitCode === 0 ? after.stdout.split('\n').map(one => one.trim()) : [])
  const steps = line.exitCode === 0 ? line.stdout.split('\n').map(one => one.trim().split(' ')).filter(one => one[0]) : []
  const landed = landingOf(sha, base, steps, descendants)
  if (!landed) return []
  const changed = await repo.git(['diff', '--name-only', `${landed}^1`, landed, '--', INTENTS])
  return changed.exitCode === 0 ? intentsIn(changed.stdout) : []
}

/**
 * The overlaps among the sides and the base branch, from what this clone has fetched (D3, D6). A branch
 * origin does not have (unless its side brings its own tip), or the base itself, is not compared. Each branch's files and each merge are kept by
 * their tips, so an unchanged pair is never merged twice. The git calls run one after another on purpose:
 * this runs in the background beside the person's own git, and a large checkout should feel none of it.
 * New git work starts only within `budgetMs` (overlap-hardening D1), counted from the first of it, so each run makes
 * some: past it, what was found is returned with `isPartial`, and the next run, given this run's cache, goes on.
 * @param {Repo} repo @param {{ base: string, sides: readonly Side[], cache: OverlapCache, budgetMs?: number, now?: () => number }} input
 * @returns {Promise<OverlapRead>}
 */
export const readOverlaps = async (repo, { base, sides, cache, budgetMs = BUDGET_MS, now = Date.now }) => {
  const version = cache.version || (await repo.git(['version'])).stdout.trim()
  const known = gitVersion(version)
  if (!canMergeTree(known)) return { overlaps: [], note: known ? `git ${known.join('.')} cannot check overlaps (needs ${MIN_GIT.join('.')})` : '', cache: { ...cache, version: known ? version : '' }, isPartial: false, compared: [] }
  const tips = await remoteTips(repo)
  const baseTip = tips.get(base)
  const present = sides.filter(side => side.branch !== base && (side.tip || tips.has(side.branch)))
  if (!baseTip || present.length === 0) return { overlaps: [], note: '', cache: { version, files: new Map(), merges: new Map() }, isPartial: false, compared: [] }
  /** @type {Map<string, string>} each side's tip, and the base's under '' */
  const tipOf = new Map([['', baseTip], ...present.map(side => /** @type {[string, string]} */ ([side.key, side.tip || (tips.get(side.branch) ?? '')]))])
  const tip = (/** @type {string} */ key) => tipOf.get(key) ?? ''
  const started = now()
  const isOver = () => now() - started > budgetMs
  // Each side's changed files, from the cache or read while the budget lasts; the sides read are the ones compared.
  const files = new Map()
  /** @type {Map<string, string[]>} */
  const byKey = new Map()
  for (const side of present) {
    const id = `${baseTip}...${tip(side.key)}`
    const list = cache.files.get(id) ?? (isOver() ? null : await changedFiles(repo, baseTip, tip(side.key)))
    if (list) {
      files.set(id, list)
      byKey.set(side.key, list)
    }
  }
  const pairs = pairsToCheck(present.filter(side => byKey.has(side.key)), byKey)
  const merges = new Map()
  /** @type {Map<string, Promise<string[]>>} */
  const brought = new Map()
  /** @type {Overlap[]} */
  const overlaps = []
  /** @type {string[]} */
  const compared = []
  for (const { a, b } of pairs) {
    const id = `${tip(a)}..${tip(b)}`
    if (!cache.merges.has(id) && isOver()) continue
    const merged = cache.merges.has(id) ? (cache.merges.get(id) ?? null) : await mergeOf(repo, tip(a), tip(b), a === '' ? brought : null)
    merges.set(id, merged)
    if (a === '') compared.push(b)
    if (merged) overlaps.push({ key: pairKey(a, b), a, b, ...merged })
  }
  return { overlaps, note: '', cache: { version, files, merges }, isPartial: byKey.size < present.length || merges.size < pairs.length, compared }
}

/**
 * The overlap check as a background job, one run at a time (D6): asked for while one runs, one more follows it,
 * with the newest ask's `read` and `onRun`; a run that ran out of time (overlap-hardening D1) is followed by the
 * next. Each run goes on from the last one's cache, and `onRun` hears it (to draw what it found). The promise
 * settles with the last run's answer once no run is left, or with the error that stopped it.
 * @returns {{ run: (read: (cache: OverlapCache) => Promise<OverlapRead>, onRun: (read: OverlapRead) => void) => Promise<OverlapRead>, last: () => OverlapRead }}
 */
export const overlapJob = () => {
  /** @type {OverlapRead} */
  let last = { overlaps: [], note: '', cache: EMPTY_OVERLAPS, isPartial: false, compared: [] }
  /** @type {Promise<OverlapRead> | null} */
  let running = null
  /** @type {{ read: (cache: OverlapCache) => Promise<OverlapRead>, onRun: (read: OverlapRead) => void } | null} */
  let asked = null
  return {
    run: (read, onRun) => {
      if (running) {
        asked = { read, onRun }
        return running
      }
      running = (async () => {
        try {
          for (let ask = { read, onRun }; ; ask = asked ?? ask) {
            asked = null
            last = await ask.read(last.cache)
            ask.onRun(last)
            if (!asked && !last.isPartial) return last
          }
        } finally {
          running = null
        }
      })()
      return running
    },
    last: () => last,
  }
}

/**
 * Brings the open intents' branches up to date in their remote-tracking refs: asks origin where each is
 * (one ls-remote), then fetches the ones that moved in one fetch, with the base's flags (no tags, no
 * FETCH_HEAD, no gc). A branch origin does not have is left alone. '' when done, else git's last line.
 * @param {Repo} repo @param {readonly string[]} branches
 */
export const fetchBranches = async (repo, branches) => {
  if (branches.length === 0) return ''
  const listed = await repo.git(['ls-remote', '--heads', 'origin'], { timeoutMs: FETCH_TIMEOUT_MS })
  if (listed.exitCode !== 0) return complaintOf(listed, 'git ls-remote')
  const origin = tipsIn(listed.stdout, /^([0-9a-f]+)\trefs\/heads\/(.+)$/)
  const local = await remoteTips(repo)
  const moved = [...new Set(branches)].filter(branch => origin.has(branch) && origin.get(branch) !== local.get(branch))
  if (moved.length === 0) return ''
  const ran = await repo.git(fetchArgs(...moved), { timeoutMs: FETCH_TIMEOUT_MS })
  return ran.exitCode === 0 ? '' : complaintOf(ran, 'git fetch')
}
