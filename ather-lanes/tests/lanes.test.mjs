// @ts-check
// Ather Lanes' pure half on a made-up machine (fixtures/machine.mjs): every reader on good and bad input (A1), the
// records keep Status' kind (A1), slots read as Ather reads the Editor pointer (A2 i), and the pane's lines follow
// design.md at 72 and 110 columns (A3): its sections and their members, no line over the width, lime only in For
// you and amber only on A look's reasons, a quiet lane absent until the fold opens.
import { describe, expect, test } from 'claude-code/testing'

import { AMBER, LIME, QUIET } from '../hooks/ather/rows.mjs'
import { parseEditorLock } from '../hooks/ather/packs/unreal.mjs'
import { checkoutOf } from '../hooks/ather/workspace.mjs'
import { BEHIND_LIMIT, HERE, boardOf, foldText, lineText, sectionOf, summaryText } from '../hooks/board.mjs'
import { lineCells, paneLines } from '../hooks/pane.mjs'
import { NO_SOURCES, beatsOf, fullData, fullOf, intentOf, laneBranches, laneOf, laneRecords, statusOfFiles } from '../hooks/records.mjs'
import { laneZeroOf, prListArgs, readLaneBeat, readOrigin, readPrs, readReflogTime, readRefs, readSessionBeat, readSidecar, readSlot, readStatus } from '../hooks/sources.mjs'
import * as M from './fixtures/machine.mjs'

/** @param {Record<string, string>} files */
const slotsOf = files => Object.entries(files).map(([id, text]) => readSlot(id, text, M.NOW_MINUTES)).filter(one => one !== null)

// The sources as index.mjs builds them from the fixture machine’s files, through the same builders.
/** @param {{ slots?: Record<string, string>, prs?: boolean }} [options] @returns {import('../hooks/records.mjs').Sources} */
const sourcesOf = ({ slots = M.SLOTS, prs = true } = {}) => {
  const status = readStatus(M.STATUS)
  const lanes = status?.lanes ?? []
  const sessions = /** @type {Record<string, string>} */ (M.SESSION_BEATS)
  const intents = /** @type {Record<string, { prompt: string, findings: string }>} */ (M.INTENTS)
  return {
    status,
    slots: slotsOf(slots),
    ...beatsOf(status, new Map(Object.entries(M.LANE_BEATS)), new Map(lanes.map(lane => [lane.path, [sessions[lane.name] ?? null]]))),
    refs: readRefs(M.REFS),
    prs: prs ? readPrs(M.PRS, M.REPO, laneBranches(status, { forPrs: true })) : null,
    intents: new Map(lanes.filter(lane => lane.sidecar === 'registered' && lane.intent).map(lane => [lane.name, intentOf(lane.intent, { prompt: intents[lane.intent]?.prompt ?? null, findings: intents[lane.intent]?.findings ?? null, progress: null })])),
    mainMovedAt: readReflogTime(M.REFLOG),
  }
}

/** @param {import('../hooks/records.mjs').Sources} sources @param {string} [here] */
const boardFrom = (sources, here = '') => boardOf(laneRecords(sources), sources.slots, here)

/** @param {ReturnType<typeof boardFrom>} board @param {Partial<import('../hooks/pane.mjs').View>} view */
const linesOf = (board, view = {}) => paneLines(board, { width: 72, isDesktop: false, now: M.NOW, clock: () => '19:04', opened: null, isFoldOpen: false, refreshedAt: M.NOW - 40000, errors: [], ...view })
/** @param {string} name @param {'you' | 'look' | 'fold'} from */
const at = (name, from) => ({ name, from })

/** @param {import('../hooks/pane.mjs').Line[]} lines */
const textOf = lines => lines.map(one => one.segments.map(segment => segment.text).join('')).join('\n')

describe('the readers (A1)', () => {
  test('Status JSON is read as given; anything else is null, never a throw', () => {
    const status = readStatus(M.STATUS)
    expect(status?.lanes.length).toBe(11)
    expect(status?.machineDir).toBe('X:\\work\\lanes\\_machine')
    for (const bad of ['', '{', 'null', '[]', '{"lanes": 3}', '\uFEFF{"lanes": [{"name": 5}]}', 'Get-MainCheckout : error']) expect(readStatus(bad)?.lanes.length ?? 0).toBe(0)
    expect(readStatus('\uFEFF{"machineDir": "m", "lanes": [{"name": "a", "missing": "yes"}]}')?.lanes[0]?.missing).toBe(false)
  })
  test('a slot file: holder, end and kind from its first line; time left or past its end; free or empty is no hold', () => {
    const [full, light, ghost] = slotsOf(M.SLOTS)
    expect(full).toEqual({ id: 'full-1', holder: 'combat-hitstop', until: '20:44', kind: 'full', isStale: false, pastMinutes: 0, leftMinutes: 34 })
    expect(light?.pastMinutes).toBe(6)
    expect(ghost?.holder).toBe('ghost-lane')
    for (const bad of [null, '', 'free since 19:00', 'held by', '\u0000\u0001']) readSlot('x-1', bad, M.NOW_MINUTES)
    expect(readSlot('x-1', null, 0)).toBe(null)
    expect(readSlot('x-1', 'free since 19:00; machine-level Editor slots', 0)).toBe(null)
    expect(readSlot('full-1', M.SLOTS['full-1'], 23 * 60 + 30)?.isStale).toBe(true)
  })
  test('heartbeats: a lane heartbeat, a half-written one, a session heartbeat on its branch only', () => {
    expect(readLaneBeat(M.LANE_BEATS['docs-sweep'])).toEqual({ source: 'lane heartbeat', at: M.NOW - 120000, state: 'working' })
    expect(readLaneBeat(M.LANE_BEATS['perf-capture'])).toBe(null)
    expect(readLaneBeat(null)).toBe(null)
    expect(readSessionBeat(M.SESSION_BEATS['combat-hitstop'], 'feat/combat-hitstop')?.at).toBe(M.NOW - 6 * 60000)
    expect(readSessionBeat(M.SESSION_BEATS['docs-sweep'], 'docs/sweep')).toBe(null)
    expect(readSessionBeat('{"branch": "x", "updatedAt": "soon"}', 'x')).toBe(null)
    expect(readSessionBeat(M.SESSION_BEATS['combat-hitstop'], '')).toBe(null)
  })
  test('refs, the reflog, the origin, lane 0 from a git directory', () => {
    const refs = readRefs(M.REFS)
    expect(refs.get('fix/editor-filter')).toEqual({ ahead: 3, behind: 27, committedAt: Math.floor((M.NOW - 3600000) / 1000) * 1000 })
    expect(readRefs('fatal: bad\nmain x y z').size).toBe(0)
    expect(readReflogTime(M.REFLOG)).toBe(Math.floor((M.NOW - 3600000) / 1000) * 1000)
    expect(readReflogTime('garbage')).toBe(0)
    expect(readOrigin(M.GIT_CONFIG)).toBe(M.REPO)
    expect(readOrigin('[remote "origin"]\n\turl = https://example.com/a/b.git\n')).toBe('')
    expect(readOrigin(null)).toBe('')
    expect(laneZeroOf('X:/work/game/.git/worktrees/editor-fix')).toBe('X:/work/game')
    expect(laneZeroOf('X:\\work\\game\\.git')).toBe('X:/work/game')
  })
  test('gh: one PR per lane branch, an open one first; another branch\u2019s and bad JSON are left out', () => {
    const prs = readPrs(M.PRS, M.REPO, ['fix/editor-filter', 'feat/combat-hitstop', 'perf/frame-budget'])
    expect(prs?.get('fix/editor-filter')).toEqual({ number: 398, url: 'https://github.com/example-studio/game/pull/398', state: 'open', isDraft: false, checks: 'failing' })
    expect(prs?.get('feat/combat-hitstop')?.checks).toBe('passing')
    expect(prs?.get('perf/frame-budget')?.checks).toBe('pending')
    expect(prs?.has('main')).toBe(false)
    expect(readPrs('not json', M.REPO, [])).toBe(null)
    expect(prListArgs(M.REPO, ['a', 'b'])).toContain('head:a head:b')
  })
  test('the branches asked about: no pool, no detached; gh leaves lane 0 out', () => {
    const status = readStatus(M.STATUS)
    expect(laneBranches(status)).toEqual(['main', 'feat/combat-hitstop', 'fix/editor-filter', 'perf/frame-budget', 'docs/sweep', 'try/scratch-a', 'claude/agent-1', 'feat/old'])
    expect(laneBranches(status, { forPrs: true }).includes('main')).toBe(false)
    expect(laneBranches(null)).toEqual([])
  })
})

describe('the lane records (A1)', () => {
  const records = laneRecords(sourcesOf())
  const named = (/** @type {string} */ name) => /** @type {import('../hooks/records.mjs').LaneRecord} */ (records.find(one => one.name === name))
  test('one record per worktree, each kind and sidecar exactly as Status gave them', () => {
    const status = readStatus(M.STATUS)
    expect(records.map(one => [one.name, one.kind, one.sidecar])).toEqual((status?.lanes ?? []).map(one => [one.name, one.kind, one.sidecar]))
  })
  test('a registered lane: branch, intent, tier, slot need and held, ahead, behind, PR, decisions, last moved', () => {
    const lane = named('combat-hitstop')
    expect([lane.branch, lane.intent, lane.intentTitle, lane.tier, lane.slotNeed, lane.slotHeld.map(one => one.id)]).toEqual(['feat/combat-hitstop', 'combat-hitstop', 'Combat hitstop', 'T1', 'full', ['full-1']])
    expect([lane.ahead, lane.behind, lane.pr?.number, lane.decisions.map(one => one.id)]).toEqual([4, 2, 401, ['F-2']])
    expect(lane.lastMoved).toEqual({ source: 'session heartbeat', at: M.NOW - 6 * 60000 })
    expect(lane.mainMovedAt).toBe(readReflogTime(M.REFLOG))
  })
  test('the other cases: a sidecar intent with no folder, a half-written heartbeat, another branch\u2019s session, a detached and a missing worktree, no PR', () => {
    expect(named('docs-sweep').intentTitle).toBe('')
    expect(named('docs-sweep').decisions).toEqual([])
    expect(named('docs-sweep').beats.map(one => one.source)).toEqual(['lane heartbeat'])
    expect(named('perf-capture').beats).toEqual([])
    expect(named('perf-capture').lastMoved?.source).toBe('last commit')
    expect([named('probe').isDetached, named('probe').ahead, named('probe').pr]).toEqual([true, null, null])
    expect(named('old-lane').isMissing).toBe(true)
    expect(named('docs-sweep').pr).toBe(null)
    expect(named('editor-fix').decisions.map(one => one.id)).toEqual(['F-2', 'F-4', 'F-5'])
    expect(laneRecords({ ...sourcesOf(), prs: null }).find(one => one.name === 'docs-sweep')?.pr).toBe(undefined)
  })
  test('no sources at all (no machine folder, no refresh yet): no records, and nothing throws', () => {
    expect(laneRecords(NO_SOURCES)).toEqual([])
    expect(boardOf([], []).count).toBe(0)
  })
})

describe('slots (A2)', () => {
  test('(i) holder and end equal Ather\u2019s parseEditorLock reading of the pointer Sync writes', () => {
    const slot = readSlot('full-1', M.SLOTS['full-1'], M.NOW_MINUTES)
    const pointer = parseEditorLock(M.POINTER, M.NOW_MINUTES)
    expect([slot?.holder, slot?.until]).toEqual([pointer.holder, pointer.until])
  })
  test('the fold names the Editor\u2019s holder; the held slots list who waits; a slot past its end and a slot held by another are reasons', () => {
    const board = boardFrom(sourcesOf())
    expect(foldText(board)).toBe('all 9 lanes · pool 1 ready, 1 building · Editor: combat-hitstop, 34m')
    expect(board.holds.map(one => one.label)).toEqual(['full-1', 'light-1', 'light-2'])
    expect(board.holds[0]?.waiting).toEqual(['editor-fix'])
    const why = Object.fromEntries(board.look.map(one => [one.lane.name, one.reasons.map(reason => reason.text)]))
    expect(why['perf-capture']).toEqual(['light-1 past its end 6m'])
    expect(why['editor-fix']).toEqual(['#398 checks failing', '27 behind main', 'needs editor, held by combat-hitstop'])
  })
  test('one rule for who waits: a hold’s waiting lanes are exactly the lanes A look says wait for it', () => {
    for (const slots of [M.SLOTS, M.PERF_SLOTS, {}]) {
      const board = boardFrom(sourcesOf({ slots }))
      const fromHolds = [...new Set(board.holds.flatMap(hold => hold.waiting))].sort()
      const fromLook = board.look.filter(one => one.reasons.some(reason => reason.short.startsWith('waits for'))).map(one => one.lane.name).sort()
      expect(fromLook).toEqual(fromHolds)
    }
  })
  test('a perf capture is one hold of every slot; with nothing held, all slots free and Editor free', () => {
    const perf = boardFrom(sourcesOf({ slots: M.PERF_SLOTS }))
    expect(perf.holds.length).toBe(1)
    expect(perf.holds[0]?.ids).toEqual(['build-1', 'full-1', 'light-1', 'light-2'])
    expect(perf.holds[0]?.label).toBe('every slot')
    expect(foldText(perf)).toContain('Editor: perf-capture, past its end 6m')
    const free = boardFrom(sourcesOf({ slots: {} }))
    expect(foldText(free)).toContain('Editor free')
    expect(textOf(linesOf(free, { isFoldOpen: true }))).toContain('all slots free')
  })
})

describe('the pane (A3, design.md)', () => {
  const board = boardFrom(sourcesOf())
  test('For you: every waiting decision under its lane, lanes by their oldest decision', () => {
    expect(board.forYou.map(one => [one.lane.name, one.decisions.map(call => call.id)])).toEqual([['editor-fix', ['F-2', 'F-4', 'F-5']], ['combat-hitstop', ['F-2']]])
  })
  test('A look: every lane with a reason from design.md\u2019s list and no other, pools never', () => {
    // The detached and the missing worktree under the lanes folder are unregistered lanes too.
    expect(board.look.map(one => one.lane.name)).toEqual(['game', 'editor-fix', 'perf-capture', 'scratch-a', 'probe', 'old-lane'])
    expect(board.look[0]?.reasons.map(one => one.text)).toEqual([`30 behind main`])
    expect(30 >= BEHIND_LIMIT).toBe(true)
    expect(board.look.find(one => one.lane.name === 'scratch-a')?.reasons.map(one => one.short)).toEqual(['unregistered'])
  })
  for (const width of [72, 110]) {
    test(`at ${width} columns: no line over the width, at rest, opened and unfolded`, () => {
      for (const view of [{}, { isFoldOpen: true }, { opened: at('perf-capture', 'look') }, { opened: at('editor-fix', 'you') }, { opened: at('scratch-a', 'look') }, { isFoldOpen: true, opened: at('docs-sweep', 'fold') }]) {
        for (const one of linesOf(board, { width, ...view })) expect(`${lineCells(one) <= width} ${one.key}`).toBe(`true ${one.key}`)
      }
    })
  }
  test('colour: lime only on For you\u2019s label and count, amber only on A look\u2019s reasons', () => {
    for (const view of [{}, { isFoldOpen: true }, { opened: at('editor-fix', 'you') }, { isDesktop: true, width: 60 }]) {
      for (const one of linesOf(board, view)) {
        for (const segment of one.segments) {
          if (segment.color === LIME) expect(segment.key).toMatch(/^you-(label|count)$/)
          if (segment.color === AMBER) expect(segment.key).toMatch(/^look-.+-why$/)
        }
      }
    }
  })
  test('a quiet lane is absent at rest and listed once the fold opens; lane 0 first, the pool on one line', () => {
    expect(textOf(linesOf(board))).not.toContain('docs-sweep')
    const open = linesOf(board, { isFoldOpen: true })
    const rows = open.filter(one => one.key.startsWith('row-')).map(one => one.key)
    expect(rows).toEqual(['row-game', 'row-agent-1', 'row-combat-hitstop', 'row-docs-sweep', 'row-editor-fix', 'row-old-lane', 'row-perf-capture', 'row-probe', 'row-scratch-a', 'row-pool'])
    expect(textOf(open)).toMatch(/◆ game {12}30 behind main/)
    expect(textOf(open)).toContain('full-1   combat-hitstop · editor · 34m left · then editor-fix')
  })
  test('nothing waiting and no trouble: one line, then the fold', () => {
    const calm = boardOf([], [])
    const text = textOf(linesOf(calm))
    expect(text).toContain('Nothing needs you.')
    expect(text).not.toContain('F O R')
    expect(text).toContain('▸ all 0 lanes · pool 0 ready, 0 building · Editor free')
  })
  test('an opened lane shows design.md\u2019s detail lines in its order; an unregistered one the Register line to copy', () => {
    const editor = textOf(linesOf(board, { opened: at('editor-fix', 'you'), width: 110 }))
    const order = ['F-2 ', 'answer them in the session that tracks editor-fix', 'PR    #398 open · checks failing · open on GitHub', 'main  27 behind · 3 ahead', 'slot  needs editor · full-1 held by combat-hitstop, 34m left', 'moved last commit 1h ago · no heartbeat here', 'lane  fix/editor-filter · editor-fix (Editor filter fix) · T2']
    let cursor = -1
    for (const piece of order) {
      const next = editor.indexOf(piece, cursor + 1)
      expect(`${next > cursor} ${piece}`).toBe(`true ${piece}`)
      cursor = next
    }
    expect(editor).toContain('▾ ')
    const scratch = textOf(linesOf(board, { opened: at('scratch-a', 'look') }))
    expect(scratch).toContain('lanes.ps1 -Action Register -Name scratch-a `')
    expect(scratch).toContain('-Intent <slug> -Tier <T0|T1|T2>')
    expect(textOf(linesOf(board, { opened: at('scratch-a', 'look'), width: 110 }))).toContain('lanes.ps1 -Action Register -Name scratch-a -Intent <slug> -Tier <T0|T1|T2>')
  })
  test('the header: main\u2019s age and the last refresh; errors said under it, the rest still drawn', () => {
    const lines = linesOf(board, { errors: ['No lanes.ps1 in X:/x: set Ather Lanes\u2019 scriptsDir.'] })
    expect(textOf(lines).split('\n')[0]).toMatch(/^L A N E S +main as of 19:04 · ↻ 40s$/)
    expect(textOf(lines)).toContain('No lanes.ps1 in X:/x')
    expect(textOf(lines)).toContain('F O R   Y O U')
  })
})

describe('this session (A9, D10)', () => {
  const status = readStatus(M.STATUS)
  test('the session\u2019s checkout is matched to its worktree by path, case and slashes aside; a checkout inside another is its own', async () => {
    expect(laneOf(status, 'X:/work/game')).toBe('game')
    expect(laneOf(status, 'X:\\work\\lanes\\editor-fix')).toBe('editor-fix')
    expect(laneOf(status, 'x:/WORK/Lanes/Editor-Fix/')).toBe('editor-fix')
    // A folder nested in a lane: Ather's checkoutOf takes it up to the lane's folder first, as the engine half does.
    const files = { exists: async (/** @type {string} */ path) => path === 'X:/work/lanes/editor-fix/.git', read: async (/** @type {string} */ path) => (path === 'X:/work/lanes/editor-fix/.git' ? 'gitdir: X:/work/game/.git/worktrees/editor-fix' : null) }
    expect(laneOf(status, (await checkoutOf(files, 'X:\\work\\lanes\\editor-fix\\Source\\Game')) ?? '')).toBe('editor-fix')
    expect(laneOf(status, 'X:/work/lanes/editor-fix/Source')).toBe('')
    // A harness worktree lies inside lane 0: it is its own worktree, not lane 0.
    expect(laneOf(status, 'X:/work/game/.claude/worktrees/agent-1')).toBe('agent-1')
    expect(laneOf({ machineDir: '', lanes: (status?.lanes ?? []).filter(one => one.name !== 'agent-1') }, 'X:/work/game/.claude/worktrees/agent-1')).toBe('')
    expect(laneOf(status, 'X:/work/lanes/editor-fixed')).toBe('')
    expect(laneOf(status, 'Y:/elsewhere')).toBe('')
    expect(laneOf(status, '')).toBe('')
    expect(laneOf(null, 'X:/work/game')).toBe('')
  })
  test('"this session" (quiet) beside its name in For you and A look, in its opened details and its fold row; the fold lists it after lane 0', () => {
    const board = boardFrom(sourcesOf(), 'editor-fix')
    for (const width of [72, 110]) {
      const rest = linesOf(board, { width })
      const you = rest.find(one => one.key === 'you-editor-fix-F-2')
      const look = rest.find(one => one.key === 'look-editor-fix')
      for (const one of [you, look]) {
        expect(one?.segments.find(segment => segment.text === HERE)?.color).toBe(QUIET)
        expect(lineCells(/** @type {any} */ (one))).toBe(width)
      }
      // Only the lane's first decision carries it, and no other lane's line.
      expect(rest.filter(one => one.segments.some(segment => segment.text.includes(HERE))).map(one => one.key)).toEqual(['you-editor-fix-F-2', 'look-editor-fix'])
      const open = linesOf(board, { width, isFoldOpen: true, opened: at('editor-fix', 'fold') })
      expect(open.filter(one => one.key.startsWith('row-')).map(one => one.key).slice(0, 3)).toEqual(['row-game', 'row-editor-fix', 'row-agent-1'])
      expect(textOf(open.filter(one => one.key === 'row-editor-fix'))).toMatch(/this session · 1h$/)
      expect(textOf(open.filter(one => one.key.startsWith('detail-editor-fix-')))).toContain(`lane  ${HERE} · fix/editor-filter`)
      for (const one of open) expect(`${lineCells(one) <= width} ${one.key}`).toBe(`true ${one.key}`)
    }
    const desktop = linesOf(board, { isDesktop: true, width: 60 })
    expect(desktop.find(one => one.key === 'you-editor-fix')?.segments.map(segment => segment.text)).toEqual(['editor-fix', `  ${HERE}`])
    expect(textOf(linesOf(boardFrom(sourcesOf(), 'scratch-a'), { opened: at('scratch-a', 'look') }))).toMatch(new RegExp(`${HERE}\\n.*No sidecar`))
  })
  test('a session in no lane marks nothing, and the fold keeps lane 0 first, then by name', () => {
    for (const view of [{}, { isFoldOpen: true }, { opened: at('editor-fix', 'you') }]) expect(textOf(linesOf(boardFrom(sourcesOf()), view))).not.toContain(HERE)
    expect(boardFrom(sourcesOf(), 'game').rows.map(one => one.lane.name).slice(0, 2)).toEqual(['game', 'agent-1'])
  })
})

describe('the status line (A7, D8)', () => {
  test('the session\u2019s lane, then For you\u2019s and A look\u2019s counts as the pane counts them, each hidden at zero', () => {
    const sources = sourcesOf()
    const board = boardFrom(sources, 'editor-fix')
    const decisions = board.forYou.reduce((sum, one) => sum + one.decisions.length, 0)
    expect(lineText(board)).toBe(`lane editor-fix · ◆ ${decisions} for you · ${board.look.length} to look at`)
    expect(lineText(board)).toBe('lane editor-fix · ◆ 4 for you · 6 to look at')
    // The pane's own counts: For you's "N decisions" and A look's number.
    expect(textOf(linesOf(board))).toMatch(/F O R {3}Y O U +4 decisions\n/)
    expect(textOf(linesOf(board))).toMatch(/A {3}L O O K +6\n/)
    expect(lineText(boardFrom(sources, 'game'))).toBe('lane 0 · ◆ 4 for you · 6 to look at')
    expect(lineText(boardFrom(sources, 'scratch-a'))).toBe('lane scratch-a · ◆ 4 for you · 6 to look at')
    expect(lineText(boardFrom(sources))).toBe('not in a lane · ◆ 4 for you · 6 to look at')
    expect(lineText(boardOf([], []))).toBe('not in a lane')
    const quiet = laneRecords(sources).filter(one => one.name === 'docs-sweep')
    expect(lineText(boardOf(quiet, [], 'docs-sweep'))).toBe('lane docs-sweep')
  })
})

describe('the lanes from files while the pane is closed (D8)', () => {
  const kept = readStatus(M.STATUS)
  const sidecar = (/** @type {string} */ name, /** @type {Record<string, string>} */ fields = {}) => JSON.stringify({ name, path: `X:\\work\\lanes\\${name}`, branch: `feat/${name}`, origin: 'register', intent: name, tier: 'T1', claims: [], session: '', slot: 'light', written: '2026-10-24T19:00:00+07:00', host: 'PC-0', ...fields }, null, 4)
  test('a sidecar is read as Status reads it; a half-written one is none', () => {
    expect(readSidecar(sidecar('lane-a'))).toEqual({ name: 'lane-a', path: 'X:\\work\\lanes\\lane-a', branch: 'feat/lane-a', intent: 'lane-a', tier: 'T1', slotNeed: 'light' })
    for (const bad of [null, '', '{"name": "x"', '{"name": "x"}', '[]']) expect(readSidecar(bad)).toBe(null)
  })
  test('no full read yet: lane 0, each worktree folder with its sidecar or unregistered, the pool by its name', () => {
    const status = statusOfFiles({ kept: null, main: 'X:/work/game', lanesRoot: 'X:/work/lanes', machineDir: 'X:/work/lanes/_machine', sidecars: [readSidecar(sidecar('lane-a'))].filter(one => one !== null), entries: ['lane-a', 'lane-b', '_pool-01', '_poolbuild-02'] })
    expect(status.lanes.map(one => [one.name, one.kind, one.sidecar, one.intent])).toEqual([
      ['game', 'main checkout (lane 0)', '(lane 0, no sidecar)', ''],
      ['_pool-01', 'pool (ready)', 'unregistered', ''],
      ['_poolbuild-02', 'pool (building)', 'unregistered', ''],
      ['lane-a', 'lane', 'registered', 'lane-a'],
      ['lane-b', 'lane', 'unregistered', ''],
    ])
    expect(status.machineDir).toBe('X:/work/lanes/_machine')
  })
  test('after a full read: Status\u2019 kind, branch and order kept; a new folder added, a gone one dropped, a removed sidecar unregistered, a new one registered', () => {
    const sidecars = [readSidecar(sidecar('combat-hitstop', { path: 'x:/WORK/lanes/combat-hitstop', intent: 'combat-hitstop' })), readSidecar(sidecar('scratch-a'))].filter(one => one !== null)
    const entries = ['_pool-01', '_poolbuild-02', 'combat-hitstop', 'editor-fix', 'scratch-a', 'probe', 'new-lane']
    const status = statusOfFiles({ kept, main: 'X:\\work\\game', lanesRoot: 'X:/work/lanes', machineDir: 'X:/work/lanes/_machine', sidecars, entries })
    const by = new Map(status.lanes.map(one => [one.name, one]))
    expect(status.lanes.map(one => one.name)).toEqual(['game', '_pool-01', '_poolbuild-02', 'combat-hitstop', 'editor-fix', 'scratch-a', 'probe', 'agent-1', 'new-lane'])
    expect(by.get('combat-hitstop')?.branch).toBe('feat/combat-hitstop')
    expect(by.get('editor-fix')?.sidecar).toBe('unregistered')
    expect([by.get('scratch-a')?.sidecar, by.get('scratch-a')?.intent, by.get('scratch-a')?.branch]).toEqual(['registered', 'scratch-a', 'feat/scratch-a'])
    expect(by.get('probe')?.branch).toBe('(detached)')
    expect(by.get('agent-1')?.kind).toBe('harness worktree (.claude\\worktrees)')
    expect([by.get('new-lane')?.kind, by.get('new-lane')?.sidecar, by.get('new-lane')?.branch]).toEqual(['lane', 'unregistered', ''])
    expect(by.has('perf-capture') || by.has('docs-sweep') || by.has('old-lane')).toBe(false)
    expect(status.machineDir).toBe('X:\\work\\lanes\\_machine')
  })
})

describe('the summary lanes_summary gives (A8, D9)', () => {
  test('lanes_open opens a lane from the first section that lists it; an unknown or pool lane from none', () => {
    const board = boardFrom(sourcesOf())
    expect(['editor-fix', 'combat-hitstop', 'perf-capture', 'game', 'docs-sweep', '_pool-01', 'nobody'].map(name => sectionOf(board, name))).toEqual(['you', 'you', 'look', 'look', 'fold', null, null])
  })
  test('a full read survives the store: kept as plain JSON and read back the same; anything else is none', () => {
    const sources = sourcesOf()
    const status = sources.status
    if (!status) throw new Error('the fixture Status')
    const full = { at: M.NOW, status, refs: sources.refs, prs: sources.prs }
    const back = fullOf(JSON.parse(JSON.stringify(fullData(full))))
    expect(back?.at).toBe(M.NOW)
    expect(back?.status).toEqual(status)
    expect([...(back?.refs ?? [])]).toEqual([...(sources.refs ?? [])])
    expect([...(back?.prs ?? [])]).toEqual([...(sources.prs ?? [])])
    expect(fullOf(JSON.parse(JSON.stringify(fullData({ ...full, prs: null }))))?.prs).toBe(null)
    for (const bad of [undefined, null, 3, {}, { at: 'x', status }, { at: 1, status: { lanes: 3 } }]) expect(fullOf(bad)).toBe(null)
  })
  test('this session\u2019s lane with its details, every For you and A look item; on a quiet machine "Nothing needs you."', () => {
    const board = boardFrom(sourcesOf(), 'editor-fix')
    const text = summaryText(board, { now: M.NOW, readAt: M.NOW - 60000, clock: () => '19:04' })
    expect(text.split('\n')[0]).toBe('This session: lane editor-fix.')
    for (const piece of ['PR: #398 open · checks failing', 'main: 27 behind · 3 ahead', 'slot: needs editor', 'lane: this session · fix/editor-filter · editor-fix (Editor filter fix) · T2', 'as of 19:04']) expect(text).toContain(piece)
    for (const { lane, decisions } of board.forYou) for (const call of decisions) expect(text).toContain(`- ${lane.name} ${call.id}: `)
    for (const { lane, reasons } of board.look) expect(text).toContain(`- ${lane.name}: ${reasons.map(one => one.text).join(' · ')}`)
    expect(text).not.toContain('Nothing needs you.')
    expect(summaryText(boardFrom(sourcesOf(), 'scratch-a'), { now: M.NOW, readAt: null, clock: () => '' })).toMatch(/^This session: lane scratch-a, unregistered \(register it with: lanes\.ps1 -Action Register -Name scratch-a/)
    const calm = summaryText(boardOf([], []), { now: M.NOW, readAt: null, clock: () => '' })
    expect(calm).toContain('This session: not in a lane.')
    expect(calm).toContain('Nothing needs you.')
    expect(calm).toContain('not read yet')
  })
})

describe('coexistence (A5)', () => {
  test('the module hooks only its command, its pane, its own two tools and the session start: no other tool call, prompt, turn or band (F-12)', async () => {
    const { register } = await import('../hooks/index.mjs')
    /** @type {string[]} */
    const hooked = []
    const on = (/** @type {string} */ event, /** @type {any} */ matcher) => {
      hooked.push(`${event}${matcher && typeof matcher === 'object' ? JSON.stringify(matcher) : ''}`)
      return { catch: () => undefined }
    }
    register(/** @type {any} */ (on), {})
    expect(hooked).toEqual(['session.start', 'command.run{"command":"lanes"}', 'tool.call{"tool":"mcp__ather-lanes__lanes_summary"}', 'tool.call{"tool":"mcp__ather-lanes__lanes_open"}', 'ui.render{"component":"Pane","requestId":"lanes"}'])
    // A tool.call hook only on the mod's own tools' names, so it never sees another tool's call (D9, F-12).
    for (const one of hooked) expect(/^(tool\.(?!call\{"tool":"mcp__ather-lanes__)|prompt\.|turn\.)|AbovePrompt/.test(one)).toBe(false)
  })
})
