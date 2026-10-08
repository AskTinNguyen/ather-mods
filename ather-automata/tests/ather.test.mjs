// @ts-check
import { describe, expect, test } from 'claude-code/testing'

import { isStopWord, ledgerWithWindow, mandateText, newWindow, nextLedgerId, nextParkId, parseAwayArgs, windowDecisions } from '../hooks/away.mjs'
import { automationResult, briefIssues, buildResult, countGotcha, explainGuard, heldShell, isAssetSave, isBuildCommand, isEditorBuild, isLogRead, isMergeCommand, isSearchCommand, mcpKind, mcpServer, recurringGotchas } from '../hooks/guards.mjs'
import { PEOPLE_COLOURS, WORK_GROUPS, buildHome, dimColour, filterWork, heldByLine, intentStands, parseWeek, personColours, proofLine, trackConsequence, untrackText, weekText, workGroup, workList } from '../hooks/home.mjs'
import { areaFromLabels, issueId, issueLabel, issueName, issueOtherRoot, issuePrompt, parseIssues } from '../hooks/issues.mjs'
import { aboutIntentPrompt, closestWord, isReadyToClose, prKey, prStatusList, currentStage, emptyEvidence, isEvening, isSamePerson, nextStep, intentLabel, optionLabel, parseEditorLock, parseFindings, parseIntent, parseOptions, parseRole, pickCandidates, searchIntents, sessionTitle, shortTitle } from '../hooks/model.mjs'
import { DECIDED_SHOWN_MS, FRESH_ANSWERS, NONE_OPEN, callId, decidePrompt, decidedText, decidedView, findingAnswers, needsView, openedDecision, pruneDecided, ruleAnswers, rulePrompt, withDecided } from '../hooks/decide.mjs'
import * as state from '../hooks/state.mjs'
import { checkoutNames, checkoutOf, parseRepos, readWorkspace } from '../hooks/workspace.mjs'
import { FRAME_SCHEME, KINDS, avatarSvg, classifyWorker, crewWords, isLive, propForTool, propSvg, trailWords, workerState } from '../hooks/squad.mjs'
import { adoptWorker, recordEnd, recordHeard, recordSpawn, recordTool, resetWorkers, workerElapsed, workerOf } from '../hooks/workers.mjs'
import { askingIn, callWhat, callsIn, during, endCall, endLoop, isInFlight, isSilent, linkChild, longShell, markAsking, resetCalls, startCall, waitWords } from '../hooks/inflight.mjs'
import { crewHeading, crewOf, crewTree } from '../hooks/crew.mjs'
import { needsRows, workGroups, workLine } from '../hooks/rows.mjs'
import { resetTranscripts, sessionName } from '../hooks/transcripts.mjs'
import { intentChanges, intentFileOf, orchestrationFileOf } from '../hooks/changes.mjs'
import { editorLockLine, unreal } from '../hooks/packs/unreal.mjs'
import { EMPTY_CACHE, FETCH_ARGS, FETCH_EVERY_MS, GIT_ENV, NO_SYNC, canFetchNow, fetchMain, isFetchDue, localWins, lockOf, parseBatch, parseLog, parseStatus, parseTree, readTeam, syncSummary, syncText } from '../hooks/team.mjs'
import { FOLD_OVER, GROUP_LABELS, LEGEND, blocksOf, ageText, callBlocks, countText, groupByOf, listStage, miniBar, needsAttention, nextGroup, nextSort, ownerName, rowCells, rowColumns, sortWork, splitParked, stageBlocks, subGroups, tidyName } from '../hooks/worklist.mjs'

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
  parseIntent({ slug, prompt: prompt({ Status: 'active', Area: 'Combat', Owner: 'Tin Nguyen', ...fields }, extra.acceptance), findings: extra.findings ?? '', progress: '', files: [], hasDebrief: false, updatedAt: extra.updatedAt ?? 1, source: 'local', firstAuthor: '' })

const SPAWNER = intent('spawner', {}, { findings: FINDINGS, updatedAt: 5 })
const THEIRS = intent('pause-ai', { Owner: 'TienPham', Area: 'AI' }, { updatedAt: 9 })

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

  test("pruning takes a session's proof in another checkout with it, never an intent's proof", async () => {
    const { io, store } = memoryIo('now')
    store.set('evidence:gone', {})
    store.set('evidence:gone|asktinnguyen/web@/work/web', {})
    store.set('evidence:gone|path:/work/local', {})
    store.set('evidence:asktinnguyen/web@/work/web|spawner', {})
    store.set('evidence:path:/work/web|spawner', {})
    store.set('evidence:live|asktinnguyen/web@/work/web', {})
    /** @type {string[]} */
    const asked = []
    await state.prune(io, async sid => (asked.push(sid), sid === 'gone'))
    expect([...store.keys()].sort()).toEqual(['evidence:asktinnguyen/web@/work/web|spawner', 'evidence:live|asktinnguyen/web@/work/web', 'evidence:path:/work/web|spawner'])
    expect(asked.sort()).toEqual(['gone', 'live'])
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
    expect([model.teamPreview.rows.map(one => one.slug), model.teamPreview.total]).toEqual([['pause-ai'], 1])
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
    const ready = parseIntent({ slug: 'board', prompt: prompt({ Status: 'active', Area: 'Tools', Owner: 'Tin Nguyen' }, '- B1: One.'), findings: '', progress: '# P\n\n- PR: #7\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n| B1 | met | t |\n', files: [], hasDebrief: false, updatedAt: 1, source: 'local', firstAuthor: '' })
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

describe('avatar frame (0.1.7)', () => {
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
    expect(uses).toBe(4)
    // Each `Svg({` call in the hooks, with its isInteractive expression ('' when it has none: a still image).
    const drawn = sources.flatMap(text => [...text.matchAll(/\bSvg\(\{([^\n]*?)\}\)/g)].map(([, props]) => ({ source: /source: ([^,]+)/.exec(props)?.[1] ?? '', framed: /isInteractive: ([^,}]+)/.exec(props)?.[1]?.trim() ?? '' })))
    expect(drawn).toEqual([
      // A finished worker's trail: still images, so no frame and no page behind them.
      { source: 'propSvg(prop)', framed: '' },
      // A worker's avatar: framed only while it runs (its bob); FRAME_SCHEME keeps that frame transparent.
      { source: 'avatarSvg(one.kind', framed: "one.state === 'running' ? true : undefined" },
      // A work row's progress bar on the desktop: a still image (exact pixels, where glyphs spilled into the count).
      { source: 'miniBarSvg(done', framed: '' },
      // The Ather mark in the desktop masthead (rows.mjs since 0.2.0): a still image, nothing moves.
      { source: 'MARK', framed: '' },
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
    expect(model.own[0]?.id).toBe('issue:31360')
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

describe('the work list: sources, search, sort and people', () => {
  const DAY = 86400000
  /** @param {string} slug @param {Record<string, unknown>} [over] */
  const work = (slug, over = {}) => /** @type {any} */ ({ id: `intent:${slug}`, kind: 'intent', slug, label: slug, hint: `${slug} · Tools · 2/4`, isMine: false, area: 'Tools', owner: 'Hai Huynh', updatedAt: NOON - DAY, ...over })
  const issue = (/** @type {number} */ number, /** @type {string} */ title, over = {}) => /** @type {any} */ ({ id: `issue:${number}`, kind: 'issue', label: `#${number} ${title}`, hint: 'Combat · 5 days ago', isMine: true, area: 'Combat', updatedAt: NOON - 5 * DAY, issue: { number, title: `Task_${title}`, updatedAt: NOON - 5 * DAY }, ...over })

  test('where each item comes from: your intents, your issues, a teammate\'s intents', () => {
    expect(workGroup(work('a', { isMine: true }))).toBe('mine')
    expect(workGroup(issue(1, 'x'))).toBe('issues')
    expect(workGroup(work('b'))).toBe('others')
    expect(WORK_GROUPS.map(group => group.key)).toEqual(['mine', 'issues', 'others'])
  })

  test('every word must match: title, detail, an issue\'s own title, or an intent\'s owner', () => {
    const all = [work('quest-debug-panel', { owner: 'Tin Nguyen' }), work('lead-vfx', { owner: 'TienDang-VFX' }), issue(28459, 'SmartObject_ContextPreview')]
    const ids = (/** @type {string} */ query) => filterWork(all, query).map(one => one.id)
    expect(ids('')).toHaveLength(3)
    expect(ids('quest panel')).toEqual(['intent:quest-debug-panel'])
    expect(ids('tin')).toEqual(['intent:quest-debug-panel'])
    expect(ids('#28459')).toEqual(['issue:28459'])
    expect(ids('smartobject preview')).toEqual(['issue:28459'])
    expect(ids('QUEST nothing')).toEqual([])
  })

  test('the age chips are gone: Sort cycles Recent, Ready to close, Oldest; an undated item sorts as the oldest (A5)', () => {
    const all = [work('month', { updatedAt: NOON - 20 * DAY, stage: 'build' }), work('fresh', { updatedAt: NOON - 2 * DAY, stage: 'prove' }), work('undated', { updatedAt: 0, stage: 'met' }), work('old', { updatedAt: NOON - 60 * DAY, stage: 'met' })]
    const order = (/** @type {any} */ sort) => sortWork(all, sort).map(one => one.slug)
    expect(order('recent')).toEqual(['fresh', 'month', 'old', 'undated'])
    expect(order('oldest')).toEqual(['undated', 'old', 'month', 'fresh'])
    expect(order('close')).toEqual(['old', 'undated', 'fresh', 'month'])
    expect([nextSort('recent'), nextSort('close'), nextSort('oldest')]).toEqual(['close', 'oldest', 'recent'])
    // A search by an owner's tidied name finds them too.
    expect(filterWork([work('lead-vfx', { owner: 'TienDang-VFX', who: 'Tien Dang' })], 'tien dang').map(one => one.slug)).toEqual(['lead-vfx'])
  })

  test('work carries when it last changed: an intent\'s files, an issue\'s update', () => {
    const list = workList([intent('mine', { Owner: 'Tin Nguyen' }, { updatedAt: 1234 })], [{ number: 7, title: 'x', name: 'X', url: '', labels: [], updatedAt: 5678, area: 'Unsorted', isUrgent: false }], 'Tin Nguyen', '', NOON)
    expect(list.map(one => one.updatedAt)).toEqual([1234, 5678])
  })

  test('each person gets one colour, never shared on screen, the same however the list is ordered', () => {
    const names = ['Tin Nguyen', 'TienDang-VFX', 'HaiHuynhTA', 'TienDang', 'ThangtrinhGEatherlabs', 'Duy Tran', 'quest-bot']
    const colours = personColours(names)
    expect(Object.keys(colours).sort()).toEqual([...names].sort())
    expect(new Set(Object.values(colours)).size).toBe(names.length)
    expect(personColours([...names].reverse())).toEqual(colours)
    expect(personColours(['Tin Nguyen', 'Tin Nguyen'])['Tin Nguyen']).toMatch(/^#[0-9a-f]{6}$/)
    expect(PEOPLE_COLOURS).toHaveLength(8)
  })

  test('a colour dimmed by 30% moves 30% of the way to the page it sits on', () => {
    expect(dimColour('#ffffff', 0.3, '#000000')).toBe('#b3b3b3')
    expect(dimColour('#000000', 0.3, '#ffffff')).toBe('#4d4d4d')
    expect(dimColour('#7aa2ff', 0, '#1a1b1e')).toBe('#7aa2ff')
    expect(dimColour('#7aa2ff', 1, '#1a1b1e')).toBe('#1a1b1e')
  })
})

describe("the team's real state: origin/main, commit dates, sort, attention, names (0.1.5)", () => {
  const MIN = 60000
  const DAY = 86400000

  test('a batched git log dates every folder by its last commit and names its first author (A2, A7)', () => {
    // `git log --format=%x00%ct%x09%an --name-only -- docs/intent`, newest first; two folders share a pull time but not a commit.
    const log = [
      '\u00001759800000\tLamPhung-Art\n\ndocs/intent/worn-edges/progress.md\ndocs/intent/worn-edges/log.md\n',
      '\u00001759700000\tCinematic\n\ndocs/intent/lead-vfx/prompt.md\ndocs/intent/worn-edges/prompt.md\n',
      '\u00001759600000\tTienDang-VFX\n\ndocs/intent/lead-vfx/prompt.md\ndocs/intent/README.md\n',
    ].join('')
    const dates = parseLog(log)
    expect(dates.get('worn-edges')).toEqual({ at: 1759800000000, firstAuthor: 'Cinematic' })
    expect(dates.get('lead-vfx')).toEqual({ at: 1759700000000, firstAuthor: 'TienDang-VFX' })
    expect([...dates.keys()].sort()).toEqual(['lead-vfx', 'worn-edges'])
    expect(parseLog('')).toEqual(new Map())
  })

  test('the tree, the blobs and the status are read without per-intent calls', () => {
    expect(parseTree('docs/intent/a/prompt.md\ndocs/intent/a/reviews/plan-review.md\ndocs/intent/b/prompt.md\ndocs/intent/README.md\n')).toEqual(new Map([['a', ['prompt.md', 'reviews/plan-review.md']], ['b', ['prompt.md']]]))
    // cat-file sizes count bytes: a multi-byte character must not shift the next object.
    const one = '# Ather · ✓\n', two = 'plain\n'
    const bytes = (/** @type {string} */ text) => new TextEncoder().encode(text).length
    const batch = `aaa blob ${bytes(one)}\n${one}\nsha:docs/intent/x/findings.md missing\nbbb blob ${bytes(two)}\n${two}\n`
    expect(parseBatch(batch, 3)).toEqual([one, null, two])
    expect(parseBatch('', 2)).toEqual([null, null])
    expect([...parseStatus(' M docs/intent/a/prompt.md\0?? docs/intent/new-one/prompt.md\0R  docs/intent/b/x.md\0docs/intent/c/x.md\0 M Source/A.cpp\0')].sort()).toEqual(['a', 'b', 'c', 'new-one'])
  })

  /** A checkout whose origin/main has intents its working tree lacks: git answers from a script. */
  const fakeRepo = (/** @type {{ local?: Record<string, string>, dirty?: string, ahead?: string, main?: boolean, top?: string, fetch?: import('../hooks/team.mjs').Ran, after?: string }} */ setup) => {
    const calls = /** @type {string[][]} */ ([])
    let fetched = false
    const MAIN = {
      'docs/intent/main-only/prompt.md': '# Main only\n\n- Status: active\n- Owner: trucnguyen\n\n## Acceptance\n\n- A1: one\n',
      'docs/intent/main-only/progress.md': '# P\n\n## Acceptance\n\n| Item | Verdict |\n| --- | --- |\n| A1 | met |\n',
      'docs/intent/both/prompt.md': '# Both\n\n- Status: active\n- Owner: Tin Nguyen\n',
      'docs/intent/done/prompt.md': '# Done\n\n- Status: completed\n',
      'docs/intent/ownerless/prompt.md': '# Ownerless\n\n- Status: active\n',
    }
    const local = setup.local ?? {}
    const blob = (/** @type {string} */ path) => (MAIN[path] === undefined ? `${path} missing\n` : `x blob ${new TextEncoder().encode(MAIN[path]).length}\n${MAIN[path]}\n`)
    /** @type {import('../hooks/team.mjs').Repo} */
    const repo = {
      git: async (args, { stdin } = {}) => {
        calls.push([...args])
        const [verb] = args
        if (args.includes('fetch')) {
          fetched = true
          return setup.fetch ?? { exitCode: 0, stdout: '' }
        }
        if (verb === 'rev-parse' && args[1] === '--show-toplevel') return { exitCode: 0, stdout: `${setup.top ?? 'R'}\n` }
        if (verb === 'rev-parse') return setup.main === false ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: `${fetched && setup.after ? setup.after : 'cafe'}\n` }
        if (verb === 'ls-tree') return { exitCode: 0, stdout: `${Object.keys(MAIN).join('\n')}\n` }
        if (verb === 'log' && args[1] === 'cafe') return { exitCode: 0, stdout: '\u00002000\tTinNguyen\n\ndocs/intent/both/prompt.md\n\u00001500\tLamPhung-Art\n\ndocs/intent/main-only/prompt.md\ndocs/intent/ownerless/prompt.md\n\u00001000\tHaiHuynhTA\n\ndocs/intent/done/prompt.md\ndocs/intent/main-only/prompt.md\n' }
        if (verb === 'log') return { exitCode: 0, stdout: setup.ahead ?? '' }
        if (verb === 'status') return { exitCode: 0, stdout: setup.dirty ?? '' }
        if (verb === 'cat-file') return { exitCode: 0, stdout: (stdin ?? '').split('\n').filter(Boolean).map(line => blob(line.slice('cafe:'.length))).join('') }
        return { exitCode: 1, stdout: '' }
      },
      read: async path => local[path.slice(2)] ?? null,
      list: async path => [...new Set(Object.keys(local).filter(file => file.startsWith(`${path.slice(2)}/`)).map(file => file.slice(path.length - 1).split('/')[0]))].map(name => ({ name, kind: 'dir' })),
      mtime: async () => 777,
    }
    return { repo, calls }
  }

  test("origin/main's intents are listed with their commit dates, plus the checkout's own, each with its source (A1, A2, D1)", async () => {
    const { repo, calls } = fakeRepo({ local: { 'docs/intent/mine-local/prompt.md': '# Mine\n\n- Status: active\n', 'docs/intent/both/prompt.md': '# Both\n\n- Status: active\n- Owner: Tin Nguyen\n' } })
    const team = await readTeam(repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    const by = Object.fromEntries(team.intents.map(one => [one.slug, one]))
    expect(team.isRepo).toBe(true)
    expect(Object.keys(by).sort()).toEqual(['both', 'done', 'main-only', 'mine-local', 'ownerless'])
    expect([by['main-only']?.source, by['main-only']?.updatedAt, by['main-only']?.firstAuthor]).toEqual(['main', 1500000, 'HaiHuynhTA'])
    expect([by['mine-local']?.source, by['mine-local']?.updatedAt]).toEqual(['local', 777])
    // The same text on both: main's copy, dated by its commit.
    expect([by.both?.source, by.both?.updatedAt]).toEqual(['main', 2000000])
    // Open intents' progress comes along; a completed one's does not.
    expect(by['main-only']?.progress).toMatch(/A1 \| met/)
    // One log for all of docs/intent, two batched blob reads: never a call per intent.
    expect(calls.filter(args => args[0] === 'log' && args[1] === 'cafe')).toHaveLength(1)
    expect(calls.filter(args => args[0] === 'cat-file')).toHaveLength(2)
    expect(calls.every(args => !['checkout', 'reset', 'stash', 'add', 'update-index'].includes(args[0] ?? ''))).toBe(true)
    // Read again while origin/main, HEAD and the intent files have not moved: neither main nor the
    // index-loading status and log are asked again.
    const again = fakeRepo({ local: { 'docs/intent/mine-local/prompt.md': '# Mine\n\n- Status: active\n', 'docs/intent/both/prompt.md': '# Both\n\n- Status: active\n- Owner: Tin Nguyen\n' } })
    await readTeam(again.repo, 'R', { cache: team.cache, pinned: null })
    expect(again.calls.filter(args => ['ls-tree', 'cat-file', 'status', 'log'].includes(args[0] ?? ''))).toEqual([])
    expect(calls.filter(args => args[0] === 'status' || (args[0] === 'log' && args[1] === 'cafe..HEAD'))).toHaveLength(2)
  })

  test('a local copy wins only when it differs and is newer: uncommitted, or committed on this branch since main (D1)', async () => {
    const edited = { 'docs/intent/both/prompt.md': '# Both, edited here\n\n- Status: active\n- Owner: Tin Nguyen\n' }
    const behind = await readTeam(fakeRepo({ local: edited }).repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    expect(behind.intents.find(one => one.slug === 'both')?.source).toBe('main')
    const dirty = await readTeam(fakeRepo({ local: edited, dirty: ' M docs/intent/both/prompt.md\0' }).repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    const mine = dirty.intents.find(one => one.slug === 'both')
    expect([mine?.source, mine?.updatedAt, mine?.prompt]).toEqual(['local', 777, edited['docs/intent/both/prompt.md']])
    const ahead = await readTeam(fakeRepo({ local: edited, ahead: '\u00003000\tTin Nguyen\n\ndocs/intent/both/prompt.md\n' }).repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    expect(ahead.intents.find(one => one.slug === 'both')?.source).toBe('local')
    // Line endings the checkout converted are not a difference.
    const crlf = await readTeam(fakeRepo({ local: { 'docs/intent/both/prompt.md': '# Both\r\n\r\n- Status: active\r\n- Owner: Tin Nguyen\r\n' }, dirty: ' M docs/intent/both/prompt.md\0' }).repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    expect(crlf.intents.find(one => one.slug === 'both')?.source).toBe('main')
    // The tracked intent is read from the checkout, where its session writes, even when main has the same.
    const tracked = await readTeam(fakeRepo({ local: { 'docs/intent/both/prompt.md': '# Both\n\n- Status: active\n- Owner: Tin Nguyen\n' } }).repo, 'R', { cache: EMPTY_CACHE, pinned: 'both' })
    expect(tracked.intents.find(one => one.slug === 'both')?.source).toBe('local')
    const onMain = { files: [], at: 1, firstAuthor: '', prompt: 'a', progress: '', findings: '' }
    expect([localWins({ prompt: 'b', progress: '', findings: '' }, onMain, true), localWins({ prompt: 'b', progress: '', findings: '' }, onMain, false), localWins({ prompt: 'a', progress: 'x', findings: '' }, onMain, true)]).toEqual([true, false, false])
  })

  test('without origin/main, or outside a checkout of its own, the folders are read as before', async () => {
    const noMain = await readTeam(fakeRepo({ main: false, local: { 'docs/intent/a/prompt.md': '# A\n\n- Status: active\n' } }).repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    expect([noMain.isRepo, noMain.cache.main, noMain.intents.map(one => one.slug)]).toEqual([true, null, ['a']])
    const elsewhere = fakeRepo({ top: 'C:/Users', local: { 'docs/intent/a/prompt.md': '# A\n\n- Status: active\n' } })
    const outside = await readTeam(elsewhere.repo, 'R', { cache: EMPTY_CACHE, pinned: null })
    expect([outside.isRepo, outside.intents.map(one => one.slug)]).toEqual([false, ['a']])
    expect(elsewhere.calls.map(args => args[0])).toEqual(['rev-parse'])
  })

  test('the fetch: narrow refspec, no tags; due when the pane is first drawn, then at most every ten minutes, one at a time (A3)', () => {
    expect(FETCH_ARGS).toEqual(['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
    expect(GIT_ENV).toEqual({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })
    expect(FETCH_EVERY_MS).toBe(10 * MIN)
    const repoSync = { ...NO_SYNC, isRepo: true, hasMain: true }
    expect(isFetchDue(NO_SYNC, NOON)).toBe(false)
    expect(isFetchDue(repoSync, NOON)).toBe(true)
    expect(isFetchDue({ ...repoSync, triedAt: NOON - 9 * MIN }, NOON)).toBe(false)
    expect(isFetchDue({ ...repoSync, triedAt: NOON - 10 * MIN }, NOON)).toBe(true)
    expect(isFetchDue({ ...repoSync, isFetching: true }, NOON)).toBe(false)
  })

  test('the sync line: "synced N min ago ↻", and a failure says so and keeps the last good time (A3, A4)', () => {
    const at = { ...NO_SYNC, isRepo: true, hasMain: true }
    expect(syncText(NO_SYNC, NOON)).toBe('')
    expect(syncText(at, NOON)).toBe('not synced yet ↻')
    expect(syncText({ ...at, isFetching: true }, NOON)).toBe('syncing…')
    expect(syncText({ ...at, fetchedAt: NOON - 20000 }, NOON)).toBe('synced just now ↻')
    expect(syncText({ ...at, fetchedAt: NOON - 4 * MIN }, NOON)).toBe('synced 4 min ago ↻')
    expect(syncText({ ...at, fetchedAt: NOON - 4 * MIN, failedAt: NOON - MIN }, NOON)).toBe('sync failed · synced 4 min ago ↻')
    expect(syncText({ ...at, failedAt: NOON }, NOON)).toBe('sync failed ↻')
    expect(syncText({ ...at, hasMain: false }, NOON)).toBe('no origin/main ↻')
    expect(syncText({ ...at, fetchedAt: NOON - 4 * MIN, failedAt: NOON, lock: 'refs/remotes/origin/main.lock' }, NOON)).toBe('sync waits on refs/remotes/origin/main.lock · synced 4 min ago ↻')
  })

  test('a fetch is synced when git says so and origin/main resolves; one that ran into a git lock names it and waits for its next due time (A3)', async () => {
    const moved = fakeRepo({ after: 'beef' })
    expect(await fetchMain(moved.repo)).toEqual({ error: '', lock: '', moved: true })
    expect(moved.calls.find(args => args.includes('fetch'))).toEqual(FETCH_ARGS)
    expect(await fetchMain(fakeRepo({}).repo)).toEqual({ error: '', lock: '', moved: false })
    const stderr = String.raw`error: cannot lock ref 'refs/remotes/origin/main': Unable to create 'E:\S2_\.git\refs\remotes\origin\main.lock': File exists.`
    expect(await fetchMain(fakeRepo({ fetch: { exitCode: 1, stdout: '', stderr } }).repo)).toEqual({ error: stderr, lock: 'refs/remotes/origin/main.lock', moved: false })
    expect(lockOf(String.raw`fatal: Unable to create 'E:\S2_\.git\index.lock': File exists.`)).toBe('index.lock')
    expect(lockOf('Error: timed out after 600000 ms')).toBe('')
    const locked = { ...NO_SYNC, isRepo: true, hasMain: true, triedAt: NOON - MIN, failedAt: NOON - MIN, lock: 'index.lock' }
    expect([canFetchNow(locked, NOON), canFetchNow({ ...locked, lock: '' }, NOON), canFetchNow(locked, NOON + 10 * MIN), canFetchNow({ ...locked, isFetching: true, lock: '' }, NOON)]).toEqual([false, true, true, false])
  })

  test('Ready to close groups the list in stage blocks: all met, proving, building, parked (A5)', () => {
    // The tracked header's stages without a session's proof: a partly done intent is building, not proving.
    const at = (/** @type {any} */ fields) => /** @type {any} */ ({ status: 'active', acceptanceDone: 3, acceptanceTotal: 3, prs: [], ...fields })
    expect([
      listStage(at({ status: 'parked' })),
      listStage(at({})),
      listStage(at({ prs: [7] }), { 7: 'MERGED' }),
      listStage(at({ prs: [7] }), { 7: 'OPEN' }),
      listStage(at({ prs: [7] })),
      listStage(at({ acceptanceDone: 1 })),
      listStage(at({ acceptanceDone: 0, acceptanceTotal: 0 })),
    ]).toEqual(['parked', 'met', 'met', 'prove', 'prove', 'build', 'build'])
    const list = [{ id: 'a', stage: 'build', updatedAt: 5 }, { id: 'b', stage: 'met', updatedAt: 1 }, { id: 'c', stage: 'parked', updatedAt: 9 }, { id: 'd', stage: 'met', updatedAt: 7 }, { id: 'e', stage: '', updatedAt: 8 }]
    expect(stageBlocks(/** @type {any} */ (list)).map(block => [block.title, block.items.map(one => one.id).join('')])).toEqual([['Ready to close', 'db'], ['Building', 'a'], ['Parked', 'c'], ['', 'e']])
    expect(LEGEND).toBe('● Building  ◐ Items met, PR not merged  ✓ Ready to close  ‖ Parked')
  })

  test("Needs attention: the person's own all-met intents and parked ones with no reason, never a teammate's (A6)", () => {
    const met = intent('all-met', {}, { acceptance: '- [x] one\n- [x] two' })
    const parked = intent('parked-bare', { Status: 'parked' })
    const reasoned = intent('parked-why', { Status: 'parked: waiting on art' })
    const theirs = intent('their-met', { Owner: 'TienPham' }, { acceptance: '- [x] one' })
    const done = intent('closed', { Status: 'completed' }, { acceptance: '- [x] one' })
    expect(needsAttention([met, parked, reasoned, theirs, done, SPAWNER], 'Tin Nguyen').map(one => [one.slug, one.kind, one.ask])).toEqual([['all-met', 'close', 'Close it?'], ['parked-bare', 'reason', 'Add one?']])
    expect(needsAttention([met], '')).toEqual([])
    const home = buildHome(base({ intents: [met, parked, SPAWNER], away: OFF }))
    expect(home.attention.map(one => one.id)).toEqual(['attention:all-met', 'attention:parked-bare'])
  })

  test('owner names from main, tidied for display; a team shows with its lead; no Owner falls back to the first committer (A7)', () => {
    const table = {
      'LamPhung-Art': 'Lam Phung', trucnguyen: 'Truc Nguyen', DuyTranSipher: 'Duy Tran', HaiHuynhTA: 'Hai Huynh', 'HaiHuynh-TA': 'Hai Huynh',
      ThangtrinhGEatherlabs: 'Thang Trinh', 'ThangTrinh-GE': 'Thang Trinh', 'TienDang-VFX': 'Tien Dang', TienDang: 'Tien Dang', TienPhamProducerAther: 'Tien Pham',
      HuyLuongDucGameDesignAther: 'Huy Luong Duc', 'KhoaLe (Game Engineer)': 'Khoa Le', 'TrucNguyen-GD (Felix Nguyen)': 'Truc Nguyen', 'Trung-TechArt': 'Trung',
      haothansipher: 'Hao Than', TinNguyen: 'Tin Nguyen', 'Tin Nguyen': 'Tin Nguyen', 'Luong Duc Huy': 'Luong Duc Huy', 'Khoa Le Hoang Dang': 'Khoa Le Hoang Dang', 'Trung Hoang Nguyen': 'Trung Hoang Nguyen',
    }
    expect(Object.fromEntries(Object.keys(table).map(name => [name, tidyName(name, unreal.names)]))).toEqual(table)
    expect(ownerName('Cinematic', 'TienDang-VFX', unreal)).toBe('Tien Dang · Cinematic')
    expect(ownerName('', 'LamPhung-Art', unreal)).toBe('Lam Phung')
    expect(ownerName('', '', unreal)).toBe('')
    // The studio's rules belong to its pack: without them a name is only split and capitalised.
    expect([tidyName('trucnguyen'), tidyName('LamPhung-Art'), tidyName('DuyTranSipher'), ownerName('Cinematic', '')]).toEqual(['Trucnguyen', 'Lam Phung Art', 'Duy Tran Sipher', 'Cinematic'])
    // People are still matched on the Owner line as written.
    expect(isSamePerson('LamPhung-Art', 'Lam Phung')).toBe(true)
    const work = workList([intent('lead-vfx', { Owner: 'Cinematic' })], [], 'Tin Nguyen', '', NOON, 'set', {}, unreal)
    expect(work[0]?.kind === 'intent' ? [work[0].owner, work[0].who] : []).toEqual(['Cinematic', 'Tien Dang · Cinematic'])
  })

  test('one row anatomy: glyph, title, warning, mini bar and count, age, owner; columns as wide as the widest (A8)', () => {
    expect([miniBar(0, 0), miniBar(0, 4), miniBar(2, 4), miniBar(4, 4)]).toEqual(['     ', '▱▱▱▱▱', '▰▰▰▱▱', '▰▰▰▰▰'])
    expect([ageText(0, NOON), ageText(NOON - 5 * MIN, NOON), ageText(NOON - 3 * 60 * MIN, NOON), ageText(NOON - 12 * DAY, NOON)]).toEqual(['', '5m', '3h', '12d'])
    const theirs = rowCells({ kind: 'intent', label: 'lead-vfx', stage: 'parked', updatedAt: NOON - 2 * DAY, isMine: false, done: 1, total: 4, who: 'Tien Dang', warn: 'parked, no reason', source: 'local' }, NOON, true)
    expect(theirs).toEqual({ glyph: '‖', title: 'lead-vfx', warn: '⚠ parked, no reason · local', repo: '', bar: '▰▱▱▱▱', count: '1/4', age: '2d', owner: 'Tien Dang' })
    const own = rowCells({ kind: 'intent', label: 'x', stage: 'met', updatedAt: 0, isMine: true, done: 2, total: 2, who: 'Tin Nguyen', warn: '', source: 'local' }, NOON, false)
    expect([own.glyph, own.warn, own.owner, own.age]).toEqual(['✓', '', '', ''])
    const issueRow = rowCells({ kind: 'issue', label: '#28887 Dodge', stage: '', updatedAt: NOON - DAY, isMine: true }, NOON, true)
    expect([issueRow.glyph, issueRow.bar, issueRow.count]).toEqual(['', '     ', ''])
    expect(rowColumns([theirs, { ...theirs, count: '12/17', owner: 'Tien Dang · Cinematic' }], 12)).toEqual({ count: 5, age: 2, owner: 12 })
  })

  test('decisions wait in one block per intent, in the order they came (A9)', () => {
    const items = [{ kind: 'call', slug: 'q', id: 'q1' }, { kind: 'lost', id: 'lost' }, { kind: 'call', slug: 'q', id: 'q2' }, { kind: 'call', slug: 'r', id: 'r1' }, { kind: 'call', slug: 'q', id: 'q3' }]
    expect(callBlocks(items).map(block => [block.slug, block.items.map(one => one.id).join(',')])).toEqual([['q', 'q1,q2,q3'], ['', 'lost'], ['r', 'r1']])
    const four = intent('quest-debug-panel', {}, { findings: [1, 2, 3, 4].map(n => `## F-${n} (2026-10-07) | blocking: yes | status: open (director)\n\nCall ${n}.\n`).join('\n') })
    const home = buildHome(base({ intents: [four], pinned: null, away: OFF }))
    expect(callBlocks(home.items).map(block => [block.slug, block.items.length])).toEqual([['quest-debug-panel', 4]])
  })
})

describe('asking about an intent (0.1.6)', () => {
  test('one this checkout has is read from its folder; one only on main is read from origin/main, read-only', () => {
    const local = aboutIntentPrompt('worn-edges', false)
    expect(local).toContain('Read docs/intent/worn-edges/ only; change nothing.')
    expect(local.includes('git show')).toBe(false)
    const main = aboutIntentPrompt('worn-edges', true)
    expect(main).toContain('git show origin/main:docs/intent/worn-edges/<file>')
    expect(main).toContain('origin/main -- docs/intent/worn-edges')
    expect(main).toContain('Do not fetch, pull, check out, track it or write anything.')
    expect(main).toContain('who owns it, its status and stage')
  })
})

describe('several repositories on one machine', () => {
  // Two checkouts of different repositories over one store: what each keeps must stay its own.
  const twoRepos = () => {
    const memory = memoryIo()
    const s2 = { ...memory.io, repo: async () => 'sipher/s2' }
    const web = { ...memory.io, repo: async () => 'asktinnguyen/han-viet' }
    return { ...memory, s2, web }
  }
  const ISSUE = { number: 7, title: 'Fix login', url: 'u', area: 'Unsorted', isUrgent: false, updatedAt: '' }

  test("a command's proof is kept by the checkout it ran in", async () => {
    const { s2, files } = twoRepos()
    const own = { isOwn: true, repo: 'sipher/s2' }
    const other = { isOwn: false, repo: 'asktinnguyen/web', root: '/Work/web/' }
    // Nothing tracked: the session's own checkout keeps the session's scope.
    expect(await state.checkoutScope(s2, own)).toBe('s1')
    expect(await state.checkoutScope(s2, other)).toBe('s1|asktinnguyen/web@/work/web')
    // A tracked intent: the session's checkout proves it; another checkout's proof stays this session's there.
    files.set('R/docs/intent/spawner/prompt.md', '# S\n\n- Owner: Tin Nguyen\n')
    await state.track(s2, 'R', 'spawner')
    expect(await state.checkoutScope(s2, own)).toBe('sipher/s2@r|spawner')
    expect(await state.checkoutScope(s2, other)).toBe('s1|asktinnguyen/web@/work/web')
  })

  test('an intent tracked in another checkout is kept as its slug and root, and scoped by that checkout', async () => {
    const memory = memoryIo()
    const { store, files } = memory
    const origins = /** @type {Record<string, string>} */ ({ '/s3/web': 'https://github.com/AskTinNguyen/web' })
    const io = { ...memory.io, repo: async () => 'sipher/s2', origin: async (/** @type {string} */ root) => origins[root] ?? '' }
    const asWeb = { ...io, repo: async () => 'asktinnguyen/web', root: async () => '/s3/web' }
    files.set('/s3/web/docs/intent/login/prompt.md', '# Login\n\n- Owner: Tin Nguyen\n')
    expect(await state.track(io, '/s3/web/', 'login', { me: 'Tin Nguyen' })).toBe(true)
    expect(store.get('pinned:s1')).toEqual({ slug: 'login', root: '/s3/web' })
    expect(await state.readPinned(io)).toBe('login')
    expect(await state.readTracked(io)).toEqual({ slug: 'login', root: '/s3/web' })
    expect(await state.evidenceScope(io)).toBe('asktinnguyen/web@/s3/web|login')
    // A command in the intent's checkout proves it; the session's own checkout and a third keep the session's.
    expect(await state.checkoutScope(io, { isOwn: false, repo: 'asktinnguyen/web', root: '/s3/web' })).toBe('asktinnguyen/web@/s3/web|login')
    expect(await state.checkoutScope(io, { isOwn: true, repo: 'sipher/s2' })).toBe('s1')
    expect(await state.checkoutScope(io, { isOwn: false, repo: 'sipher/tools', root: '/s3/tools' })).toBe('s1|sipher/tools@/s3/tools')
    // "Continue …" and the changes an edit records are web's.
    expect(await state.readLast(asWeb, 'Tin Nguyen')).toBe('login')
    expect(await state.readLast(io, 'Tin Nguyen')).toBe(null)
    await state.noteChanges(io, 'login', [{ kind: 'done', id: 'A1', text: 'ticked A1' }], Date.now(), '/s3/web')
    expect(await state.readChanges(io, 'login', 0, '/s3/web')).toHaveLength(1)
    expect(await state.readChanges(asWeb, 'login', 0)).toHaveLength(1)
    expect(await state.readChanges(io, 'login', 0)).toHaveLength(0)
    // /clear carries the pair as it is.
    await state.moveLane(io, 's1', 's1b')
    memory.switchSession('s1b')
    expect(store.get('pinned:s1b')).toEqual({ slug: 'login', root: '/s3/web' })
    expect(await state.readTracked(io)).toEqual({ slug: 'login', root: '/s3/web' })
    expect(await state.untrack(io, 'Tin Nguyen')).toEqual({ result: 'untracked', slug: 'login' })
    expect(store.has('pinned:s1b')).toBe(false)
    expect(await state.readLast(asWeb, 'Tin Nguyen')).toBe(null)
    expect(await state.evidenceScope(io)).toBe('s1b')
  })

  test('a stop is kept per checkout: stopping web/login does not stop a write tracking s2/login', async () => {
    const memory = memoryIo()
    const origins = /** @type {Record<string, string>} */ ({ '/s3stop/web': 'https://github.com/AskTinNguyen/web' })
    const io = { ...memory.io, repo: async () => 'sipher/s2', origin: async (/** @type {string} */ root) => origins[root] ?? '' }
    memory.files.set('/s3stop/web/docs/intent/login/prompt.md', '# Login\n')
    memory.files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(io, '/s3stop/web', 'login')
    await state.untrack(io, 'Tin Nguyen')
    expect(memory.store.get('untracked:s1')).toEqual([{ slug: 'login', root: '/s3stop/web' }])
    expect(await state.track(io, '/s3stop/web', 'login', { isAuto: true })).toBe(false)
    expect(await state.track(io, 'R', 'login', { isAuto: true })).toBe(true)
    expect(memory.store.get('pinned:s1')).toBe('login')
    // Stopping the own one keeps its plain slug; tracking web's on purpose lifts only web's stop.
    await state.untrack(io, 'Tin Nguyen')
    expect(memory.store.get('untracked:s1')).toEqual([{ slug: 'login', root: '/s3stop/web' }, 'login'])
    expect(await state.track(io, '/s3stop/web', 'login')).toBe(true)
    expect(memory.store.get('untracked:s1')).toEqual(['login'])
  })

  test("prune takes a gone session's foreign pin and its proof in that checkout, never the intent's proof", async () => {
    const { io, store } = memoryIo('live')
    store.set('pinned:gone', { slug: 'login', root: '/s3prune/web' })
    store.set('evidence:gone|asktinnguyen/web@/s3prune/web', { tests: { state: 'pass', detail: '', at: Date.now() } })
    store.set('evidence:asktinnguyen/web@/s3prune/web|login', { tests: { state: 'pass', detail: '', at: Date.now() } })
    await state.prune(io, async sid => sid === 'gone')
    expect([...store.keys()].sort()).toEqual(['evidence:asktinnguyen/web@/s3prune/web|login'])
  })

  test("an intent in the session's own checkout is kept as a plain slug, as before", async () => {
    const memory = memoryIo()
    const io = { ...memory.io, repo: async () => 'sipher/s2' }
    memory.store.set('pinned:s1', 'spawner')
    expect(await state.readTracked(io)).toEqual({ slug: 'spawner', root: 'R' })
    memory.files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(io, 'R', 'login')
    expect(memory.store.get('pinned:s1')).toBe('login')
    expect(await state.checkoutScope(io, { isOwn: true, repo: 'sipher/s2' })).toBe('sipher/s2@r|login')
    expect(await state.checkoutScope(io, { isOwn: false, repo: 'asktinnguyen/web', root: '/s3/web' })).toBe('s1|asktinnguyen/web@/s3/web')
  })

  test('a repository is named by its origin, whatever the protocol; without one, by its folder', () => {
    expect(state.repoId('git@github.com:AskTinNguyen/han-viet.git', 'R')).toBe('asktinnguyen/han-viet')
    expect(state.repoId('https://github.com/AskTinNguyen/han-viet', 'R')).toBe('asktinnguyen/han-viet')
    expect(state.repoId('ssh://git@github.com:22/Sipher/S2.git/', 'R')).toBe('sipher/s2')
    expect(state.repoId('', 'C:\\Work\\S2\\')).toBe('path:c:/work/s2')
  })

  test('a checkout is named by its repository and its folder; without an origin by its folder, without a repository not at all', () => {
    expect(state.checkoutId('sipher/s2', 'C:\\Work\\S2\\')).toBe('sipher/s2@c:/work/s2')
    expect(state.checkoutId('sipher/s2', '/Work/s2-b')).toBe('sipher/s2@/work/s2-b')
    expect(state.checkoutId('path:c:/work/s2', 'C:\\Work\\S2')).toBe('path:c:/work/s2')
    expect(state.checkoutId('', '/Work/s2')).toBe('')
  })

  // Two clones of one origin, /work/s2 and /work/s2-b, over one store: `own` is a session in the first,
  // `inSecond` one in the second, and `own` reaches the second by its root.
  const twoClones = () => {
    const memory = memoryIo()
    const origin = async () => 'git@github.com:Sipher/S2.git'
    const own = { ...memory.io, repo: async () => 'sipher/s2', root: async () => '/work/s2', origin }
    const inSecond = { ...own, root: async () => '/work/s2-b' }
    for (const root of ['/work/s2', '/work/s2-b']) memory.files.set(`${root}/docs/intent/login/prompt.md`, '# Login\n')
    return { ...memory, own, inSecond, second: '/work/s2-b' }
  }

  test("two checkouts of one repository keep their own intent proof and session proof", async () => {
    const { own, inSecond, second, store } = twoClones()
    expect(await state.intentScope(own, 'login')).toBe('sipher/s2@/work/s2|login')
    expect(await state.intentScope(own, 'login', second)).toBe('sipher/s2@/work/s2-b|login')
    // A session in the second clone names its intent as the first clone's session does from outside.
    expect(await state.intentScope(inSecond, 'login')).toBe('sipher/s2@/work/s2-b|login')
    await state.track(own, second, 'login')
    const scope = await state.evidenceScope(own)
    await state.setRung(own, scope, 'build', { state: 'pass', detail: 'Result: Succeeded' })
    expect((await state.readEvidence(own, await state.intentScope(own, 'login', second))).build.state).toBe('pass')
    expect((await state.readEvidence(inSecond, await state.intentScope(inSecond, 'login'))).build.state).toBe('pass')
    expect((await state.readEvidence(own, await state.intentScope(own, 'login'))).build.state).toBe('none')
    expect([...store.keys()].filter(key => key.startsWith('evidence:'))).toEqual(['evidence:sipher/s2@/work/s2-b|login'])
    // Nothing tracked: this session's proof in the other clone is that clone's, not the repository's.
    await state.untrack(own, 'Tin Nguyen')
    expect(await state.checkoutScope(own, { isOwn: false, repo: 'sipher/s2', root: second })).toBe('s1|sipher/s2@/work/s2-b')
    expect(await state.checkoutScope(own, { isOwn: false, repo: 'sipher/s2', root: '/work/s2-c' })).toBe('s1|sipher/s2@/work/s2-c')
    expect(await state.checkoutScope(own, { isOwn: true, repo: 'sipher/s2' })).toBe('s1')
  })

  test('two checkouts of one repository keep their own changes and Continue', async () => {
    const { own, inSecond, second, store } = twoClones()
    await state.noteChanges(own, 'login', [{ kind: 'done', id: 'A1', text: 'ticked A1' }], Date.now(), second)
    expect(await state.readChanges(own, 'login', 0, second)).toHaveLength(1)
    expect(await state.readChanges(inSecond, 'login', 0)).toHaveLength(1)
    expect(await state.readChanges(own, 'login', 0)).toHaveLength(0)
    await state.track(own, second, 'login', { me: 'Tin Nguyen' })
    expect(await state.readLast(own, 'Tin Nguyen', second)).toBe('login')
    expect(await state.readLast(inSecond, 'Tin Nguyen')).toBe('login')
    expect(await state.readLast(own, 'Tin Nguyen')).toBe(null)
    await state.track(own, '/work/s2', 'login', { me: 'Tin Nguyen' })
    expect(store.get('last:sipher/s2@/work/s2|tinnguyen')).toBe('login')
    expect(store.get('last:sipher/s2@/work/s2-b|tinnguyen')).toBe('login')
    // Untracking the first clone's leaves the second clone's Continue.
    await state.untrack(own, 'Tin Nguyen')
    expect(await state.readLast(own, 'Tin Nguyen')).toBe(null)
    expect(await state.readLast(own, 'Tin Nguyen', second)).toBe('login')
    // Issues and PR states stay the repository's.
    await state.setPrStates(own, { 12: 'MERGED' }, Date.now())
    expect(await state.readPrStates(inSecond)).toEqual({ 12: 'MERGED' })
    expect(store.has('prStates:sipher/s2')).toBe(true)
  })

  test("the per-repository keys of before are not read", async () => {
    const { own, store } = twoClones()
    store.set('evidence:sipher/s2|login', { build: { state: 'pass', detail: '', at: Date.now() } })
    store.set('changes:sipher/s2|login', [{ kind: 'done', id: 'A1', text: 'ticked A1', at: Date.now() }])
    store.set('last:sipher/s2|tinnguyen', 'login')
    expect((await state.readEvidence(own, await state.intentScope(own, 'login'))).build.state).toBe('none')
    expect(await state.readChanges(own, 'login', 0)).toHaveLength(0)
    expect(await state.readLast(own, 'Tin Nguyen')).toBe(null)
  })

  test('the same slug in two repositories keeps its own proof and changes', async () => {
    const { s2, web, files } = twoRepos()
    files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(s2, 'R', 'login')
    const scope = await state.evidenceScope(s2)
    expect(scope).toBe('sipher/s2@r|login')
    await state.setRung(s2, scope, 'build', { state: 'pass', detail: 'Result: Succeeded' })
    await state.noteChanges(s2, 'login', [{ kind: 'done', id: 'A1', text: 'ticked A1' }], Date.now())
    expect((await state.readEvidence(s2, await state.intentScope(s2, 'login'))).build.state).toBe('pass')
    expect((await state.readEvidence(web, await state.intentScope(web, 'login'))).build.state).toBe('none')
    expect(await state.readChanges(s2, 'login', 0)).toHaveLength(1)
    expect(await state.readChanges(web, 'login', 0)).toHaveLength(0)
  })

  test("issues, PR states and Continue are each repository's own", async () => {
    const { s2, web, files } = twoRepos()
    await state.setIssues(s2, 'Tin Nguyen', [ISSUE])
    await state.setPrStates(s2, { 12: 'MERGED' }, Date.now())
    files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(s2, 'R', 'login', { me: 'Tin Nguyen' })
    expect(await state.readIssues(s2, 'Tin Nguyen')).toHaveLength(1)
    expect(await state.readIssues(web, 'Tin Nguyen')).toEqual([])
    expect(await state.readPrStates(s2)).toEqual({ 12: 'MERGED' })
    expect(await state.readPrStates(web)).toEqual({})
    expect(await state.readLast(s2, 'Tin Nguyen')).toBe('login')
    expect(await state.readLast(web, 'Tin Nguyen')).toBe(null)
  })

  test('without a repository (the Paseo version) the keys are as before', async () => {
    const { io, store, files } = memoryIo()
    await state.setIssues(io, 'Tin Nguyen', [ISSUE])
    await state.setPrStates(io, { 12: 'OPEN' }, Date.now())
    expect(store.has('issues:tinnguyen')).toBe(true)
    expect(store.has('prStates')).toBe(true)
    // Proof, changes and Continue too: no repository, so no checkout in the key.
    files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(io, 'R', 'login', { me: 'Tin Nguyen' })
    expect(await state.evidenceScope(io)).toBe('login')
    await state.setRung(io, 'login', 'build', { state: 'pass', detail: 'Result: Succeeded' })
    await state.noteChanges(io, 'login', [{ kind: 'done', id: 'A1', text: 'ticked A1' }], Date.now())
    expect(store.get('last:tinnguyen')).toBe('login')
    expect(store.has('evidence:login')).toBe(true)
    expect(store.has('changes:login')).toBe(true)
  })

  test("proof and Continue from before the upgrade read through until the scoped key is written; untracking clears both", async () => {
    const { s2, store, files } = twoRepos()
    store.set('evidence:login', { tests: { state: 'pass', detail: '12 passed', at: Date.now() } })
    store.set('last:tinnguyen', 'login')
    const scope = await state.intentScope(s2, 'login')
    expect((await state.readEvidence(s2, scope)).tests.state).toBe('pass')
    await state.setRung(s2, scope, 'build', { state: 'pass', detail: 'Result: Succeeded' })
    const kept = await state.readEvidence(s2, scope)
    expect([kept.tests.state, kept.build.state]).toEqual(['pass', 'pass'])
    expect(await state.readLast(s2, 'Tin Nguyen')).toBe('login')
    files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(s2, 'R', 'login', { me: 'Tin Nguyen' })
    await state.untrack(s2, 'Tin Nguyen')
    expect(await state.readLast(s2, 'Tin Nguyen')).toBe(null)
    expect(store.has('last:tinnguyen')).toBe(false)
  })

  test('an old "Continue" naming another intent does not come back after tracking and untracking one', async () => {
    const { s2, store, files } = twoRepos()
    store.set('last:tinnguyen', 'old-one')
    files.set('R/docs/intent/login/prompt.md', '# Login\n')
    await state.track(s2, 'R', 'login', { me: 'Tin Nguyen' })
    await state.untrack(s2, 'Tin Nguyen')
    expect(await state.readLast(s2, 'Tin Nguyen')).toBe(null)
    expect(store.has('last:tinnguyen')).toBe(false)
  })

  test('the lane names its repository when the Io can read the origin, and asks again when git could not say', async () => {
    const { io } = memoryIo()
    let origin = /** @type {string | null} */ (null)
    const withOrigin = { ...io, origin: async () => origin }
    const first = await state.lane(withOrigin, 'cwd-repo-test')
    expect(first.repo).toBe('path:r')
    await new Promise(resolve => setTimeout(resolve, 5))
    origin = 'git@github.com:Sipher/S2.git'
    expect((await state.lane(withOrigin, 'cwd-repo-test')).repo).toBe('sipher/s2')
    expect((await state.lane(io, 'cwd-no-origin')).repo).toBe('')
  })
})

describe('the workspace', () => {
  // Folders and files over plain maps: a folder exists when something is in it.
  const disk = (/** @type {Record<string, string>} */ paths) => {
    const files = new Map(Object.entries(paths))
    const has = (/** @type {string} */ path) => [...files.keys()].some(one => one === path || one.startsWith(`${path}/`))
    return {
      files,
      read: async (/** @type {string} */ path) => files.get(path) ?? null,
      exists: async (/** @type {string} */ path) => has(path),
      list: async (/** @type {string} */ dir) => {
        const names = new Set([...files.keys()].filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0]))
        return [...names].map(name => ({ name, kind: files.has(`${dir}/${name}`) ? 'file' : 'dir' }))
      },
    }
  }
  const HEAD = 'ref: refs/heads/main\n'

  test('a folder resolves to the checkout holding it: a .git folder, a worktree .git file, or none', async () => {
    const files = disk({ '/w/s2/.git/HEAD': HEAD, '/w/s2/Plugins/X/a.txt': '', '/w/tree/.git': 'gitdir: /w/s2/.git/worktrees/tree\n', '/w/loose/a.txt': '' })
    expect(await checkoutOf(files, '/w/s2')).toBe('/w/s2')
    expect(await checkoutOf(files, '/w/s2/Plugins/X')).toBe('/w/s2')
    expect(await checkoutOf(files, '/w/s2/Plugins/X/../../')).toBe('/w/s2')
    expect(await checkoutOf(files, '/w/tree/src')).toBe('/w/tree')
    expect(await checkoutOf(files, '/w/loose')).toBe(null)
  })

  test('the repos option splits on ; and new lines, drops blanks, and takes relative folders from the session folder', () => {
    expect(parseRepos(' ../web ;\n\n/abs/game\r\nC:\\Work\\S2\\ ; ', '/w/s2')).toEqual(['/w/web', '/abs/game', 'C:/Work/S2'])
    expect(parseRepos('', '/w/s2')).toEqual([])
  })

  test('the workspace lists the session checkout first, then option folders, each once; a folder in no checkout is skipped', async () => {
    const files = disk({ '/w/s2/.git/HEAD': HEAD, '/w/s2/Source/a.cpp': '', '/w/web/.git/HEAD': HEAD, '/w/loose/a.txt': '', '/w/other/.git/HEAD': HEAD })
    const found = await readWorkspace(files, '/w/s2/Source', '../../web; /w/s2/; Source; ../../loose')
    expect(found.roots).toEqual(['/w/s2', '/w/web'])
    expect(found.skipped).toEqual(['/w/loose'])
  })

  test("a session folder in no checkout adds its child checkouts by name, after the option's, at most 8 in all", async () => {
    /** @type {Record<string, string>} */
    const paths = { '/w/notes/a.md': '', '/w/x/.git/HEAD': HEAD, '/w/b/.git': 'gitdir: /w/x/.git/worktrees/b\n' }
    for (const name of ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) paths[`/w/${name}/.git/HEAD`] = HEAD
    const found = await readWorkspace(disk(paths), '/w', 'x')
    expect(found.roots).toEqual(['/w/x', '/w/b', '/w/c', '/w/d', '/w/e', '/w/f', '/w/g', '/w/h'])
    // Inside a checkout, the children are not looked at.
    const inside = disk({ '/w/s2/.git/HEAD': HEAD, '/w/s2/sub/.git/HEAD': HEAD })
    expect((await readWorkspace(inside, '/w/s2', '')).roots).toEqual(['/w/s2'])
  })

  test('each checkout gets its own lane: repository and pack', async () => {
    const { io, files } = memoryIo()
    files.set('/ws/game/Game.uproject', '{}')
    // memoryIo's exists sees a folder only as its own entry.
    files.set('/ws/game/docs/intent', '')
    files.set('/ws/web/package.json', '{"name":"web"}')
    const origins = /** @type {Record<string, string>} */ ({ '/ws/game': 'git@github.com:Sipher/S2.git', '/ws/web': 'https://github.com/AskTinNguyen/han-viet' })
    // The web repository sets its own user.name; the session folder's is Tin Nguyen.
    const names = /** @type {Record<string, string>} */ ({ '/ws/web': 'tin-web', R: 'not the session folder' })
    const withOrigin = { ...io, origin: async (/** @type {string} */ root) => origins[root] ?? '', gitUser: async (/** @type {string | undefined} */ root) => (root && names[root]) || 'Tin Nguyen' }
    const game = await state.laneAt(withOrigin, '/ws/game')
    const web = await state.laneAt(withOrigin, '/ws/web')
    expect([game.root, game.repo, game.pack.id, game.isS2, game.me]).toEqual(['/ws/game', 'sipher/s2', 'unreal', true, 'Tin Nguyen'])
    expect([web.root, web.repo, web.pack.id, web.isS2, web.me]).toEqual(['/ws/web', 'asktinnguyen/han-viet', 'web', false, 'tin-web'])
    // The session's lane reads the name in the session folder, as it always has.
    expect((await state.lane(withOrigin, 'cwd-own-user-test')).me).toBe('Tin Nguyen')
  })

  test('the workspace is read once per session folder and option, and the session lane is its root', async () => {
    const memory = memoryIo()
    memory.files.set('/ws2/a/.git/HEAD', HEAD)
    memory.files.set('/ws2/web/.git/HEAD', HEAD)
    const lines = /** @type {string[]} */ ([])
    const first = await state.workspace(memory.io, '/ws2/a', '../web;../none', line => lines.push(line))
    memory.files.set('/ws2/none/.git/HEAD', HEAD)
    expect(await state.workspace(memory.io, '/ws2/a', '../web;../none', line => lines.push(line))).toEqual(first)
    expect(first).toEqual(['/ws2/a', '/ws2/web'])
    expect(lines).toHaveLength(2)
    expect((await state.lane(memory.io, 'cwd-workspace-test')).root).toBe('R')
  })
  test('each checkout is named by its repository, and only those that would share a name by their folder', () => {
    const at = (/** @type {string} */ root, /** @type {string} */ repo) => ({ root, repo })
    // One checkout, and names that already differ: as before.
    expect(checkoutNames([at('/w/s2', 'sipher/s2')])).toEqual(['s2'])
    expect(checkoutNames([at('/w/game', 'sipher/s2'), at('/w/site', 'asktinnguyen/web')])).toEqual(['s2', 'web'])
    // Two clones of one repository.
    expect(checkoutNames([at('/w/s2', 'sipher/s2'), at('/w/s2-b', 'sipher/s2')])).toEqual(['s2', 's2-b'])
    // a/web beside b/web.
    expect(checkoutNames([at('/w/front', 'a/web'), at('/w/back', 'b/web')])).toEqual(['front', 'back'])
    // The same folder name twice, and three times: numbered in order.
    expect(checkoutNames([at('/a/web', 'a/web'), at('/b/web', 'b/web')])).toEqual(['web', 'web-2'])
    expect(checkoutNames([at('/a/s2', 'sipher/s2'), at('/b/s2', 'sipher/s2'), at('/c/s2', 'sipher/s2')])).toEqual(['s2', 's2-2', 's2-3'])
    // A mix: only the clashing ones change.
    expect(checkoutNames([at('/w/game', 'sipher/s2'), at('/w/site', 'asktinnguyen/web'), at('/w/game-b', 'sipher/s2'), at('/w/docs', 'sipher/handbook')])).toEqual(['game', 'web', 'game-b', 'handbook'])
    // Without an origin a checkout is its folder; a folder name another checkout already has is numbered.
    expect(checkoutNames([at('/w/web', 'path:/w/web'), at('/w/x', 'a/tool'), at('/w/web-2', 'b/tool'), at('C:\\Work\\web\\', 'path:c:/work/web')])).toEqual(['web', 'x', 'web-2', 'web-3'])
    const names = checkoutNames([at('/a/web', 'a/web'), at('/b/web', 'b/web'), at('/c/web-2', 'c/web-2')])
    expect(new Set(names).size).toBe(3)
    expect(checkoutNames([])).toEqual([])
  })

  test('a checkout outside the workspace takes a name that is left and renames none; a name holds only what <name>#<n> reads', () => {
    const at = (/** @type {string} */ root, /** @type {string} */ repo) => ({ root, repo })
    const inside = [at('/w/tools', 'sipher/tools'), at('/w/web', 'asktinnguyen/web')]
    const alone = checkoutNames(inside)
    // Another clone of a workspace repository, and a folder named as a workspace checkout is.
    for (const outside of [at('/x/tools-b', 'sipher/tools'), at('/x/tools', 'sipher/tools'), at('/x/web', 'other/site'), at('/x/tools', 'path:/x/tools')]) {
      const names = checkoutNames(inside, [outside])
      expect(names.slice(0, 2)).toEqual(alone)
      expect(alone.includes(names[2] ?? '')).toBe(false)
    }
    expect(checkoutNames(inside, [at('/x/tools-b', 'sipher/tools')])).toEqual(['tools', 'web', 'tools-b'])
    expect(checkoutNames(inside, [at('/x/tools', 'sipher/tools')])).toEqual(['tools', 'web', 'tools-2'])
    expect(checkoutNames(inside, [at('/x/docs', 'sipher/handbook')])).toEqual(['tools', 'web', 'handbook'])
    // Two clones in folders with a space: different names that /ather issue <name>#<n> reads.
    const spaced = checkoutNames([at('/w/S2 clone', 'sipher/s2'), at('/w/S2 other', 'sipher/s2'), at('/w/Trò chơi', 'path:/w/trò chơi')])
    expect(new Set(spaced).size).toBe(3)
    for (const name of spaced) expect(/^[\w.-]+$/.test(name)).toBe(true)
  })
})

describe('one pane over the workspace', () => {
  const MIN = 60000
  // An intent read from a checkout: its key is its slug in the session's own checkout, `<repoName>/<slug>` in another.
  const from = (root, repoName, slug, isOwn, fields = {}, extra = {}) => {
    const one = intent(slug, fields, extra)
    return { ...one, root, repoName, key: isOwn ? slug : `${repoName}/${slug}` }
  }

  test('two checkouts: ids are keys, the same slug in both is two rows, each row carries its repository', () => {
    const intents = [from('/ws/s2', 's2', 'login', false, {}, { updatedAt: 3 }), from('/ws/web', 'web', 'login', false, {}, { updatedAt: 2 }), from('/ws/web', 'web', 'search', false, { Owner: 'TienPham' }, { updatedAt: 1 })]
    const work = workList(intents, [], 'Tin Nguyen', '', NOON)
    expect(work.map(one => one.id)).toEqual(['intent:s2/login', 'intent:web/login', 'intent:web/search'])
    expect(work.filter(one => one.kind === 'intent' && one.slug === 'login')).toHaveLength(2)
    const cells = work.map(one => rowCells(/** @type {any} */ (one), NOON, true))
    expect(cells.map(cell => cell.repo)).toEqual(['s2', 'web', 'web'])
    // Its own cell, not the warning's.
    expect(cells[0]?.warn).toBe('local')
    // `local` follows the row's own checkout: tagged only where that checkout's main was read.
    const own = work.map(one => rowCells(/** @type {any} */ (one), NOON, row => row.root === '/ws/web').warn)
    expect(own).toEqual(['', 'local', 'local'])
  })

  test("the session's own checkout and another: own keys stay slugs", () => {
    const work = workList([from('/ws/s2', 's2', 'login', true), from('/ws/web', 'web', 'login', false)], [], 'Tin Nguyen', '', NOON)
    expect(work.map(one => one.id)).toEqual(['intent:login', 'intent:web/login'])
  })

  test('one checkout: no repository name, ids are intent:<slug>', () => {
    const work = workList([from('/ws/s2', 's2', 'login', true), from('/ws/s2', 's2', 'board', true)], [], 'Tin Nguyen', '', NOON)
    expect(work.map(one => one.id).sort()).toEqual(['intent:board', 'intent:login'])
    expect(work.map(one => rowCells(/** @type {any} */ (one), NOON, true).warn)).toEqual(['local', 'local'])
    expect(workList([intent('spawner')], [], 'Tin Nguyen', '', NOON).map(one => one.id)).toEqual(['intent:spawner'])
  })

  test('home tracks, continues and searches by key', () => {
    const s2 = from('/ws/s2', 's2', 'login', true)
    const web = from('/ws/web', 'web', 'login', false)
    const model = buildHome(/** @type {any} */ (base({ intents: [s2, web], pinned: 'web/login', away: OFF })))
    expect(model.header.title).toBe('web/login')
    const untracked = buildHome(/** @type {any} */ (base({ intents: [s2, web], pinned: null, last: 'web/login', away: OFF })))
    expect(untracked.next?.id).toBe('intent:web/login')
    expect(searchIntents([s2, web], 'web login').map(one => one.key)).toEqual(['web/login'])
    expect(filterWork(untracked.work, 'web/login').map(one => one.id)).toEqual(['intent:web/login'])
  })

  test('Ask about an intent in another checkout reads it there with git -C', () => {
    expect(aboutIntentPrompt('login', true, '/ws/web')).toContain('git -C /ws/web show origin/main:docs/intent/login/<file>')
    expect(aboutIntentPrompt('login', false, '/ws/web')).toContain('/ws/web/docs/intent/login/')
    expect(aboutIntentPrompt('login', true)).toBe(aboutIntentPrompt('login', true, ''))
  })

  test('the sync line over several checkouts: an error wins, else the least recently synced', () => {
    const at = { ...NO_SYNC, isRepo: true, hasMain: true }
    const fresh = { ...at, fetchedAt: NOON - MIN }
    const older = { ...at, fetchedAt: NOON - 8 * MIN }
    const failed = { ...at, fetchedAt: NOON, failedAt: NOON + 1 }
    expect(syncSummary([fresh])).toBe(fresh)
    expect(syncSummary([fresh, older])).toBe(older)
    expect(syncSummary([older, fresh])).toBe(older)
    expect(syncSummary([fresh, { ...at }])).toEqual({ ...at })
    expect(syncSummary([older, failed, fresh])).toBe(failed)
    expect(syncSummary([NO_SYNC, fresh])).toBe(fresh)
    expect(syncSummary([])).toBe(NO_SYNC)
  })

  // The pane's elements, as plain nodes; every node of a drawn list that passes `test`.
  const node = (/** @type {string} */ type) => (/** @type {any} */ props = {}) => ({ type, props, children: [props.children].flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== '') })
  const el = Object.fromEntries(['Box', 'Text', 'Button', 'Svg', 'Input'].map(name => [name, node(name)]))
  /** @param {any} tree @param {(one: any) => boolean} test @returns {any[]} */
  const all = (tree, test) => (!tree || typeof tree !== 'object' ? [] : [...(test(tree) ? [tree] : []), ...(tree.children ?? []).flatMap((/** @type {any} */ child) => all(child, test))])
  const keysOf = (/** @type {any} */ tree) => all({ children: tree }, one => typeof one.props?.key === 'string').map(one => one.props.key)
  const repeated = (/** @type {string[]} */ keys) => keys.filter((key, at) => keys.indexOf(key) !== at)
  const look = (/** @type {boolean} */ isClicked) => ({ isClicked, width: 100, now: NOON, isTagged: false, ownerColour: () => '#ffffff', onRow: () => () => undefined })

  test('a desktop row draws its repository after the title, as a terminal row does; without one it is drawn as before', () => {
    const [named, plain] = workList([from('/ws/web', 'web', 'login', false, { Status: 'parked' }), from('/ws/s2', 's2', 'board', true)], [], 'Tin Nguyen', '', NOON).map(one => ({ ...one, repoName: one.key === 'board' ? '' : one.repoName }))
    const cols = { count: 3, age: 2, owner: 0 }
    const draw = (/** @type {any} */ one, /** @type {boolean} */ isClicked) => workLine(el, { key: `pick-${one.id}`, cells: rowCells(one, NOON, false), cols, width: 100, ownerColour: '#ffffff', onPress: () => undefined, isClicked })
    const mainOf = (/** @type {any} */ row) => all(row, one => /-main$/.test(one.props?.key ?? ''))[0]
    for (const isClicked of [false, true]) {
      const main = mainOf(draw(named, isClicked))
      // Inside the title's box, after the warning.
      expect(main.children.map((/** @type {any} */ child) => child.props.key)).toEqual(['pick-intent:web/login', 'pick-intent:web/login-warn', 'pick-intent:web/login-repo'])
      expect(main.children[2].children.join('').trim()).toBe('web')
      expect(mainOf(draw(plain, isClicked)).children.map((/** @type {any} */ child) => child.props.key)).toEqual(['pick-intent:board'])
    }
  })

  const CALLS = `# Findings\n\n## F-1 (2026-10-01, rev 3) | blocking: yes | status: open (director)\n\nDrops only, or a full respawn?\n\n**Options:**\n- A (recommended): drops only\n- B: a full respawn\n\n## F-2 (2026-10-01, rev 3) | blocking: yes | status: open (director)\n\nWhich pool size?\n`

  test("a decision on another checkout's intent: its id and answers name the key and its findings file; the session's own as with one checkout", () => {
    const own = from('/ws/s2', 's2', 'login', true, {}, { findings: CALLS, updatedAt: 2 })
    const web = from('/ws/web', 'web', 'login', false, {}, { findings: CALLS, updatedAt: 1 })
    const model = buildHome(/** @type {any} */ (base({ intents: [own, web], pinned: null, away: OFF })))
    const calls = model.items.filter(one => one.kind === 'call')
    expect(calls.map(one => one.id)).toEqual(['call:login:F-1', 'call:login:F-2', 'call:web/login:F-1', 'call:web/login:F-2'])
    expect(calls.map(one => one.kind === 'call' && one.slug)).toEqual(['login', 'login', 'web/login', 'web/login'])
    const [mine, , theirs] = calls
    const [f1] = own.findings
    // The session's own checkout: the words one checkout gets.
    const alone = buildHome(/** @type {any} */ (base({ intents: [intent('login', {}, { findings: CALLS })], pinned: null, away: OFF }))).items[0]
    expect([mine?.id, mine?.prompt, mine?.answers?.explain, mine?.answers?.options.map(one => one.prompt), mine?.answers?.typed('x')]).toEqual([alone?.id, alone?.prompt, alone?.answers?.explain, alone?.answers?.options.map(one => one.prompt), alone?.answers?.typed('x')])
    expect(mine?.answers?.options[0]?.prompt).toBe(findingAnswers('login', /** @type {any} */ (f1)).options[0]?.prompt)
    // Another checkout's: every answer names the key and the findings file there.
    const said = [...(theirs?.answers?.options.map(one => one.prompt) ?? []), theirs?.answers?.explain ?? '', theirs?.answers?.typed('later') ?? '', theirs?.prompt ?? '']
    expect(said).toHaveLength(5)
    expect(said.every(text => text.includes('/ws/web/docs/intent/login/findings.md'))).toBe(true)
    expect(said.slice(0, 4).every(text => text.includes('F-1 on web/login'))).toBe(true)
    expect(theirs?.answers?.source?.startsWith('## F-1')).toBe(true)
  })

  test('the same slug in two checkouts: two blocks of decisions; answering one neither marks, folds nor prunes the other', () => {
    const own = from('/ws/s2', 's2', 'login', true, {}, { findings: CALLS, updatedAt: 2 })
    const web = from('/ws/web', 'web', 'login', false, {}, { findings: CALLS, updatedAt: 1 })
    const model = buildHome(/** @type {any} */ (base({ intents: [own, web], pinned: null, away: OFF })))
    const now = 1_000_000
    const opened = new Set(['web/login'])
    const view = needsView(model.items, model.open, { ...FRESH_ANSWERS }, opened, now, true)
    expect(view.blocks.map(block => [block.slug, block.items.map(one => one.id)])).toEqual([['login', ['call:login:F-1', 'call:login:F-2']], ['web/login', ['call:web/login:F-1', 'call:web/login:F-2']]])
    // Only web's block is open: its first decision is the one opened, the session's own stay behind their head.
    expect([view.shownId, view.states['call:login:F-1']]).toEqual(['call:web/login:F-1', 'line'])
    const decided = [{ id: 'call:web/login:F-1', answer: 'A', at: now }]
    const after = needsView(model.items, model.open.filter(one => one.id !== 'call:web/login:F-1'), { ...FRESH_ANSWERS, decided }, new Set(['web/login', 'login']), now + 1000, true)
    expect([after.states['call:web/login:F-1'], after.states['call:login:F-1'], after.shownId]).toEqual(['decided', 'opened', 'call:login:F-1'])
    const folded = needsView(model.items, model.open, { ...FRESH_ANSWERS, decided }, opened, now + DECIDED_SHOWN_MS, true)
    expect([folded.folded.map(one => one.id), folded.blocks.map(block => block.items.length)]).toEqual([['call:web/login:F-1'], [2, 1]])
    // Read again with web's F-1 resolved: its answer goes, by its key; one given to the other login's F-1 stays.
    const waiting = new Set(['call:login:F-1', 'call:login:F-2', 'call:web/login:F-2'])
    expect(pruneDecided([...decided, { id: 'call:login:F-1', answer: 'B', at: now }], id => waiting.has(id), now + 60000).map(one => one.id)).toEqual(['call:login:F-1'])
    // Drawn: both heads and every row, no element key twice.
    const press = () => () => undefined
    const answer = { view: needsView(model.items, model.open, { ...FRESH_ANSWERS }, new Set(['web/login', 'login']), now, true), onOpen: press, onAnswer: press, onExplain: press, onType: press, onTyped: press, onFindings: press, onFold: () => undefined }
    const keys = keysOf(needsRows(el, false, { items: model.items, open: model.open, opened: new Set(['web/login', 'login']), width: 100, key: () => undefined, onAct: press, onToggle: press, answer: /** @type {any} */ (answer) }))
    expect(repeated(keys)).toEqual([])
    expect(['calls-login', 'calls-web/login', 'item-call:login:F-1', 'item-call:web/login:F-1'].every(key => keys.includes(key))).toBe(true)
  })

  test("teammates' intents from two checkouts, grouped: every row once, the same slug twice, each with its repository", () => {
    const theirs = (/** @type {string} */ root, /** @type {string} */ slug, /** @type {Record<string, string>} */ fields, /** @type {number} */ updatedAt) => from(`/ws/${root}`, root, slug, false, fields, { updatedAt })
    const intents = [
      theirs('s2', 'board', { Owner: 'TienPham', Area: 'Combat' }, 20),
      theirs('web', 'board', { Owner: 'TienPham', Area: 'Web' }, 19),
      theirs('web', 'search', { Owner: 'LamPhung', Area: 'Web', Status: 'parked (waiting on design)' }, 18),
      ...Array.from({ length: 7 }, (_, n) => theirs(n % 2 ? 'web' : 's2', `big-${n >> 1}`, { Owner: 'DuyTran', Area: 'Tools' }, 10 - n)),
    ]
    const work = workList(intents, [], 'Tin Nguyen', '', NOON)
    const ids = work.map(one => one.id).sort()
    expect(ids).toHaveLength(10)
    expect(ids.filter(id => /\/big-0$/.test(id))).toEqual(['intent:s2/big-0', 'intent:web/big-0'])
    /** @param {boolean} isClicked @param {any} groupBy @param {string} query @param {Set<string>} [folded] */
    const draw = (isClicked, groupBy, query, folded = new Set()) => workGroups(el, look(isClicked), { work, shown: filterWork(work, query), query, sort: 'recent', groupBy, areas: ['Combat', 'Tools'], folded, me: 'Tin Nguyen', onFold: key => () => void (folded.has(key) ? folded.delete(key) : folded.add(key)), issuesFoot: [] })
    const rows = (/** @type {any} */ tree) => all({ children: tree }, one => one.type === 'Button' && /^pick-intent:/.test(one.props.key)).map(one => one.props.key.slice('pick-'.length))
    const heads = (/** @type {any} */ tree) => all({ children: tree }, one => one.type === 'Text' && /^(sub|park)-/.test(one.props.key ?? '')).map(one => one.props.children)
    const repos = (/** @type {any} */ tree) => rows(tree).map(id => [id.slice('intent:'.length).split('/')[0], all({ children: tree }, one => one.props?.key === `pick-${id}-repo`).map(one => one.children.join('').trim()).join('|')])
    for (const isClicked of [false, true]) {
      for (const groupBy of ['person', 'area', 'stage', 'none']) {
        // A search that keeps everything: nothing starts folded, and every head counts "x of y".
        const tree = draw(isClicked, groupBy, ' ')
        expect(rows(tree).sort()).toEqual(ids)
        expect(repos(tree).every(([name, drawn]) => name === drawn)).toBe(true)
        expect(repeated(keysOf(tree))).toEqual([])
        const counts = heads(tree).map((/** @type {string} */ head) => / · (\d+) of (\d+)$/.exec(head)?.slice(1).map(Number) ?? [])
        expect(counts.every(([shown, total]) => shown === total)).toBe(true)
        expect(counts.reduce((sum, [shown]) => sum + (shown ?? 0), 0)).toBe(groupBy === 'none' ? 1 : 10)
      }
      // No search, by person: the seven of one person (over two checkouts) and Parked start folded; a press opens them.
      const folded = new Set()
      const first = draw(isClicked, 'person', '', folded)
      expect(heads(first)).toEqual(['Duy Tran · 7', 'Tien Pham · 2', '‖ Parked · 1'])
      expect(rows(first)).toEqual(['intent:s2/board', 'intent:web/board'])
      all({ children: first }, one => one.type === 'Button' && one.props.key === 'sub-others-0-fold')[0].props.onPress()
      all({ children: first }, one => one.type === 'Button' && one.props.key === 'park-others-fold')[0].props.onPress()
      expect(rows(draw(isClicked, 'person', '', folded)).sort()).toEqual(ids)
      // A search: both boards, "2 of 2" of their person, and the repository still drawn.
      const found = draw(isClicked, 'person', 'board')
      expect([rows(found), heads(found), repos(found)]).toEqual([['intent:s2/board', 'intent:web/board'], ['Tien Pham · 2 of 2'], [['s2', 's2'], ['web', 'web']]])
    }
  })
})

describe('issues and PRs from every workspace checkout', () => {
  const ISSUE = { number: 7, title: 'Fix login', name: 'Fix login', url: 'u', labels: [], area: 'Unsorted', isUrgent: false, updatedAt: 1 }
  // An issue read in a checkout: its key is its number in the session's own checkout, `<repoName>#<n>` in another.
  const at = (root, repoName, isOwn, number = 7) => ({ ...ISSUE, number, root, repo: `o/${repoName}`, repoName, key: isOwn ? String(number) : `${repoName}#${number}` })
  const linkedTo = (root, repoName, slug, isOwn, number) => {
    const one = parseIntent({ slug, prompt: prompt({ Status: 'active', Area: 'Combat', Owner: 'Tin Nguyen', Issue: `#${number}` }), findings: '', progress: '', files: [], hasDebrief: false, updatedAt: 1, source: 'local', firstAuthor: '' })
    return { ...one, root, repoName, key: isOwn ? slug : `${repoName}/${slug}` }
  }
  const ids = (/** @type {any[]} */ work) => work.filter(one => one.kind === 'issue').map(one => one.id)

  test('ids: issue:<n> in the session checkout, issue:<repoName>#<n> elsewhere; two #7s are two rows with names', () => {
    const work = workList([], [at('/ws/s2', 's2', true), at('/ws/web', 'web', false)], 'Tin Nguyen', '', NOON)
    expect(ids(work)).toEqual(['issue:7', 'issue:web#7'])
    expect(work.map(one => rowCells(/** @type {any} */ (one), NOON, true).repo)).toEqual(['s2', 'web'])
    expect(issueId(ISSUE)).toBe('issue:7')
    expect(issueOtherRoot(at('/ws/web', 'web', false))).toBe('/ws/web')
    expect(issueOtherRoot(at('/ws/s2', 's2', true))).toBe('')
    expect(issueOtherRoot(ISSUE)).toBe('')
  })

  test('one checkout: no name, ids issue:<n>', () => {
    const work = workList([], [at('/ws/s2', 's2', true), at('/ws/s2', 's2', true, 9)], 'Tin Nguyen', '', NOON)
    expect(ids(work)).toEqual(['issue:7', 'issue:9'])
    expect(work.map(one => rowCells(/** @type {any} */ (one), NOON, true).warn)).toEqual(['', ''])
    expect(ids(workList([], [ISSUE], 'Tin Nguyen', '', NOON))).toEqual(['issue:7'])
  })

  test('an issue hides behind an intent only in the same checkout', () => {
    const issues = [at('/ws/s2', 's2', false), at('/ws/web', 'web', false)]
    expect(ids(workList([linkedTo('/ws/web', 'web', 'login', false, 7)], issues, 'Tin Nguyen', '', NOON))).toEqual(['issue:s2#7'])
    expect(ids(workList([linkedTo('/ws/s2', 's2', 'login', false, 7)], issues, 'Tin Nguyen', '', NOON))).toEqual(['issue:web#7'])
    // Without checkouts (Paseo, tests) as before.
    expect(ids(workList([linkedTo('', '', 'login', true, 7)], [ISSUE], 'Tin Nguyen', '', NOON))).toEqual([])
  })

  test("an issue in another checkout names that checkout's docs/intent", () => {
    expect(issuePrompt(at('/ws/web', 'web', false), 'Tin Nguyen')).toContain('/ws/web/docs/intent')
    // The session's own checkout keeps the relative skill paths: no checkout folder is named.
    expect(issuePrompt(at('/ws/s2', 's2', true), 'Tin Nguyen')).not.toContain('/ws/s2')
  })

  test("an intent's PRs are read under its own checkout's key", () => {
    const met = (/** @type {string} */ root, /** @type {string} */ key) => /** @type {any} */ ({ slug: 'login', key, root, status: 'active', acceptanceDone: 1, acceptanceTotal: 1, prs: [12] })
    const own = met('/ws/s2', 'login')
    const web = met('/ws/web', 'web/login')
    const prs = { 12: 'OPEN', '/ws/web#12': 'MERGED' }
    expect(prKey(own, 12)).toBe('12')
    expect(prKey(web, 12)).toBe('/ws/web#12')
    expect(isReadyToClose(own, prs)).toBe(false)
    expect(isReadyToClose(web, prs)).toBe(true)
    expect(listStage(web, prs)).toBe('met')
    expect(prStatusList(web, prs)).toEqual(prStatusList(own, { 12: 'MERGED' }))
  })

  test('the issue and PR readers take an explicit repository, the session one by default', async () => {
    const memory = memoryIo()
    const io = { ...memory.io, repo: async () => 'sipher/s2' }
    await state.setIssues(io, 'Tin Nguyen', [ISSUE])
    await state.setIssues(io, 'Tin Nguyen', [{ ...ISSUE, number: 8 }], 'o/web')
    expect((await state.readIssues(io, 'Tin Nguyen')).map(one => one.number)).toEqual([7])
    expect((await state.readIssues(io, 'Tin Nguyen', 'sipher/s2')).map(one => one.number)).toEqual([7])
    expect((await state.readIssues(io, 'Tin Nguyen', 'o/web')).map(one => one.number)).toEqual([8])
    await state.setPrStates(io, { 12: 'OPEN' }, NOON)
    await state.setPrStates(io, { 12: 'MERGED' }, NOON, 'o/web')
    expect(await state.readPrStates(io)).toEqual({ 12: 'OPEN' })
    expect(await state.readPrStates(io, 'o/web')).toEqual({ 12: 'MERGED' })
    expect(Object.keys(await state.readPrRecords(io, 'o/web'))).toEqual(['12'])
    // The session's keys are the ones written before.
    expect(memory.store.has('prStates:sipher/s2')).toBe(true)
    expect(memory.store.has('prStates:o/web')).toBe(true)
  })
})

describe('who waits on whom: calls in flight and the worker tree (0.1.9)', () => {
  const fakeHost = (/** @type {any[]} */ agents, /** @type {Record<string, string>} */ files = {}) => /** @type {any} */ ({ home: async () => '', configDir: async () => '', list: async () => [], read: async (/** @type {string} */ path) => files[path] ?? null, exists: async () => false, run: async () => undefined, agents: async () => agents })
  /** @template T @param {number} at @param {() => Promise<T>} run */
  const atTime = async (at, run) => {
    const real = Date.now
    Date.now = () => at
    try {
      return await run()
    } finally {
      Date.now = real
    }
  }

  test('A1: a call is in flight in its own loop until it settles: it ran, was refused or threw; onSettled runs every time', async () => {
    resetCalls()
    let settled = 0
    const onSettled = () => void (settled += 1)
    let seenInside = false
    const ran = await during({ loop: 'w1', toolUseId: 't1', tool: 'Bash', input: { command: 'Build.bat', description: 'Build S2Editor' }, at: 0 }, async () => {
      seenInside = isInFlight('w1') && !isInFlight('') && callsIn('w1')[0]?.what === 'Build S2Editor'
      return { result: 'ok' }
    }, onSettled)
    expect(seenInside).toBe(true)
    expect(ran).toEqual({ result: 'ok' })
    expect(isInFlight('w1')).toBe(false)
    const denied = await during({ loop: 'w1', tool: 'Bash', input: { command: 'rm -rf x' }, at: 0 }, async () => ({ deny: 'no' }), onSettled)
    expect(denied).toEqual({ deny: 'no' })
    expect(isInFlight('w1')).toBe(false)
    let threw = ''
    await during({ tool: 'Read', input: {}, at: 0 }, async () => {
      throw new Error('boom')
    }, onSettled).catch(error => void (threw = String(error)))
    expect(threw).toContain('boom')
    expect(isInFlight('')).toBe(false)
    expect(settled).toBe(3)
  })

  test("A1: a foreground Agent call is linked to the worker it started, by the call's id or else the loop's open Agent call; a background one is not", () => {
    resetCalls()
    const first = startCall({ loop: 'parent', toolUseId: 'agent-1', tool: 'Agent', input: { description: 'Fix F1' }, at: 0 })
    startCall({ loop: 'parent', toolUseId: 'bash-1', tool: 'Bash', input: { command: 'git status' }, at: 0 })
    linkChild({ loop: 'parent', toolUseId: 'agent-1', childId: 'child' })
    expect(callsIn('parent').find(one => one.tool === 'Agent')?.childId).toBe('child')
    endCall(first)
    startCall({ loop: '', toolUseId: '', tool: 'Agent', input: {}, at: 0 })
    linkChild({ loop: '', childId: 'bg', isBackground: true })
    expect(callsIn('')[0]?.childId).toBe(undefined)
    linkChild({ loop: '', childId: 'fg' })
    expect(callsIn('')[0]?.childId).toBe('fg')
    // What a call is: its own description, else its command's first line, cut.
    expect(callWhat('Bash', { command: 'Wait-ForS2EditorCloseAndBuild.ps1 -Target S2Editor\necho done' })).toBe('Wait-ForS2EditorCloseAndBuild.ps1 -Target S2Editor')
    expect(callWhat('Bash', { command: 'x'.repeat(80) })).toHaveLength(60)
    expect(callWhat('Read', {})).toBe('Read')
  })

  test('A2: one rule for a quiet worker: a call in flight is never quiet, however long; silence past the threshold is', () => {
    expect(isSilent({ isInFlight: true, lastAt: 0, now: 3600000, quietMs: 90000 })).toBe(false)
    expect(isSilent({ isInFlight: false, lastAt: 0, now: 91000, quietMs: 90000 })).toBe(true)
    expect(isSilent({ isInFlight: false, lastAt: 0, now: 60000, quietMs: 90000 })).toBe(false)
  })

  test('A2: in the pane a worker with a long call in flight is not quiet; a truly silent one is; a call that ends starts the quiet clock then', async () => {
    resetWorkers()
    resetCalls()
    recordSpawn({ agentId: 'busy', subagentType: 'general-purpose', prompt: 'Build it.', description: 'Builds for long', model: 'opus', at: 0 })
    recordSpawn({ agentId: 'still', subagentType: 'general-purpose', prompt: 'Build it.', description: 'Says nothing', model: 'opus', at: 0 })
    recordTool('busy', 'Bash', { command: 'Build.bat S2Editor' }, 1000)
    startCall({ loop: 'busy', tool: 'Bash', input: { command: 'Build.bat S2Editor', description: 'Build S2Editor Development' }, at: 1000 })
    recordTool('still', 'Edit', {}, 1000)
    const host = fakeHost([{ id: 'busy', description: 'Builds for long', type: 'general-purpose', status: 'running' }, { id: 'still', description: 'Says nothing', type: 'general-purpose', status: 'running' }])
    const crew = await atTime(11 * 60000, () => crewOf(host, 'R', 's1'))
    const busy = crew.find(one => one.id === 'busy')
    const still = crew.find(one => one.id === 'still')
    expect(busy?.prop).toBe('building')
    expect(busy?.wait).toBe('⏳ Build S2Editor Development')
    expect(still?.prop).toBe('idle')
    expect(crewWords(/** @type {any} */ (still)).doing).toBe('quiet')
    recordHeard('still', 11 * 60000)
    expect(workerOf('still')?.lastAt).toBe(11 * 60000)
  })

  test("A4: waiting lines from facts only: the child a foreground Agent call waits on; a shell or Monitor call past a minute, quoted; the pack's lock line", () => {
    resetCalls()
    const titles = (/** @type {string} */ id) => (id === 'c1' ? 'F1 thermo fixes' : 'a worker')
    startCall({ loop: 'p', toolUseId: 'a1', tool: 'Agent', input: { description: 'F1' }, at: 0 })
    linkChild({ loop: 'p', toolUseId: 'a1', childId: 'c1' })
    expect(waitWords(callsIn('p'), 5000, titles)).toEqual({ wait: '⏳ waiting on F1 thermo fixes', stuck: '' })
    startCall({ loop: 'q', tool: 'Bash', input: { command: 'Build.bat', description: 'Build S2Editor' }, at: 0 })
    expect(waitWords(callsIn('q'), 59000, titles).wait).toBe('')
    expect(waitWords(callsIn('q'), 61000, titles).wait).toBe('⏳ Build S2Editor')
    startCall({ loop: 'm', tool: 'Monitor', input: { description: 'PIE log until the boss dies' }, at: 0 })
    expect(waitWords(callsIn('m'), 61000, titles).wait).toBe('⏳ PIE log until the boss dies')
    startCall({ loop: 'l', tool: 'PowerShell', input: { command: 'while ((Get-Content Saved/EDITOR_OWNER.txt) -notmatch "free") { Start-Sleep 30 }', description: 'Wait for the Editor lock' }, at: 0 })
    const lockOf = (/** @type {string} */ command) => editorLockLine(command, 'Lane B holds the Editor until 15:40 for the snow proof, session 1a2b3c4d\nmore')
    expect(waitWords(callsIn('l'), 61000, titles, lockOf).wait).toBe('⏳ Wait for the Editor lock · Lane B holds the Editor until 15:40 for the snow …')
    // No resource is inferred: a command that does not name the lock file gets no lock line.
    expect(editorLockLine('Build.bat S2Editor', 'held by Lane B')).toBe('')
    expect(unreal.lockLine).toBe(editorLockLine)
  })

  test("several checkouts: a waiting line's lock is read in the checkout the command runs in, with that checkout's pack", async () => {
    resetWorkers()
    resetCalls()
    const wait = 'cd ../s2-b && while ((Get-Content Saved/EDITOR_OWNER.txt) -notmatch "free") { Start-Sleep 30 }'
    recordSpawn({ agentId: 'w', subagentType: 'general-purpose', prompt: 'Build it.', description: 'Waits for the Editor', model: 'opus', at: 0 })
    recordTool('w', 'PowerShell', { command: wait }, 1000)
    startCall({ loop: 'w', tool: 'PowerShell', input: { command: wait, description: 'Wait for the Editor lock' }, at: 1000 })
    const agents = [{ id: 'w', description: 'Waits for the Editor', type: 'general-purpose', status: 'running' }]
    const files = { '/ws/s2/Saved/EDITOR_OWNER.txt': 'Lane A holds the Editor', '/ws/s2-b/Saved/EDITOR_OWNER.txt': 'Lane B holds the Editor' }
    const reads = []
    const host = { ...fakeHost(agents, files), read: async (/** @type {string} */ path) => (reads.push(path), files[path] ?? null) }
    /** @param {string} command */
    const where = async command => (command.startsWith('cd ../s2-b') ? { root: '/ws/s2-b', pack: unreal } : { root: '/ws/web', pack: {} })
    // A session in /ws/s2: the command waits in /ws/s2-b, so that checkout's lock is the one quoted.
    expect((await atTime(11 * 60000, () => crewOf(host, '/ws/s2', 's1', unreal, where)))[0]?.wait).toBe('⏳ Wait for the Editor lock · Lane B holds the Editor')
    expect(reads).toEqual(['/ws/s2-b/Saved/EDITOR_OWNER.txt'])
    // A session whose own pack reads no lock (a web checkout, a parent folder) still quotes it.
    expect((await atTime(11 * 60000, () => crewOf(host, '/ws/web', 's1', {}, where)))[0]?.wait).toBe('⏳ Wait for the Editor lock · Lane B holds the Editor')
    // In a checkout whose pack reads none, nothing is quoted; with one checkout, the session's own, as before.
    expect((await atTime(11 * 60000, () => crewOf(host, '/ws/s2', 's1', unreal, async () => ({ root: '/ws/web', pack: {} }))))[0]?.wait).toBe('⏳ Wait for the Editor lock')
    expect((await atTime(11 * 60000, () => crewOf(host, '/ws/s2', 's1', unreal)))[0]?.wait).toBe('⏳ Wait for the Editor lock · Lane A holds the Editor')
  })

  test("several checkouts: each checkout's session records are read from its own folder, so a worker found later is still adopted", async () => {
    resetWorkers()
    resetCalls()
    resetTranscripts()
    const dirs = { '/home/u/.claude/projects': [{ name: '-ws-s2', kind: 'dir' }, { name: '-ws-web', kind: 'dir' }], '/home/u/.claude/projects/-ws-web': [{ name: 'aaaaaaaa-1.jsonl', kind: 'file' }] }
    const record = '/home/u/.claude/projects/-ws-s2/s1/subagents/agent-old'
    const host = /** @type {any} */ ({
      ...fakeHost([{ id: 'old', description: 'Found later', type: 'general-purpose', status: 'running' }], { [`${record}.meta.json`]: '{"model":"claude-opus-5-5"}' }),
      home: async () => '/home/u',
      list: async (/** @type {keyof typeof dirs} */ path) => dirs[path] ?? [],
      exists: async (/** @type {string} */ path) => path === `${record}.jsonl`,
      run: async (/** @type {string[]} */ argv) => ({ exitCode: 0, stdout: argv.at(-1) === `${record}.jsonl` ? '"timestamp":"2026-10-03T05:00:00.000Z"' : '"customTitle":"Web login"' }),
    })
    // Another checkout's session is named first (an intent there, proved by it) …
    expect(await sessionName(host, '/ws/web', 'aaaaaaaa')).toBe('Web login')
    // … and this session's worker is still found under its own checkout's records.
    const crew = await atTime(NOON + 60000, () => crewOf(host, '/ws/s2', 's1'))
    expect([crew[0]?.origin, crew[0]?.elapsed]).toEqual(['adopted', 60000])
    resetTranscripts()
  })

  test('A4: a worker found later with no call seen shows no in-flight line', async () => {
    resetWorkers()
    resetCalls()
    adoptWorker({ id: 'old', type: 'general-purpose', description: 'Found later', model: 'opus', startedAt: 0, now: 0 })
    startCall({ loop: 'old', tool: 'Bash', input: { description: 'A long thing' }, at: 0 })
    const crew = await atTime(30 * 60000, () => crewOf(fakeHost([{ id: 'old', description: 'Found later', type: 'general-purpose', status: 'running' }]), 'R', 's1'))
    expect([crew[0]?.wait, crew[0]?.stuck]).toEqual(['', ''])
  })

  test('A5: one call running 25 minutes or more says so', () => {
    resetCalls()
    startCall({ loop: 's', tool: 'Bash', input: { description: 'PIE soak' }, at: 0 })
    expect(waitWords(callsIn('s'), 24 * 60000, () => '').stuck).toBe('')
    expect(waitWords(callsIn('s'), 25 * 60000, () => '').stuck).toBe('⚠ one call running 25 min')
    expect(waitWords(callsIn('s'), 31.5 * 60000, () => '').stuck).toBe('⚠ one call running 31 min')
  })

  test('A3: the tree draws each worker under the one that started it; "started by" only when that one is not drawn above; past three finished, "+N finished"', () => {
    /** @param {string} id @param {string} state @param {string} [parentId] @returns {any} */
    const one = (id, state, parentId = '') => ({ id, title: id, state, parentId, via: parentId, wait: '', stuck: '' })
    const crew = [one('f5', 'done', 'lead'), one('f4', 'done', 'lead'), one('f3', 'done', 'lead'), one('f2', 'done', 'lead'), one('f1', 'running', 'lead'), one('lead', 'running'), one('orphan', 'running', 'gone-lead'), one('gone-lead', 'done')]
    crew[6].via = 'gone-lead (finished)'
    const tree = crewTree(crew)
    const drawn = tree.live.map(line => (line.kind === 'worker' ? `${'  '.repeat(line.depth)}${line.one.id}${line.one.via ? ` < ${line.one.via}` : ''}` : `${'  '.repeat(line.depth)}+${line.count} finished`))
    expect(drawn).toEqual(['lead', '  f1', '  f5', '  f4', '  f3', '  +1 finished', 'orphan < gone-lead (finished)'])
    expect(tree.done.map(line => (line.kind === 'worker' ? line.one.id : ''))).toEqual(['gone-lead'])
    expect([tree.running, tree.queued, tree.waitingOn]).toEqual([3, 0, 0])
  })

  test("A6: the heading counts running and waiting on; Claude Code's pending reads \"queued\"", () => {
    expect(crewHeading({ running: 2, queued: 0, waitingOn: 1 })).toBe('Workers · Running 2 · Waiting on 1')
    expect(crewHeading({ running: 1, queued: 1, waitingOn: 0 })).toBe('Workers · Running 1 · Queued 1')
    expect(crewWords({ state: 'waiting', prop: null, origin: 'seen', elapsed: 5000, tools: 0, via: '' })).toEqual({ doing: 'queued', line: 'queued 0:05 · 0 tool calls' })
    // A message sent waits on nothing: SendMessage does not make a worker look idle.
    expect(propForTool('SendMessage', { to: 'w2' })).toBe(null)
    expect(propForTool('AskUserQuestion', {})).toBe('asking')
  })
})

describe('a team list that groups (0.1.9)', () => {
  /** @param {string} slug @param {Record<string, unknown>} [over] */
  const work = (slug, over = {}) => /** @type {any} */ ({ id: `intent:${slug}`, kind: 'intent', slug, label: slug, isMine: false, area: 'Tools', who: 'Hai Huynh', stage: 'build', updatedAt: 1, ...over })

  test('A7: Group cycles Person, Area, Stage, None; a stored choice reads back, anything else is Person', () => {
    expect([nextGroup('person'), nextGroup('area'), nextGroup('stage'), nextGroup('none')]).toEqual(['area', 'stage', 'none', 'person'])
    expect([groupByOf('stage'), groupByOf(undefined), groupByOf('tabs')]).toEqual(['stage', 'person', 'person'])
    expect(GROUP_LABELS.person).toBe('Person')
  })

  test("A7: sub-groups by person (no owner last), by area in the pack's order (Unsorted last), by stage in block order", () => {
    const list = [work('a', { who: 'Lam Phung', area: 'VFX', stage: 'met' }), work('b', { who: '', area: '' }), work('c', { who: 'Duy Tran', area: 'Combat', stage: 'prove' }), work('d', { who: 'Lam Phung', area: 'Tools' })]
    const titles = (/** @type {any} */ by) => subGroups(list, by, ['Combat', 'Tools', 'VFX']).map(group => `${group.title}:${group.items.map(one => one.slug).join('')}`)
    expect(titles('person')).toEqual(['Duy Tran:c', 'Lam Phung:ad', 'No owner:b'])
    expect(titles('area')).toEqual(['Combat:c', 'Tools:d', 'VFX:a', 'Unsorted:b'])
    expect(titles('stage')).toEqual(['Ready to close:a', 'Proving:c', 'Building:bd'])
    expect(titles('none')).toEqual([':abcd'])
    expect(subGroups([], 'none')).toEqual([])
    expect(FOLD_OVER).toBe(6)
  })

  test('A8, A9: parked intents split off for their own block; heads count "x of y" while searching', () => {
    const { open, parked } = splitParked([work('a'), work('p', { stage: 'parked' }), work('b')])
    expect([open.map(one => one.slug), parked.map(one => one.slug)]).toEqual([['a', 'b'], ['p']])
    expect([countText(3, 9, false), countText(3, 9, true)]).toEqual(['3', '3 of 9'])
  })

  test('A7: the choice is kept per person in the store', async () => {
    const memory = memoryIo()
    expect(await state.readGroupBy(memory.io, 'Tin Nguyen')).toBe('person')
    await state.setGroupBy(memory.io, 'Tin Nguyen', 'area')
    expect(await state.readGroupBy(memory.io, 'Tin Nguyen')).toBe('area')
    expect(await state.readGroupBy(memory.io, 'Lan Vo')).toBe('person')
  })
})

describe('a team list that groups: drawn (0.1.9)', () => {
  const node = (/** @type {string} */ type) => (/** @type {any} */ props = {}) => ({ type, props, children: [props.children].flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== '') })
  const el = Object.fromEntries(['Box', 'Text', 'Button', 'Svg'].map(name => [name, node(name)]))
  /** @param {any} tree @param {(one: any) => boolean} test @returns {any[]} */
  const all = (tree, test) => (!tree || typeof tree !== 'object' ? [] : [...(test(tree) ? [tree] : []), ...(tree.children ?? []).flatMap((/** @type {any} */ child) => all(child, test))])
  const look = { isClicked: false, width: 68, now: 10, isTagged: false, ownerColour: () => '#ffffff', onRow: () => () => undefined }
  /** @param {string} slug @param {string} who @param {string} [stage] */
  const theirs = (slug, who, stage = 'build') => /** @type {any} */ ({ id: `intent:${slug}`, kind: 'intent', slug, label: slug, hint: '', isMine: false, area: 'Tools', owner: who, who, updatedAt: 1, stage, done: 0, total: 2, source: 'main', warn: '' })

  test('A7, A8: a sub-group of more than six starts folded, six or fewer open, Parked folded; a press on a head opens it', () => {
    const work = [...Array.from({ length: 7 }, (_, n) => theirs(`big-${n}`, 'Lam Phung')), ...Array.from({ length: 6 }, (_, n) => theirs(`six-${n}`, 'Duy Tran')), theirs('resting', 'Duy Tran', 'parked')]
    const pressed = new Set()
    const draw = () => workGroups(el, look, { work, shown: work, query: '', sort: 'recent', groupBy: 'person', areas: [], folded: pressed, me: 'Tin Nguyen', onFold: key => () => void (pressed.has(key) ? pressed.delete(key) : pressed.add(key)), issuesFoot: [] })
    const rows = (/** @type {any} */ tree) => all({ children: tree }, one => one.type === 'Button' && /^pick-intent:/.test(one.props.key)).map(one => one.props.key.slice('pick-intent:'.length))
    const heads = (/** @type {any} */ tree) => all({ children: tree }, one => one.type === 'Text' && /^(sub|park)-/.test(one.props.key ?? '')).map(one => one.props.children)
    const first = draw()
    expect(heads(first)).toEqual(['Duy Tran · 6', 'Lam Phung · 7', '‖ Parked · 1'])
    expect(rows(first)).toEqual(Array.from({ length: 6 }, (_, n) => `six-${n}`))
    all({ children: first }, one => one.type === 'Button' && one.props.key === 'sub-others-1-fold')[0].props.onPress()
    all({ children: first }, one => one.type === 'Button' && one.props.key === 'park-others-fold')[0].props.onPress()
    expect(rows(draw())).toHaveLength(14)
  })
})

describe('crew-tree-and-groups round 2: permission, leaks, one clock, blocks (0.1.9)', () => {
  test('a call whose permission dialog was shown is asking, not running: it never counts as in flight, and its ⏳ line says so', () => {
    resetCalls()
    startCall({ loop: 'w', toolUseId: 't-ask', tool: 'Bash', input: { command: 'rm -rf build', description: 'Clean the build folder' }, at: 0 })
    expect(isInFlight('w')).toBe(true)
    markAsking({ loop: 'w', tool: 'Bash', input: { command: 'rm -rf build' }, at: 1000 })
    expect(isInFlight('w')).toBe(false)
    expect(askingIn('w').map(one => one.askedAt)).toEqual([1000])
    expect(isSilent({ isInFlight: isInFlight('w'), lastAt: 0, now: 11 * 60000, quietMs: 10 * 60000 })).toBe(true)
    // Not a long shell (it may not be running yet); the line says only that permission was asked, and when.
    // A call asked about still warns once it has gone on 25 minutes: an approved build may run on.
    expect(longShell(callsIn('w'), 30 * 60000)).toBe(undefined)
    const asked = waitWords(callsIn('w'), 30 * 60000, () => '')
    expect(asked.wait).toBe('⏳ asked permission 29 min ago: Clean the build folder')
    expect(/^⚠ one call running \d+ min$/.test(asked.stuck)).toBe(true)
    expect(waitWords(callsIn('w'), 1000 + 30000, () => '').wait).toBe('⏳ asked permission just now: Clean the build folder')
    // A dialog for another loop or another tool marks nothing here.
    markAsking({ loop: '', tool: 'Bash', input: { command: 'rm -rf build' }, at: 5 })
    markAsking({ loop: 'w', tool: 'Write', input: {}, at: 5 })
    expect(askingIn('w')).toHaveLength(1)
    expect(askingIn('')).toHaveLength(0)
  })

  test("the dialog is matched to its loop's newest call of that tool, the one with the same command first", () => {
    resetCalls()
    startCall({ loop: 'w', tool: 'Bash', input: { command: 'git push', description: 'Push' }, at: 0 })
    startCall({ loop: 'w', tool: 'Bash', input: { command: 'Build.bat', description: 'Build' }, at: 1 })
    markAsking({ loop: 'w', tool: 'Bash', input: { command: 'git push' }, at: 2 })
    expect(askingIn('w').map(one => one.what)).toEqual(['Push'])
    expect(isInFlight('w')).toBe(true)
    // No command to match: the newest call of the tool not already asking.
    markAsking({ loop: 'w', tool: 'Bash', input: {}, at: 3 })
    expect(askingIn('w').map(one => one.what)).toEqual(['Push', 'Build'])
  })

  test('an aborted dispatch clears its call though the call never settles; a finished turn clears its loop; a throwing onSettled is swallowed', async () => {
    resetCalls()
    const stop = new AbortController()
    let release = () => undefined
    const pending = during({ loop: 'w', tool: 'Bash', input: { command: 'sleep 999' }, at: 0 }, () => new Promise(resolve => (release = () => resolve('done'))), () => {
      throw new Error('bookkeeping broke')
    }, stop.signal)
    expect(isInFlight('w')).toBe(true)
    stop.abort()
    expect(isInFlight('w')).toBe(false)
    release()
    expect(await pending).toBe('done')
    startCall({ loop: 'gone', tool: 'Bash', input: {}, at: 0 })
    startCall({ loop: 'gone', tool: 'Read', input: {}, at: 0 })
    startCall({ loop: 'kept', tool: 'Read', input: {}, at: 0 })
    endLoop('gone')
    expect([callsIn('gone').length, callsIn('kept').length]).toEqual([0, 1])
  })

  test('over the cap, a live long call is kept: asking calls go first, then the loop piling calls up', () => {
    resetCalls()
    startCall({ loop: 'long', tool: 'Bash', input: { description: 'The real build' }, at: 0 })
    startCall({ loop: 'q', toolUseId: 'asked', tool: 'Bash', input: {}, at: 1 })
    markAsking({ loop: 'q', tool: 'Bash', input: {}, at: 1 })
    for (let n = 0; n < 199; n += 1) startCall({ loop: 'leaky', tool: 'Read', input: {}, at: 2 + n })
    expect(askingIn('q')).toHaveLength(0)
    startCall({ loop: 'leaky', tool: 'Read', input: {}, at: 500 })
    expect(callsIn('long').map(one => one.what)).toEqual(['The real build'])
    expect(callsIn('leaky')).toHaveLength(199)
  })

  test('one clock: a worker\'s last call and when it was heard from live on its record', () => {
    resetWorkers()
    recordSpawn({ agentId: 'w', subagentType: 'general-purpose', prompt: 'x', description: 'x', model: 'opus', at: 0 })
    recordTool('w', 'Edit', {}, 100)
    recordHeard('w', 900)
    expect([workerOf('w')?.lastTool, workerOf('w')?.lastAt]).toEqual(['Edit', 900])
    recordTool('w', 'AskUserQuestion', {}, 1000)
    expect([workerOf('w')?.prop, workerOf('w')?.trail]).toEqual(['asking', ['editing']])
    expect(crewWords({ state: 'running', prop: 'asking', origin: 'seen', elapsed: 5000, tools: 2, via: '' }).doing).toBe('asking you')
    expect(['running', 'waiting', 'done', 'failed'].map(one => isLive(/** @type {any} */ (one)))).toEqual([true, true, false, false])
  })

  test('blocksOf: one shape for sub-groups, stage blocks, plain rows and Parked; totals from the whole list; nothing folded while searching', () => {
    /** @param {string} slug @param {Record<string, unknown>} [over] */
    const one = (slug, over = {}) => /** @type {any} */ ({ slug, who: 'Hai Huynh', area: 'Tools', stage: 'build', updatedAt: 1, ...over })
    const all = [...Array.from({ length: 9 }, (_, n) => one(`h${n}`, { updatedAt: n })), one('d', { who: 'Duy Tran', stage: 'met' }), one('p', { stage: 'parked' })]
    const view = (/** @type {any[]} */ blocks) => blocks.map(block => `${block.kind}:${block.title}:${block.items.length}/${block.total}:${block.startsFolded ? 'folded' : 'open'}`)
    const how = { sort: /** @type {const} */ ('recent'), groupBy: /** @type {const} */ ('person'), areas: [], isSearching: false }
    expect(view(blocksOf('others', all, all, how))).toEqual(['sub:Duy Tran:1/1:open', 'sub:Hai Huynh:9/9:folded', 'sub:‖ Parked:1/1:folded'])
    const found = all.filter(each => each.slug === 'h1' || each.slug === 'h2' || each.slug === 'p')
    expect(view(blocksOf('others', found, all, { ...how, isSearching: true }))).toEqual(['sub:Hai Huynh:2/9:open', 'sub:‖ Parked:1/1:open'])
    expect(view(blocksOf('others', all, all, { ...how, groupBy: 'none' }))).toEqual(['plain::10/10:open', 'sub:‖ Parked:1/1:folded'])
    expect(view(blocksOf('mine', all, all, { ...how, sort: 'close' }))).toEqual(['stage:Ready to close:1/1:open', 'stage:Building:9/9:open', 'sub:‖ Parked:1/1:folded'])
    // Your intents are never sub-grouped; the order inside a block is the sort's.
    expect(blocksOf('mine', all, all, how)[0]?.items.slice(0, 2).map(each => each.slug)).toEqual(['h8', 'h7'])
    expect(blocksOf('others', all, all, how)[1]?.foldKey).toBe('others:person:Hai Huynh')
    expect(blocksOf('others', [], all, how)).toEqual([])
  })
})

// Real excerpts from origin/main (2026-10-08): the two formats the findings use.
const FLUID_F10 = `## F-10 (2026-09-29, rev 6) | blocking: no | status: open

**Found:** in the snow/sand lab, neither Nine Tails hook can be driven by its production trigger, so both are proven by automation tests plus a lab force.
- **N6 FoxScan.** The lab has no FoxScan Otherworld Reveal volume, and FoxScan has no test-simulation driver.

**Options:**
- A (recommended): prove both on a map where Fox Form and FoxScan run for real, the Winter or Loc_03 test maps, at the first production trial. Before that, decide whether N5 should also listen to the stance-form route (\`USipherStanceComponent::OnStanceEntered\`).
- B: add a lab rig that grants Fox Form, which means driving the production ability with its resources set up.

**Proposed amendment:** none; the director picks where the production trial happens (see the report).
**Resolution:**

## Reconciliation 2026-10-03 (rev 8, L-18)

- F-10 stays open: N5 and N6 production-trigger proof on a map where Fox Form and FoxScan run for real.
`

const QUEST_F1 = `## F-1 (open, not blocking): Restart one quest also restores every flow-owned actor's authored state

- Found by: P2 worker, 2026-10-05, while writing A5 (S4).
- Today: the confirmation says both, in words, before the restart runs.
- Options: (a) keep it as is, with the confirmation (no runtime change; recommended for P2, since the in-place reset of
  every quest has the same actor behaviour); (b) add a runtime hook that restores only the restarted quest's flow-owned
  actors, which touches \`S2\` quest runtime code outside the debug tool and widens A8; (c) after the import, re-run the
  other quests' current beat entry actions, which can repeat spawns, items and dialogue. Recommendation: (a).
- Decision needed from: owner, only if (b) is wanted.
- Resolution (orchestrator, 2026-10-05): accepted (a). It needs no runtime change and keeps A8's scope. The
  confirmation already names both effects. The owner can ask for (b) later, as its own rev. No rev bump.
`

// More verbatim findings from origin/main 9209256a5bc9 (2026-10-08, read with git show).
const SO_F63 = "## F-63 (2026-09-30, rev 9) | blocking: no | status: open (AIScalable owners)\n\n**Found:** (proof run 3) On `L_Master_biome_01_AoBing`, `BP_AoBing_SoldierCamp_SwordAggressive_GuardPost_C_0` ran a patrol Smart Object find about once per frame (2,711 finds from 05.07.32 UTC until PIE stopped, made visible by the new `LogSipherSmartObjectEligibility` Verbose line); the camp's only patrol slot was already claimed by the PatrolFatigue soldier, so each find failed and was retried on the next frame. The retry pattern is pre-existing in the patrol goal generation (not introduced by this branch); the branch adds one eligibility query build per call.\n**Options:** (a) the patrol generator backs off after a failed find (for example the generator's min interval); (b) leave it.\n**Recommendation:** (a), owned by the AIScalable framework, outside this intent. Measure first (per-frame `FindSmartObjects` over the camp's query box).\n**Resolution:** open; reported for the AIScalable owners.\n"
const WORLD_F2 = "## F-2 (2026-09-30) | blocking: no | Two terrain docs route a step through the disabled plugin\n\n`docs/engineer/Terrain/TerrainTechniques.md` and `RVTTerrainBlending.md` describe adjusting RVT blending in the Dash Edit Material panel. With the plugin disabled, that step has no tool unless an artist enables the plugin locally.\n\nProposed amendment: the selection material quick-edit panel (phase 6) covers this; it is the reason Q3 recommends building it.\n\nResolution: open (Q3).\n"
const WORLD_F8 = "## F-8 (2026-10-01) | blocking: no | Idle cost with the toolbag open is not zero\n\nRound 2 measured about +0.65 ms of game-thread time with the toolbag open and a toy armed, against outcome O5's target of zero idle cost (an unfocused Editor window; FPS chart over about 37 s per run). No Tin's Toys tick is registered; the likely costs are the viewport mode's per-frame HUD drawing and the input pre-processor.\n\nProposed amendment: none. Engineering follow-up: profile with Unreal Insights and skip HUD work when nothing changed.\n\nResolution: partly addressed. The plugin CHANGELOG records redraw-on-change work (PR #32212); no new idle number was measured, so it stays open for a re-measure (follow-up in prompt.md Resolution).\n"
const UVS_F1 = "## F-1 (2026-09-29, S1) | blocking | the function already exists\n\nS2 already ships object-scale-aware tiling: `/Game/S2/Core_Env/Shader/MF_TextureScale`\n(and `MF_TextureScale_VT`, core `MF_UVTriplanar`). It uses the engine `ObjectScale`\nfunction (object-to-world transform, not bounds), a local-space box projection, and a\n`Tiling Follow Object Scale` static switch that `M_Standard_Shader`, `M_Environment`,\n`M_WorldTriplanar` and `M_Env_Simple` already expose. Evidence and paths: progress.md S1.\n\nBuilding `MF_S2_AutoScaleUV` would duplicate shared shader code, which\n`Content/S2/Core_Env/Shader/AGENTS.md` forbids (\"Do not duplicate shader graphs\").\n\nOptions for the orchestrator/director:\n1. (Recommended) Re-scope to verify and document the existing path: a live read of\n   the `MF_TextureScale` graph, then A2 (scale 1, (4,1,1), (1,1,4) cubes with an MI of\n   `M_Standard_Shader` with `Tiling Follow Object Scale` on), A3 (a usage doc for the\n   existing switch, plus limits: ISM per-instance scale, Nanite, WPO), and A4 (stats\n   with the switch on vs off). Gaps found there become proposals to the env-art owner.\n2. Add only what is missing (for example a mesh-UV mode that scales UV0 by the two\n   dominant-face scale components, if MF_TextureScale only does box projection),\n   as an input on the existing function after env-art owner approval, not a new MF.\n3. Close the intent as already satisfied.\n\n**Resolution:** director chose option 3 (close as already done), 2026-09-29, L-2, rev 2.\n"
const BOSS_F2 = "## F2 (2026-10-07, rev 1, non-blocking for this change, blocks a literal A3 \"passes\"): `validate_repository.py` fails for reasons outside this change\n\n- On the shared checkout (b0baa94 plus other lanes' files) it reports 100 errors: Unreal binaries in the \"harness diff\" (silent-bell and tins-lights work), the stale inventories, `.claude/settings.json`, `unreal-anti-slop-review` without SKILL.md, three skill descriptions over 400 characters, invalid YAML in `quest-from-brief/SKILL.md`, `foliage-grid-builder` over 500 lines, and about 30 broken links in `docs/exec-plans/` and `docs/runbooks/blockout-effects-authoring.md`. None touch `boss-bt-authoring` or this intent folder.\n- CI confirms it on this branch's full tree: Harness Validate (run 37606338991) passes its blocking inventory step and reports 35 advisory validator errors, all pre-existing (`.claude/settings.json`, three long skill descriptions, `quest-from-brief` YAML, `foliage-grid-builder` length, broken links in `docs/domains/` and `docs/exec-plans/`). The shared checkout adds 65 more from other lanes' local files.\n- What did run on the branch tree: the validator's skill-package rules on this package (PASS) and the inventory check (current after regenerating main's stale copies). The PR's Harness Validate check is the full-tree verdict.\n- Options: (a) accept A3 on the branch-tree checks plus the PR's CI result; (b) hold A3 until main's own errors are fixed (owner of each skill or doc; the inventory part is VuTruong's P3). Recommendation: (a).\n- Resolution (2026-10-08, coordinator for the Owner, standing autonomy L-2): **accepted (a).** A3 is met on the branch-tree checks plus green CI (Harness Validate success, inventories current), because the 35 advisory validator errors are already on main and none come from this change.\n"
const TAILS_F2 = "## F-2 (2026-10-07, rev 3) | blocking: yes | status: open\n\n**Found:** A3 check on `L_S2Empty` with the scratch asset `/Game/Developers/NineTailsShapeDraft/DA_TailShape_DraftTest_A3`. Persona's requested path equals PIE's desired path (0.00 cm, all 9 tails), and PIE's final pose is within 5 cm of desired. Persona's final pose is 17-39 cm away from PIE's final pose, though. Pose diagnostics put the difference after the shape stage, in the `ABP_Tail_ChildVisualSync` post-process. That it predates this work is inferred, not proven. Evidence: `Saved/NineTailsShapeDrafting/A3/persona-vs-pie.json`, `diag.json`. Recorded by the orchestrator from the worker's S7 report.\n**Proposed amendment:** (recommended) measure one untouched existing preset the same way. If it shows the same gap, A3 compares the shape-stage path (which the tool controls), and the post-process gap is logged as a separate pre-existing issue. Alternatives: make the Persona preview match PIE's post-process (wider scope, may touch the ABP or preview runtime path), or accept the gap as is.\n**Proposed reading (worker, 2026-10-07 slot 19:18-19:27; status stays open):** the scratch asset was measured again on `L_S2Empty`, no ABP change, rotation-invariant (max pairwise joint-distance difference per tail), via `ReadPoseDiagnostics`.\n- (a) **Before Kawaii:** the motion node's output in Persona matches PIE at **0.00 cm on all 9 tails**, both in Shape Edit and with Shape Edit ended.\n- (b) **After Kawaii**, with the Persona body scrubbed to t=0 and not playing, and the PIE MainChar standing still: both final poses were stable from the first sample (0.00 cm change between consecutive reads, which are about 1-2 s apart because of MCP latency). Persona final vs PIE final is **0.13-3.12 cm per tail**.\n- **Likely cause of the earlier 17-39 cm gap:** a reading in Shape Edit. There the paired preview ticks the tail at zero delta (`NineTailsTailPersonaPreview.cpp` Tick: `TickAnimation(bShapeEditPolicy ? 0 : DeltaTime)`), so KawaiiPhysics holds a stale, unsettled state.\n- **Proposed reading of A3:** a drafted shape plays back the same in Persona and PIE, both at the motion-node output (exact) and after the post-process once the rig has settled outside Shape Edit (within about 3 cm).\n- **Not covered:** the pelvis pose was not matched or measured; the Persona body is at montage time 0, PIE is in idle.\n- **Possible follow-up for the owner** (not done): Shape Edit could tick the tail with real delta so the drafting view shows the settled post-process pose.\n- Evidence: `Saved/NineTailsShapeDrafting/A3/a3-compare.json`, `a3-persona.json`, `a3-pie.json`.\n\n**Resolution:** <pending owner>\n"
const FLUID_F8 = "## F-8 (2026-09-29, rev 5) | blocking: no | status: open (updated S15: new blockers found)\n\n**Found:** two review fixes are out of reach without C++, so the material-only phase delivers them only in part.\n- R1 terracing: `Snow/Dust Interaction Parallax Sample Scale` 2.0 reduces the stair steps in the print walls; they still show at grazing angles (`Saved/FluidBlocksWPM/snowsand/fixes/`, BEFORE_R1 vs AFTER1_R1). Real Nanite displacement needs a Nanite-built lab landscape:\n  - Setting `bEnableNanite` through ObjectTools does not build Nanite data.\n  - Setting `landscape.Nanite.LiveRebuildOnModification 1` and toggling Nanite crashed the Editor (assert `Proxies.Contains`, LandscapeSubsystem.cpp:1443). Nothing saved was lost.\n- Footprint-shaped prints: the brush texture is inside the vendor `DLWE_Trail_Brush`, which UDW creates itself. The print-shape knobs (scale 0.7, scatter 0.5, size scatter 0.1) give narrower, crisper ovals, not feet.\n\n**Options:**\n- A (recommended): in the next C++ build, add a lab tool that calls `ULandscapeSubsystem::BuildNanite` on the lab landscape, then capture R1 with `For Nanite Tessellation` on and parallax off. Treat the foot shape as part of the preset-class hook (a Sipher brush material that UDW is told to use), and show it in the lab before any production use.\n- B: accept parallax-only depth for landscapes and leave foot-shaped prints to the Fluid Blocks hero patches (D11, 20 cm).\n\n**Proposed amendment:** none; engineering order within A11/A13. The look choice between A and B is the director's once A's captures exist.\n**Update (S15, 2026-09-29):**\n- Nanite build: the new `SetLandscapeNanite` tool builds the lab landscape's Nanite mesh without the crash (1 proxy up to date, 5 s). It refuses while live rebuild is on and checks proxy registration first.\n- The new blocker: on the Nanite landscape the weather snow does not render at all, so the ground shows the bare Layer 01 grass. The Look FX does not render either. This holds with the plain R1 instance and with `For Nanite Tessellation` on, and after a forced Nanite rebuild with each material. Only a distant ring, beyond the Nanite range, shows snow.\n  - The cause is not found. One hypothesis: UDS 9.0's DLWE snow path does not survive the landscape's Nanite material path.\n  - Evidence: `Saved/FluidBlocksWPM/snowsand/diag/shadowless_reruns/NANITE_*` (those runs also lost dynamic shadows, see S15).\n  - So real Nanite displacement for R1 is not proven, and parallax stays the landscape route for now.\n- Foot-shaped prints: `USipherDLWEFootprintStamperComponent` stamps one oriented print per planted foot, drawn into UDW's trail target with a Sipher copy of the vendor brush. The vendor stamps are swapped off for the pawn.\n  - In the lab (FOOT_R1) this gives separate oval prints along the walk direction, 44 x 20 cm, without the continuous trench or its stair-stepped walls.\n  - The brush copy still draws the vendor's noisy circle, stretched to the quad. A heel and toe silhouette needs a shape change in `M_SipherDLWE_FootBrush`, which is not done.\n\n**Options now:**\n- A: keep parallax for landscapes and use the stamper where separate prints read better (crust, salt, dust), with R1's deep-powder trench kept as the vendor draws it. Nanite snow is left for a UDS upgrade or a DLWE-on-Nanite investigation.\n- B: investigate DLWE on Nanite landscapes now. This is open-ended and may need a vendor material change on a Sipher copy.\n\n**Recommendation:** A. The director's call is whether deep powder should keep its trench or show separate prints (see the S15 captures).\n**Resolution:**\n"

describe('decide in place (0.2.0)', () => {
  test('a stale unsettled Resolution never reopens a heading that says resolved; "opened …" is a settled answer', () => {
    // sipher-so-montage-in-step F-21 on origin/main: the heading and the Resolution line verbatim, the body cut.
    const f21 = '# Findings\n\n## F-21 (2026-09-29, rev 5) | blocking: no | status: resolved (Phase 7 approved, D11 / L-16; shipped in PR #32137, `0889ee954fcc`)\n\n**Found:** Actor I/O lets designers wire events per placed actor.\n**Resolution:** pending Director; recommended.\n'
    expect(parseFindings(f21, '').map(one => one.id)).toEqual([])
    const opened = '# Findings\n\n## F-2 (2026-10-01) | blocking: no | status: open\n\n**Found:** x.\n**Resolution:** opened follow-up #123 and closed here.\n'
    expect(parseFindings(opened, '').map(one => one.id)).toEqual([])
  })
  test('a heading that says "not blocking" or "non-blocking" does not block; "blocking" alone does', () => {
    const findings = '# Findings\n\n## F-4 (open, not blocking): low-severity notes\n\nNotes.\n\n## F-5 (open, non-blocking for this change): later\n\nLater.\n\n## F-6 (open, blocking): the build fails\n\nIt fails.\n'
    expect(parseFindings(findings, '').map(one => [one.id, one.isBlocking])).toEqual([['F-4', false], ['F-5', false], ['F-6', true]])
  })

  test('A1: the list format: options, letters and the recommended one, labels a first clause', () => {
    const options = parseOptions(FLUID_F10)
    expect(options.map(one => [one.letter, one.label, one.isRecommended])).toEqual([
      ['A', 'Prove both on a map where Fox Form and FoxScan run for real', true],
      ['B', 'Add a lab rig that grants Fox Form', false],
    ])
    expect(options[0]?.text.startsWith('Prove both on a map where Fox Form and FoxScan run for real, the Winter or Loc_03 test maps')).toBe(true)
    expect(options[0]?.text.endsWith('(USipherStanceComponent::OnStanceEntered).')).toBe(true)
  })

  test('A1: the list format is read from the last options heading, a qualifier allowed ("**Options now:**")', () => {
    const options = parseOptions(FLUID_F8)
    expect(options.map(one => [one.letter, one.isRecommended])).toEqual([['A', true], ['B', false]])
    expect(options[0]?.text.startsWith('Keep parallax for landscapes and use the stamper')).toBe(true)
    expect(options[1]?.text.startsWith('Investigate DLWE on Nanite landscapes now')).toBe(true)
  })

  test('A1: the inline format: (a) (b) (c) across continuation lines, "Recommendation: (a)", nothing after it', () => {
    const options = parseOptions(QUEST_F1)
    expect(options.map(one => [one.letter, one.label, one.isRecommended])).toEqual([
      ['A', 'Keep it as is', true],
      ['B', 'Add a runtime hook that restores only the restarted…', false],
      ['C', "After the import, re-run the other quests' current beat…", false],
    ])
    expect(options[1]?.text).toBe("Add a runtime hook that restores only the restarted quest's flow-owned actors, which touches S2 quest runtime code outside the debug tool and widens A8")
    expect(options[2]?.text).toBe("After the import, re-run the other quests' current beat entry actions, which can repeat spawns, items and dialogue")
    // "**Options:** (a) …" on one line, "**Recommendation:** (a)" on the next.
    expect(parseOptions(SO_F63).map(one => [one.letter, one.isRecommended])).toEqual([['A', true], ['B', false]])
    // "recommended" inside one option's words, when nothing else says.
    expect(parseOptions('- Options: (a) keep this rule (no change; recommended); (b) drop it.').map(one => one.isRecommended)).toEqual([true, false])
  })

  test('A1: lettered text is options only next to the word Options or Recommendation', () => {
    // ninetails-shape-drafting F-2: "(a) Before Kawaii" and "(b) After Kawaii" are evidence, not choices.
    expect(parseOptions(TAILS_F2)).toEqual([])
    expect(parseOptions('Found: **drops only** or full respawn? (a) no, drops only (recommended); (b) full respawn.')).toEqual([])
    expect(parseOptions('Which way? (a) north; (b) south. Recommendation: (b).').map(one => [one.letter, one.isRecommended])).toEqual([['A', false], ['B', true]])
  })

  test('A1: a button label is the first clause, or the whole option cut when that clause only sets the scene or is too short', () => {
    expect(parseOptions(FLUID_F8.replace(/\*\*Options now:\*\*[\s\S]*$/, '')).map(one => one.label)).toEqual(['In the next C++ build, add a lab tool that calls…', 'Accept parallax-only depth for landscapes and leave…'])
    expect(optionLabel('leave it, nothing changes')).toBe('Leave it, nothing changes')
    expect(optionLabel('no, drops only')).toBe('No, drops only')
  })

  test('A1: none when a finding writes no options, or only one', () => {
    expect(parseOptions('Pool size is an engineering call.')).toEqual([])
    expect(parseOptions('**Options:**\n- A: the only way.\n')).toEqual([])
    expect(parseOptions('**Options:**\n- A: one\n- B: two\n')).toEqual([
      { letter: 'A', label: 'One', text: 'One', isRecommended: false },
      { letter: 'B', label: 'Two', text: 'Two', isRecommended: false },
    ])
  })

  test('A2: a filled Resolution decides, whatever the heading says; one that starts open, pending, partly, not yet, tbd, <…> or - does not close', () => {
    const ids = (/** @type {string} */ findings) => parseFindings(findings, '').map(one => one.id)
    // Closed on origin/main: a Resolution that settles it.
    expect(ids(QUEST_F1)).toEqual([])
    expect(ids(UVS_F1)).toEqual([])
    expect(ids(BOSS_F2)).toEqual([])
    // Still open on origin/main, a Resolution line notwithstanding.
    expect(ids(SO_F63)).toEqual(['F-63'])
    expect(ids(WORLD_F2)).toEqual(['F-2'])
    expect(ids(WORLD_F8)).toEqual(['F-8'])
    expect(ids(TAILS_F2)).toEqual(['F-2'])
    // An empty "**Resolution:**" leaves the heading to decide.
    const open = parseFindings(`# Findings\n\n${QUEST_F1}\n${FLUID_F10}`, '')
    expect(open.map(one => one.id)).toEqual(['F-10'])
    expect(open[0]?.options.map(one => one.letter)).toEqual(['A', 'B'])
    expect(open[0]?.source.startsWith('## F-10 (2026-09-29, rev 6)')).toBe(true)
    expect(ids('## F-1 (2026-10-01) | blocking: yes | status: open (director)\n\nWhich? (a) x; (b) y.\n\n**Resolution:** accepted (a).\n')).toEqual([])
    // A heading that says closed stays closed against an unsettled Resolution (often stale): a reopen changes the heading.
    expect(ids('## F-1 (2026-10-01) | blocking: yes | status: accepted\n\n- Resolution: not yet; reopened by the owner.\n')).toEqual([])
    expect(ids('## F-1 (2026-10-01) | blocking: yes | status: open\n\n- Resolution: not yet; reopened by the owner.\n')).toEqual(['F-1'])
    expect(ids('## F-1 (2026-10-01) | blocking: yes | status: open\n\n**Resolution:** - \n')).toEqual(['F-1'])
  })

  test('A4, A5: an option, Explain and a typed answer hand the session the exact words', () => {
    const [f10] = parseFindings(FLUID_F10, '')
    const answers = findingAnswers('fluid-snow-sand-look', /** @type {any} */ (f10))
    expect(answers.options[0]?.prompt).toBe(
      "Decide F-10 on fluid-snow-sand-look: A — Prove both on a map where Fox Form and FoxScan run for real, the Winter or Loc_03 test maps, at the first production trial. Before that, decide whether N5 should also listen to the stance-form route (USipherStanceComponent::OnStanceEntered). Record it as the intent skill's decision step says (mark the finding, fill its Resolution, fold an accepted amendment into prompt.md with a Rev bump and a Decisions entry); do not ask me again.",
    )
    expect(answers.explain).toBe('Explain decision F-10 on fluid-snow-sand-look: what it is about, each option and what it means, and why the recommendation; do not decide or change anything.')
    expect(answers.typed('  try   the Winter map first ')).toBe(decidePrompt('fluid-snow-sand-look', 'F-10', '"try the Winter map first" (my own answer, in my words)'))
    expect(answers.source?.startsWith('## F-10')).toBe(true)
  })

  test('A3: the decision drawn opened is the one pressed while it waits, else the first that waits; NONE_OPEN closes it', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const waits = (/** @type {{ id: string }} */ one) => one.id !== 'a'
    expect(openedDecision(items, '', waits)?.id).toBe('b')
    expect(openedDecision(items, 'c', waits)?.id).toBe('c')
    expect(openedDecision(items, 'a', waits)?.id).toBe('b')
    expect(openedDecision(items, NONE_OPEN, waits)).toBe(undefined)
  })

  test('A3, A4: needsView lays out Needs you: blocks, each row decided, opened or a line, the folded answers and the focus', () => {
    const answers = findingAnswers('q', { id: 'F-1', options: [] })
    const call = (/** @type {string} */ slug, /** @type {string} */ id) => ({ id: callId(slug, id), kind: 'call', slug, answers })
    const items = [call('q', 'F-1'), call('r', 'F-1'), call('r', 'F-2'), { id: 'editor', kind: 'editor' }, call('s', 'F-3')]
    const [q1, r1, r2, editor, s3] = items
    const now = 1_000_000
    const none = new Set()
    // The first answerable visible row opens; a two-decision intent is one folded block; the editor row only keeps its press.
    let view = needsView(items, items, { ...FRESH_ANSWERS }, none, now, true)
    expect(view.blocks.map(block => [block.slug, block.items.length])).toEqual([['q', 1], ['r', 2], ['', 1], ['s', 1]])
    expect([view.shownId, view.states[q1?.id ?? ''], view.states[r1?.id ?? ''], view.opens.has('editor'), view.isFocusFree]).toEqual([q1?.id, 'opened', 'line', false, true])
    // Answered just now: "decided" in place, and the next one opens; the typed field only for the opened row, where the surface has one.
    const decided = [{ id: q1?.id ?? '', answer: 'A', at: now - 1000 }]
    view = needsView(items, items.filter(one => one !== q1), { ...FRESH_ANSWERS, decided, typing: s3?.id ?? '' }, none, now, true)
    expect([view.states[q1?.id ?? ''], view.shownId, view.typingId, view.isFocusFree]).toEqual(['decided', s3?.id, s3?.id, false])
    expect(needsView(items, items.filter(one => one !== q1), { ...FRESH_ANSWERS, decided, typing: s3?.id ?? '' }, none, now, false).typingId).toBe('')
    // Past DECIDED_SHOWN_MS it folds and leaves the blocks; an opened block's rows can be opened.
    view = needsView(items, items.filter(one => one !== q1), { ...FRESH_ANSWERS, decided, opened: r2?.id ?? '' }, new Set(['r']), now + DECIDED_SHOWN_MS, true)
    expect([view.folded.map(one => one.id), view.blocks.some(block => block.items.includes(/** @type {any} */ (q1))), view.shownId]).toEqual([[q1?.id], false, r2?.id])
    expect(needsView(items, items, { ...FRESH_ANSWERS, opened: NONE_OPEN }, none, now, true).shownId).toBe('')
    expect(editor?.kind).toBe('editor')
  })

  test('A4: an answer shows in place for 8 seconds, then folds, newest first; kept until the files read it resolved', () => {
    const at = 1_000_000
    let decided = withDecided([], { id: 'call:x:F-1', answer: 'A', at })
    decided = withDecided(decided, { id: 'call:x:F-2', answer: 'try it', at: at + 1000 })
    decided = withDecided(decided, { id: 'call:x:F-1', answer: 'B', at: at + 2000 })
    expect(decided.map(one => `${one.id}=${one.answer}`)).toEqual(['call:x:F-1=B', 'call:x:F-2=try it'])
    const items = [{ id: 'call:x:F-1' }, { id: 'call:x:F-2' }]
    expect(decidedView(decided, items, at + 2000 + DECIDED_SHOWN_MS - 1).fresh.map(one => one.id)).toEqual(['call:x:F-1'])
    const later = decidedView(decided, items, at + 2000 + DECIDED_SHOWN_MS)
    expect([later.fresh.length, later.folded.map(one => one.id)]).toEqual([0, ['call:x:F-1', 'call:x:F-2']])
    // Drawing reads only: an item not listed now (the away window's Home) hides its answer, the answer stays.
    expect(decidedView(decided, [], at).fresh).toEqual([])
    // Pruned only when the files are read again: kept while it waits, or for its 8 seconds.
    expect(pruneDecided(decided, id => id === 'call:x:F-2', at + 60000).map(one => one.id)).toEqual(['call:x:F-2'])
    expect(pruneDecided(decided, () => false, at + 2500).map(one => one.id)).toEqual(['call:x:F-1', 'call:x:F-2'])
    expect(decidedText('A')).toBe('✓ Decided: A')
  })

  test('A8: "make it a rule?" answers in place: yes drafts and never commits, no closes it here; one wording for every rule request', () => {
    const traps = [{ title: 'Live Coding blocks the build', count: 4, fix: 'Close the Editor first.' }]
    const answers = ruleAnswers(traps, 'Tin')
    expect(answers.options.map(one => [one.letter, one.label, one.prompt === ''])).toEqual([['A', 'Make it a rule', false], ['B', 'No, leave it', true]])
    expect(answers.options[0]?.prompt).toContain('"Live Coding blocks the build", 4 sessions; its fix each time: Close the Editor first.')
    const ending = 'draft the change that prevents it (the AGENTS.md line or skill step, at the closest authority AGENTS.md allows) and show me the diff for review by the owners (Tin); do not commit.'
    expect([answers.options[0]?.prompt.endsWith(ending), answers.typed('later').endsWith(ending), rulePrompt(traps, 'Tin').endsWith(ending)]).toEqual([true, true, true])
    expect(rulePrompt([...traps, { title: 'T2', count: 5, fix: 'F2.' }], 'Tin').endsWith(ending.replace('the diff', 'the diffs'))).toBe(true)
    expect(ruleAnswers([{ title: 'T1', count: 3, fix: 'F1.' }, { title: 'T2', count: 5, fix: 'F2.' }], 'Tin').typed('only the first')).toContain('"only the first" (my own answer, in my words)')
    // Home's items carry their answers: a decision its finding's, the rule its own and its walk-through.
    const model = buildHome(/** @type {any} */ (base({ away: OFF, recurring: [{ id: 'x', title: 'Trap', fix: 'Fix.', count: 3 }] })))
    const call = model.items.find(one => one.kind === 'call')
    expect([call?.id, call?.answers?.explain]).toEqual(['call:spawner:F-1', 'Explain decision F-1 on spawner: what it is about, each option and what it means, and why the recommendation; do not decide or change anything.'])
    const rule = model.items.find(one => one.kind === 'rule')
    expect([rule?.answers?.options.length, rule?.prompt]).toEqual([2, rulePrompt([{ title: 'Trap', fix: 'Fix.', count: 3 }], unreal.owners)])
  })
})
