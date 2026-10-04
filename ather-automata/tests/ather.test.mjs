// @ts-check
import { describe, expect, test } from 'claude-code/testing'

import { isStopWord, ledgerWithWindow, mandateText, newWindow, nextLedgerId, nextParkId, parseAwayArgs, windowDecisions } from '../hooks/away.mjs'
import { automationResult, briefIssues, buildResult, countGotcha, explainGuard, heldShell, isAssetSave, isBuildCommand, isEditorBuild, isLogRead, isMergeCommand, isSearchCommand, mcpKind, mcpServer, recurringGotchas } from '../hooks/guards.mjs'
import { buildHome, workList } from '../hooks/home.mjs'
import { areaFromLabels, issueLabel, issuePrompt, parseIssues } from '../hooks/issues.mjs'
import { closestWord, currentStage, emptyEvidence, isEvening, isSamePerson, nextStep, parseEditorLock, parseFindings, parseIntent, parseRole, pickCandidates, searchIntents, shortTitle } from '../hooks/model.mjs'
import * as state from '../hooks/state.mjs'

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
    await state.settleItem(io, { kind: 'rule', ruleId: 'live-coding', id: 'x', label: '', title: '', question: '', prompt: '' })
    expect(await io.get('gotchaRuled')).toEqual(['live-coding'])
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
    expect(model.header.role).toBe('as Engineer')
    expect(model.open).toHaveLength(1)
    expect(home({ sent: ['call:spawner:F-1'] }).open).toHaveLength(0)
  })

  test('a newcomer gets the tour as Next and no hand-over offer, even in the evening', () => {
    const model = home({ me: 'Minh Tran', role: '', pinned: null, tourDone: false, now: EVENING })
    expect(model.isNewcomer).toBe(true)
    expect(model.header.role).toBe('role not set (/ather role)')
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
})

describe('GitHub issues as work', () => {
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
    expect(model.next?.hint).toBe('[BUG] Dodge cancels the wrong montage · high priority · Combat · 2 months ago')
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
