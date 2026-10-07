// @ts-check
import { describe, expect, test } from 'claude-code/testing'

import { isStopWord, ledgerWithWindow, mandateText, newWindow, nextLedgerId, nextParkId, parseAwayArgs, windowDecisions } from '../hooks/away.mjs'
import { automationResult, briefIssues, buildResult, countGotcha, explainGuard, heldShell, isAssetSave, isBuildCommand, isEditorBuild, isLogRead, isMergeCommand, isSearchCommand, mcpKind, mcpServer, recurringGotchas } from '../hooks/guards.mjs'
import { buildHome, heldByLine, intentStands, parseWeek, proofLine, trackConsequence, untrackText, weekText, workList } from '../hooks/home.mjs'
import { areaFromLabels, issueLabel, issueName, issuePrompt, parseIssues } from '../hooks/issues.mjs'
import { closestWord, currentStage, emptyEvidence, isEvening, isSamePerson, nextStep, intentLabel, parseEditorLock, parseFindings, parseIntent, parseRole, pickCandidates, searchIntents, sessionTitle, shortTitle } from '../hooks/model.mjs'
import * as state from '../hooks/state.mjs'
import { FRAME_SCHEME, KINDS, avatarSvg, classifyWorker, crewWords, propForTool, propSvg, trailWords, workerState } from '../hooks/squad.mjs'
import { adoptWorker, recordEnd, recordSpawn, recordTool, resetWorkers, workerElapsed, workerOf } from '../hooks/workers.mjs'
import { intentChanges, intentFileOf, orchestrationFileOf } from '../hooks/changes.mjs'
import { unreal } from '../hooks/packs/unreal.mjs'

const NOON = Date.UTC(2026, 9, 3, 5, 0) // 12:00 at UTC+7
const EVENING = Date.UTC(2026, 9, 3, 14, 0) // 21:00 at UTC+7

const prompt = (fields, acceptance = '- [x] one\n- [ ] two') =>
  `# Spawner\n\n- Rev: 3\n${Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Acceptance\n\n${acceptance}\n`

const FINDINGS = `# Findings

## F-1 (2026-10-01, rev 3) | blocking: yes | status: open (director)

Found: **drops only** or full respawn? (a) no, drops only (recommended); (b) full respawn.

## F-2 (2026-10-01, rev 3) | blocking: no | status: resolved (director)

Settled.

## F-3 (2026-10-02, rev 3) | blocking: no | status: open (engineering)

Pool size is an engineering call.
`

const intent = (slug, fields = {}, extra = {}) =>
  parseIntent({ slug, prompt: prompt({ Status: 'active', Area: 'Combat', Owner: 'Tin Nguyen', ...fields }, extra.acceptance), findings: extra.findings ?? '', progress: '', files: [], hasDebrief: false, mtimeMs: extra.mtimeMs ?? 1 })

const SPAWNER = intent('spawner', {}, { findings: FINDINGS, mtimeMs: 5 })
const THEIRS = intent('pause-ai', { Owner: 'TienPham', Area: 'AI' }, { mtimeMs: 9 })

const base = (over = {}) => ({
  intents: [SPAWNER, THEIRS],
  pinned: 'spawner',
  me: 'Tin Nguyen',
  role: 'engineer',
  area: '',
  tourDone: true,
  evidence: emptyEvidence(),
  away: newWindow({ hours: 8, untilDone: false, goal: '' }, NOON, 'L.md', { person: 'tinnguyen', root: 'R' }),
  ledger: '',
  lost: null,
  lock: parseEditorLock('free since 10:00', 600),
  recurring: [],
  issues: [],
  sent: [],
  workers: 0,
  now: NOON,
  tz: 420,
  ...over,
})
const OFF = { phase: /** @type {const} */ ('off'), untilDone: false, goal: '', held: ['merge', 'push-main'], startedAt: 0, wakeAt: 0, ledgerPath: '', parked: [], person: '', root: '' }

// An in-memory Io, slow enough that unserialized read-modify-writes would interleave.
const memoryIo = (sid = 's1') => {
  const store = new Map()
  const files = new Map()
  const tick = () => new Promise(resolve => setTimeout(resolve, 1))
  let session = sid
  return {
    store,
    files,
    switchSession: next => {
      session = next
    },
    io: {
      get: async key => (await tick(), store.get(key)),
      set: async (key, value) => (await tick(), void store.set(key, JSON.parse(JSON.stringify(value)))),
      remove: async key => void store.delete(key),
      keys: async () => [...store.keys()],
      read: async path => (await tick(), files.get(path) ?? null),
      write: async (path, text) => (await tick(), void files.set(path, text)),
      exists: async path => files.has(path),
      sessionId: async () => session,
      root: async () => 'R',
      gitUser: async () => 'Tin Nguyen',
      redraw: () => undefined,
      // The files directly in a folder, written just now.
      list: async dir => [...files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => ({ name: path.slice(dir.length + 1), kind: 'file', mtimeMs: Date.now() })),
    },
  }
}

describe('intents', () => {
  test('header fields, a status with a note, area and owner', () => {
    const parked = intent('x', { Status: 'parked: waiting on art', Area: 'vfx' })
    expect(parked.status).toBe('parked')
    expect(parked.area).toBe('VFX')
    expect(SPAWNER.acceptanceDone).toBe(1)
  })

  test('only open findings; the director call is a call, the engineering one is not', () => {
    const open = parseFindings(FINDINGS, '')
    expect(open.map(one => one.id)).toEqual(['F-1', 'F-3'])
    expect(open[0]?.title).toBe('Drops only or full respawn?')
    expect(open[1]?.isDirectorCall).toBe(false)
  })

  test('titles, people, picking and search', () => {
    expect(shortTitle('Found: the **pool** drains. Then more.')).toBe('The pool drains')
    expect(isSamePerson('Tin Nguyen', 'TinNguyen')).toBe(true)
    expect(pickCandidates([THEIRS, SPAWNER], 'Tin Nguyen', '').map(one => one.slug)).toEqual(['spawner', 'pause-ai'])
    expect(pickCandidates([SPAWNER, THEIRS], 'Minh Tran', 'AI').map(one => one.slug)).toEqual(['pause-ai', 'spawner'])
    expect(searchIntents([SPAWNER, THEIRS], 'ai tienpham').map(one => one.slug)).toEqual(['pause-ai'])
    // Whole words: 'no' and 'ok' find nothing; an area word finds its intents.
    expect(searchIntents([intent('fluid-snow-sand-look')], 'no')).toHaveLength(0)
    expect(searchIntents([intent('fluid-snow-sand-look')], 'ok')).toHaveLength(0)
    expect(searchIntents([SPAWNER, THEIRS], 'combat').map(one => one.slug)).toEqual(['spawner'])
    expect(parseRole('game designer')).toBe('designer')
    expect(parseRole('tech artist')).toBe('techart')
    expect(closestWord('tuor', ['tour', 'role', 'issue'])).toBe('tour')
    expect(closestWord('isue', ['tour', 'role', 'issue'])).toBe('issue')
    expect(closestWord('banana', ['tour', 'role', 'issue'])).toBe(null)
  })
})

describe('stages and the next step', () => {
  test('Plan, Build, Prove until the role has its evidence, Ship', () => {
    expect(currentStage(intent('x', {}, { acceptance: '' }), emptyEvidence(), 'engineer')).toBe('plan')
    expect(currentStage(SPAWNER, emptyEvidence(), 'engineer')).toBe('build')
    const done = intent('x', {}, { acceptance: '- [x] one' })
    expect(currentStage(done, emptyEvidence(), 'designer')).toBe('prove')
    expect(currentStage(done, { ...emptyEvidence(), pie: { state: 'pass', detail: '' } }, 'designer')).toBe('ship')
    // No role yet: any role's proof counts.
    expect(currentStage(done, { ...emptyEvidence(), pie: { state: 'pass', detail: '' } }, '')).toBe('ship')
    expect(currentStage(done, { ...emptyEvidence(), build: { state: 'pass', detail: '' } }, '')).toBe('prove')
  })

  test('an unreviewed plan asks for a review before a worker; Prove names what is missing', () => {
    const fresh = intent('x', {}, { acceptance: '- [ ] one' })
    expect(nextStep('engineer', fresh, emptyEvidence(), 0, 'Tin Nguyen')?.key).toBe('review')
    expect(nextStep('engineer', { ...fresh, hasReview: true }, emptyEvidence(), 0, 'Tin Nguyen')?.key).toBe('brief')
    const step = nextStep('techart', intent('x', {}, { acceptance: '- [x] one' }), emptyEvidence(), 0, 'Tin Nguyen')
    expect(step?.label).toBe('Prove it works')
    expect(step?.hint).toContain('Still needed: your own Editor check and a PIE proof')
    expect(step?.hint).toContain('/ather checked')
    // Someone else's intent: only a read-only summary.
    expect(nextStep('engineer', fresh, emptyEvidence(), 0, 'Minh Tran')?.key).toBe('follow')
  })

  test('a shipped intent owes a debrief once, then nothing', () => {
    const shipped = intent('x', { Status: 'completed' })
    expect(nextStep('engineer', shipped, emptyEvidence(), 0, 'Tin Nguyen')?.key).toBe('debrief')
    expect(nextStep('engineer', { ...shipped, hasDebrief: true }, emptyEvidence(), 0, 'Tin Nguyen')).toBe(undefined)
  })
})

describe('guards and evidence', () => {
  test('a piped build reads its own Result line', () => {
    expect(buildResult('Result: Succeeded\n...\nResult: Failed (OtherCompilationError)')).toBe('fail')
    // Only the Editor target is evidence; a heredoc that mentions a build is not a build.
    expect(isEditorBuild('Build.bat ShaderCompileWorker Win64 Development')).toBe(false)
    expect(isEditorBuild('Build.bat S2Editor Win64 Development')).toBe(true)
    expect(isBuildCommand("node - <<'EOF'\nconsole.log('Build.bat S2Editor | tail')\nEOF")).toBe(false)
  })

  test('tests pass only when tests ran and passed; no tests or a non-zero exit is a fail', () => {
    expect(automationResult('EXIT CODE: 0\n0 tests found')).toBe('fail')
    expect(automationResult('EXIT CODE: -1')).toBe('fail')
    expect(automationResult('EXIT CODE: 0')).toBe(null)
    expect(automationResult('12 tests passed')).toBe('pass')
  })

  test('merges and pulls are audited; merge-base and --abort are not', () => {
    expect(isMergeCommand('git pull origin main')).toBe(true)
    expect(isMergeCommand('git merge-base a b')).toBe(false)
    expect(isMergeCommand('git merge --abort')).toBe(false)
  })

  test('searching for a trap is not hitting it; reading a build log is', () => {
    expect(isSearchCommand('grep -r "index.lock" docs/')).toBe(true)
    expect(isSearchCommand('Get-Content Saved/Logs/build.log | Select-String Result')).toBe(false)
    expect(isLogRead('Get-Content Saved/Logs/build.log -Tail 40')).toBe(true)
    expect(isLogRead('Build.bat S2Editor > build.log')).toBe(false)
  })

  test('held shell commands: merges and pushes to main however they are spelled, not feature work', () => {
    const held = ['merge', 'push-main']
    const on = (/** @type {string} */ branch) => () => branch
    expect(heldShell('gh pr merge 1 --admin', held, on('feat/x'))).toBe('merge')
    expect(heldShell('gh api -X PUT repos/o/r/pulls/12/merge', held, on('feat/x'))).toBe('merge')
    expect(heldShell('git push origin HEAD:main', held, on('feat/x'))).toBe('push-main')
    expect(heldShell('git push', held, on('main'))).toBe('push-main')
    expect(heldShell('git push origin +main', held, on('feat/x'))).toBe('push-main')
    expect(heldShell('git push origin "main"', held, on('feat/x'))).toBe('push-main')
    expect(heldShell('git push -u origin feat/main-menu', held, on('main'))).toBe(null)
    expect(heldShell('git push', held, on('feat/x'))).toBe(null)
    expect(heldShell('git merge origin/main', held, on('feat/x'))).toBe(null)
    expect(heldShell('git merge feat/x', held, on('main'))).toBe('merge')
    // Each command is judged on the branch of the folder it runs in, not the shared checkout's.
    const layout = (/** @type {string | null} */ folder) => (folder === 'E:/wt/feat' ? 'feat/x' : folder === null ? 'main' : '')
    expect(heldShell('git -C E:/wt/feat push -u origin HEAD', held, layout)).toBe(null)
    expect(heldShell('git -C E:/wt/feat merge origin/main', held, layout)).toBe(null)
    expect(heldShell('cd E:/wt/feat && git push', held, layout)).toBe(null)
    // A folder whose branch cannot be told: only an explicit main is held.
    expect(heldShell('git -C E:/elsewhere push', held, layout)).toBe(null)
    expect(heldShell('git -C E:/elsewhere push origin main', held, layout)).toBe('push-main')
    // Quoted text and heredoc bodies are not commands.
    expect(heldShell('git commit -m "fix; git push origin main"', held, layout)).toBe(null)
    expect(heldShell('gh pr create --body "gh pr merge 1"', held, layout)).toBe(null)
    expect(isAssetSave('{"tool":"save_asset"}')).toBe(true)
  })

  test('PIE counts only when PIE or a test run starts, never for any console command', () => {
    expect(mcpKind('ExecuteConsoleCommand stat fps')).toBe(null)
    expect(mcpKind('StartPIE L_S2Empty')).toBe('pie')
    expect(mcpKind('ExecuteConsoleCommand Sipher.Bench.Combo.Start sword')).toBe('pie')
    expect(mcpKind('ExecuteConsoleCommand Sipher.Bench.Combo.List')).toBe(null)
    expect(mcpServer('mcp__claude_ai_Claude_Docs__read')).toBe('claude_ai_Claude_Docs')
  })

  test('tree-rewriting git is explained; only editing briefs are checked', () => {
    expect(explainGuard('git checkout main')).toContain('other sessions share')
    expect(explainGuard('git status')).toBe(null)
    expect(briefIssues('Fix the bug.', 'Explore')).toEqual([])
    // A stated deliverable is an acceptance check; a worker kept to its own folder respects the shared tree.
    expect(briefIssues('Write scenario scripts in E:/tmp/x/. Work ONLY in that folder; no git changes. Deliverable: a ranked list.', undefined)).toEqual([])
  })

  test('a trap is offered as a rule from its third session', () => {
    const rule = { id: 'live-coding', title: 'Live Coding', fix: 'Close the Editor.' }
    const twice = countGotcha(countGotcha({}, rule), rule)
    expect(recurringGotchas(twice, [])).toHaveLength(0)
    expect(recurringGotchas(countGotcha(twice, rule), ['live-coding'])).toHaveLength(0)
    expect(recurringGotchas(countGotcha(twice, rule), []).map(one => one.count)).toEqual([3])
  })
})

describe('away windows', () => {
  test('hours and goals parse, typed loosely; anything else is not a window', () => {
    expect(parseAwayArgs('until done ship it', 0)).toEqual({ hours: 24, untilDone: true, goal: 'ship it' })
    expect(parseAwayArgs('2 hours, finish the pool', 0)).toEqual({ hours: 2, untilDone: false, goal: 'finish the pool' })
    expect(parseAwayArgs('finish the pool', 0)).toBe(null)
    expect(['stop', 'off', 'cancel', 'end now', 'end', "I'm back", 'back'].every(isStopWord)).toBe(true)
    const seven = 19 * 60
    expect(parseAwayArgs('30m', seven)?.hours).toBe(0.5)
    expect(parseAwayArgs('until 9am fix it', seven)).toEqual({ hours: 14, untilDone: false, goal: 'fix it' })
    expect(parseAwayArgs('tonight', seven)?.hours).toBe(14)
    expect(parseAwayArgs('until 21:30', seven)?.hours).toBe(2.5)
    // A named time may run past 16 hours: at noon, tonight (09:00) is 21 hours away.
    expect(parseAwayArgs('tonight', 12 * 60)?.hours).toBe(21)
    expect(isStopWord('until done')).toBe(false)
  })

  test('ledger ids continue from the file; park ids from the list; the mandate never merges', () => {
    const away = newWindow({ hours: 8, untilDone: false, goal: 'pool' }, NOON, 'L.md', { person: 'tinnguyen', root: 'R' })
    expect(nextLedgerId('### D-4 · old\n')).toBe(5)
    expect(nextParkId([{ id: 'P-2', kind: 'merge', command: '', at: 0 }])).toBe('P-3')
    const text = ledgerWithWindow('', away, 420)
    expect(text).toContain('## Autonomy window from 12:00, until 20:00')
    expect(mandateText(away, 420)).toContain('never merge')
    expect(windowDecisions(`${text}\n### D-1 · new one\n`)).toEqual([{ id: 'D-1', question: 'new one' }])
    expect(isEvening(EVENING, 420)).toBe(true)
  })
})

describe('shared state: one owner, one change at a time', () => {
  test('a held action and a deferred question at the same moment both survive', async () => {
    const { io, files } = memoryIo()
    await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    const [parked, deferred, second] = await Promise.all([
      state.park(io, 'merge', 'gh pr merge 1', NOON),
      state.deferQuestions(io, [{ question: 'Pool size?', options: [{ label: '32' }] }], 0),
      state.park(io, 'merge', 'gh pr merge 2', NOON),
    ])
    const away = await state.readAway(io)
    expect(away.parked.map(one => one.id)).toEqual(['P-1', 'P-2'])
    expect(parked?.parked.id).toBe('P-1')
    expect(second?.parked.id).toBe('P-2')
    expect(deferred?.ids).toEqual(['D-1'])
    expect(files.get(away.ledgerPath) ?? '').toContain('### D-1 · Pool size?')
  })

  test('a kind the window does not hold is not parked', async () => {
    const { io } = memoryIo()
    await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    expect(await state.park(io, 'asset-save', 'save_asset', NOON)).toBe(null)
  })

  test('ending twice keeps the review; a new window waits until it is reviewed', async () => {
    const { io } = memoryIo()
    await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    await state.park(io, 'merge', 'gh pr merge 1', NOON)
    expect(await state.endAway(io)).toBe(true)
    expect(await state.endAway(io)).toBe(false)
    const away = await state.readAway(io)
    expect(away.phase).toBe('review')
    expect(away.parked).toHaveLength(1)
    expect(await state.startAway(io, { hours: 4, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })).toBe(null)
  })

  test('a resume (a plain session id change) moves nothing; /clear moves the lane to the new id', async () => {
    const memory = memoryIo('old')
    memory.files.set('R/docs/intent/spawner/prompt.md', '# Spawner')
    await state.track(memory.io, 'R', 'spawner')
    await state.startAway(memory.io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    memory.switchSession('resumed')
    expect((await state.readAway(memory.io)).phase).toBe('off')
    expect(await state.readPinned(memory.io)).toBe(null)
    expect(memory.store.has('away:old')).toBe(true)
    await state.moveLane(memory.io, 'old', 'resumed')
    expect((await state.readAway(memory.io)).phase).toBe('running')
    expect(await state.readPinned(memory.io)).toBe('spawner')
    expect(memory.store.has('away:old')).toBe(false)
  })

  test('holds and question recording last through the review, until it is settled', async () => {
    const { io } = memoryIo()
    await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    await state.endAway(io)
    expect((await state.park(io, 'merge', 'gh pr merge 1', NOON))?.parked.id).toBe('P-1')
    // Ended, and the person has not typed since: still recorded. Once they type, they are asked.
    expect((await state.deferQuestions(io, [{ question: 'Q?', options: [] }], 0))?.ids).toEqual(['D-1'])
    expect(await state.deferQuestions(io, [{ question: 'Q2?', options: [] }], Date.now() + 1000)).toBe(null)
    expect((await state.park(io, 'merge', 'gh pr merge 3', NOON))?.parked.id).toBe('P-2')
    await state.closeAway(io)
    expect(await state.park(io, 'merge', 'gh pr merge 2', NOON)).toBe(null)
  })

  test("the ledger goes in your own intent's folder, never a teammate's", async () => {
    const { io, files } = memoryIo()
    files.set('R/docs/intent/theirs/prompt.md', '# T\n\n- Owner: TienPham\n')
    await state.track(io, 'R', 'theirs')
    const away = await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    expect(away?.ledgerPath.startsWith('R/Saved/AtherAutomata/away/')).toBe(true)
  })

  test("a new session takes over this person's window from an ended session, not from a live one or someone else's", async () => {
    const memory = memoryIo('night')
    await state.startAway(memory.io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    memory.switchSession('morning')
    expect(await state.adoptWindow(memory.io, { me: 'Tin Nguyen', root: 'R', isAlive: async () => true })).toBe(null)
    expect(await state.adoptWindow(memory.io, { me: 'Minh Tran', root: 'R', isAlive: async () => false })).toBe(null)
    // The window's time passed overnight: adopted straight into review, still holding.
    const adopted = await state.adoptWindow(memory.io, { me: 'Tin Nguyen', root: 'R', isAlive: async () => false })
    expect(adopted?.isOver).toBe(true)
    expect((await state.readAway(memory.io)).phase).toBe('review')
    expect(memory.store.has('away:night')).toBe(false)
  })

  test('pruning removes what ended sessions left behind, but keeps a window that still holds', async () => {
    const { io, store } = memoryIo('now')
    store.set('pinned:gone', 'x')
    store.set('evidence:gone', {})
    store.set('pinned:sleeping', 'y')
    store.set('away:sleeping', { phase: 'review', person: 'tinnguyen', root: 'R' })
    store.set('pinned:live', 'z')
    // A session in another checkout: this one cannot vouch it has gone, so it is kept.
    store.set('pinned:elsewhere', 'w')
    store.set('evidence:elsewhere', {})
    await state.prune(io, async sid => sid === 'gone' || sid === 'sleeping')
    expect([...store.keys()].sort()).toEqual(['away:sleeping', 'evidence:elsewhere', 'pinned:elsewhere', 'pinned:live', 'pinned:sleeping'])
  })

  test('tracking refuses an intent that does not exist', async () => {
    const { io } = memoryIo()
    expect(await state.track(io, 'R', 'no-such-intent')).toBe(false)
    expect(await state.readPinned(io)).toBe(null)
  })

  test('a readback counts only from the server that was written to', async () => {
    const { io } = memoryIo()
    await state.noteMcp(io, 's1', 'write', 'unreal', true)
    await state.noteMcp(io, 's1', 'read', 'other', true)
    expect((await state.readEvidence(io, 's1')).readback.state).toBe('none')
    await state.noteMcp(io, 's1', 'read', 'unreal', true)
    expect((await state.readEvidence(io, 's1')).readback.state).toBe('pass')
  })

  test("a tracked intent's evidence outlives the session and expires after a day", async () => {
    const { io, files, store } = memoryIo()
    files.set('R/docs/intent/spawner/prompt.md', '# S\n\n- Owner: Tin Nguyen\n')
    await state.track(io, 'R', 'spawner')
    const scope = await state.evidenceScope(io)
    expect(scope).toBe('spawner')
    await state.setRung(io, scope, 'build', { state: 'pass', detail: 'Result: Succeeded' })
    expect((await state.readEvidence(io, scope)).build.state).toBe('pass')
    const stored = /** @type {any} */ (store.get('evidence:spawner'))
    store.set('evidence:spawner', { ...stored, build: { ...stored.build, at: Date.now() - 25 * 3600 * 1000 } })
    expect((await state.readEvidence(io, scope)).build.state).toBe('none')
  })

  test('closing a window deletes it and its index entry; a failed hand-over can restore it; settling a rule settles that trap', async () => {
    const { io, store } = memoryIo()
    await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    expect(store.get('windows:tinnguyen')).toEqual(['s1'])
    await state.endAway(io)
    const saved = await state.readAway(io)
    await state.closeAway(io)
    expect(store.has('away:s1')).toBe(false)
    expect(store.has('windows:tinnguyen')).toBe(false)
    await state.restoreAway(io, saved)
    expect((await state.readAway(io)).phase).toBe('review')
    await state.closeAway(io)
    expect((await state.readAway(io)).phase).toBe('off')
    await state.settleItem(io, { kind: 'rule', ruleIds: ['live-coding'], id: 'x', label: '', title: '', question: '', prompt: '' })
    expect(await io.get('gotchaRuled')).toEqual(['live-coding'])
  })

  test('a trap whose rule is already written in the checkout is not offered as a rule', async () => {
    const { io, store, files } = memoryIo()
    const hit = { title: 't', fix: 'f', count: 4 }
    store.set('gotchaHits', { 'index-lock': hit, 'restore-packages': hit, disk: hit })
    expect((await state.readRecurring(io)).map(one => one.id).sort()).toEqual(['disk', 'index-lock', 'restore-packages'])
    files.set('R/docs/skills/git-lfs-traffic-control.md', 'On index.lock errors, find the holder first with `Get-CimInstance Win32_Process -Filter ...`')
    files.set('R/.agents/skills/unreal-mcp/SKILL.md', 'nothing about restore data yet')
    expect((await state.readRecurring(io)).map(one => one.id).sort()).toEqual(['disk', 'restore-packages'])
  })
})

describe('home', () => {
  const home = (over = {}) => buildHome(/** @type {any} */ (base({ away: OFF, ...over })))

  test('a tracked intent: header, my open director call with its id, labels for the desktop', () => {
    const model = home()
    expect(model.header.stage).toBe('Build')
    expect(model.items.map(one => one.id)).toEqual(['call:spawner:F-1'])
    expect(model.items[0]?.title).toBe('F-1 · Drops only or full respawn?')
    expect(model.items[0]?.label).toBe('Decide F-1 on spawner')
    expect(model.header.role).toBe('Engineer')
    // The pane's coloured stages say what the track says.
    expect(model.header.stages.map(one => `${one.label} ${one.state === 'done' ? '✓' : one.state === 'now' ? '●' : '○'}`).join('  ')).toBe(model.header.track)
    expect(model.open).toHaveLength(1)
    expect(home({ sent: ['call:spawner:F-1'] }).open).toHaveLength(0)
  })

  test('a newcomer gets the tour as Next and no hand-over offer, even in the evening', () => {
    const model = home({ me: 'Minh Tran', role: '', pinned: null, tourDone: false, now: EVENING })
    expect(model.isNewcomer).toBe(true)
    // The tour asks the role and is said once, by Next: the header repeats neither.
    expect(model.header.role).toBe('')
    expect(model.header.sentence).toBe('')
    expect(model.next?.label).toBe('Take the tour')
    // Until the git name is read, nobody is a newcomer and a teammate's role line stays.
    expect(home({ me: '', role: '', pinned: null, tourDone: false }).isNewcomer).toBe(false)
    expect(home({ me: 'Lan Vo', role: '', pinned: null, tourDone: true }).header.role).toBe('Role not set · /ather role')
    // Saying a role is enough to stop being new.
    expect(home({ me: 'Minh Tran', role: 'engineer', pinned: null, tourDone: false }).isNewcomer).toBe(false)
    expect(model.next?.isTour).toBe(true)
    expect(model.offerAway).toBe(false)
  })

  test('someone who owns intents is never a newcomer; Next picks up their best one; evening offers a hand-over', () => {
    const model = home({ pinned: null, role: '', tourDone: false })
    expect(model.isNewcomer).toBe(false)
    expect(model.next?.label).toBe('Pick up spawner')
    expect(model.picks.map(one => one.slug)).toEqual(['pause-ai'])
    expect(home({ pinned: null, now: EVENING }).offerAway).toBe(true)
  })

  test('while away: one item to end it; after: one review item with every decision and held action', () => {
    const running = newWindow({ hours: 8, untilDone: false, goal: '' }, NOON, 'L.md', { person: 'tinnguyen', root: 'R' })
    expect(home({ away: running }).items.map(one => one.kind)).toEqual(['away-end'])
    const review = home({ away: { ...running, phase: 'review', parked: [{ id: 'P-1', kind: 'merge', command: 'gh pr merge 1', at: 1 }] }, ledger: '## Autonomy window from 12:00\n### D-1 · Pool size?\n' })
    expect(review.items[0]?.title).toBe('Review what happened while you were away (1 decision, 1 held action)')
    expect(review.items[0]?.label).toBe('Review: 1 decision, 1 held action')
    expect(review.items[0]?.prompt).toContain('D-1 Pool size?')
    expect(review.items[0]?.prompt).toContain('P-1 gh pr merge 1')
  })

  test("following a teammate's intent never puts their decisions on you", () => {
    const model = home({ me: 'Minh Tran', role: 'designer', pinned: 'spawner' })
    expect(model.items.filter(one => one.kind === 'call')).toHaveLength(0)
    expect(model.next?.label).toBe('See where it stands')
  })

  test('lost edits, a blocking Editor lock for a designer, and a recurring trap each wait in Needs you', () => {
    const model = home({ role: 'designer', lost: { paths: ['A.uasset'], isDisclosed: false }, lock: parseEditorLock('held by lane-7 until 23:00', 600), recurring: [{ id: 'x', title: 'Trap', fix: 'Fix.', count: 3 }] })
    expect(model.items.map(one => one.kind)).toEqual(['lost', 'call', 'editor', 'rule'])
    expect(model.items.find(one => one.kind === 'rule')?.prompt).toContain('do not commit')
  })

  test('many problems that keep coming back wait as one item, which settles them all', async () => {
    const recurring = ['a', 'b', 'c'].map(id => ({ id, title: `Trap ${id}`, fix: 'Fix.', count: 3 }))
    const rules = home({ recurring }).items.filter(one => one.kind === 'rule')
    expect(rules).toHaveLength(1)
    expect(rules[0].title).toBe('3 problems keep coming back: make them rules?')
    expect(rules[0].prompt).toContain('multiSelect')
    const { io } = memoryIo()
    await state.settleItem(io, rules[0])
    expect(await io.get('gotchaRuled')).toEqual(['a', 'b', 'c'])
  })
})

describe('what the intent recorded', () => {
  const PROMPT = '# X\n\n## Goal\n\nSnow that takes footprints.\n\n## Scope\n\nSnow and sand.\n\n## Acceptance\n\n- [ ] A1: Snow look. Real depth.\n- [ ] A2 (owed): Sand look. Grain.\n'

  test('a ticked item, a new goal, a narrower scope: one plain line each', () => {
    expect(intentChanges('prompt.md', PROMPT, PROMPT.replace('- [ ] A2', '- [x] A2'))).toEqual([{ kind: 'done', id: 'A2', text: 'Ticked A2 · Sand look' }])
    expect(intentChanges('prompt.md', PROMPT, PROMPT.replace('Snow that takes footprints.', 'Snow and sand that take footprints.')).map(one => one.text)).toEqual(['Goal changed'])
    expect(intentChanges('prompt.md', PROMPT, PROMPT.replace('Snow and sand.\n', 'Snow only.\n')).map(one => one.text)).toEqual(['Scope changed'])
    expect(intentChanges('prompt.md', PROMPT, PROMPT.replace('Real depth.', 'Real depth and a rim.'))).toEqual([])
    expect(intentChanges('prompt.md', '', PROMPT)).toEqual([])
  })

  test('a new decision for the person, and a decision taken', () => {
    const before = '## F-1 (2026-10-01) | blocking: no | status: open (engineering)\nUse the snow material for sand?\n'
    const asked = `${before}\n## F-2 (2026-10-04) | blocking: yes | status: open (director)\nKeep sand trails in PIE only?\n`
    expect(intentChanges('findings.md', before, asked).map(one => one.text)).toEqual(['New decision F-2 · yours'])
    const decided = before.replace('status: open (engineering)', 'status: resolved (engineering)')
    expect(intentChanges('findings.md', before, decided).map(one => one.kind)).toEqual(['changed'])
    expect(intentChanges('findings.md', before, decided)[0].text.startsWith('Decided F-1')).toBe(true)
  })

  test('a ready intent heads the pane as Ready to close, every stage ticked, with Close as Next', () => {
    const ready = parseIntent({ slug: 'board', prompt: prompt({ Status: 'active', Area: 'Tools', Owner: 'Tin Nguyen' }, '- B1: One.'), findings: '', progress: '# P\n\n- PR: #7\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n| B1 | met | t |\n', files: [], hasDebrief: false, mtimeMs: 1 })
    const model = buildHome(base({ intents: [ready], pinned: 'board', away: OFF, prs: { 7: 'MERGED' } }))
    expect([model.header.stage, model.header.progress, model.header.track]).toEqual(['Ready to close', '1 of 1 done', 'Plan ✓  Build ✓  Prove ✓  Ship ✓'])
    expect(model.next?.id).toBe('next:board:close')
  })

  test('only an intent\'s prompt, findings and progress count', () => {
    expect(intentFileOf('E:/S2_/docs/intent/snow/progress.md')).toEqual({ slug: 'snow', file: 'progress.md' })
    expect(intentFileOf('E:/S2_/docs/intent/snow/prompt.md')).toEqual({ slug: 'snow', file: 'prompt.md' })
    expect(intentFileOf('E:\\S2_\\docs\\intent\\snow\\findings.md')).toEqual({ slug: 'snow', file: 'findings.md' })
    expect(intentFileOf('E:/S2_/docs/intent/snow/log.md')).toBe(null)
  })
})

describe('the worker squad', () => {
  test('a worker\'s kind comes from its dispatch: the agent type, then what the brief asks for', () => {
    expect(classifyWorker({ subagentType: 'Explore', prompt: 'Find every caller of Foo.' })).toBe('scout')
    expect(classifyWorker({ subagentType: 'general-purpose', prompt: 'Run the thermo-nuclear review on the diff.' })).toBe('reviewer')
    expect(classifyWorker({ subagentType: 'general-purpose', prompt: 'Take the Editor owner lock first, then set the material params.' })).toBe('editor')
    expect(classifyWorker({ subagentType: 'general-purpose', prompt: 'Prove A11 in PIE with the MainChar test simulation.' })).toBe('tester')
    expect(classifyWorker({ subagentType: 'general-purpose', prompt: 'Implement the footprint fade and build S2Editor.' })).toBe('builder')
    expect(classifyWorker({ subagentType: 'general-purpose', prompt: 'Summarise yesterday.' })).toBe('general')
  })

  test('what a worker is doing comes from its tool calls; a call that says nothing keeps the last', () => {
    expect(propForTool('Grep', {})).toBe('reading')
    expect(propForTool('Edit', {})).toBe('editing')
    expect(propForTool('Bash', { command: 'Build.bat S2Editor Win64 Development' })).toBe('building')
    expect(propForTool('Bash', { command: 'Run-S2Automation -Filter Snow' })).toBe('testing')
    expect(propForTool('mcp__unreal-mcp__StartPIE', {})).toBe('testing')
    expect(propForTool('mcp__unreal-mcp__set_material_param', { value: 1 })).toBe('editor')
    expect(propForTool('Skill', { skill: 'thermo-nuclear-code-quality-review' })).toBe('reviewing')
    expect(propForTool('Bash', { command: 'echo hi' })).toBe(null)
  })

  test('the kind is fixed at dispatch; the trail keeps each distinct step, in order', () => {
    resetWorkers()
    recordSpawn({ agentId: 'a', subagentType: 'general-purpose', prompt: 'Implement it and build.', description: 'A13', model: 'claude-opus-5-5', at: 0 })
    for (const [tool, input] of [['Read', {}], ['Grep', {}], ['Edit', {}], ['Bash', { command: 'Build.bat S2Editor' }], ['Bash', { command: 'Run-S2Automation' }], ['Bash', { command: 'echo done' }]]) recordTool('a', tool, input, 1)
    const worker = workerOf('a')
    expect(worker?.kind).toBe('builder')
    expect(worker?.tools).toBe(6)
    expect(worker?.prop).toBe('testing')
    expect(trailWords(worker?.trail ?? [])).toBe('read → edit → build → test')
  })

  test('statuses read as states; an avatar wears its kind\'s colour and its state\'s ring', () => {
    expect(['running', 'completed', 'failed', 'killed', 'pending'].map(workerState)).toEqual(['running', 'done', 'failed', 'failed', 'waiting'])
    const svg = avatarSvg('tester', 'testing', 'done')
    expect(svg).toContain(KINDS.tester.fill)
    expect(svg).toContain('#3ccf7a')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(avatarSvg('builder', null, 'running')).toContain('animateTransform')
    // A running avatar is framed; a frame whose colour scheme differs from the app's paints a white square behind it.
    expect(avatarSvg('builder', null, 'running')).toContain('color-scheme: light dark')
  })
})

describe('avatar frame (0.1.3)', () => {
  test("every avatar sets its frame page's root to light dark, first thing in the svg, so the frame is transparent in either theme", () => {
    for (const state of /** @type {const} */ (['running', 'waiting', 'done', 'failed'])) {
      for (const prop of /** @type {const} */ ([null, 'building', 'idle'])) {
        const svg = avatarSvg('builder', prop, state)
        // The desktop's frame page is <style>…</style><svg…>: only a rule on :root reaches the page's root.
        expect(svg).toMatch(/^<svg [^>]*><style>:root\{color-scheme:light dark;background:transparent\}<\/style>/)
        expect(svg.match(/<style>/g)?.length ?? 0).toBe(1)
      }
    }
    expect(FRAME_SCHEME).toBe('<style>:root{color-scheme:light dark;background:transparent}</style>')
  })

  test('every Svg Ather draws, with whether it is framed (isInteractive) and why', async () => {
    const fs = await import('node:fs')
    // Every hooks file, at any depth: an Svg drawn anywhere (any prop order, over several lines, a destructured Svg,
    // JSX) is counted, so a new one fails this test until it is listed below with its reason.
    const hooks = new URL('../hooks/', import.meta.url)
    const sources = fs.readdirSync(hooks, { recursive: true }).map(String).filter(name => /\.(m?js|tsx?)$/.test(name)).map(name => fs.readFileSync(new URL(name.replace(/\\/g, '/'), hooks), 'utf8'))
    const uses = sources.reduce((n, text) => n + [...text.matchAll(/\bSvg\(|<Svg\b|\bh\(\s*Svg\b/g)].length, 0)
    expect(uses).toBe(3)
    // Each `Svg({` call in the hooks, with its isInteractive expression ('' when it has none: a still image).
    const drawn = sources.flatMap(text => [...text.matchAll(/\bSvg\(\{([^\n]*?)\}\)/g)].map(([, props]) => ({ source: /source: ([^,]+)/.exec(props)?.[1] ?? '', framed: /isInteractive: ([^,}]+)/.exec(props)?.[1]?.trim() ?? '' })))
    expect(drawn).toEqual([
      // The Ather mark in the desktop masthead: a still image, nothing moves.
      { source: 'MARK', framed: '' },
      // A finished worker's trail: still images, so no frame and no page behind them.
      { source: 'propSvg(prop)', framed: '' },
      // A worker's avatar: framed only while it runs (its bob); FRAME_SCHEME keeps that frame transparent.
      { source: 'avatarSvg(one.kind', framed: "one.state === 'running' ? true : undefined" },
    ])
    expect(propSvg('reading').startsWith('<svg')).toBe(true)
  })
})

describe('create in the Editor', () => {
  const home = (over = {}) => buildHome(/** @type {any} */ (base({ away: OFF, pinned: null, ...over })))
  const present = ['bt-graph', 'boss-bt-authoring', 'team-move-rule-book-authoring', 'qte-content-authoring', 'unreal-niagara-mcp', 'level-cinematics-authoring'].map(name => ({ name, description: `What ${name} does.` }))

  test('Create appears when Editor skills are present, grouped and ordered by role', () => {
    const designer = home({ role: 'designer', skills: present })
    expect(designer.actions.map(one => one.label)).toEqual(['＋ New intent', '✦ Create'])
    expect(designer.create.map(one => one.group)).toEqual(['AI and encounters', 'Levels and cinematics', 'VFX and look'])
    expect(designer.create[0].items.map(one => one.verb)).toEqual(['Edit a Behavior Tree', 'Design a boss or elite fight', 'Make a Team Move rule book for a squad', 'Add a QTE'])
    expect(home({ role: 'techart', skills: present }).create[0].group).toBe('VFX and look')
    expect(home({ role: 'designer', skills: [] }).actions.map(one => one.label)).toEqual(['＋ New intent'])
  })

  test('the request asks first, records an intent, and respects a held Editor lock', () => {
    const free = home({ role: 'designer', skills: present, lock: parseEditorLock('free since 14:18', 600) })
    expect(free.create[0].items[0].prompt).toContain('First ask me what I want')
    expect(free.create[0].items[0].prompt).toContain('.agents/skills/bt-graph/SKILL.md')
    expect(free.create[0].items[0].prompt).not.toContain('held by')
    const held = home({ role: 'designer', skills: present, lock: parseEditorLock('held by lane-7 until 23:00', 600) })
    expect(held.editor.isHeld).toBe(true)
    expect(held.create[0].items[0].prompt).toContain('held by lane-7 until 23:00: ask that lane for a window first')
  })
})

describe('quick actions', () => {
  test('New intent always; Skills opens the short list, grouped, of the listed skills present here', () => {
    const home = (over = {}) => buildHome(/** @type {any} */ (base({ away: OFF, ...over })))
    const model = home({ pinned: null, skills: [{ name: 'talab', description: 'Test a TechArt job.' }, { name: 'thermo-nuclear-code-quality-review', description: 'Strict review.' }, { name: 'night-watch', description: 'Not listed.' }] })
    expect(model.actions.map(one => one.label)).toEqual(['＋ New intent', '▶ Skills'])
    expect(model.skills.map(one => `${one.group}: ${one.name}`)).toEqual(['Review and proof: thermo-nuclear-code-quality-review', 'Agentic testing: talab'])
    expect(home({ pinned: null, skills: [] }).actions.map(one => one.label)).toEqual(['＋ New intent'])
  })
})

describe('GitHub issues as work', () => {
  test('a row shows the words of a title, and its tags fill in a missing area', () => {
    expect(issueName('[QA][Steam][PRE-PROD: BOSS-ENE][BVT][Phase 3]: Boss shield stays up after the phase change').name).toBe('Boss shield stays up after the phase change')
    expect(issueName('task_S02_VFX_rain-particles-on-low-settings').name).toBe('Rain particles on low settings')
    expect(issueName('Plain title').name).toBe('Plain title')
    const [issue] = parseIssues(JSON.stringify([{ number: 1, title: '[QA][PRE-PROD: BOSS-ENE]: Boss shakes', labels: [], updatedAt: '2026-09-01T00:00:00Z' }]))
    expect(issue.area).toBe('Bosses')
    expect(issue.title).toBe('[QA][PRE-PROD: BOSS-ENE]: Boss shakes')
    expect(issueLabel({ ...issue, area: 'Unsorted' }, Date.parse('2026-09-01T12:00:00Z'))).toBe('today')
  })

  const GH = JSON.stringify([
    { number: 31360, title: 'Cheaper rain particles on low settings', url: 'https://github.com/sipherxyz/s2/issues/31360', labels: [], updatedAt: '2026-09-15T11:52:35Z' },
    { number: 28887, title: '[BUG] Dodge cancels the wrong montage', url: 'u', labels: [{ name: 'combat' }, { name: 'animation-code' }, { name: 'priority:high' }], updatedAt: '2026-07-21T02:57:12Z' },
  ])
  const issues = parseIssues(GH)

  test('urgent first, then most recent; area from labels; a broken reply is no issues', () => {
    expect(issues.map(one => one.number)).toEqual([28887, 31360])
    expect(issues[0]?.area).toBe('Combat')
    expect(areaFromLabels(['animation-code'])).toBe('Characters & Animation')
    expect(areaFromLabels(['VFX'])).toBe('VFX')
    expect(parseIssues('not json')).toEqual([])
  })

  test('a row says the number, area and age; the request runs the preflight and changes nothing on GitHub', () => {
    const issue = /** @type {import('../hooks/issues.mjs').Issue} */ (issues[0])
    expect(issueLabel(issue, Date.UTC(2026, 9, 4))).toBe('high priority · Combat · 2 months ago')
    // With no role set, the session is asked to find it out.
    expect(issuePrompt(issue, 'Lan Vo', '')).toContain('ask me (designer, tech artist or engineer)')
    expect(issuePrompt(issue, 'Lan Vo', 'engineer')).not.toContain('ask me (designer')
    const prompt = issuePrompt(issue, 'Tin Nguyen')
    expect(prompt).toContain('issue-preflight')
    expect(prompt).toContain('--issue 28887')
    expect(prompt).toContain('"- Issue: #28887"')
    expect(prompt).toContain('Do not comment on, assign or close the issue')
  })

  test('one list: your intents, then your issues without an intent, then teammates\' intents', () => {
    // Any way of naming the issue links it: #N, owner/repo#N, a link, a bare number.
    expect(intent('a', { Issue: 'sipherxyz/S2#28887' }).issue).toBe(28887)
    expect(intent('a', { Issue: 'https://github.com/sipherxyz/S2/issues/28887' }).issue).toBe(28887)
    expect(intent('a', { Issue: '28887' }).issue).toBe(28887)
    const linked = intent('time-dilation', { Issue: '#28887' })
    const work = workList([SPAWNER, THEIRS, linked], issues, 'Tin Nguyen', '', NOON)
    expect(work.map(one => one.id)).toEqual(['intent:spawner', 'intent:time-dilation', 'issue:31360', 'intent:pause-ai'])
  })

  test('with no intent of your own, Next starts your most urgent issue', () => {
    const model = buildHome(/** @type {any} */ (base({ away: OFF, me: 'Lan Vo', role: 'engineer', pinned: null, issues })))
    expect(model.next?.label).toBe('Start issue #28887')
    expect(model.next?.hint).toBe('Dodge cancels the wrong montage · high priority · Combat · 2 months ago')
    expect(model.next?.prompt).toContain('issue-preflight')
    expect(model.picks[0]?.id).toBe('issue:31360')
    // Once started, it leaves Next for the rest of the session.
    const started = buildHome(/** @type {any} */ (base({ away: OFF, me: 'Lan Vo', role: 'engineer', pinned: null, issues, sent: ['issue:28887'] })))
    expect(started.next?.label).toBe('Start issue #31360')
  })

  test('a day-old issue list is not shown; a fresh one is', async () => {
    const { io, store } = memoryIo()
    await state.setIssues(io, 'Lan Vo', issues)
    expect(await state.readIssues(io, 'Lan Vo')).toHaveLength(2)
    store.set('issues:lanvo', { at: Date.now() - 25 * 3600 * 1000, list: issues })
    expect(await state.readIssues(io, 'Lan Vo')).toHaveLength(0)
  })
})

describe('the week figures from week-calendar', () => {
  const week = (over = {}) => JSON.stringify({ week: { startMs: NOON - 2 * 86400000, endMs: NOON + 5 * 86400000 }, metrics: { prsMerged: 3 }, machineHours: { productiveUtilization: 0.684 }, ...over })

  test('read while their week is running; nothing otherwise', () => {
    expect(parseWeek(week(), NOON)).toEqual({ prsMerged: 3, productive: 0.684 })
    expect(parseWeek(week(), NOON + 6 * 86400000)).toBe(null)
    expect(parseWeek(null, NOON)).toBe(null)
    expect(parseWeek('{', NOON)).toBe(null)
    expect(parseWeek(week({ metrics: undefined }), NOON)).toBe(null)
  })

  test('one quiet line in the header, only when there are figures', () => {
    expect(weekText({ prsMerged: 3, productive: 0.684 })).toBe('This week: 3 PRs merged · 68% productive')
    expect(weekText({ prsMerged: 1, productive: null })).toBe('This week: 1 PR merged')
    expect(buildHome(/** @type {any} */ (base({ away: OFF, week: parseWeek(week(), NOON) }))).header.week).toBe('This week: 3 PRs merged · 68% productive')
    expect(buildHome(/** @type {any} */ (base({ away: OFF }))).header.week).toBe('')
  })
})

describe('the second panel review (0.0.8)', () => {
  test('a lock that says no agent holds it is free; a held one names its session', () => {
    const free = parseEditorLock('Editor open on main be77a0955406 (Development) launched by Claude session b3ebb2cb at 20:38 for Tin; free for Tin to use; no agent holds it since 20:40', 21 * 60)
    expect(free.state).toBe('free')
    expect(free.until).toBe('20:40')
    const held = parseEditorLock('Editor held by Claude session 1a2b3c4d for the snow proof until 23:00', 21 * 60)
    expect(held.state).toBe('held')
    expect(held.session).toBe('1a2b3c4d')
    expect(held.until).toBe('23:00')
  })
  test("a session's name is its last title the person set, else the last generated one", () => {
    expect(sessionTitle('"aiTitle":"Mock test"\n"customTitle":"💬 Snow proof"\n"customTitle":"🟢 Snow proof"\n')).toBe('🟢 Snow proof')
    expect(sessionTitle('"aiTitle":"Old"\n"aiTitle":"Mock test with agents"\n')).toBe('Mock test with agents')
    expect(sessionTitle('')).toBe('')
  })
  test('a parked intent says why; a decision keeps its whole text beside its short title', () => {
    const parked = intent('x', { Status: 'parked: waiting on the weather presets', Area: 'vfx', Owner: 'Lan Vo' })
    expect(intentLabel(parked, 'Tin Nguyen')).toContain('parked: Waiting on the weather presets')
    const [first] = parseFindings('# Findings\n\n## F-1 (2026-10-01) | blocking: no | status: open (director)\n\nFound: the snow lab cannot drive either hook from its production path. A second sentence explains why.\n', '')
    expect(first?.full).toBe('The snow lab cannot drive either hook from its production path. A second sentence explains why.')
  })
})

describe('track guard', () => {
  test('untrack (A1): the pin goes, "Continue …" goes when it names the same intent, the proof stays with the intent', async () => {
    const { io, files } = memoryIo()
    files.set('R/docs/intent/spawner/prompt.md', '# S')
    await state.track(io, 'R', 'spawner', { me: 'Tin Nguyen' })
    await state.setRung(io, await state.evidenceScope(io), 'build', { state: 'pass', detail: 'Result: Succeeded' })
    expect(await state.readLast(io, 'Tin Nguyen')).toBe('spawner')
    const outcome = await state.untrack(io, 'Tin Nguyen')
    expect(outcome).toEqual({ result: 'untracked', slug: 'spawner' })
    expect(untrackText(outcome)).toBe('Stopped tracking spawner. Its proof so far stays with the intent.')
    expect(await state.readPinned(io)).toBe(null)
    expect(await state.readLast(io, 'Tin Nguyen')).toBe(null)
    expect((await state.readEvidence(io, 'spawner')).build.state).toBe('pass')
    expect(await state.evidenceScope(io)).toBe('s1')
    const again = await state.untrack(io, 'Tin Nguyen')
    expect(again.result).toBe('none')
    expect(untrackText(again)).toBe('Nothing is tracked in this session.')
  })

  test('untrack keeps "Continue …" when it names another intent', async () => {
    const { io, files } = memoryIo()
    files.set('R/docs/intent/spawner/prompt.md', '# S')
    files.set('R/docs/intent/pause-ai/prompt.md', '# P')
    await state.track(io, 'R', 'spawner', { me: 'Tin Nguyen' })
    await state.track(io, 'R', 'pause-ai')
    await state.untrack(io, 'Tin Nguyen')
    expect(await state.readLast(io, 'Tin Nguyen')).toBe('spawner')
  })

  test('a write does not track again an intent this session stopped tracking; tracking it on purpose does, and lifts the stop', async () => {
    const { io, files, store } = memoryIo()
    files.set('R/docs/intent/spawner/prompt.md', '# S')
    files.set('R/docs/intent/pause-ai/prompt.md', '# P')
    await state.track(io, 'R', 'spawner')
    await state.untrack(io, 'Tin Nguyen')
    expect(await state.track(io, 'R', 'spawner', { isAuto: true, onlyIfNone: true })).toBe(false)
    expect(await state.track(io, 'R', 'spawner', { isAuto: true })).toBe(false)
    expect(await state.readPinned(io)).toBe(null)
    // Another intent still tracks from a write.
    expect(await state.track(io, 'R', 'pause-ai', { isAuto: true, onlyIfNone: true })).toBe(true)
    expect(await state.track(io, 'R', 'spawner')).toBe(true)
    expect(store.has('untracked:s1')).toBe(false)
    // The stop follows the lane after /clear.
    await state.untrack(io, 'Tin Nguyen')
    await state.moveLane(io, 's1', 's2')
    expect(store.get('untracked:s2')).toEqual(['spawner'])
  })

  test('untrack is refused while an away window runs; once it has ended, it goes through', async () => {
    const { io, files } = memoryIo()
    files.set('R/docs/intent/spawner/prompt.md', '# S\n\n- Owner: Tin Nguyen\n')
    await state.track(io, 'R', 'spawner')
    await state.startAway(io, { hours: 8, untilDone: false, goal: '' }, { root: 'R', tz: 0, now: NOON, me: 'Tin Nguyen' })
    const refused = await state.untrack(io, 'Tin Nguyen')
    expect(refused).toEqual({ result: 'away', slug: 'spawner' })
    expect(untrackText(refused)).toBe('End the away window first.')
    expect(await state.readPinned(io)).toBe('spawner')
    await state.endAway(io)
    expect((await state.untrack(io, 'Tin Nguyen')).result).toBe('untracked')
    expect((await state.readAway(io)).phase).toBe('review')
  })

  test('without a pane, an intent is said in one line, and so is what working on it here means (D5)', () => {
    expect(intentStands(SPAWNER, 'Build', 'Tin Nguyen')).toBe('spawner: Build, 1/2 done, yours.')
    expect(intentStands(THEIRS, 'Build', 'Tin Nguyen', 'Also tracked in 1 other session · active now')).toBe("pause-ai: Build, 1/2 done, TienPham's. Also tracked in 1 other session · active now.")
    expect(trackConsequence()).toBe('This session gets its next step, your builds and PIE count as its proof, other sessions see you on it; /ather untrack undoes it.')
  })

  test("auto-track (A3) reads only the orchestrator's files: an intent's prompt.md and log.md", () => {
    expect(orchestrationFileOf('E:/S2/docs/intent/spawner/prompt.md')).toEqual({ slug: 'spawner', file: 'prompt.md' })
    expect(orchestrationFileOf('docs\\intent\\spawner\\log.md')).toEqual({ slug: 'spawner', file: 'log.md' })
    for (const other of ['docs/intent/spawner/progress.md', 'docs/intent/spawner/findings.md', 'docs/intent/spawner/decisions.md', 'docs/intent/README.md', 'docs/intent/spawner/notes/prompt.md.bak', 42]) expect(orchestrationFileOf(other)).toBe(null)
  })

  test('the heartbeat is written again at once on track and untrack (D4), with the last activity', async () => {
    const { io, files } = memoryIo()
    files.set('R/docs/intent/spawner/prompt.md', '# S')
    state.markActive(NOON)
    await state.writeHeartbeat(io, { root: 'R', localDir: 'L', branch: 'main', hasEnded: false })
    const lane = () => JSON.parse(files.get('R/L/lanes/s1.json') ?? '{}')
    expect(lane().intent).toBe(null)
    expect(lane().lastActiveAt).toBe(NOON)
    await state.track(io, 'R', 'spawner')
    expect(lane().intent).toBe('spawner')
    await state.untrack(io, 'Tin Nguyen')
    expect(lane().intent).toBe(null)
    expect(lane().branch).toBe('main')
    state.markActive()
  })

  test('held by (A4): the live sessions on this checkout tracking the same intent, as one line', async () => {
    const memory = memoryIo('me')
    const now = Date.now()
    const write = (/** @type {string} */ sid, /** @type {object} */ lane) => memory.files.set(`R/L/lanes/${sid}.json`, JSON.stringify({ sessionId: sid, branch: 'main', updatedAt: now, away: 'off', hasEnded: false, ...lane }))
    write('me', { intent: 'spawner' })
    write('p1', { intent: 'spawner', lastActiveAt: now - 5 * 60000 })
    write('p2', { intent: 'pause-ai', lastActiveAt: now })
    write('p3', { intent: 'spawner', hasEnded: true })
    const peers = await state.readPeers(memory.io, 'R', 'L')
    expect(peers.map(one => one.sessionId).sort()).toEqual(['p1', 'p2'])
    expect(heldByLine(peers, 'spawner', now)).toBe('Also tracked in 1 other session · active 5m ago')
    expect(heldByLine([...peers, { intent: 'spawner', updatedAt: now, lastActiveAt: now - 20000 }], 'spawner', now)).toBe('Also tracked in 2 other sessions · active now')
    expect(heldByLine(peers, 'box-scale-tool', now)).toBe('')
    expect(heldByLine([{ intent: null, updatedAt: now }], '', now)).toBe('')
  })

  test('proof attribution (A5): every record is stamped with the session that wrote it, and names it when it is not this one', async () => {
    const memory = memoryIo('1a2b3c4d-0000-4000-8000-000000000000')
    await state.setRung(memory.io, 'spawner', 'build', { state: 'pass', detail: 'Result: Succeeded' })
    await state.noteMcp(memory.io, 'spawner', 'pie', 'L_SnowLab', true)
    memory.switchSession('9f8e7d6c-0000-4000-8000-000000000000')
    await state.noteMcp(memory.io, 'spawner', 'write', 'unreal', true)
    await state.noteMcp(memory.io, 'spawner', 'read', 'unreal', true)
    const evidence = await state.readEvidence(memory.io, 'spawner')
    expect([evidence.build.by, evidence.pie.by, evidence.readback.by]).toEqual(['1a2b3c4d', '1a2b3c4d', '9f8e7d6c'])
    expect(proofLine(evidence, unreal, '9f8e7d6c')).toBe('build ✓ by session 1a2b3c4d · read-back ✓ · PIE ✓ by session 1a2b3c4d')
    expect(proofLine(evidence, unreal, '1a2b3c4d', { '9f8e7d6c': 'Snow proof' })).toBe('build ✓ · read-back ✓ by "Snow proof" · PIE ✓')
    // Records from before the stamp name nobody.
    expect(proofLine({ ...emptyEvidence(), build: { state: 'fail', detail: 'x' } }, unreal, 'abc')).toBe('build ✗')
  })
})

describe('worker clocks and kinds (0.1.1)', () => {
  test('a fix round is a builder though its brief quotes the review; the description decides first', () => {
    expect(classifyWorker({ subagentType: 'general-purpose', description: 'Thermo round 1 fixes', prompt: 'Apply the thermo-nuclear review findings.' })).toBe('builder')
    expect(classifyWorker({ subagentType: 'general-purpose', description: 'Thermo review: core', prompt: 'Review the core and fix nothing.' })).toBe('reviewer')
    expect(classifyWorker({ subagentType: 'general-purpose', description: 'Separate PR: rule book gap', prompt: 'Take the Editor owner lock first.' })).toBe('editor')
  })
  test("a worker's clock runs to now while it runs and to its last turn's end once finished", () => {
    resetWorkers()
    recordSpawn({ agentId: 'w', subagentType: 'general-purpose', prompt: 'Fix it.', description: 'Fix it', model: 'opus', at: 1000 })
    expect(workerElapsed(/** @type {any} */ (workerOf('w')), true, 9000)).toBe(8000)
    recordEnd('w', 5000)
    expect(workerElapsed(/** @type {any} */ (workerOf('w')), false, 9000)).toBe(4000)
    // Resumed and ended again: the later end wins; running again, it counts to now.
    recordEnd('w', 12000)
    expect(workerElapsed(/** @type {any} */ (workerOf('w')), false, 20000)).toBe(11000)
    expect(workerElapsed(/** @type {any} */ (workerOf('w')), true, 20000)).toBe(19000)
  })
  test('a worker found running later is adopted whole: its start from the record, not idle, its calls uncounted', () => {
    resetWorkers()
    adoptWorker({ id: 'old', type: 'general-purpose', description: 'Thermo round 1 fixes', model: 'opus', startedAt: 1000, now: 600000 })
    const worker = /** @type {any} */ (workerOf('old'))
    expect(worker.origin).toBe('adopted')
    expect(worker.kind).toBe('builder')
    expect(worker.lastAt).toBe(600000)
    expect(workerElapsed(worker, false, 700000)).toBe(null)
  })
  test('a row says what is known: no count for a worker found later, no clock without a start', () => {
    const base = { state: /** @type {const} */ ('running'), prop: null, tools: 3, via: '' }
    expect(crewWords({ ...base, origin: 'seen', elapsed: 5000 })).toEqual({ doing: 'starting', line: 'running 0:05 · 3 tool calls' })
    expect(crewWords({ ...base, origin: 'adopted', elapsed: 600000, via: 'Thermo round 1 fixes' })).toEqual({ doing: 'working', line: 'running 10:00 · started by Thermo round 1 fixes' })
    expect(crewWords({ ...base, origin: 'unknown', elapsed: null })).toEqual({ doing: 'working', line: 'running · start unknown' })
    expect(crewWords({ ...base, state: 'done', origin: 'seen', elapsed: 1280000, tools: 1 })).toEqual({ doing: 'finished', line: 'took 21:20 · 1 tool call' })
    expect(crewWords({ ...base, state: 'done', origin: 'adopted', elapsed: null })).toEqual({ doing: 'finished', line: '' })
  })
})
