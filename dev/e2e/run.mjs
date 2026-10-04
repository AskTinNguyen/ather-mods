// End-to-end run of the Ather Automata hooks module against a sandbox copy of
// the repo's intents, as the desktop app and the terminal drive it.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AFK, createEngine } from './engine.mjs'
import { check } from './screen.mjs'

const OUT = process.argv[2]
// The intents come from an S2 checkout: its docs/intent is copied into a sandbox per run.
const S2_ROOT = process.env.S2_ROOT
if (!S2_ROOT || !fs.existsSync(path.join(S2_ROOT, 'docs/intent'))) throw new Error('Set S2_ROOT to an S2 checkout (the folder holding docs/intent).')
const { register } = await import('./out/hooks/ather.mjs')

const results = []
const screens = []
const expect = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })

// A timezone offset that makes "now" read as the given local hour.
const tzFor = hour => {
  const now = new Date()
  return (((hour * 60 - (now.getUTCHours() * 60 + now.getUTCMinutes())) % 1440) + 1440) % 1440
}

const sandbox = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-e2e-'))
  fs.cpSync(path.join(S2_ROOT, 'docs/intent'), path.join(root, 'docs/intent'), { recursive: true })
  fs.mkdirSync(path.join(root, 'Saved'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Saved/EDITOR_OWNER.txt'), 'free since 14:18')
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n')
  return root
}

const boot = async ({ surfaces = [], user = 'Tin Nguyen', hour = 12, store = {}, ghIssues } = {}) => {
  const root = sandbox()
  const engine = createEngine({ root, surfaces: [...surfaces], user, ghIssues })
  for (const [key, value] of Object.entries({ tz: tzFor(hour), ...store })) engine.store.set(key, value)
  register(engine.on, { briefGate: 'warn' })
  await engine.start()
  // The timezone probe runs in the background; put the test's clock back afterwards.
  await new Promise(resolve => setTimeout(resolve, 1500))
  engine.store.set('tz', tzFor(hour))
  return { engine, root, done: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const dialogText = dialogs =>
  dialogs
    .map(d => [`  ┌ [${d.header}] ${d.question.replace(/\n/g, ' ')}`, ...d.options.map((o, i) => `  │ ${i + 1}. ${o.label}${o.description ? `  —  ${o.description}` : ''}`), `  └ answered: ${d.answer === null ? '(dismissed)' : d.answer}`].join('\n'))
    .join('\n')

const pick = label => question => question.options.find(option => option.label === label || option.label.startsWith(label))?.label ?? `__missing:${label}__ among ${question.options.map(o => o.label).join(' | ')}`
const typed = text => () => text
// Where a session's evidence is: its tracked intent (no commit in the sandbox, which has no refs), or the session.
const evidenceOf = (engine, sid = 'harness-session-0001') => {
  const pinned = engine.store.get(`pinned:${sid}`)
  return engine.store.get(`evidence:${pinned ?? sid}`)
}
const dismiss = () => null

// One /ather (or other command) run: fresh dialog record, scripted answers, flushed sends.
const run = async (engine, answers, command = 'ather', args = '') => {
  engine.record.dialogs.length = 0
  engine.script.length = 0
  engine.script.push(...answers)
  const submits = engine.record.submits.length
  const fills = engine.record.fills.length
  const out = await engine.command(command, args)
  await engine.flush()
  return { out: out.text, dialogs: [...engine.record.dialogs], sent: engine.record.submits.slice(submits), filled: engine.record.fills.slice(fills), left: engine.script.length }
}

const pressIn = (tree, label) => {
  const stack = [tree]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node.type === 'Button' && String(node.props.label ?? '').startsWith(label)) {
      node.props.onPress()
      return true
    }
    stack.push(...(node.children ?? []))
  }
  return false
}

// ---------------------------------------------------------------- start

{
  const { engine, done } = await boot()
  expect('two commands: /ather and /away', engine.record.commands.join(',') === 'ather,away', engine.record.commands)
  expect('three model tools: status, away, profile', engine.record.registeredTools.join(',') === 'status,away,profile', engine.record.registeredTools)
  done()
  const quiet = createEngine({ root: sandbox(), surfaces: [], user: 'Tin Nguyen' })
  register(quiet.on, {})
  await quiet.start(false)
  expect('a non-interactive session gets the guards but no console commands', quiet.record.commands.length === 0 && quiet.record.registeredTools.length === 3, quiet.record.commands)
}

// ---------------------------------------------------------------- desktop: one question, never a loop

{
  const { engine, done } = await boot()
  const first = await run(engine, [pick('Decide F-')])
  screens.push(['Desktop · /ather, decide the waiting call', `${dialogText(first.dialogs)}\n  → output: ${first.out}\n  → sent: ${first.sent[0] ?? '(nothing)'}`])
  const menu = first.dialogs[0]
  expect('/ather asks exactly one question', first.dialogs.length === 1 && menu?.header === 'Ather', first.dialogs.length)
  expect('the question says where things stand and what waits', /Nothing tracked in this session\. Waiting on you: F-\d+ on [a-z-]+\. What now\?/.test(menu?.question ?? ''), menu?.question)
  expect('the owner of open intents is not offered the tour', !(menu?.options ?? []).some(o => /tour/i.test(o.label)), menu?.options.map(o => o.label))
  expect('deciding hands the call to the session, once', first.sent.length === 1 && /Walk me through decision F-\d+ on intent .+ Then ask me to choose with a question dialog/.test(first.sent[0] ?? ''), first.sent)
  const again = await run(engine, [dismiss])
  expect('a sent decision is not offered again', !(again.dialogs[0]?.options ?? []).some(o => o.label.startsWith('Decide F-')), again.dialogs[0]?.options.map(o => o.label))
  expect('closing the question ends /ather with one status line', again.dialogs.length === 1 && !again.out.includes('\n') && again.sent.length === 0, again.out)
  const unanswered = await run(engine, [typed('[No preference]')])
  expect('an unanswered question closes it', unanswered.dialogs.length === 1 && unanswered.sent.length === 0 && !/Nothing matches/.test(unanswered.out), unanswered.out)
  const idle = await run(engine, [() => AFK])
  expect('a question that times out while you are away closes, nothing chosen', idle.dialogs.length === 1 && idle.sent.length === 0, idle.out)
  const question = await run(engine, [typed('what can you do?')])
  expect('a question typed under Other goes to the session', question.sent.length === 1 && /I asked Ather: "what can you do\?"/.test(question.sent[0] ?? ''), question.sent)
  const miss = await run(engine, [typed('zzzq')])
  expect('a word that matches no intent goes to the session, once', miss.dialogs.length === 1 && miss.sent.length === 1 && /I asked Ather: "zzzq"/.test(miss.sent[0] ?? ''), miss.out)
  const name = await run(engine, [typed('fluid')])
  expect('part of an intent name tracks it', engine.store.get('pinned:harness-session-0001') === 'fluid-snow-sand-look' && /Now tracking fluid-snow-sand-look/.test(name.out), name.out)
  const tracked = await run(engine, [dismiss])
  expect('with an intent tracked, the question leads with it', /^fluid-snow-sand-look: /.test(tracked.dialogs[0]?.question ?? ''), tracked.dialogs[0]?.question)
  const switched = await run(engine, [pick('Switch to other work'), question => question.options[0].label])
  expect('switching is one follow-up question, then done', switched.dialogs.length === 2 && switched.dialogs[1]?.header === 'Work' && /Now tracking/.test(switched.out), switched.dialogs.map(d => d.header))
  const picked = await run(engine, [question => question.options[0].label], 'ather', 'pick')
  expect('/ather pick is one question', picked.dialogs.length === 1 && /Now tracking/.test(picked.out), picked.out)
  const role = await run(engine, [], 'ather', 'role designer')
  expect('/ather role sets the role for this person', engine.store.get('role:tinnguyen') === 'designer' && /Designer/.test(role.out), role.out)
  await run(engine, [], 'ather', 'checked')
  expect('/ather checked records your own Editor check', evidenceOf(engine)?.editor?.state === 'pass')
  await run(engine, [], 'ather', 'intent box-scale-tool')
  expect('/ather intent tracks by name', engine.store.get('pinned:harness-session-0001') === 'box-scale-tool')
  const tour = await run(engine, [], 'ather', 'tour')
  expect('/ather tour hands the tour to the session and its skill', tour.sent.length === 1 && /\.agents\/skills\/ather-tour\/SKILL\.md/.test(tour.sent[0] ?? ''), tour.sent)
  expect('no command hook threw on the desktop path', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

// ---------------------------------------------------------------- newcomer

{
  const { engine, done } = await boot({ user: 'Minh Tran', hour: 21 })
  expect('a newcomer is told about the tour when the session starts', engine.record.toasts.some(text => /new here\? Type \/ather tour/.test(text)), engine.record.toasts)
  const first = await run(engine, [pick('Take the tour')])
  screens.push(['Desktop · newcomer /ather', `${dialogText(first.dialogs)}\n  → output: ${first.out}\n  → sent: ${first.sent[0] ?? '(nothing)'}`])
  const menu = first.dialogs[0]
  expect('the newcomer question welcomes them by name with the tour first', /^Hi Minh, new to Ather\?/.test(menu?.question ?? '') && menu?.options[0]?.label === 'Take the tour (Recommended)', menu?.options.map(o => o.label))
  expect('a newcomer is not offered a hand-over in the evening', !(menu?.options ?? []).some(o => o.label === 'Heading off?'), menu?.options.map(o => o.label))
  expect('the newcomer can skip the tour or pick something to work on', (menu?.options ?? []).some(o => o.label === 'Skip the tour') && (menu?.options ?? []).some(o => o.label === 'Pick something to work on'), menu?.options.map(o => o.label))
  expect('taking the tour sends it to the session and marks it taken for this person', first.sent.length === 1 && engine.store.get('tour:minhtran')?.isDone === true, first.sent)
  const after = await run(engine, [dismiss])
  expect('after the tour, /ather no longer leads with it', !(after.dialogs[0]?.options ?? []).some(o => /tour/i.test(o.label)), after.dialogs[0]?.options.map(o => o.label))
  const profile = await engine.modelTool({ tool: 'mcp__ather-automata__profile', role: 'techart', track: 'actor-io' })
  expect('the tour records the role and a followed intent through the profile tool', engine.store.get('role:minhtran') === 'techart' && engine.store.get('pinned:harness-session-0001') === 'actor-io', profile.result)
  const bad = await engine.modelTool({ tool: 'mcp__ather-automata__profile', track: 'no-such-intent' })
  expect('the profile tool refuses an intent that does not exist', /No intent named/.test(bad.result), bad.result)
  done()
}

// ---------------------------------------------------------------- away

{
  const { engine, root, done } = await boot({ hour: 21 })
  const menu = await run(engine, [dismiss])
  expect('in the evening the question offers "Heading off?"', (menu.dialogs[0]?.options ?? []).some(o => o.label === 'Heading off?'), menu.dialogs[0]?.options.map(o => o.label))
  const away = await run(engine, [pick('Until done')], 'away')
  screens.push(['Desktop · /away', `${dialogText(away.dialogs)}\n  → output: ${away.out}\n  → sent: ${away.sent[0] ?? ''}`])
  const state = engine.store.get('away:harness-session-0001')
  expect('/away offers the three presets', away.dialogs[0]?.options.map(o => o.label).join('|') === 'Until done (Recommended)|8 hours|4 hours', away.dialogs[0]?.options.map(o => o.label))
  expect('"Until done" starts a window with no clock and the default holds', state?.phase === 'running' && state?.untilDone === true && state?.held?.join(',') === 'merge,push-main', state)
  expect('the hand-over goes to the session at once, with the ledger path relative to the repo', /^I am away until done/.test(away.sent[0] ?? '') && /record every decision you take for me in (docs|Saved)\//.test(away.sent[0] ?? ''), away.sent)
  expect('the ledger gets the window header', /## Autonomy window from /.test(fs.readFileSync(state.ledgerPath, 'utf8')))
  const compose = await engine.compose()
  const lane = compose.sections.find(one => one.id === 'ather-automata:lane')?.text ?? ''
  expect('every prompt carries the mandate', /until the work is done/.test(lane) && /never merge/.test(lane) && /action "end"/.test(lane), lane.slice(0, 160))
  const asked = await engine.modelTool({ tool: 'AskUserQuestion', questions: [{ question: 'Which pool size?', header: 'Pool', options: [{ label: '32 (Recommended)' }, { label: '16' }], multiSelect: false }] })
  expect("the model's question is refused and written to the ledger", asked.deny !== undefined && /### D-1 · Which pool size\?/.test(fs.readFileSync(state.ledgerPath, 'utf8')), asked.deny?.slice(0, 80))
  const merge = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 32212 --admin' })
  expect('a merge is refused and parked', merge.deny !== undefined && engine.store.get('away:harness-session-0001')?.parked.length === 1, merge.deny?.slice(0, 80))
  const push = await engine.modelTool({ tool: 'Bash', command: 'git push -u origin feat/main-menu' })
  expect('a branch push goes through', push.deny === undefined)
  const review = await run(engine, [pick("I'm back")])
  expect("while away, /ather's own question is not deferred, and \"I'm back\" is one choice", review.dialogs.length === 1 && review.dialogs[0]?.options[0]?.label === "I'm back: end the window", review.dialogs[0]?.options.map(o => o.label))
  screens.push(['Desktop · /ather after the window', `${dialogText(review.dialogs)}\n  → output: ${review.out}\n  → sent: ${review.sent[0] ?? ''}`])
  expect('the review goes to the session with every decision and held action', /D-1 Which pool size\?/.test(review.sent[0] ?? '') && /P-1 gh pr merge 32212/.test(review.sent[0] ?? ''), review.sent)
  expect('sending the review closes the window', (engine.store.get('away:harness-session-0001')?.phase ?? 'off') === 'off')
  const timed = await run(engine, [], 'away', '6h tidy the pool')
  expect('/away 6h <goal> starts at once', (engine.store.get('away:harness-session-0001')?.phase ?? 'off') === 'running' && /until/.test(timed.out), timed.out)
  await run(engine, [], 'away', 'end')
  expect('/away end ends it', (engine.store.get('away:harness-session-0001')?.phase ?? 'off') === 'review')
  const tool = await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  expect('the model can close the review', (engine.store.get('away:harness-session-0001')?.phase ?? 'off') === 'off', tool.result)
  const started = await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'start', hours: 2, goal: 'nap' })
  expect('the model can open a window on the person\'s words', (engine.store.get('away:harness-session-0001')?.phase ?? 'off') === 'running' && /Autonomy window open/.test(started.result), started.result)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  expect('no hook threw in the away flow', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  void root
  done()
}

// ---------------------------------------------------------------- guards, evidence, recurring traps

{
  const { engine, done } = await boot({ store: { gotchaHits: { 'live-coding': { title: 'A running Editor blocks the build (Live Coding)', fix: 'Close the Editor.', count: 2 } } } })
  const piped = await engine.modelTool({ tool: 'Bash', command: 'Build.bat S2Editor | tail -5', __text: 'Result: Failed (OtherCompilationError)' })
  expect('a piped build that says Failed is reported as failed', (piped.context ?? []).some(text => /Treat this build as failed/.test(text)) && evidenceOf(engine)?.build?.state === 'fail', piped.context)
  const brief = await engine.modelTool({ tool: 'Agent', prompt: 'Fix the bug.', description: 'fixer' })
  expect('a thin worker brief gets a reminder', (brief.context ?? []).some(text => /did not name exact paths/.test(text)), brief.context)
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat x', __text: 'Unable to build while Live Coding is active' })
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat x', __text: 'Unable to build while Live Coding is active' })
  expect('a trap pops up with its fix and counts once per session', engine.store.get('gotchaHits')['live-coding'].count === 3 && engine.record.toasts.filter(text => /Ather gotcha/.test(text)).length === 1, engine.store.get('gotchaHits'))
  const pie = await engine.modelTool({ tool: 'mcp__unreal__StartPIE', map: 'L_S2Empty' })
  await engine.flush()
  expect('a PIE run through MCP is evidence', evidenceOf(engine)?.pie?.state === 'pass', pie)
  const both = await run(engine, [pick('Go through 2 things')])
  expect('two waiting things are one choice that sends one walk-through', both.sent.length === 1 && /one at a time/.test(both.sent[0] ?? '') && /Ask me with a question dialog whether to make it a rule/.test(both.sent[0] ?? ''), both.sent)
  expect('the trap is settled once sent', (engine.store.get('gotchaRuled') ?? []).includes('live-coding'))
  const status = JSON.parse((await engine.modelTool({ tool: 'mcp__ather-automata__status' })).result)
  expect('the status tool reports the lane', status.me === 'Tin Nguyen' && status.evidence.build.state === 'fail' && status.caught.buildsCorrected === 1, status)
  await engine.timers()
  expect('the heartbeat writes this lane', fs.existsSync(path.join(engine.$ ? (await engine.$.session.root()) : '', 'Saved/AtherAutomata/lanes/harness-session-0001.json')))
  expect('no hook threw in the guards', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

// ---------------------------------------------------------------- what the 0.9.0 review found

{
  const { engine, done } = await boot()
  const away = () => engine.store.get('away:harness-session-0001')
  // B1: /away end after the window already ended must not wipe the review.
  await run(engine, [], 'away', '4h')
  await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 1 --admin' })
  await run(engine, [], 'away', 'end')
  const again = await run(engine, [], 'away', 'end')
  expect('/away end after the window ended keeps the review and its held actions', (away()?.phase ?? 'off') === 'review' && away()?.parked.length === 1 && /has ended/.test(again.out), again.out)
  const blocked = await run(engine, [], 'away', '2h')
  expect('a new window waits until the last one is reviewed', (away()?.phase ?? 'off') === 'review' && /waits for your review/.test(blocked.out), blocked.out)
  // M3: an item is settled only once the session has it.
  engine.failSubmit(true)
  const failed = await run(engine, [pick('Review:')])
  expect('when delivery fails, the review stays open and is offered again', (away()?.phase ?? 'off') === 'review' && engine.record.toasts.some(text => /could not send/.test(text)), failed.out)
  engine.failSubmit(false)
  await run(engine, [pick('Review:')])
  expect('once delivered, the review closes the window', (away()?.phase ?? 'off') === 'off')
  // B1: holds and deferred questions at the same moment both survive, with distinct ids.
  await run(engine, [], 'away', '4h')
  const ask = { tool: 'AskUserQuestion', questions: [{ question: 'Which pool size?', header: 'Pool', options: [{ label: '32' }, { label: '16' }], multiSelect: false }] }
  await Promise.all([engine.modelTool({ tool: 'Bash', command: 'gh pr merge 2 --admin' }), engine.modelTool(ask), engine.modelTool({ tool: 'Bash', command: 'git push origin HEAD:main' })])
  expect('parallel holds and a deferred question all land, with distinct ids', away()?.parked.map(one => one.id).join(',') === 'P-1,P-2' && /### D-1 · Which pool size\?/.test(fs.readFileSync(away()?.ledgerPath, 'utf8')), away()?.parked)
  // N1: a resume to another conversation must not take this window with it.
  engine.setSessionId('harness-session-resumed')
  const resumedMerge = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 9 --admin' })
  await engine.flush()
  expect('a resumed conversation is not put under this window, and this window is untouched', resumedMerge.deny === undefined && away()?.phase === 'running' && engine.store.get('away:harness-session-resumed') === undefined, resumedMerge.deny)
  engine.setSessionId('harness-session-0001')
  // M2: after /clear the window moves to the new session id at once, before anything touches it.
  await engine.end('clear')
  engine.setSessionId('harness-session-0002')
  await new Promise(resolve => setTimeout(resolve, 1400))
  expect('after /clear the lane is moved to the new session id straight away', engine.store.get('away:harness-session-0002')?.phase === 'running' && engine.store.get('away:harness-session-0001') === undefined, [...engine.store.keys()].filter(key => key.startsWith('away:')))
  const compose = await engine.compose()
  const merge = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 3 --admin' })
  expect('after /clear the mandate and the holds carry on', /AUTONOMY WINDOW/.test(compose.sections.find(one => one.id === 'ather-automata:lane')?.text ?? '') && merge.deny !== undefined, merge.deny?.slice(0, 60))
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  engine.setSessionId('harness-session-0001')
  // M6: a console command is not a PIE proof; a readback must come from the server written to.
  await engine.modelTool({ tool: 'mcp__unreal__ExecuteConsoleCommand', command: 'stat fps' })
  await engine.modelTool({ tool: 'mcp__unreal__set_actor_property', actor: 'A' })
  await engine.modelTool({ tool: 'mcp__docs__get_page', page: 'x' })
  await engine.flush()
  const evidence = evidenceOf(engine)
  expect('a console command is not a PIE proof, and a read elsewhere is not a readback', evidence?.pie?.state !== 'pass' && evidence?.readback?.state !== 'pass', evidence)
  // M7: text typed in the away dialog is hours and a goal, not a question.
  const typedAway = await run(engine, [typed('2 hours, finish the pool')], 'away')
  const state2 = engine.store.get('away:harness-session-0001')
  expect('"2 hours, finish the pool" typed in the away dialog opens a 2-hour window with that goal', state2?.phase === 'running' && state2?.goal === 'finish the pool' && /^I am away until/.test(typedAway.sent[0] ?? ''), typedAway.out)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  // m1: a mistyped intent is refused, not tracked.
  const typo = await run(engine, [], 'ather', 'intent no-such-intent')
  expect('/ather intent with a name that does not exist is refused', /No open intent matches/.test(typo.out) && engine.store.get('pinned:harness-session-0001') === undefined, typo.out)
  // m9: an ended session says so in its heartbeat.
  await engine.end('exit')
  const laneFile = path.join(await engine.$.session.root(), 'Saved/AtherAutomata/lanes/harness-session-0001.json')
  expect('an ended session marks its lane ended', fs.existsSync(laneFile) && JSON.parse(fs.readFileSync(laneFile, 'utf8')).hasEnded === true)
  expect('no hook threw in the regression scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

// ---------------------------------------------------------------- what the fresh-eyes first-day review found

{
  const { engine, root, done } = await boot()
  const away = () => engine.store.get('away:harness-session-0001')
  // Holds last through the review: a window that has ended still holds until it is reviewed.
  await run(engine, [], 'away', '4h')
  await run(engine, [], 'away', 'end')
  const afterEnd = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 7 --admin' })
  const asked = await engine.modelTool({ tool: 'AskUserQuestion', questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false }] })
  expect('after the window ends, merges stay held and questions stay recorded until the review', afterEnd.deny !== undefined && asked.deny !== undefined && away()?.parked.length === 1, afterEnd.deny?.slice(0, 60))
  // The shared checkout is on main: a bare push is a push to main.
  const bare = await engine.modelTool({ tool: 'Bash', command: 'git push' })
  const plus = await engine.modelTool({ tool: 'Bash', command: 'git push origin +main' })
  const api = await engine.modelTool({ tool: 'Bash', command: 'gh api -X PUT repos/o/r/pulls/12/merge' })
  expect('a bare push on main, +main and a merge through gh api are all held', bare.deny !== undefined && plus.deny !== undefined && api.deny !== undefined, [bare.deny, plus.deny, api.deny].map(one => Boolean(one)))
  await run(engine, [pick('Review:')])
  const freed = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 8 --admin' })
  expect('once reviewed, nothing is held', freed.deny === undefined && (away()?.phase ?? 'off') === 'off')
  // An until-done window does not end on a checklist that is already complete.
  const done1 = path.join(root, 'docs/intent/zz-finished')
  fs.mkdirSync(done1, { recursive: true })
  fs.writeFileSync(path.join(done1, 'prompt.md'), '# Finished\n\n- Status: active\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- [x] all done\n')
  await run(engine, [], 'ather', 'intent zz-finished')
  await run(engine, [], 'away', 'until done polish')
  await engine.timers()
  expect('an until-done window keeps running on a checklist that was already complete', (away()?.phase ?? 'off') === 'running', (away()?.phase ?? 'off'))
  expect('the ledger of your own intent goes in its folder', /docs[\\/]intent[\\/]zz-finished[\\/]decisions\.md$/.test(away()?.ledgerPath), away()?.ledgerPath)
  // A new session picks up the window from the session that ended overnight.
  await engine.end('exit')
  engine.setSessionId('harness-session-morning')
  engine.record.toasts.length = 0
  await engine.start()
  await new Promise(resolve => setTimeout(resolve, 300))
  const morning = engine.store.get('away:harness-session-morning')
  const held = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 9 --admin' })
  expect("the next morning's session takes over last night's window, still holding", morning?.phase === 'running' && held.deny !== undefined && engine.record.toasts.some(text => /away window from an earlier session/.test(text)), engine.record.toasts)
  // Stop words end it.
  const stop = await run(engine, [], 'away', 'stop')
  expect('/away stop ends the window instead of offering a new one', /Away window ended/.test(stop.out) && stop.dialogs.length === 0 && engine.store.get('away:harness-session-morning')?.phase === 'review', stop.out)
  const startAgain = await run(engine, [], 'away', '')
  expect('while a review waits, /away does not offer to start a new window', startAgain.dialogs.length === 0 && /waits for your review/.test(startAgain.out), startAgain.out)
  // Evidence: no tests is not a pass; reading about a trap is not hitting it.
  await engine.modelTool({ tool: 'Bash', command: 'Run-S2Automation -Filter TeamMove', __text: 'EXIT CODE: 0\n0 tests found' })
  expect('a test run that found no tests is not a pass', evidenceOf(engine, 'harness-session-morning')?.automation?.state === 'fail', evidenceOf(engine, 'harness-session-morning')?.automation)
  engine.record.toasts.length = 0
  await engine.modelTool({ tool: 'Bash', command: 'grep -r "index.lock" docs/', __text: 'docs/x.md: index.lock is a git file' })
  expect('grepping docs for a trap does not raise or count it', !engine.record.toasts.some(text => /gotcha/.test(text)), engine.record.toasts)
  expect('no hook threw in the first-day scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  // Minh follows a teammate's intent: it is read-only, and nothing of his lands in their folder.
  const { engine, done } = await boot({ user: 'Minh Tran', hour: 18 })
  const no = await run(engine, [typed('no')])
  expect('typing "no" does not track an intent', engine.store.get('pinned:harness-session-0001') === undefined && no.sent.length === 1, no.out)
  await run(engine, [], 'ather', 'pick fluid')
  const menu = await run(engine, [dismiss])
  expect("a teammate's open decisions are not offered to the follower", !(menu.dialogs[0]?.options ?? []).some(o => /Answer question/.test(o.label)) && (menu.dialogs[0]?.options ?? []).some(o => /See where it stands/.test(o.label)), menu.dialogs[0]?.options.map(o => o.label))
  await run(engine, [], 'away', '4h')
  expect("an away window while following a teammate's intent keeps its ledger out of their folder", /Saved[\\/]AtherAutomata[\\/]away/.test(engine.store.get('away:harness-session-0001')?.ledgerPath ?? ''), engine.store.get('away:harness-session-0001')?.ledgerPath)
  await run(engine, [], 'away', 'stop')
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  const role = await run(engine, [], 'ather', 'role game designer')
  expect('"/ather role game designer" is understood, and a role ends being new', engine.store.get('role:minhtran') === 'designer' && /Designer/.test(role.out), role.out)
  const after = await run(engine, [dismiss])
  expect('with a role set, /ather no longer leads with the tour', !/new to Ather/.test(after.dialogs[0]?.question ?? ''), after.dialogs[0]?.question)
  done()
}

{
  // Lan skips the tour; the welcome toast is said once, not every session.
  const { engine, done } = await boot({ user: 'Lan Vo' })
  const first = await run(engine, [pick('Skip the tour')])
  expect('a newcomer can skip the tour from the first question', engine.store.get('tour:lanvo')?.isDone === true && /Tour skipped/.test(first.out), first.out)
  engine.record.toasts.length = 0
  await engine.start()
  expect('the welcome toast is not repeated in later sessions', !engine.record.toasts.some(text => /new here/.test(text)), engine.record.toasts)
  done()
}

// ---------------------------------------------------------------- what the 0.9.2 structural review found

{
  const { engine, root, done } = await boot()
  const key = 'away:harness-session-0001'
  // B1: a worktree on a feature branch, as AGENTS.md prescribes; the shared checkout stays on main.
  const worktree = path.join(root, 'wt-feat')
  const gitdir = path.join(root, '.git', 'worktrees', 'feat')
  fs.mkdirSync(worktree, { recursive: true })
  fs.mkdirSync(gitdir, { recursive: true })
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitdir.replace(/\\/g, '/')}\n`)
  fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feat/bear-timing\n')
  await run(engine, [], 'away', '4h')
  const wt = worktree.replace(/\\/g, '/')
  const push = await engine.modelTool({ tool: 'Bash', command: `git -C ${wt} push -u origin HEAD` })
  const sync = await engine.modelTool({ tool: 'Bash', command: `git -C ${wt} merge origin/main` })
  const pushMain = await engine.modelTool({ tool: 'Bash', command: `git -C ${wt} push origin HEAD:main` })
  expect("a worktree's branch push and main sync are not held; a push to main from it is", push.deny === undefined && sync.deny === undefined && pushMain.deny !== undefined, [push.deny, sync.deny, pushMain.deny].map(Boolean))
  // M1: once the review is handed over, the session's questions reach the person.
  await run(engine, [], 'away', 'end')
  await run(engine, [pick('Review:')])
  const asked = await engine.modelTool({ tool: 'AskUserQuestion', questions: [{ question: 'Keep D-1?', header: 'Review', options: [{ label: 'Keep' }, { label: 'Undo' }], multiSelect: false }] })
  const compose = await engine.compose()
  expect('after the review is handed over, its questions are asked, not recorded, and the mandate is gone', asked.deny === undefined && !/AWAY WINDOW/.test(compose.sections.find(one => one.id === 'ather-automata:lane')?.text ?? ''), asked.deny)
  // M3: a closed window leaves no keys behind.
  expect('a closed window leaves no store keys behind', !engine.store.has(key) && !engine.store.has('windows:tinnguyen'), [...engine.store.keys()].filter(one => /^(away|windows):/.test(one)))
  // M2: traps and the build result are read from a build log, as the Prove step prescribes.
  engine.record.toasts.length = 0
  await engine.modelTool({ tool: 'PowerShell', command: 'Get-Content Saved/Logs/S2Editor-build.log -Tail 60', __text: 'Building S2Editor...\nUnable to build while Live Coding is active\nResult: Succeeded' })
  expect('reading a build log catches its traps and its Result line', engine.record.toasts.some(text => /Live Coding/.test(text)) && evidenceOf(engine)?.build?.state === 'pass', evidenceOf(engine)?.build)
  // A scripted session never takes over a window it cannot review.
  await run(engine, [], 'away', '4h')
  await engine.end('exit')
  // A live session in another checkout has no heartbeat here: its lane must survive this start's cleanup.
  engine.store.set('pinned:harness-session-other-checkout', 'tins-toys')
  engine.store.set('evidence:harness-session-other-checkout', { build: { state: 'pass', detail: 'Result: Succeeded' } })
  engine.setSessionId('harness-session-script')
  await engine.start(false)
  await new Promise(resolve => setTimeout(resolve, 300))
  expect("a session start's cleanup leaves sessions it cannot vouch for alone", engine.store.get('pinned:harness-session-other-checkout') === 'tins-toys' && engine.store.has('evidence:harness-session-other-checkout'), [...engine.store.keys()])
  expect('a non-interactive session does not adopt the window', engine.store.get('away:harness-session-script') === undefined && engine.store.get(key)?.phase === 'running', [...engine.store.keys()].filter(one => one.startsWith('away:')))
  expect('no hook threw in the structural-review scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

// ---------------------------------------------------------------- GitHub issues as work (0.9.3)

const GH_ISSUES = [
  { number: 28887, title: '[BUG] Dodge cancels the wrong montage when two overlap', url: 'https://github.com/sipherxyz/s2/issues/28887', labels: [{ name: 'combat' }, { name: 'priority:high' }], updatedAt: '2026-07-21T02:57:12Z' },
  { number: 31360, title: 'Cheaper rain particles on low settings', url: 'https://github.com/sipherxyz/s2/issues/31360', labels: [{ name: 'VFX' }], updatedAt: '2026-09-15T11:52:35Z' },
]

{
  // Lan owns no intent but has assigned issues: Next is the most urgent one.
  const { engine, done } = await boot({ user: 'Lan Vo', ghIssues: GH_ISSUES, store: { 'role:lanvo': 'engineer' } })
  await new Promise(resolve => setTimeout(resolve, 300))
  const menu = await run(engine, [pick('Next: Start issue #28887')])
  screens.push(['Desktop · /ather with assigned GitHub issues', `${dialogText(menu.dialogs)}\n  → output: ${menu.out}\n  → sent: ${menu.sent[0] ?? '(nothing)'}`])
  expect('with no intent of your own, Next starts your most urgent GitHub issue', /Next: Start issue #28887/.test(menu.dialogs[0]?.options.map(o => o.label).join('|') ?? ''), menu.dialogs[0]?.options.map(o => o.label))
  expect('starting an issue asks the session to run the preflight, then draft the intent with the issue linked', menu.sent.length === 1 && /issue-preflight/.test(menu.sent[0] ?? '') && /- Issue: #28887/.test(menu.sent[0] ?? '') && /Do not comment on, assign or close/.test(menu.sent[0] ?? ''), menu.sent[0])
  const after = await run(engine, [dismiss])
  expect('a started issue leaves Next for the rest of the session', !(after.dialogs[0]?.options ?? []).some(o => /#28887/.test(o.label)) && (after.dialogs[0]?.options ?? []).some(o => /Start issue #31360/.test(o.label)), after.dialogs[0]?.options.map(o => o.label))
  const work = await run(engine, [pick('Pick something to work on'), pick('#31360')])
  expect('"What to work on" lists issues beside intents, and picking one sends it', work.dialogs[1]?.header === 'Work' && work.sent.some(text => /issue #31360/.test(text)), work.dialogs[1]?.options.map(o => o.label))
  const typedNumber = await run(engine, [typed('#40001'), pick('Start issue #40001')])
  expect('typing an issue number starts that issue, even one not assigned to you', typedNumber.sent.some(text => /issue #40001/.test(text)), typedNumber.sent)
  const command = await run(engine, [], 'ather', 'issue 28887')
  expect('/ather issue <number> starts it', /Sent issue #28887/.test(command.out), command.out)
  expect('gh was asked for open issues assigned to me, read-only', !engine.record.hookErrors.length, engine.record.hookErrors)
  done()
}

{
  // An issue that already has an intent shows as the intent, not twice.
  const { engine, root, done } = await boot({ ghIssues: GH_ISSUES })
  const dir = path.join(root, 'docs/intent/time-dilation-ownership')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompt.md'), '# Time dilation ownership\n\n- Status: active\n- Area: Combat\n- Owner: Tin Nguyen\n- Issue: #28887\n\n## Acceptance\n\n- [ ] fixed\n')
  await new Promise(resolve => setTimeout(resolve, 300))
  const work = await run(engine, [pick('Pick something to work on'), dismiss])
  const labels = work.dialogs[1]?.options.map(o => o.label) ?? []
  expect('an issue that already has an intent is listed as that intent only', !labels.some(label => /#28887/.test(label)) && labels.includes('time-dilation-ownership'), labels)
  done()
}

{
  // Without gh (or signed out) there are simply no issues: no error, one debug line.
  const { engine, done } = await boot()
  const menu = await run(engine, [dismiss])
  expect('without gh, /ather works and shows no issues', menu.dialogs.length === 1 && engine.record.hookErrors.length === 0 && engine.record.logs.some(text => /could not read your GitHub issues/.test(text)), engine.record.logs)
  done()
}

{
  // The terminal pane lists issues beside intents.
  const { engine, done } = await boot({ surfaces: ['terminal'], user: 'Lan Vo', ghIssues: GH_ISSUES, store: { 'role:lanvo': 'engineer' } })
  await new Promise(resolve => setTimeout(resolve, 300))
  await run(engine, [])
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · /ather with assigned GitHub issues (72 columns)', pane.lines.join('\n')])
  expect('the pane shows Next as the urgent issue and the other issue under "Also open for you", cleanly', /NEXT {2}Start issue #28887/.test(pane.lines.join('\n')) && /#31360/.test(pane.lines.join('\n')) && pane.problems.length === 0, pane.problems)
  pressIn(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'Everything open')
  const all = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · Everything open (72 columns)', all.lines.join('\n')])
  expect('"Everything open" groups your GitHub issues first, then intents by area', /Your GitHub issues/.test(all.lines.join('\n')) && all.problems.length === 0, all.problems)
  done()
}

// ---------------------------------------------------------------- what the second first-day review found (0.9.4)

{
  // The morning after: the window ended overnight; once the person types, they are asked again; merges stay held.
  const { engine, root, done } = await boot({ user: 'Minh Tran', store: { 'role:minhtran': 'designer', 'tour:minhtran': { isDone: true } } })
  await run(engine, [], 'away', '30m')
  const window = engine.store.get('away:harness-session-0001')
  expect('/away 30m starts a half-hour window', window?.phase === 'running' && Math.round((window.wakeAt - window.startedAt) / 60000) === 30, window && (window.wakeAt - window.startedAt) / 60000)
  engine.store.set('away:harness-session-0001', { ...window, wakeAt: Date.now() - 1000 })
  await engine.end('exit')
  engine.setSessionId('harness-session-morning')
  engine.record.toasts.length = 0
  await engine.start()
  await new Promise(resolve => setTimeout(resolve, 300))
  expect('an overnight window that has ended is picked up as "welcome back", not "still running"', engine.record.toasts.some(text => /welcome back/i.test(text)) && engine.store.get('away:harness-session-morning')?.phase === 'review', engine.record.toasts)
  const ask = { tool: 'AskUserQuestion', questions: [{ question: 'Which timing?', header: 'Timing', options: [{ label: 'Earlier' }, { label: 'Later' }], multiSelect: false }] }
  const before = await engine.modelTool(ask)
  await engine.type('good morning, where are we?')
  const after = await engine.modelTool(ask)
  const merge = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 5 --admin' })
  expect('once the person types, their questions are asked again; merges stay held until the review', before.deny !== undefined && after.deny === undefined && merge.deny !== undefined, [before.deny, after.deny, merge.deny].map(Boolean))
  const back = await run(engine, [], 'away', "I'm back")
  expect('"/away I\'m back" is understood as coming back', !/Heading off/.test(back.out) && back.dialogs.length === 0, back.out)
  const night = await run(engine, [pick('Review:')])
  void night
  const tonight = await run(engine, [], 'away', 'tonight')
  const overnight = engine.store.get('away:harness-session-morning')
  expect('/away tonight runs until 09:00', overnight?.phase === 'running' && /until 09:00/.test(tonight.out), tonight.out)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  void root
  done()
}

{
  // A newcomer with an issue sees it beside the tour; skipping the tour asks the role.
  const issues = [{ number: 32401, title: 'Bear slash timing feels late', url: 'u', labels: [{ name: 'combat' }, { name: 'priority:high' }], updatedAt: new Date().toISOString() }]
  const { engine, done } = await boot({ user: 'Minh Tran', ghIssues: issues })
  await new Promise(resolve => setTimeout(resolve, 300))
  const menu = await run(engine, [pick('Skip the tour'), pick('Designer')])
  screens.push(['Desktop · newcomer with an assigned issue, skipping the tour', `${dialogText(menu.dialogs)}\n  → output: ${menu.out}`])
  expect("a newcomer's first question offers their own issue beside the tour", (menu.dialogs[0]?.options ?? []).some(o => /^Start #32401 Bear slash/.test(o.label)), menu.dialogs[0]?.options.map(o => o.label))
  expect('skipping the tour asks the role, and the answer is kept', menu.dialogs[1]?.header === 'Your role' && engine.store.get('role:minhtran') === 'designer', menu.dialogs[1]?.question)
  const two = await run(engine, [typed('2')])
  expect('"2" under Other picks the second option', two.dialogs.length >= 1 && !/I asked Ather: "2"/.test(two.sent[0] ?? ''), two.sent)
  const typo = await run(engine, [], 'ather', 'tuor')
  expect('"/ather tuor" suggests /ather tour instead of running it', /Did you mean \/ather tour\?/.test(typo.out) && typo.sent.length === 0, typo.out)
  const ship = await run(engine, [typed('ship it')])
  expect('"ship it" under Other goes to the session as words, not as the skip command', ship.sent.some(text => /I asked Ather: "ship it"/.test(text)), ship.sent)
  done()
}

{
  // Evidence for an intent survives into the next session while HEAD is unchanged.
  const { engine, root, done } = await boot({ store: { 'role:tinnguyen': 'engineer' } })
  fs.mkdirSync(path.join(root, '.git/refs/heads'), { recursive: true })
  fs.writeFileSync(path.join(root, '.git/refs/heads/main'), 'abcdefabcdef0123456789abcdefabcdef012345\n')
  await run(engine, [], 'ather', 'intent box-scale-tool')
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', __text: 'Result: Succeeded' })
  await engine.modelTool({ tool: 'Bash', command: 'Run-S2Automation -Filter Box', __text: 'EXIT CODE: 0\n12 tests passed' })
  await engine.end('exit')
  engine.setSessionId('harness-session-tomorrow')
  await engine.start()
  await run(engine, [], 'ather', 'intent box-scale-tool')
  const evidence = engine.store.get('evidence:box-scale-tool')
  expect("yesterday's build and tests still count today", evidence?.build?.state === 'pass' && evidence?.automation?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
  done()
}

{
  // While a merge's losses are unreviewed, Next waits; the pane shows what needs you first.
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer', 'lost:harness-session-0001': { paths: ['Content/S2/BP_Sash.uasset'], isDisclosed: false } } })
  await run(engine, [], 'ather', 'intent box-scale-tool')
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · a merge lost an edit (72 columns)', pane.lines.join('\n')])
  const text = pane.lines.join('\n')
  expect('with a merge loss unreviewed, Next waits and Needs you comes first, naming the asset', !/NEXT/.test(text) && /Needs you \(\d\)\n1: A merge dropped your edits to BP_Sash/.test(text) && /A merge dropped your edits to BP_Sash/.test(text) && pane.problems.length === 0, pane.problems)
  done()
}

// ---------------------------------------------------------------- what the third first-day review found (0.9.5)

const hasFocus = tree => {
  const stack = [tree]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node.props?.autoFocus) return true
    stack.push(...(node.children ?? []))
  }
  return false
}

{
  // While away, the pane focuses nothing: one stray Enter must not end the window.
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' } })
  await run(engine, [], 'away', 'tonight')
  await run(engine, [])
  const tree = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const away = check(tree, 72)
  screens.push(['Terminal · away window running (72 columns)', away.lines.join('\n')])
  expect('while away, the pane focuses nothing and offers "End the window (I\'m back)"', !hasFocus(tree) && /e: End the window \(I'm back\)/.test(away.lines.join('\n')) && /nothing for you yet/.test(away.lines.join('\n')), away.lines)
  done()
}

{
  // A tech artist with PIE proven: the last proof is one press.
  const { engine, root, done } = await boot({ user: 'Hana Le', store: { 'role:hanale': 'techart', 'tour:hanale': { isDone: true } } })
  const dir = path.join(root, 'docs/intent/snow-trail-lod-pop')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompt.md'), '# Snow trail LOD pop\n\n- Status: active\n- Area: VFX\n- Owner: Hana Le\n\n## Acceptance\n\n- [x] no pop at LOD1\n')
  await run(engine, [], 'ather', 'intent snow-trail-lod-pop')
  await engine.modelTool({ tool: 'mcp__unreal__StartPIE', map: 'L_SnowLab' })
  await engine.flush()
  // In the terminal the claim is never the default focus: a reflexive Enter must not record it.
  engine.setSurfaces?.(['terminal'])
  const paneTree = await engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const nextButton = (function find(node) { if (!node || typeof node !== 'object') return null; if (node.props?.key === 'next') return node; for (const child of node.children ?? []) { const hit = find(child); if (hit) return hit } return null })(paneTree)
  expect('"I checked it in the Editor" is never focused by default in the pane', nextButton && /I checked it in the Editor/.test(nextButton.props.label) && !nextButton.props.autoFocus, nextButton?.props)
  const menu = await run(engine, [pick('I checked it in the Editor')])
  expect("a tech artist's last proof is offered as one press, and recorded", (menu.dialogs[0]?.options ?? []).some(o => o.label === 'I checked it in the Editor') && engine.store.get('evidence:snow-trail-lod-pop')?.editor?.state === 'pass', menu.dialogs[0]?.options.map(o => o.label))
  // The next session offers to continue it.
  await engine.end('exit')
  engine.setSessionId('harness-session-hana-2')
  await engine.start()
  const day2 = await run(engine, [dismiss])
  expect('a new session offers to continue the intent you last worked on', (day2.dialogs[0]?.options ?? []).some(o => o.label === 'Continue snow-trail-lod-pop'), day2.dialogs[0]?.options.map(o => o.label))
  done()
}

{
  // Starting an issue with no role set asks the session to find it out.
  const issues = [{ number: 32450, title: 'Snow trail VFX pops at LOD1', url: 'u', labels: [{ name: 'VFX' }, { name: 'priority:high' }], updatedAt: new Date().toISOString() }]
  const { engine, done } = await boot({ user: 'Hana Le', ghIssues: issues })
  await new Promise(resolve => setTimeout(resolve, 300))
  const first = await run(engine, [pick('Start #32450')])
  expect('starting an issue with no role set asks the session to ask the role', /ask me \(designer, tech artist or engineer\)/.test(first.sent[0] ?? ''), first.sent[0])
  done()
}

{
  // The morning question says what happened overnight; the header shows the stage track and the proof.
  const { engine, done } = await boot({ store: { 'role:tinnguyen': 'engineer' } })
  await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', __text: 'Result: Succeeded' })
  await engine.modelTool({ tool: 'Bash', command: 'Run-S2Automation -Filter Snow', __text: 'EXIT CODE: 0\n2 tests failed' })
  await run(engine, [], 'away', '4h')
  await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 3 --admin' })
  await run(engine, [], 'away', 'stop')
  const morning = await run(engine, [dismiss])
  expect('the morning question says what happened while you were away', /^Welcome back\. While you were away: 1 held action\./.test(morning.dialogs[0]?.question ?? ''), morning.dialogs[0]?.question)
  engine.setSurfaces?.(['terminal'])
  done()
}

{
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' } })
  await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', __text: 'Result: Succeeded' })
  await engine.modelTool({ tool: 'Bash', command: 'Run-S2Automation -Filter Snow', __text: 'EXIT CODE: 0\n2 tests failed' })
  await engine.flush()
  pressIn(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'F-10')
  await engine.flush()
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · tracked intent with proof and a sent decision (72 columns)', pane.lines.join('\n')])
  const text = pane.lines.join('\n')
  expect('the header shows the stage track and the proof so far, a failed test included', /Plan ✓ {2}Build ● {2}Prove ○ {2}Ship ○/.test(text) && /build ✓ · tests ✗/.test(text), pane.lines.slice(0, 3))
  expect('a sent decision is marked in front, so a cut row still says so; the footer drops the tour', /✓ sent · F-10/.test(text) && !/\/ather tour/.test(text) && pane.problems.length === 0, pane.problems)
  done()
}

// ---------------------------------------------------------------- terminal

{
  const { engine, done } = await boot({ surfaces: ['terminal'], hour: 21 })
  const pane = width => engine.render('Pane', { title: 'Ather', isFocused: true, bodyColumns: width, placement: 'dock' }, 'ather')
  const band = width => engine.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: width }, 'band')
  const opened = await run(engine, [])
  expect('/ather opens the pane in the terminal', engine.record.opens.some(one => one.id === 'ather') && opened.dialogs.length === 0, opened.out)
  for (const width of [72, 110]) {
    const drawn = check(await pane(width), width)
    expect(`terminal pane @${width}: lays out cleanly`, drawn.problems.length === 0, drawn.problems.join('; '))
    if (width === 72) screens.push(['Terminal · /ather (72 columns, 21:00)', drawn.lines.join('\n')])
    const rail = check(await band(width), width)
    expect(`terminal band @${width}: one line when something needs you`, rail.lines.length === 1 && /needs? you · \/ather/.test(rail.lines[0] ?? ''), rail.lines)
  }
  const home = check(await pane(110), 110).lines.join('\n')
  expect('the pane offers the hand-over in the evening', /Heading off\?/.test(home), home)
  expect('NEXT leads and is focused', /n: NEXT {2}Pick up /.test(home), home)
  pressIn(await pane(110), 'Everything open')
  const all = check(await pane(72), 72)
  screens.push(['Terminal · All intents (72 columns)', all.lines.join('\n')])
  expect('All intents lists every open intent by area, cleanly', all.problems.length === 0 && /Everything open \(yours first\)/.test(all.lines.join('\n')), all.problems)
  pressIn(await pane(110), 'Back')
  const tree = await pane(110)
  pressIn(tree, 'F-')
  await engine.flush()
  expect('pressing a Needs-you row hands it to the session and closes the pane', engine.record.submits.length === 1 && engine.record.closes.some(one => one.id === 'ather'), engine.record.submits)
  await engine.close('ather')
  expect('no hook threw in the terminal', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  const { engine, done } = await boot({ surfaces: ['terminal'], user: 'Minh Tran' })
  const band = check(await engine.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band'), 110)
  expect('a newcomer band points at the tour', /New here\? \/ather tour/.test(band.lines.join('')), band.lines)
  await run(engine, [])
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · newcomer /ather (72 columns)', pane.lines.join('\n')])
  expect("a newcomer's pane leads with the tour and offers teammates' intents", /NEXT {2}New here\? Take the tour/.test(pane.lines.join('\n')) && /Follow a teammate \(read-only\)/.test(pane.lines.join('\n')) && pane.problems.length === 0, pane.problems)
  done()
}

{
  // Nothing to say: the band is left to other mods.
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'tour:lanvo': { isDone: true } }, user: 'Lan Vo' })
  const band = await engine.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band')
  expect('with nothing to say the band stays empty for other mods', band === null, band)
  done()
}

// ---------------------------------------------------------------- report

const passed = results.filter(one => one.ok).length
const lines = ['# Ather Automata end-to-end run', '', `${passed} of ${results.length} checks passed.`, '']
for (const one of results) lines.push(`- ${one.ok ? '✅' : '❌'} ${one.name}${one.ok || !one.detail ? '' : `  \n  ${one.detail}`}`)
lines.push('', '# Screens', '')
for (const [title, body] of screens) lines.push(`## ${title}`, '', '```text', body, '```', '')
fs.writeFileSync(OUT, lines.join('\n'))
console.log(`${passed}/${results.length} passed`)
for (const one of results.filter(r => !r.ok)) console.log(`FAIL ${one.name}\n     ${one.detail.slice(0, 400)}`)
