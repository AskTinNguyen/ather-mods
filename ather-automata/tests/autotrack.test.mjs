// @ts-check
// Auto-track (docs/intent/auto-track): a session tracks the intent it works on by itself. One describe per
// Acceptance row of that intent (A1, a worker's write, is the hooks' alone); the hooks' side of every row (a worker's
// write, a commit, an answer, the tick) is in dev/e2e/repos.mjs.
import { describe, expect, test } from 'claude-code/testing'

import { AUTO_SWITCH_MS, autoTrackText, autoUntrackText, mayTake } from '../hooks/autotrack.mjs'
import { intentFolderOf, intentRootIn } from '../hooks/changes.mjs'
import { answeredIntentOf, decidePrompt, explainPrompt } from '../hooks/decide.mjs'
import { isClosedStatus, statusOf } from '../hooks/model.mjs'
import { commitIntentOf } from '../hooks/shell.mjs'
import * as state from '../hooks/state.mjs'
import { isSameFolder } from '../hooks/workspace.mjs'

const MIN = 60 * 1000

// An in-memory Io over one store and one set of files; `R` is the session's root. `lists` counts folder listings
// (reading the peers' heartbeats is one). Paths are found in any case, as on Windows.
const memoryIo = (sid = 's1') => {
  const store = new Map()
  /** @type {Map<string, string>} */
  const files = new Map()
  const seen = { lists: 0 }
  const find = (/** @type {string} */ path) => [...files.keys()].find(one => one.toLowerCase() === path.toLowerCase())
  return {
    store,
    files,
    seen,
    // The branch every checkout is on, as auto-track's `branchOf` reads it.
    branch: 'main',
    io: {
      get: async (/** @type {string} */ key) => store.get(key),
      set: async (/** @type {string} */ key, /** @type {unknown} */ value) => void store.set(key, JSON.parse(JSON.stringify(value))),
      remove: async (/** @type {string} */ key) => void store.delete(key),
      keys: async () => [...store.keys()],
      read: async (/** @type {string} */ path) => files.get(find(path) ?? '') ?? null,
      write: async (/** @type {string} */ path, /** @type {string} */ text) => void files.set(path, text),
      exists: async (/** @type {string} */ path) => find(path) !== undefined,
      sessionId: async () => sid,
      root: async () => 'R',
      gitUser: async () => 'Tin Nguyen',
      redraw: () => undefined,
      list: async (/** @type {string} */ dir) => {
        seen.lists += 1
        return [...files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => ({ name: path.slice(dir.length + 1), kind: 'file', mtimeMs: Date.now() }))
      },
    },
  }
}

/** @param {string} status */
const promptWith = status => `# Intent\n\n- Rev: 1\n- Status: ${status}\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: It works.\n`

// A session in the checkout R with intents `a`, `b` and `c` (active), `done` (completed) and `held` (parked).
const withIntents = (sid = 's1') => {
  const memory = memoryIo(sid)
  memory.files.set('R/.git/HEAD', 'ref: refs/heads/main\n')
  for (const [slug, status] of [['a', 'active'], ['b', 'active'], ['c', 'active'], ['done', 'completed'], ['held', 'parked: waiting on art']]) memory.files.set(`R/docs/intent/${slug}/prompt.md`, promptWith(status))
  return memory
}
/** @typedef {ReturnType<typeof memoryIo>} Memory */
// Work on an intent, as the hooks hand it over.
/** @param {Memory} memory @param {string} slug @param {{ root?: string, isNew?: boolean }} [at] */
const work = (memory, slug, { root = 'R', isNew = false } = {}) => state.autoTrack(memory.io, root, slug, { isNew, branchOf: async () => memory.branch })
/** @param {Memory} memory */
const tick = memory => state.untrackClosed(memory.io, async () => memory.branch)
/** @param {Memory} memory @param {number} minutes */
const lastWorkedAgo = (memory, minutes) => memory.store.set('pinMeta:s1', { ...(/** @type {object} */ (memory.store.get('pinMeta:s1'))), at: Date.now() - minutes * MIN })
const BASE = { hasPin: true, meta: { at: 0, isAuto: true }, isAway: false, isNew: false, now: AUTO_SWITCH_MS }

describe('auto-track A2: any file in the intent folder counts, in a checkout of its own', () => {
  test('any file under docs/intent/<slug>/ names its intent; files beside the folders do not', () => {
    expect(intentFolderOf('E:/S2/docs/intent/spawner/prompt.md')).toEqual({ slug: 'spawner', file: 'prompt.md', root: 'E:/S2' })
    expect(intentFolderOf('docs\\intent\\spawner\\progress.md')).toEqual({ slug: 'spawner', file: 'progress.md', root: '' })
    expect(intentFolderOf('/w/web/docs/intent/spawner/proof/A1.png')).toEqual({ slug: 'spawner', file: 'proof/a1.png', root: '/w/web' })
    for (const other of ['docs/intent/README.md', 'docs/intent/spawner/', 'docs/intents/spawner/prompt.md', 'src/a.js', 42]) expect(intentFolderOf(other)).toBe(null)
  })
  test('the checkout a file lands in: a Windows path with backslashes as written, a relative one from the session folder', () => {
    expect(intentRootIn('D:\\W\\s2\\docs\\intent\\x\\notes\\a.md', '/elsewhere')).toBe('D:/W/s2')
    expect(intentRootIn('../web/docs/intent/x/a.md', '/w/s2')).toBe('/w/web')
    expect(intentRootIn('docs/intent/x/prompt.md', 'D:\\W\\s2')).toBe('D:/W/s2')
    expect(intentRootIn('src/a.js', '/w/s2')).toBe(null)
  })
  test('work on an intent with nothing tracked takes it, and says so with the way back', async () => {
    const memory = withIntents()
    expect(await work(memory, 'a')).toBe(true)
    expect(memory.store.get('pinned:s1')).toBe('a')
    expect(memory.store.get('pinMeta:s1')).toEqual({ isAuto: true, branch: 'main', at: /** @type {{ at: number }} */ (memory.store.get('pinMeta:s1')).at })
    expect(autoTrackText('a')).toBe('Now tracking a: this session works on it. /ather untrack stops that.')
    expect(await work(memory, 'nope')).toBe(false)
  })
  test('an intent folder in no checkout of its own (a temp draft, a scratch copy inside a checkout) is never taken; tracking it on purpose still works', async () => {
    const memory = withIntents()
    memory.files.set('T/docs/intent/draft/prompt.md', promptWith('active'))
    memory.files.set('R/Saved/tmp/docs/intent/draft/prompt.md', promptWith('active'))
    expect(await work(memory, 'draft', { root: 'T' })).toBe(false)
    expect(await work(memory, 'draft', { root: 'R/Saved/tmp' })).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect(await state.track(memory.io, 'T', 'draft')).toBe(true)
  })
})

describe('auto-track A3: an intent(<slug>) commit counts', () => {
  test("the last commit's first message starting with intent(<slug>), with the folder it runs in", () => {
    expect(commitIntentOf('git commit -m "intent(auto-track): rev 1"')).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf("git add -A && git commit -q -m 'intent(auto-track): x'")).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf('git commit -m "$(cat <<\'EOF\'\nintent(auto-track): rev 1\n\nCo-Authored-By: x\nEOF\n)"')).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf("git commit -m @'\nintent(auto-track): rev\n'@")).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf('cd ../web && git commit -am "intent(login): x"')).toEqual({ slug: 'login', folder: '../web' })
    expect(commitIntentOf('git -C ../web commit --message="intent(login): x"')).toEqual({ slug: 'login', folder: '../web' })
    expect(commitIntentOf('git commit -m "feat: x"; git commit --amend -m "intent(login): y"')).toEqual({ slug: 'login', folder: null })
  })
  test('anything else is no intent commit, nor one whose outcome the command hides', () => {
    const others = [
      'git commit -m "feat(x): y" -m "intent(login): z"',
      'git commit -m "feat(ather-automata): intent(login)"',
      'git log --grep "intent(login)"',
      'echo git commit -m "intent(login)"',
      'echo "git commit -m intent(x)" && git commit -m "feat"',
      'git commit --amend --no-edit',
      'git commit -F msg.txt && git tag -a v1 -m "intent(foo): x"',
      'git status; git commit --no-edit; git tag -m "intent(bar)" t',
      'git commit-tree HEAD^{tree} -m "intent(foo): x"',
      'git commit --dry-run -m "intent(login): x"',
      'git commit -m "intent(login): x" || true',
      'git commit -m "intent(login): a" && git commit -m "feat: b"',
    ]
    for (const command of others) expect(commitIntentOf(command)).toBe(null)
    // An || inside the message is text, not an outcome hidden.
    expect(commitIntentOf('git commit -m "intent(login): a || b"')).toEqual({ slug: 'login', folder: null })
  })
})

describe('auto-track A4: a switch waits 30 minutes', () => {
  test('work on another intent takes over only after the tracked one had no work from this session for 30 min', async () => {
    const memory = withIntents()
    await work(memory, 'a')
    lastWorkedAgo(memory, 29)
    expect(await work(memory, 'b')).toBe(false)
    expect(memory.store.get('pinned:s1')).toBe('a')
    lastWorkedAgo(memory, 31)
    expect(await work(memory, 'a')).toBe(false)
    expect(await work(memory, 'b')).toBe(false)
    lastWorkedAgo(memory, 31)
    expect(await work(memory, 'b')).toBe(true)
    expect(memory.store.get('pinned:s1')).toBe('b')
  })
  test('a deliberate track counts as work when it is made, and stays deliberate when worked on', async () => {
    const memory = withIntents()
    await state.track(memory.io, 'R', 'a')
    expect(await work(memory, 'b')).toBe(false)
    await work(memory, 'a')
    expect(/** @type {{ isAuto: boolean }} */ (memory.store.get('pinMeta:s1')).isAuto).toBe(false)
  })
  test('one intent written two ways (case, slashes) is the same intent: its time is noted, nothing is taken', async () => {
    const memory = withIntents()
    memory.files.set('D:/W/web/.git/HEAD', 'ref: refs/heads/main\n')
    memory.files.set('D:/W/web/docs/intent/login/prompt.md', promptWith('active'))
    expect(await work(memory, 'login', { root: 'D:/W/web' })).toBe(true)
    lastWorkedAgo(memory, 40)
    expect(await work(memory, 'login', { root: 'd:\\w\\web\\' })).toBe(false)
    expect(Date.now() - /** @type {{ at: number }} */ (memory.store.get('pinMeta:s1')).at < MIN).toBe(true)
    expect(memory.store.get('pinned:s1')).toEqual({ slug: 'login', root: 'D:/W/web' })
    expect(isSameFolder('d:\\w\\web\\', 'D:/W/web')).toBe(true)
  })
  test('an intent this session just started takes over at once; nothing is taken while an away window runs', async () => {
    expect(mayTake({ ...BASE, now: 1, isNew: true })).toBe(true)
    expect(mayTake({ ...BASE, now: 1 })).toBe(false)
    expect(mayTake({ ...BASE, isAway: true })).toBe(false)
    expect(mayTake({ ...BASE, isAway: true, isNew: true })).toBe(false)
    expect(mayTake({ ...BASE, hasPin: false, isAway: true })).toBe(false)
    expect(mayTake({ ...BASE, meta: null, now: Date.now() })).toBe(true)
    const memory = withIntents()
    memory.store.set('away:s1', { phase: 'running', wakeAt: Date.now() + 60 * MIN })
    expect(await work(memory, 'a')).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
  })
  test('what blocks an intent is read only once the cheap rules let it through', async () => {
    const memory = withIntents()
    await work(memory, 'a')
    const lists = memory.seen.lists
    expect(await work(memory, 'b')).toBe(false)
    expect(memory.seen.lists).toBe(lists)
  })
})

describe('auto-track A5: never takes an intent another live session tracks, nor a closed one', () => {
  test("a live peer's heartbeat naming the intent keeps it from this session; an ended one does not", async () => {
    const memory = withIntents()
    const { localDir } = (await state.laneAt(memory.io, 'R')).pack
    const peer = (/** @type {boolean} */ hasEnded) => memory.files.set(`R/${localDir}/lanes/s2.json`, JSON.stringify({ sessionId: 's2', intent: 'a', branch: 'main', updatedAt: Date.now(), away: 'off', hasEnded }))
    peer(false)
    expect(await work(memory, 'a')).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect(await state.track(memory.io, 'R', 'a')).toBe(true)
    await state.untrack(memory.io, 'Tin Nguyen')
    expect(await work(memory, 'b')).toBe(true)
    peer(true)
    lastWorkedAgo(memory, 31)
    memory.store.delete('untracked:s1')
    expect(await work(memory, 'a')).toBe(true)
  })
  test('a closed intent is never taken', async () => {
    const memory = withIntents()
    expect(await work(memory, 'done')).toBe(false)
    expect(await work(memory, 'held')).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect([statusOf(promptWith('parked: waiting on art')), statusOf('# x')]).toEqual(['parked', 'unknown'])
    expect([isClosedStatus('completed'), isClosedStatus('parked'), isClosedStatus('active'), isClosedStatus('unknown')]).toEqual([true, true, false, false])
  })
})

describe('auto-track A6: auto-untrack when the intent is completed or parked', () => {
  test("an auto pin goes when its intent's status closes it; the proof stays and no stop is left", async () => {
    const memory = withIntents()
    await work(memory, 'a')
    expect(await tick(memory)).toBe(null)
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('completed'))
    expect(await tick(memory)).toEqual({ slug: 'a', back: '' })
    expect([memory.store.has('pinned:s1'), memory.store.has('pinMeta:s1'), memory.store.has('untracked:s1')]).toEqual([false, false, false])
    expect(autoUntrackText({ slug: 'a', back: '' })).toBe('Stopped tracking a: it is completed or parked.')
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('active'))
    expect(await work(memory, 'a')).toBe(true)
  })
  test('the status is read on the branch the pin was taken on: on another branch the pin waits', async () => {
    const memory = withIntents()
    memory.branch = 'feat/a'
    await work(memory, 'a')
    memory.branch = 'main'
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('completed'))
    expect(await tick(memory)).toBe(null)
    expect(memory.store.get('pinned:s1')).toBe('a')
    memory.branch = 'feat/a'
    expect(await tick(memory)).toEqual({ slug: 'a', back: '' })
  })
  test('the deliberate pin an auto pin replaced comes back when that one is let go, through a chain of auto pins', async () => {
    const memory = withIntents()
    await state.track(memory.io, 'R', 'a')
    lastWorkedAgo(memory, 31)
    expect(await work(memory, 'b')).toBe(true)
    lastWorkedAgo(memory, 31)
    expect(await work(memory, 'c')).toBe(true)
    memory.files.set('R/docs/intent/c/prompt.md', promptWith('parked: later'))
    expect(await tick(memory)).toEqual({ slug: 'c', back: 'a' })
    expect(memory.store.get('pinned:s1')).toBe('a')
    expect(/** @type {{ isAuto: boolean }} */ (memory.store.get('pinMeta:s1')).isAuto).toBe(false)
    expect(autoUntrackText({ slug: 'c', back: 'a' })).toBe('Stopped tracking c: it is completed or parked. Back to a.')
  })
  test('a deliberate track stays when its intent closes, and so does any pin while an away window runs', async () => {
    const memory = withIntents()
    await state.track(memory.io, 'R', 'a')
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('parked: waiting'))
    expect(await tick(memory)).toBe(null)
    expect(memory.store.get('pinned:s1')).toBe('a')
    await state.untrack(memory.io, 'Tin Nguyen')
    memory.store.delete('untracked:s1')
    await work(memory, 'b')
    memory.store.set('away:s1', { phase: 'running', wakeAt: Date.now() + 60 * MIN })
    memory.files.set('R/docs/intent/b/prompt.md', promptWith('completed'))
    expect(await tick(memory)).toBe(null)
    expect(memory.store.get('pinned:s1')).toBe('b')
  })
})

describe('auto-track A7: an untrack stop is respected', () => {
  test('work on an intent the person untracked in this session never pins it again; another intent still does', async () => {
    const memory = withIntents()
    await work(memory, 'a')
    await state.untrack(memory.io, 'Tin Nguyen')
    expect(await work(memory, 'a')).toBe(false)
    expect(await work(memory, 'a', { isNew: true })).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect(await work(memory, 'b')).toBe(true)
  })
  test('a stop holds whichever way its folder is written', async () => {
    const memory = withIntents()
    memory.files.set('D:/W/web/.git/HEAD', 'ref: refs/heads/main\n')
    memory.files.set('D:/W/web/docs/intent/login/prompt.md', promptWith('active'))
    await work(memory, 'login', { root: 'D:/W/web' })
    await state.untrack(memory.io, 'Tin Nguyen')
    expect(await work(memory, 'login', { root: 'd:\\w\\web' })).toBe(false)
  })
  test('the pin and its time move with the lane after /clear, and prune removes them with an ended lane', async () => {
    const memory = withIntents()
    await work(memory, 'a')
    await state.moveLane(memory.io, 's1', 's9')
    expect([memory.store.has('pinMeta:s1'), memory.store.has('pinMeta:s9')]).toEqual([false, true])
    await state.prune(memory.io, async sid => sid === 's9')
    expect([memory.store.has('pinned:s9'), memory.store.has('pinMeta:s9')]).toEqual([false, false])
  })
})

describe('auto-track A8: answering a decision is not work on its intent', () => {
  test('a Needs you answer names its intent; explaining one, or any other prompt, does not', () => {
    expect(answeredIntentOf(decidePrompt('kawaii-physics', 'F-1', 'A — drops only'))).toBe('kawaii-physics')
    expect(answeredIntentOf(explainPrompt('kawaii-physics', 'F-1'))).toBe(null)
    expect(answeredIntentOf('Fix the login form')).toBe(null)
  })
})
