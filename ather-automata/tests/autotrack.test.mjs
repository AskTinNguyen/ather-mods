// @ts-check
// Auto-track (docs/intent/auto-track): a session tracks the intent it works on by itself. One describe per
// Acceptance row of that intent (A1, a worker's write, is the hooks' alone); the hooks' side of every row (a worker's
// write, a commit, the tick) is in dev/e2e/repos.mjs.
import { describe, expect, test } from 'claude-code/testing'

import { AUTO_SWITCH_MS, autoTrackText, autoUntrackText, mayTake } from '../hooks/autotrack.mjs'
import { intentFolderOf } from '../hooks/changes.mjs'
import { isClosedStatus, statusOf } from '../hooks/model.mjs'
import { commitIntentOf } from '../hooks/shell.mjs'
import * as state from '../hooks/state.mjs'

const MIN = 60 * 1000

// An in-memory Io over one store and one set of files; `R` is the session's root.
const memoryIo = (sid = 's1') => {
  const store = new Map()
  const files = new Map()
  return {
    store,
    files,
    io: {
      get: async (/** @type {string} */ key) => store.get(key),
      set: async (/** @type {string} */ key, /** @type {unknown} */ value) => void store.set(key, JSON.parse(JSON.stringify(value))),
      remove: async (/** @type {string} */ key) => void store.delete(key),
      keys: async () => [...store.keys()],
      read: async (/** @type {string} */ path) => files.get(path) ?? null,
      write: async (/** @type {string} */ path, /** @type {string} */ text) => void files.set(path, text),
      exists: async (/** @type {string} */ path) => files.has(path),
      sessionId: async () => sid,
      root: async () => 'R',
      gitUser: async () => 'Tin Nguyen',
      redraw: () => undefined,
      list: async (/** @type {string} */ dir) => [...files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => ({ name: path.slice(dir.length + 1), kind: 'file', mtimeMs: Date.now() })),
    },
  }
}

/** @param {string} status */
const promptWith = status => `# Intent\n\n- Rev: 1\n- Status: ${status}\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: It works.\n`

// A session in R with intents `a` and `b` (active), `done` (completed) and `held` (parked).
const withIntents = (sid = 's1') => {
  const memory = memoryIo(sid)
  for (const [slug, status] of [['a', 'active'], ['b', 'active'], ['done', 'completed'], ['held', 'parked: waiting on art']]) memory.files.set(`R/docs/intent/${slug}/prompt.md`, promptWith(status))
  return memory
}
/** @param {{ store: Map<string, unknown> }} memory @param {number} minutes */
const lastWorkedAgo = (memory, minutes) => memory.store.set('pinMeta:s1', { ...(/** @type {object} */ (memory.store.get('pinMeta:s1'))), at: Date.now() - minutes * MIN })
const BASE = { hasPin: true, meta: { at: 0, isAuto: true }, isBlocked: false, isAway: false, isNew: false, now: AUTO_SWITCH_MS }

describe('auto-track A2: any file in the intent folder counts', () => {
  test('any file under docs/intent/<slug>/ names its intent; files beside the folders do not', () => {
    expect(intentFolderOf('E:/S2/docs/intent/spawner/prompt.md')).toEqual({ slug: 'spawner', file: 'prompt.md', root: 'E:/S2' })
    expect(intentFolderOf('docs\\intent\\spawner\\progress.md')).toEqual({ slug: 'spawner', file: 'progress.md', root: '' })
    expect(intentFolderOf('/w/web/docs/intent/spawner/proof/A1.png')).toEqual({ slug: 'spawner', file: 'proof/a1.png', root: '/w/web' })
    expect(intentFolderOf('docs/intent/spawner/findings.md')).toEqual({ slug: 'spawner', file: 'findings.md', root: '' })
    for (const other of ['docs/intent/README.md', 'docs/intent/spawner/', 'docs/intents/spawner/prompt.md', 'src/a.js', 42]) expect(intentFolderOf(other)).toBe(null)
  })
  test('work on an intent with nothing tracked takes it, and says so with the way back', async () => {
    const memory = withIntents()
    expect(await state.autoTrack(memory.io, 'R', 'a')).toBe(true)
    expect(memory.store.get('pinned:s1')).toBe('a')
    expect(/** @type {{ isAuto: boolean }} */ (memory.store.get('pinMeta:s1')).isAuto).toBe(true)
    expect(autoTrackText('a')).toBe('Now tracking a: this session works on it. /ather untrack stops that.')
    // An intent folder that does not exist is no intent.
    expect(await state.autoTrack(memory.io, 'R', 'nope')).toBe(false)
  })
})

describe('auto-track A3: an intent(<slug>) commit counts', () => {
  test('a commit whose first message starts with intent(<slug>), with the folder it runs in', () => {
    expect(commitIntentOf('git commit -m "intent(auto-track): rev 1"')).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf("git add -A && git commit -q -m 'intent(auto-track): x'")).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf('git commit -m "$(cat <<\'EOF\'\nintent(auto-track): rev 1\n\nCo-Authored-By: x\nEOF\n)"')).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf("git commit -m @'\nintent(auto-track): rev\n'@")).toEqual({ slug: 'auto-track', folder: null })
    expect(commitIntentOf('cd ../web && git commit -am "intent(login): x"')).toEqual({ slug: 'login', folder: '../web' })
    expect(commitIntentOf('git -C ../web commit --message="intent(login): x"')).toEqual({ slug: 'login', folder: '../web' })
  })
  test('anything else is no intent commit', () => {
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
    ]
    for (const command of others) expect(commitIntentOf(command)).toBe(null)
  })
})

describe('auto-track A4: a switch waits 30 minutes', () => {
  test('work on another intent takes over only after the tracked one had no work from this session for 30 min', async () => {
    const memory = withIntents()
    await state.autoTrack(memory.io, 'R', 'a')
    lastWorkedAgo(memory, 29)
    expect(await state.autoTrack(memory.io, 'R', 'b')).toBe(false)
    expect(memory.store.get('pinned:s1')).toBe('a')
    // Work on the tracked one starts its 30 minutes again.
    lastWorkedAgo(memory, 31)
    expect(await state.autoTrack(memory.io, 'R', 'a')).toBe(false)
    expect(await state.autoTrack(memory.io, 'R', 'b')).toBe(false)
    lastWorkedAgo(memory, 31)
    expect(await state.autoTrack(memory.io, 'R', 'b')).toBe(true)
    expect(memory.store.get('pinned:s1')).toBe('b')
  })
  test('a deliberate track counts as work when it is made, and stays deliberate when worked on', async () => {
    const memory = withIntents()
    await state.track(memory.io, 'R', 'a')
    expect(await state.autoTrack(memory.io, 'R', 'b')).toBe(false)
    await state.autoTrack(memory.io, 'R', 'a')
    expect(/** @type {{ isAuto: boolean }} */ (memory.store.get('pinMeta:s1')).isAuto).toBe(false)
  })
  test('an intent this session just started takes over at once; a pin never moves while an away window runs', () => {
    expect(mayTake({ ...BASE, now: 1, isNew: true })).toBe(true)
    expect(mayTake({ ...BASE, now: 1 })).toBe(false)
    expect(mayTake({ ...BASE, isAway: true })).toBe(false)
    expect(mayTake({ ...BASE, isAway: true, isNew: true })).toBe(false)
    expect(mayTake({ ...BASE, hasPin: false, isAway: true })).toBe(true)
    expect(mayTake({ ...BASE, hasPin: false, isBlocked: true })).toBe(false)
    // A pin from before 0.7.0 has no time: it counts as idle.
    expect(mayTake({ ...BASE, meta: null, now: Date.now() })).toBe(true)
  })
})

describe('auto-track A5: never takes an intent another live session tracks', () => {
  test("a live peer's heartbeat naming the intent keeps it from this session; an ended one does not", async () => {
    const memory = withIntents()
    // Where heartbeats are in R: its pack's folder, as the store reads R.
    const { localDir } = (await state.laneAt(memory.io, 'R')).pack
    const peer = (/** @type {boolean} */ hasEnded) => memory.files.set(`R/${localDir}/lanes/s2.json`, JSON.stringify({ sessionId: 's2', intent: 'a', branch: 'main', updatedAt: Date.now(), away: 'off', hasEnded }))
    peer(false)
    expect(await state.autoTrack(memory.io, 'R', 'a')).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    // Tracking it on purpose still works: a second session on an intent is shown, not prevented (track-guard).
    expect(await state.track(memory.io, 'R', 'a')).toBe(true)
    await state.untrack(memory.io, 'Tin Nguyen')
    expect(await state.autoTrack(memory.io, 'R', 'b')).toBe(true)
    peer(true)
    lastWorkedAgo(memory, 31)
    memory.store.delete('untracked:s1')
    expect(await state.autoTrack(memory.io, 'R', 'a')).toBe(true)
  })
  test('a closed intent is never taken', async () => {
    const memory = withIntents()
    expect(await state.autoTrack(memory.io, 'R', 'done')).toBe(false)
    expect(await state.autoTrack(memory.io, 'R', 'held')).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect([statusOf(promptWith('parked: waiting on art')), statusOf('# x')]).toEqual(['parked', 'unknown'])
    expect([isClosedStatus('completed'), isClosedStatus('parked'), isClosedStatus('active'), isClosedStatus('unknown')]).toEqual([true, true, false, false])
  })
})

describe('auto-track A6: auto-untrack when the intent is completed or parked', () => {
  test("an auto pin goes when its intent's status closes it; the proof stays and no stop is left", async () => {
    const memory = withIntents()
    await state.autoTrack(memory.io, 'R', 'a')
    expect(await state.untrackClosed(memory.io)).toBe('')
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('completed'))
    expect(await state.untrackClosed(memory.io)).toBe('a')
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect(memory.store.has('pinMeta:s1')).toBe(false)
    expect(memory.store.has('untracked:s1')).toBe(false)
    expect(autoUntrackText('a')).toBe('Stopped tracking a: it is completed or parked.')
    // Reopened, work on it takes it again.
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('active'))
    expect(await state.autoTrack(memory.io, 'R', 'a')).toBe(true)
  })
  test('a deliberate track stays when its intent closes, and so does any pin while an away window runs', async () => {
    const memory = withIntents()
    await state.track(memory.io, 'R', 'a')
    memory.files.set('R/docs/intent/a/prompt.md', promptWith('parked: waiting'))
    expect(await state.untrackClosed(memory.io)).toBe('')
    expect(memory.store.get('pinned:s1')).toBe('a')
    await state.untrack(memory.io, 'Tin Nguyen')
    memory.store.delete('untracked:s1')
    await state.autoTrack(memory.io, 'R', 'b')
    memory.store.set('away:s1', { phase: 'running', wakeAt: Date.now() + 60 * MIN })
    memory.files.set('R/docs/intent/b/prompt.md', promptWith('completed'))
    expect(await state.untrackClosed(memory.io)).toBe('')
    expect(memory.store.get('pinned:s1')).toBe('b')
  })
})

describe('auto-track A7: an untrack stop is respected', () => {
  test('work on an intent the person untracked in this session never pins it again; another intent still does', async () => {
    const memory = withIntents()
    await state.autoTrack(memory.io, 'R', 'a')
    await state.untrack(memory.io, 'Tin Nguyen')
    expect(await state.autoTrack(memory.io, 'R', 'a')).toBe(false)
    expect(await state.autoTrack(memory.io, 'R', 'a', true)).toBe(false)
    expect(memory.store.has('pinned:s1')).toBe(false)
    expect(await state.autoTrack(memory.io, 'R', 'b')).toBe(true)
  })
  test('the pin and its time move with the lane after /clear, and prune removes them with an ended lane', async () => {
    const memory = withIntents()
    await state.autoTrack(memory.io, 'R', 'a')
    await state.moveLane(memory.io, 's1', 's9')
    expect([memory.store.has('pinMeta:s1'), memory.store.has('pinMeta:s9')]).toEqual([false, true])
    await state.prune(memory.io, async sid => sid === 's9')
    expect([memory.store.has('pinned:s9'), memory.store.has('pinMeta:s9')]).toEqual([false, false])
  })
})
