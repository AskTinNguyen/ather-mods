// End-to-end run of the Ather Automata hooks module against a sandbox copy of
// the repo's intents, as the desktop app and the terminal drive it.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { AFK, createEngine } from './engine.mjs'
import { check, draw, layouts } from './screen.mjs'

const OUT = process.argv[2]
// --layouts <dir>: write every pane and band laid out at 72 and 110 columns, to diff two runs.
const LAYOUTS = process.argv.includes('--layouts') ? process.argv[process.argv.indexOf('--layouts') + 1] : null
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
  // The skills the quick actions may name.
  fs.mkdirSync(path.join(root, '.agents/skill-library/visuals/show-me'), { recursive: true })
  fs.writeFileSync(path.join(root, '.agents/skill-library/visuals/show-me/SKILL.md'), '---\nname: show-me\ndescription: Help the user understand the topic visually.\n---\n')
  for (const skill of ['intent', 'issue-preflight', 'thermo-nuclear-code-quality-review', 'editor-video-walkthrough', 'talab', 'bt-graph', 'boss-bt-authoring', 'team-move-rule-book-authoring', 's2-goai-config-authoring', 'qte-content-authoring', 'level-cinematics-authoring', 'unreal-niagara-mcp']) {
    fs.mkdirSync(path.join(root, '.agents/skills', skill), { recursive: true })
    fs.writeFileSync(path.join(root, '.agents/skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: What ${skill} does. Use it when it fits.\n---\n`)
  }
  fs.mkdirSync(path.join(root, 'Saved'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Saved/EDITOR_OWNER.txt'), 'free since 14:18')
  // The marker an S2 checkout has at its root: it selects the Unreal pack (packs/index.mjs).
  fs.writeFileSync(path.join(root, 'S2.uproject'), '{}\n')
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n')
  return root
}

const boot = async ({ surfaces = [], user = 'Tin Nguyen', hour = 12, store = {}, ghIssues, ghPrs, env } = {}) => {
  const root = sandbox()
  const engine = createEngine({ root, surfaces: [...surfaces], user, ghIssues, ghPrs, env })
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
  // The desktop app starts sessions as the SDK does (not interactive, no surface): the commands are
  // there at once, and the console's reading starts the first time it is drawn, never before.
  const quietReads = () => quiet.record.logs.length + quiet.record.invalidations
  const before = quietReads()
  expect('a session the desktop app starts (not interactive) still gets /ather and /away, and reads nothing until drawn', quiet.record.commands.join(',') === 'ather,away' && quiet.record.registeredTools.length === 3 && quietReads() === before, quiet.record.commands)
  const desk = createEngine({ root: sandbox(), surfaces: [], user: 'Tin Nguyen', ghIssues: [{ number: 28887, title: '[BUG][GAS] Dodge cancels the wrong montage', url: 'https://github.com/sipherxyz/s2/issues/28887', labels: [{ name: 'combat' }], updatedAt: new Date().toISOString() }] })
  register(desk.on, {})
  await desk.start(false)
  await desk.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band', 'desktop')
  await new Promise(resolve => setTimeout(resolve, 1500))
  const deskPane = check(await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop'), 70)
  const narrow = check(await desk.render('Pane', { bodyColumns: 30 }, 'ather', 'desktop'), 1000)
  expect('on the desktop nothing is cut by column count: the full issue title shows, and rows span the panel', narrow.lines.some(line => line.includes('#28887')) && narrow.lines.some(line => line.includes('Dodge cancels the wrong montage')) &&narrow.lines.some(line => /^\s+In the snow\/sand lab/.test(line) && line.length > 60), narrow.lines)
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  findKey(await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop'), 'work-issue:28887')?.props.onPress({})
  const deskCard = await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop')
  expect("the desktop's issue card opens GitHub with a real link", findKey(deskCard, 'issue-open')?.type === 'Link' && findKey(deskCard, 'issue-open')?.props.href === 'https://github.com/sipherxyz/s2/issues/28887', findKey(deskCard, 'issue-open'))
  expect('on the desktop, the first draw starts the console: the assigned issue shows in the pane', /Dodge cancels the wrong montage/.test(deskPane.lines.join('\n')), deskPane.lines)
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
  expect('without a pane, part of an intent name typed in the dialog says where it stands and how to work on it, and does not track it', engine.store.get('pinned:harness-session-0001') === undefined && /^fluid-snow-sand-look · .+\. To work on it in this session: \/ather intent fluid-snow-sand-look$/.test(name.out) && name.sent.length === 0, name.out)
  const words = await run(engine, [], 'ather', 'fluid snow')
  expect('without a pane, words after /ather that match one intent do not track it either', engine.store.get('pinned:harness-session-0001') === undefined && /To work on it in this session: \/ather intent fluid-snow-sand-look$/.test(words.out) && words.dialogs.length === 0, words.out)
  // D5: in the Work question a typed name opens one follow-up (the phone's Intent view) that says where it
  // stands and what working on it here means; each of the question's own choices says what it does.
  const pinnedNow = () => engine.store.get('pinned:harness-session-0001')
  const consequence = 'This session gets its next step, your builds and PIE count as its proof, other sessions see you on it; /ather untrack undoes it.'
  const work = await run(engine, [pick('Pick something to work on'), typed('fluid'), pick('Work on it here')])
  screens.push(['Desktop · a name typed in the Work question, then Work on it here', `${dialogText(work.dialogs)}\n  → output: ${work.out}`])
  const [, workQ, follow] = work.dialogs
  expect("each Work-question choice says what it does: an intent's works on it here, with the consequence", workQ?.header === 'Work' && (workQ?.options ?? []).length > 0 && workQ.options.every(o => o.description.endsWith(consequence) || o.description.endsWith('Drafts an intent with you first.')), workQ?.options)
  expect('a name typed in the Work question opens one follow-up: the slug, where it stands, what working on it here means, three choices', follow?.header === 'fluid-snow-s' && new RegExp(`^fluid-snow-sand-look: [A-Z][a-z ]+, \\d+/\\d+ done, [^.]+\\. Work on it here\\? ${consequence.replace(/[.?/()]/g, '\\$&')}$`).test(follow?.question ?? '') && (follow?.options ?? []).map(o => o.label).join('|') === 'Work on it here|Just look|Pick something else', follow)
  expect('… Work on it here tracks it and moves "Continue …" to it', pinnedNow() === 'fluid-snow-sand-look' && engine.store.get('last:tinnguyen') === 'fluid-snow-sand-look' && work.out === 'Now tracking fluid-snow-sand-look.' && work.sent.length === 0, work.out)
  await run(engine, [], 'ather', 'untrack')
  const look = await run(engine, [pick('Pick something to work on'), typed('fluid'), pick('Just look')])
  expect('… Just look says where it stands and its next step, and tracks nothing', pinnedNow() === undefined && /^fluid-snow-sand-look: .+ Its next step: .+\. Not tracked here; \/ather intent fluid-snow-sand-look works on it in this session\.$/.test(look.out) && look.sent.length === 0, look.out)
  const other = await run(engine, [pick('Pick something to work on'), typed('fluid'), pick('Pick something else'), dismiss])
  expect('… Pick something else asks the Work question again, tracking nothing', pinnedNow() === undefined && other.dialogs.map(d => d.header).join(',') === 'Ather,Work,fluid-snow-s,Work', other.dialogs.map(d => d.header))
  const noDialog = await run(engine, [pick('Pick something to work on'), typed('fluid'), () => { throw new Error('no dialog in this session') }])
  expect('… where the follow-up cannot be asked, the reply names /ather intent <slug> and nothing is tracked', pinnedNow() === undefined && /To work on it in this session: \/ather intent fluid-snow-sand-look$/.test(noDialog.out), noDialog.out)
  const sandbox = await engine.$.session.root()
  for (const slug of ['zz-guard-alpha', 'zz-guard-beta']) {
    fs.mkdirSync(path.join(sandbox, 'docs/intent', slug), { recursive: true })
    fs.writeFileSync(path.join(sandbox, 'docs/intent', slug, 'prompt.md'), `# ${slug}\n\n- Rev: 1\n- Status: active\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: It works.\n`)
  }
  const several = await run(engine, [pick('Pick something to work on'), typed('guard'), pick('zz-guard-beta')])
  expect('several matches in the Work question become its choices, each with the consequence; picking one tracks it', several.dialogs[2]?.header === 'Work' && /^2 intents match "guard"\. Which one should this session work on\?$/.test(several.dialogs[2]?.question ?? '') && (several.dialogs[2]?.options ?? []).map(o => o.label).sort().join('|') === 'zz-guard-alpha|zz-guard-beta' && several.dialogs[2].options.every(o => o.description.endsWith(consequence)) && pinnedNow() === 'zz-guard-beta', several.dialogs[2])
  for (const slug of ['zz-guard-alpha', 'zz-guard-beta']) fs.rmSync(path.join(sandbox, 'docs/intent', slug), { recursive: true, force: true })
  await run(engine, [], 'ather', 'untrack')
  const exact = await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  expect('/ather intent with the exact name tracks it at once, with no dialog, without a pane too', engine.store.get('pinned:harness-session-0001') === 'fluid-snow-sand-look' && exact.out === 'Now tracking fluid-snow-sand-look.' && exact.dialogs.length === 0, exact.out)
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
  await run(engine, [], 'ather', 'pick fluid-snow-sand-look')
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
  expect('the pane shows Next as the urgent issue and the other issue under "Also open for you", cleanly', /N E X T\nn: Start issue #28887/.test(pane.lines.join('\n')) && /#31360/.test(pane.lines.join('\n')) && pane.problems.length === 0, pane.problems)
  // Next carries the issue's open and copy icons; an issue row opens its card.
  const find = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => find(child, key)).find(Boolean) ?? null)
  const home = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  expect("in the terminal Next's issue carries Open on GitHub and Copy link as plain presses (no ctrl+click)", find(home, 'next-open')?.type === 'Button' && find(home, 'next-open')?.props.hotkey === 'o' && find(home, 'next-copy')?.props.hotkey === 'y', find(home, 'next-open')?.props)
  find(home, 'next-open')?.props.onPress({})
  await engine.flush()
  expect('Open on GitHub asks gh to open the issue in the browser, a read', engine.record.ghRuns.includes('gh issue view 28887 --web'), engine.record.ghRuns)
  find(home, 'work-issue:31360')?.props.onPress({})
  const cardTree = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const card = check(cardTree, 72)
  screens.push(['Terminal · an issue card (72 columns)', card.lines.join('\n')])
  expect('an issue row opens its card: Start an intent, Open on GitHub, Copy link, Back', /I S S U E   # 3 1 3 6 0\nCheaper rain particles on low settings/.test(card.lines.join('\n')) && find(cardTree, 'issue-open')?.type === 'Button' && find(cardTree, 'issue-open')?.props.hotkey === '2' && find(cardTree, 'issue-copy')?.props.hotkey === '3' && Boolean(find(cardTree, 'issue-start')) && Boolean(find(cardTree, 'issue-back')) && card.problems.length === 0, card.lines)
  find(cardTree, 'issue-copy')?.props.onPress({ surface: 'terminal' })
  await engine.flush()
  expect('Copy link copies the issue URL and says so', engine.record.copies.includes('https://github.com/sipherxyz/s2/issues/31360') && engine.record.toasts.some(text => /issue link copied/.test(text)), engine.record.copies)
  find(cardTree, 'issue-start')?.props.onPress({})
  await engine.flush()
  expect('Start an intent hands the issue to the session (preflight first)', engine.record.submits.some(text => /issue #31360/.test(text) && /issue-preflight/.test(text)), engine.record.submits)
  pressIn(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'Everything open')
  const all = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · Everything open (72 columns)', all.lines.join('\n')])
  expect('"Everything open" groups by source, each with its count and a fold: your assigned issues, then the teammates\' intents', /▾ A S S I G N E D {3}I S S U E S {3}· {3}1\n1: #28887/.test(all.lines.join('\n')) && /▾ T E A M M A T E S ' {3}I N T E N T S/.test(all.lines.join('\n')) && all.problems.length === 0, all.problems)
  // The list's own controls: fold a group, filter by age, search, and a teammate's name after the title in its colour.
  const pickTree = () => engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const pickText = async () => check(await pickTree(), 72).lines.join('\n')
  const collect = (node, test) => (!node || typeof node !== 'object' ? [] : [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(child => collect(child, test))])
  expect('"Everything open" starts unfiltered: Search…, Any time chosen', /s: Search…\n● Any time {2}○ 7 days {2}○ 30 days {2}○ 90 days/.test(await pickText()))
  find(await pickTree(), 'group-issues-fold')?.props.onPress()
  const folded = await pickText()
  expect('folding a group hides its rows and keeps its heading and count', /▸ A S S I G N E D {3}I S S U E S {3}· {3}1/.test(folded) && !/#28887/.test(folded) && /quest-debug-panel/.test(folded), folded)
  find(await pickTree(), 'group-issues-fold')?.props.onPress()
  expect('… and unfolding brings them back', /#28887/.test(await pickText()))
  find(await pickTree(), 'pick-range-7')?.props.onPress()
  const week = await pickText()
  expect('the 7 days filter keeps what changed this week (intents) and drops the older issue, saying how many remain', !/#28887/.test(week) && /quest-debug-panel/.test(week) && /^\d+ of \d+$/m.test(week) && /● 7 days/.test(week), week)
  find(await pickTree(), 'pick-range-0')?.props.onPress()
  engine.script.length = 0
  engine.script.push(typed('dodge'))
  find(await pickTree(), 'pick-search')?.props.onPress()
  await engine.flush()
  const searched = await pickText()
  expect('Search asks one question and the words typed under Other narrow the list (here to the Dodge issue)', /#28887/.test(searched) && !/quest-debug-panel/.test(searched) && /^1 of \d+$/m.test(searched) && /Search: dodge/.test(searched) && engine.record.dialogs.at(-1)?.header === 'Search', searched)
  find(await pickTree(), 'pick-search-clear')?.props.onPress()
  expect('✕ Clear shows everything again', /quest-debug-panel/.test(await pickText()) && !/Search: /.test(await pickText()))
  const owners = collect(await pickTree(), node => node.type === 'Text' && /^pick-intent:.*-aside$/.test(node.props.key ?? ''))
  const ownerColours = new Map(owners.map(node => [node.props.children, node.props.color]))
  expect('a teammate\'s name sits after the title (not in a right column), in its own colour, dimmed', owners.length > 0 && owners.every(node => /^#[0-9a-f]{6}$/.test(node.props.color) && node.props.color !== '#8E918A') && collect(await pickTree(), node => node.type === 'Box' && /^pick-intent:.*-line$/.test(node.props.key ?? '')).every(node => node.props.justifyContent === undefined), [...ownerColours])
  expect('no two teammates share a colour', new Set(ownerColours.values()).size === ownerColours.size, [...ownerColours])
  const allTree = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const reads = engine.record.ghRuns.filter(text => text.startsWith('gh issue list')).length
  expect('"Everything open" has a refresh button for the GitHub issues (r)', find(allTree, 'issues-refresh')?.props.hotkey === 'r' && /Refresh GitHub issues/.test(all.lines.join('\n')), find(allTree, 'issues-refresh')?.props)
  find(allTree, 'issues-refresh')?.props.onPress({})
  await engine.flush()
  expect('refresh reads the assigned issues from GitHub again and says how many', engine.record.ghRuns.filter(text => text.startsWith('gh issue list')).length === reads + 1 && engine.record.toasts.some(text => /2 open GitHub issues assigned to you/.test(text)), engine.record.toasts)
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
  expect('with a merge loss unreviewed, Next waits and Needs you comes first, naming the asset', !/N E X T/.test(text) && /N E E D S   Y O U   ·   \d\n◆ 1: See what a merge lost\n\s+A merge dropped your edits to BP_Sash\n\n◆ 2: /.test(text) && /A merge dropped your edits to BP_Sash/.test(text) && pane.problems.length === 0, pane.problems)
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
  engine.setSurfaces?.([])
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
  pressIn(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'Decide F-10')
  await engine.flush()
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · tracked intent with proof and a sent decision (72 columns)', pane.lines.join('\n')])
  const text = pane.lines.join('\n')
  expect('the header shows the stage track and the proof so far, a failed test included', /Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○/.test(text) && /build ✓ · tests ✗/.test(text), pane.lines.slice(0, 3))
  expect('a sent decision is marked in front, so a cut row still says so; the footer drops the tour', /✓ sent · Decide F-10/.test(text) && !/\/ather tour/.test(text) && pane.problems.length === 0, pane.problems)
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
  expect('the pane offers the hand-over in the evening', /H E A D I N G   O F F \?/.test(home), home)
  expect('Heading off says what it is for: let AI work while you zZz', /H E A D I N G   O F F \?\nLet AI work while you zZz\n/.test(home), home)
  expect("a teammate's name sits in its own column at the right edge, out of the detail line", (() => {
    // Whichever teammates the checkout has: the first row under the heading ends in a name at column 110, and its detail line does not repeat it.
    const lines = home.split('\n')
    const at = lines.findIndex(line => /^a: /.test(line))
    const name = /\s{2,}(\S.*)$/.exec(lines[at] ?? '')?.[1] ?? ''
    return at > 0 && lines[at].length === 110 && name !== '' && !(lines[at + 1] ?? '').includes(name)
  })(), home)
  expect('NEXT leads and is focused', /N E X T\nn: Pick up /.test(home), home)
  pressIn(await pane(110), 'Everything open')
  const all = check(await pane(72), 72)
  screens.push(['Terminal · All intents (72 columns)', all.lines.join('\n')])
  expect('All intents lists every open intent by area, cleanly', all.problems.length === 0 && /Everything open\nYours first/.test(all.lines.join('\n')), all.problems)
  pressIn(await pane(110), 'Back')
  const tree = await pane(110)
  pressIn(tree, 'Decide F-')
  await engine.flush()
  expect('pressing a Needs-you row hands it to the session and closes the pane', engine.record.submits.length === 1 && engine.record.closes.some(one => one.id === 'ather'), engine.record.submits)
  await engine.close('ather')
  expect('no hook threw in the terminal', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  const { engine, done } = await boot({ surfaces: ['terminal'], user: 'Minh Tran' })
  const band = check(await engine.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band'), 110)
  expect('a newcomer band points at the tour', /New here\? Take the tour/.test(band.lines.join('')), band.lines)
  await run(engine, [])
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · newcomer /ather (72 columns)', pane.lines.join('\n')])
  const find = (node, type) => (!node || typeof node !== 'object' ? null : node.type === type ? node : (node.children ?? []).map(child => find(child, type)).find(Boolean) ?? null)
  const desk = await engine.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop')
  const deskPane = check(desk, 70)
  expect('the pane is headed with the full name, Ather Automata', /^A T H E R   A U T O M A T A$/m.test(pane.lines.join('\n')) && engine.record.opens.some(one => one.title === 'ATHER AUTOMATA'), engine.record.opens)
  const issuesNow = await run(engine, [], 'ather', 'issues')
  expect('/ather issues reads them on the spot and says why when it cannot, or that there are none', /Could not read your GitHub issues|No open GitHub issues are assigned to you|N E X T|Pick/.test(issuesNow.out + issuesNow.dialogs.map(one => one.question).join(' ')) , issuesNow.out)
  expect('the desktop pane carries the Ather mark, is clicked (no hotkeys drawn) and lays out cleanly; the terminal draws no mark', find(desk, 'Svg')?.props.alt === 'Ather' && deskPane.problems.length === 0 && !/\b[a-z0-9]: /.test(deskPane.lines.join('\n')) && !find(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 'Svg'), deskPane.problems)
  expect("a newcomer's pane leads with the tour and offers teammates' intents", /N E X T\nn: Take the tour\nSix short steps/.test(pane.lines.join('\n')) && /F O L L O W   A   T E A M M A T E\nRead-only/.test(pane.lines.join('\n')) && (pane.lines.join('\n').match(/tour/gi) ?? []).length === 1 && pane.problems.length === 0, pane.problems)
  done()
}

{
  // Create: making things in the Editor, grouped by what is made, three per group, More for the rest.
  const { engine, done } = await boot({ surfaces: ['terminal'], user: 'Lan Vo', store: { 'role:lanvo': 'designer', 'tour:lanvo': { isDone: true } } })
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  await run(engine, [])
  findKey(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 'action:create')?.props.onPress({})
  const firstTree = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const first = check(firstTree, 72)
  screens.push(['Terminal · Create (72 columns, a designer)', first.lines.join('\n')])
  const text = first.lines.join('\n')
  expect('Create leads with the Editor lock, then the designer\'s groups, three rows each', /C R E A T E\nMake it in the Editor\nEditor free: the session takes the lock and starts\./.test(text) && /A I   A N D   E N C O U N T E R S\n1: Edit a Behavior Tree/.test(text) && /3: Make a Team Move rule book for a squad/.test(text) && !/Set up GOAI NPC behaviour/.test(text) && /More… \(2\)/.test(text) && first.problems.length === 0, first.lines)
  findKey(firstTree, 'create-AI and encounters-more')?.props.onPress({})
  const opened = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72).lines.join('\n')
  expect('More shows the rest of the group', /Set up GOAI NPC behaviour/.test(opened) && /Add a QTE/.test(opened) && !/More… \(2\)/.test(opened), opened)
  findKey(firstTree, 'create:bt-graph')?.props.onPress({})
  await engine.flush()
  expect('a row hands the session a guided creation: ask first, intent, the lock, then build', engine.record.submits.some(text => /I want to edit a Behavior Tree in the Unreal Editor\. Use the bt-graph skill/.test(text) && /First ask me what I want/.test(text) && /record it as an intent/.test(text)), engine.record.submits)
  done()
}

{
  // What the intent recorded: one line per change, a notice after the turn, the Intent view on See.
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' } })
  await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  const file = path.join(root, 'docs/intent/fluid-snow-sand-look/prompt.md')
  const unticked = /^- \[ \] (A\d+)/m.exec(fs.readFileSync(file, 'utf8'))
  await engine.modelTool({ tool: 'Edit', file_path: file, old_string: `- [ ] ${unticked[1]}:`, new_string: `- [x] ${unticked[1]}:` })
  await engine.flush()
  const props = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  const band = await engine.render('AbovePrompt', props, 'band')
  const bandText = check(band, 110).lines.join('')
  expect('after an edit ticks a checklist item, the band says so in one line, with See', new RegExp(`◆ Intent: ticked ${unticked[1]}`).test(bandText) && Boolean(findKey(band, 'ather-intent-see')), bandText)
  findKey(band, 'ather-intent-see').props.onPress({})
  await engine.flush()
  const viewTree = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const view = check(viewTree, 72)
  screens.push(['Terminal · the Intent view (72 columns)', view.lines.join('\n')])
  expect('See opens the Intent view: the goal, today\'s line with its time, and Next', /I N T E N T\nfluid-snow-sand-look/.test(view.lines.join('\n')) && new RegExp(`T O D A Y\\n✓ Ticked ${unticked[1]} · .+ \\d\\d:\\d\\d`).test(view.lines.join('\n')) && /N E X T/.test(view.lines.join('\n')) && view.problems.length === 0, view.lines)
  expect('once seen, the notice leaves the band', !/◆ Intent:/.test(check(await engine.render('AbovePrompt', props, 'band'), 110).lines.join('')))
  findKey(viewTree, 'change-0-press').props.onPress({})
  await engine.flush()
  expect('pressing a line asks the session to explain it, briefly, with your own words as the why', engine.record.submits.some(text => new RegExp(`explain in at most four lines what "Ticked ${unticked[1]}`).test(text) && /Quote what I said/.test(text)), engine.record.submits)
  done()
}

{
  // The worker squad: each worker's kind from its dispatch, what it is doing from its tool calls.
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' } })
  await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  await engine.spawn({ agentId: 'w-build', description: 'A13 Sand footprints fade', prompt: 'Implement A13: footprints fade over 4 seconds. Edit the material function and build S2Editor.' })
  await engine.agentTool('w-build', { tool: 'Edit', file_path: 'Plugins/Fluid/Source/Footprints.cpp', old_string: 'a', new_string: 'b' })
  await engine.agentTool('w-build', { tool: 'Bash', command: 'Build.bat S2Editor Win64 Development' })
  await engine.spawn({ agentId: 'w-review', description: 'Review the snow material change', prompt: 'Run the thermo-nuclear review on the snow material change and report findings.' })
  await engine.agentTool('w-review', { tool: 'Read', file_path: 'Plugins/Fluid/Source/Footprints.cpp' })
  await engine.agentTool('w-review', { tool: 'Skill', skill: 'thermo-nuclear-code-quality-review' })
  // It answers (its turn ends, as Claude Code reports), then its status reads completed.
  await engine.agentTurnEnd('w-review')
  engine.setAgentStatus('w-review', 'completed')
  const term = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · the worker squad (72 columns)', term.lines.join('\n')])
  const text = term.lines.join('\n')
  expect('the summary strip shows the checklist, workers running and the same Needs you count as the section', /Checklist 8\/17 ━+ · Workers 1 · Needs you \d+/.test(text) && Number(/Needs you (\d+)/.exec(text)?.[1]) === Number(/N E E D S   Y O U   ·   (\d+)/.exec(text)?.[1] ?? 0), term.lines.slice(0, 8))
  expect('a running worker shows its kind from the brief and what it is doing from its last tool call', /W O R K E R S   ·   R U N N I N G   1\n● A13 Sand footprints fade\n  Builder · Opus · building\n  running \d+:\d\d · 2 tool calls/.test(text) && term.problems.length === 0, term.lines)
  expect('a finished worker shows its trail and how it ended', /D O N E   1\n✓ Review the snow material change\n  Reviewer · Opus · finished\n  read → review ✓ · took \d+:\d\d · 2 tool calls/.test(text), term.lines)
  const find = (node, test) => (!node || typeof node !== 'object' ? [] : [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(child => find(child, test))])
  const desk = await engine.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop')
  const avatars = find(desk, node => node.type === 'Svg' && /, (running|done)$/.test(node.props.alt))
  expect('on the desktop each worker has its avatar: the running Builder animated, the done Reviewer still', avatars.map(one => one.props.alt).join(' | ') === 'Builder, running | Reviewer, done' && avatars[0].props.isInteractive === true && !avatars[1].props.isInteractive && /#2f8cf0/.test(avatars[0].props.source) && /#ddff00/.test(avatars[0].props.source) && /#f2d27a/.test(avatars[1].props.source) && /#3ccf7a/.test(avatars[1].props.source), avatars.map(one => one.props.alt))
  expect("on the desktop a finished worker's trail is drawn as props", find(desk, node => node.type === 'Svg' && /^(reading|reviewing)$/.test(node.props.alt)).length === 2)
  find(term.lines ? await engine.render('Pane', { bodyColumns: 72 }, 'ather') : null, node => node.props?.key === 'worker-w-build')[0]?.props.onPress({})
  await engine.flush()
  expect('pressing a worker asks the session for its status, without stopping it', engine.record.submits.some(text => /five-line status of the background worker "A13 Sand footprints fade" \(agent w-build\)/.test(text) && /Do not stop/.test(text)), engine.record.submits)
  done()
}

{
  // Nothing to say: the band shows the quiet name and its three icons; ✕ hides it until something is new.
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'tour:lanvo': { isDone: true } }, user: 'Lan Vo' })
  const props = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }
  const band = await engine.render('AbovePrompt', props, 'band')
  const find = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => find(child, key)).find(Boolean) ?? null)
  const icons = ['ather-away', 'ather-open', 'ather-close'].map(key => find(band, key))
  expect('the band carries three icons, away, open and close, and nothing more', icons.every(Boolean) && icons.map(one => one.props.label).join('') === '☾⤢✕' && icons[2].props.role === 'dismiss' && check(band, 110).problems.length === 0, icons.map(one => one?.props.label))
  icons[2].props.onPress({})
  expect('✕ hides the band while it has nothing new to say', (await engine.render('AbovePrompt', props, 'band')) === null)
  engine.setSurfaces?.(['desktop'])
  const reopened = await run(engine, [], 'ather')
  expect('on the desktop, /ather opens the pane, and brings back a band closed with ✕', reopened.dialogs.length === 0 && engine.record.opens.some(one => one.id === 'ather') && (await engine.render('AbovePrompt', props, 'band')) !== null, reopened)
  engine.setSurfaces?.(['terminal'])
  icons[0].props.onPress({})
  await engine.flush()
  const away = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · the band ☾ opens the away choices (72 columns)', away.lines.join('\n')])
  expect('☾ opens the pane on the away choices', engine.record.opens.some(one => one.id === 'ather') && /Heading off\?/.test(away.lines.join('\n')) && /Until done/.test(away.lines.join('\n')) && /8 hours/.test(away.lines.join('\n')) && away.problems.length === 0, away.lines)
  done()
}

{
  // The quick actions under the header: a new intent, and Skills, which opens the short list.
  const { engine, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' } })
  await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  const find = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => find(child, key)).find(Boolean) ?? null)
  const tree = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const fresh = find(tree, 'action:new-intent')
  const skillsButton = find(tree, 'action:skills')
  expect('the pane offers New intent and Skills', fresh?.props.label === '＋ New intent' && fresh.props.variant === 'primary' && skillsButton?.props.label === '▶ Skills' && check(tree, 72).problems.length === 0, [fresh?.props.label, skillsButton?.props.label])
  skillsButton?.props.onPress({})
  const list = await engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const listed = check(list, 72)
  screens.push(['Terminal · Skills (72 columns)', listed.lines.join('\n')])
  expect('Skills lists the present skills by group, each with the first sentence of its description', /R E V I E W   A N D   P R O O F\n1: thermo-nuclear-code-quality-review\nWhat thermo-nuclear-code-quality-review does\.\n2: editor-video-walkthrough/.test(listed.lines.join('\n')) && /A G E N T I C   T E S T I N G\n3: talab/.test(listed.lines.join('\n')) && !/Use it when/.test(listed.lines.join('\n')) && listed.problems.length === 0, listed.lines)
  expect('a skill from the manual library is listed under Explain it to me', /E X P L A I N   I T   T O   M E\n\d: show-me\nHelp the user understand the topic visually\./.test(listed.lines.join('\n')), listed.lines)
  find(list, 'skill:talab')?.props.onPress({})
  await engine.flush()
  expect('a skill hands the session its run, for the tracked intent', engine.record.submits.some(text => /Run the talab skill \(\.agents\/skills\/talab\/SKILL\.md\) for intent fluid-snow-sand-look/.test(text)), engine.record.submits)
  done()
}

// ---------------------------------------------------------------- intent completion from one source each (0.0.6)

{
  // prompt.md lists ids (no boxes), progress.md's Acceptance table says met, progress.md's "- PR:" names the PR.
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer', 'tour:tinnguyen': { isDone: true } }, ghPrs: { 50001: 'MERGED', 50002: 'OPEN', 50003: 'MERGED' } })
  const write = (slug, prompt, progress) => {
    const dir = path.join(root, 'docs/intent', slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'prompt.md'), prompt)
    if (progress !== null) fs.writeFileSync(path.join(dir, 'progress.md'), progress)
    return dir
  }
  const prompt = (ids, status = 'active') => `# Board\n\n- Status: ${status}\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Acceptance\n\n${ids.map(id => `- ${id}: Thing ${id}. Proof: tests.`).join('\n')}\n`
  const progress = (rows, pr) => `# Board: Progress\n\n- Working under rev: 1\n- PR: ${pr}\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n${rows.map(([id, verdict]) => `| ${id} | ${verdict} | proof/${id} |`).join('\n')}\n\n## Steps\n`
  const SIX = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']
  write('zz-board', prompt(SIX), progress(SIX.map(id => [id, 'met']), '#50001'))
  write('zz-legacy', '# Legacy\n\n- Status: active\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- [x] A1: One.\n- [ ] A2: Two.\n', null)
  const extra = write('zz-extra', prompt(['B1', 'B2']), progress([['B1', 'met'], ['B2', 'open'], ['Z9', 'met']], '#50002'))
  write('zz-closed', prompt(['B1'], 'completed'), progress([['B1', 'met']], '#50003'))
  const status = async slug => {
    await run(engine, [], 'ather', `intent ${slug}`)
    await engine.flush()
    return JSON.parse((await engine.modelTool({ tool: 'mcp__ather-automata__status' })).result).tracked
  }
  const board = await status('zz-board')
  expect('ids without boxes and a progress table with every row met read 6/6, not 0/6 or "no checklist"', board?.checklist === '6/6', board)
  expect('all met, its PR merged and Status active: the stage is Ready to close', board?.stage === 'Ready to close' && board?.prs.join(',') === '#50001 MERGED', board)
  expect("the PR's state was read with gh pr view, read-only", engine.record.ghRuns.includes('gh pr view 50001 --json state,mergedAt') && !engine.record.ghRuns.some(text => /gh pr (merge|edit|close|comment)/.test(text)), engine.record.ghRuns)
  const pane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · an intent ready to close (72 columns)', pane.lines.join('\n')])
  const text = pane.lines.join('\n')
  expect('the pane heads it Ready to close with every stage ticked, and Next closes it', /Ready to close/.test(text) && /Plan ✓ ─ Build ✓ ─ Prove ✓ ─ Ship ✓/.test(text) && /N E X T\nn: Close the intent/.test(text) && pane.problems.length === 0, pane.lines.slice(0, 14))
  engine.setSurfaces?.([])
  const menu = await run(engine, [pick('Next: Close the intent')])
  expect('Close asks the session to close it the intent skill\'s way; Ather writes nothing in the intent', menu.sent.length === 1 && /\.agents\/skills\/intent\/SKILL\.md/.test(menu.sent[0] ?? '') && /Status: completed/.test(menu.sent[0] ?? '') && /^- Status: active$/m.test(fs.readFileSync(path.join(root, 'docs/intent/zz-board/prompt.md'), 'utf8')), menu.sent)
  engine.setSurfaces?.(['terminal'])
  const legacy = await status('zz-legacy')
  expect('a legacy intent with boxes only still counts its boxes', legacy?.checklist === '1/2' && legacy?.stage === 'Build', legacy)
  const extraRow = await status('zz-extra')
  expect('a progress row for an id prompt.md does not list is ignored; an open PR is not ready to close', extraRow?.checklist === '1/2' && extraRow?.stage !== 'Ready to close', extraRow)
  const closed = await status('zz-closed')
  expect('a Status of completed wins over ready to close, and its PR is not asked about', closed?.stage === 'Ship' && !engine.record.ghRuns.includes('gh pr view 50003 --json state,mergedAt'), closed)
  // An edit that turns a progress row met is one line in the band, as a ticked box was.
  await run(engine, [], 'ather', 'intent zz-extra')
  const file = path.join(extra, 'progress.md')
  await engine.modelTool({ tool: 'Edit', file_path: file, old_string: '| B2 | open |', new_string: '| B2 | met |' })
  await engine.flush()
  const band = check(await engine.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band'), 110).lines.join('')
  expect('an edit that turns a progress row met says so in the band', /◆ Intent: met B2/.test(band), band)
  expect('no hook threw in the single-source scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  // The header names the session that holds the Editor by its title, read from Claude Code's record of it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-home-'))
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' }, env: { USERPROFILE: home } })
  const records = path.join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(records, { recursive: true })
  fs.writeFileSync(path.join(records, '1a2b3c4d-0000-4000-8000-000000000000.jsonl'), '{"type":"ai-title","aiTitle":"Snow work"}\n{"type":"user","message":"hi"}\n{"type":"custom-title","customTitle":"🟢 Snow proof"}\n')
  fs.mkdirSync(path.join(root, 'Saved'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Saved/EDITOR_OWNER.txt'), 'Editor held by Claude session 1a2b3c4d for the snow proof until 23:00\n')
  await run(engine, [])
  const held = check(await engine.render('Pane', { bodyColumns: 100 }, 'ather'), 100).lines.join('\n')
  expect('a held Editor shows the name of the session holding it', /Editor busy · "🟢 Snow proof" until 23:00/.test(held), held.split('\n').slice(0, 5))
  fs.writeFileSync(path.join(root, 'Saved/EDITOR_OWNER.txt'), 'Editor open on main launched by Claude session 1a2b3c4d at 20:38 for Tin; free for Tin to use; no agent holds it since 20:40\n')
  await new Promise(resolve => setTimeout(resolve, 16000))
  await run(engine, [])
  const free = check(await engine.render('Pane', { bodyColumns: 100 }, 'ather'), 100).lines.join('\n')
  expect('a lock that says no agent holds it reads as free', /Editor free/.test(free) && !/Editor busy/.test(free), free.split('\n').slice(0, 5))
  done()
  fs.rmSync(home, { recursive: true, force: true })
}

// ---------------------------------------------------------------- track guard (0.1.1)

{
  // A1: untrack from /ather and from the profile tool; refused while an away window runs; the proof stays with the intent.
  const { engine, root, done } = await boot({ store: { 'role:tinnguyen': 'engineer' } })
  const pinned = () => engine.store.get('pinned:harness-session-0001')
  const laneFile = path.join(root, 'Saved/AtherAutomata/lanes/harness-session-0001.json')
  const lane = () => JSON.parse(fs.readFileSync(laneFile, 'utf8'))
  await engine.timers()
  await run(engine, [], 'ather', 'intent box-scale-tool')
  expect('tracking writes the lane heartbeat at once, with the last activity', lane().intent === 'box-scale-tool' && typeof lane().lastActiveAt === 'number', lane())
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', __text: 'Result: Succeeded' })
  const waiting = async () => /Waiting on you: [^.]*\./.exec((await run(engine, [dismiss])).dialogs[0]?.question ?? '')?.[0] ?? ''
  const before = await waiting()
  await engine.spawn({ agentId: 'w-guard', description: 'A2 worker', prompt: 'Implement A2.' })
  await run(engine, [], 'away', '4h')
  const refused = await run(engine, [], 'ather', 'untrack')
  expect('/ather untrack is refused while an away window runs', refused.out === 'End the away window first.' && pinned() === 'box-scale-tool', refused.out)
  await run(engine, [], 'away', 'end')
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  const untracked = await run(engine, [], 'ather', 'untrack')
  expect('/ather untrack stops tracking: the pin and "Continue …" go, the heartbeat says so at once, the proof stays with the intent', untracked.out === 'Stopped tracking box-scale-tool. Its proof so far stays with the intent.' && pinned() === undefined && engine.store.get('last:tinnguyen') === undefined && lane().intent === null && engine.store.get('evidence:box-scale-tool')?.build?.state === 'pass', [untracked.out, pinned(), lane().intent])
  expect('untracking leaves running workers and Needs you as they were', (await engine.$.agent.list()).some(one => one.id === 'w-guard' && one.status === 'running') && before !== '' && (await waiting()) === before, before)
  const nothing = await run(engine, [], 'ather', 'untrack')
  expect('/ather untrack with nothing tracked says so', nothing.out === 'Nothing is tracked in this session.', nothing.out)
  await engine.modelTool({ tool: 'mcp__ather-automata__profile', track: 'box-scale-tool' })
  const status = JSON.parse((await engine.modelTool({ tool: 'mcp__ather-automata__status' })).result)
  expect('the status tool shows which session produced each proof (by: its first 8 characters)', status.tracked?.slug === 'box-scale-tool' && status.evidence.build.state === 'pass' && status.evidence.build.by === 'harness-', status.evidence.build)
  const none = await engine.modelTool({ tool: 'mcp__ather-automata__profile', track: 'none' })
  expect('the profile tool\'s track "none" stops tracking', pinned() === undefined && /^Stopped tracking box-scale-tool\. Its proof so far stays with the intent\.$/.test(none.result), none.result)
  expect('no hook threw in the untrack scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  // A3: only the session's own orchestration tracks: a main-thread Write or Edit of prompt.md or log.md, once it ran.
  const { engine, root, done } = await boot({ store: { 'role:tinnguyen': 'engineer' } })
  const pinned = () => engine.store.get('pinned:harness-session-0001')
  const file = (slug, name) => path.join(root, 'docs/intent', slug, name)
  await engine.spawn({ agentId: 'w-intent', description: 'Box worker', prompt: 'Implement box-scale-tool A1.' })
  await engine.agentTool('w-intent', { tool: 'Write', file_path: file('box-scale-tool', 'progress.md'), content: '# box-scale-tool: Progress\n' })
  await engine.agentTool('w-intent', { tool: 'Edit', file_path: file('box-scale-tool', 'log.md'), old_string: 'not there', new_string: 'x' })
  await engine.flush()
  expect("a worker's writes into an intent (progress.md, log.md) never track it", pinned() === undefined, pinned())
  await engine.modelTool({ tool: 'Edit', file_path: file('box-scale-tool', 'progress.md'), old_string: ': Progress', new_string: ': progress' })
  await engine.modelTool({ tool: 'Write', file_path: 'docs/intent/box-scale-tool/log.md', content: 'x', __isError: true })
  await engine.flush()
  expect('a main-thread write of progress.md, or a write of log.md that failed, does not track the intent', pinned() === undefined, pinned())
  await engine.modelTool({ tool: 'Edit', file_path: file('box-scale-tool', 'log.md'), old_string: 'not there', new_string: 'x' })
  await engine.flush()
  expect('a main-thread edit of log.md tracks the intent once it ran', pinned() === 'box-scale-tool', pinned())
  await engine.modelTool({ tool: 'Edit', file_path: file('fluid-snow-sand-look', 'prompt.md'), old_string: 'not there', new_string: 'x' })
  await engine.flush()
  expect("a main-thread edit of another intent's prompt.md does not switch the tracked one", pinned() === 'box-scale-tool', pinned())
  await engine.modelTool({ tool: 'Write', file_path: file('zz-captured', 'prompt.md'), content: '# Captured\n\n- Rev: 1\n- Status: active\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: It works.\n' })
  await engine.flush()
  expect('capturing a new intent (a write that creates its prompt.md) switches the pin to it', pinned() === 'zz-captured', pinned())
  await run(engine, [], 'ather', 'untrack')
  await engine.modelTool({ tool: 'Write', file_path: file('zz-captured', 'log.md'), content: '# Log\n' })
  await engine.flush()
  expect('after /ather untrack, a write into that intent does not track it again in this session', pinned() === undefined, pinned())
  await engine.modelTool({ tool: 'Write', file_path: file('box-scale-tool', 'log.md'), content: '# Log\n' })
  await engine.flush()
  expect('another intent still tracks from a write', pinned() === 'box-scale-tool', pinned())
  expect('no hook threw in the auto-track scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  // A2: looking never tracks. A row or words open the Intent view; Work on this here tracks; Stop tracking undoes it (A1).
  // A4 and A5: the view says when other live sessions track the same intent, and names proof another session produced.
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer', 'tour:tinnguyen': { isDone: true } } })
  const pinned = () => engine.store.get('pinned:harness-session-0001')
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  const findWhere = (node, test) => (!node || typeof node !== 'object' ? null : test(node) ? node : (node.children ?? []).map(child => findWhere(child, test)).find(Boolean) ?? null)
  const pane = () => engine.render('Pane', { bodyColumns: 72 }, 'ather')
  // A second intent of Tin's, so the home lists one under Also yours beside the teammates' ones.
  fs.mkdirSync(path.join(root, 'docs/intent/zz-guard-mine'), { recursive: true })
  fs.writeFileSync(path.join(root, 'docs/intent/zz-guard-mine/prompt.md'), '# Guard\n\n- Rev: 1\n- Status: active\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Goal\n\nA second intent of mine.\n\n## Acceptance\n\n- A1: It works.\n')
  await run(engine, [])
  const row = findWhere(await pane(), node => node.type === 'Button' && /^work-intent:/.test(node.props.key ?? ''))
  const slug = String(row?.props.key ?? '').slice('work-intent:'.length)
  row?.props.onPress({})
  const viewTree = await pane()
  const view = check(viewTree, 72)
  screens.push(['Terminal · the Intent view of an intent this session does not track (72 columns)', view.lines.join('\n')])
  expect('a home row opens the Intent view for its intent and does not track it; the view offers Work on this here, and no Next', slug !== '' && pinned() === undefined && new RegExp(`^I N T E N T\\n${slug}$`, 'm').test(view.lines.join('\n')) && /\[ Work on this here \]/.test(view.lines.join('\n')) && !findKey(viewTree, 'intent-untrack') && !/N E X T/.test(view.lines.join('\n')) && view.problems.length === 0, view.lines)
  findKey(viewTree, 'intent-work')?.props.onPress({})
  await engine.flush()
  const trackedTree = await pane()
  expect('Work on this here tracks it and moves "Continue …" to it; the view then offers Stop tracking', pinned() === slug && engine.store.get('last:tinnguyen') === slug && Boolean(findKey(trackedTree, 'intent-untrack')) && !findKey(trackedTree, 'intent-work') && engine.record.toasts.includes(`Ather: Now tracking ${slug}.`), [pinned(), engine.record.toasts.slice(-2)])
  findKey(trackedTree, 'intent-untrack')?.props.onPress({})
  await engine.flush()
  const stoppedTree = await pane()
  expect('Stop tracking in the Intent view stops tracking, says the proof stays, and keeps the view on the intent with Work on this here', pinned() === undefined && engine.store.get('last:tinnguyen') === undefined && Boolean(findKey(stoppedTree, 'intent-work')) && new RegExp(`^I N T E N T\\n${slug}$`, 'm').test(check(stoppedTree, 72).lines.join('\n')) && engine.record.toasts.includes(`Ather: Stopped tracking ${slug}. Its proof so far stays with the intent.`), engine.record.toasts.slice(-2))
  pressIn(stoppedTree, 'Back')
  // Every home row, under Also yours and under Follow a teammate alike.
  const homeTree = await pane()
  const sections = ['picks-mine', 'picks-theirs'].filter(key => findKey(homeTree, key))
  const rows = []
  ;(function collect(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Button' && /^work-intent:/.test(node.props.key ?? '')) rows.push(String(node.props.key).slice('work-intent:'.length))
    for (const child of node.children ?? []) collect(child)
  })(homeTree)
  const opened = []
  for (const one of rows) {
    findWhere(await pane(), node => node.type === 'Button' && node.props.key === `work-intent:${one}`)?.props.onPress({})
    if (new RegExp(`^I N T E N T\\n${one}$`, 'm').test(draw(await pane(), 72).join('\n'))) opened.push(one)
    pressIn(await pane(), 'Back')
  }
  expect('every home row (Also yours, Follow a teammate) opens its own Intent view and none tracks', rows.length > 1 && opened.join(',') === rows.join(',') && pinned() === undefined && sections.length === 2, { sections, rows, opened })
  pressIn(await pane(), 'Everything open')
  const pickRow = findWhere(await pane(), node => node.type === 'Button' && /^pick-intent:/.test(node.props.key ?? '') && node.props.key !== `pick-intent:${slug}`)
  const other = String(pickRow?.props.key ?? '').slice('pick-intent:'.length)
  pickRow?.props.onPress({})
  const pickView = await pane()
  expect('an Everything-open row opens the Intent view without tracking; Back goes back to the list', other !== '' && pinned() === undefined && new RegExp(`^I N T E N T\\n${other}$`, 'm').test(check(pickView, 72).lines.join('\n')), other)
  pressIn(pickView, 'Back')
  expect('… and Back from it goes back to Everything open', /^Everything open$/m.test(check(await pane(), 72).lines.join('\n')))
  const words = await run(engine, [], 'ather', 'fluid snow')
  const wordsView = check(await pane(), 72)
  expect('words after /ather that match one intent open its view and do not track it', pinned() === undefined && words.dialogs.length === 0 && /^I N T E N T\nfluid-snow-sand-look$/m.test(wordsView.lines.join('\n')), [words.out, pinned()])
  // Another live session on this checkout tracks fluid-snow-sand-look; a build it ran is in the intent's proof.
  const lanes = path.join(root, 'Saved/AtherAutomata/lanes')
  fs.mkdirSync(lanes, { recursive: true })
  const now = Date.now()
  fs.writeFileSync(path.join(lanes, '1a2b3c4d-0000-4000-8000-000000000000.json'), JSON.stringify({ sessionId: '1a2b3c4d-0000-4000-8000-000000000000', intent: 'fluid-snow-sand-look', branch: 'main', updatedAt: now, lastActiveAt: now - 3 * 60000, away: 'off', hasEnded: false }))
  fs.writeFileSync(path.join(lanes, '5e6f7a8b-0000-4000-8000-000000000000.json'), JSON.stringify({ sessionId: '5e6f7a8b-0000-4000-8000-000000000000', intent: 'fluid-snow-sand-look', branch: 'main', updatedAt: now, lastActiveAt: now, away: 'off', hasEnded: true }))
  engine.store.set('evidence:fluid-snow-sand-look', { build: { state: 'pass', detail: 'Result: Succeeded', at: now, by: '1a2b3c4d' } })
  const peerView = check(await pane(), 72)
  screens.push(['Terminal · the Intent view with another session on it and its proof (72 columns)', peerView.lines.join('\n')])
  expect('the Intent view says how many other live sessions track the intent, and when the latest was active; an ended one does not count', /^Also tracked in 1 other session · active 3m ago$/m.test(peerView.lines.join('\n')) && peerView.problems.length === 0, peerView.lines.slice(0, 8))
  expect('the Intent view names the session that produced proof when it is not this one', /^Proof: build ✓ by session 1a2b3c4d$/m.test(peerView.lines.join('\n')), peerView.lines.slice(0, 8))
  await run(engine, [], 'ather', 'intent fluid-snow-sand-look')
  const laneText = (await engine.compose()).sections.find(one => one.id === 'ather-automata:lane')?.text ?? ''
  expect('the lane text carries the same line for the tracked intent', /\nAlso tracked in 1 other session · active 3m ago\.\n/.test(laneText), laneText)
  fs.rmSync(path.join(lanes, '1a2b3c4d-0000-4000-8000-000000000000.json'))
  const alone = (await engine.compose()).sections.find(one => one.id === 'ather-automata:lane')?.text ?? ''
  const aloneView = check(await pane(), 72).lines.join('\n')
  expect('with no other live session on the intent, neither the view nor the lane text says anything', !/Also tracked/.test(alone) && !/Also tracked/.test(aloneView) && /^I N T E N T\nfluid-snow-sand-look$/m.test(aloneView), aloneView.split('\n').slice(0, 6))
  expect('no hook threw in the Intent view scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  // A6: /clear and an adopted away window keep the pin, and say so with the way out.
  const { engine, done } = await boot({ store: { 'role:tinnguyen': 'engineer' } })
  const still = 'Ather: Still tracking box-scale-tool · /ather untrack'
  await engine.end('clear')
  engine.setSessionId('harness-session-0002')
  await new Promise(resolve => setTimeout(resolve, 1400))
  expect('after /clear with nothing tracked, nothing is said', !engine.record.toasts.some(text => /Still tracking/.test(text)), engine.record.toasts)
  await run(engine, [], 'ather', 'intent box-scale-tool')
  await engine.end('clear')
  engine.setSessionId('harness-session-0003')
  await new Promise(resolve => setTimeout(resolve, 1400))
  expect('after /clear the session keeps its intent and says "Still tracking <slug> · /ather untrack"', engine.store.get('pinned:harness-session-0003') === 'box-scale-tool' && engine.record.toasts.includes(still), engine.record.toasts.slice(-2))
  await run(engine, [], 'away', '4h')
  await engine.end('exit')
  engine.setSessionId('harness-session-morning')
  engine.record.toasts.length = 0
  await engine.start()
  await new Promise(resolve => setTimeout(resolve, 300))
  expect('a new session that takes over an away window keeps its intent and says "Still tracking <slug> · /ather untrack"', engine.store.get('pinned:harness-session-morning') === 'box-scale-tool' && engine.record.toasts.some(text => /away window from an earlier session/.test(text)) && engine.record.toasts.includes(still), engine.record.toasts)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  expect('no hook threw in the /clear and adoption scenarios', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

// ---------------------------------------------------------------- the web pack, on a han-viet checkout
//
// HANVIET_ROOT: a checkout of AskTinNguyen/han-viet. Its profile, package.json, AGENTS.md and intents
// are copied into a sandbox (nothing is written to the checkout); an intent of the person's own with
// every item met puts Prove next. Laid out at 72 and 110 columns like the S2 panes.

const HANVIET_ROOT = process.env.HANVIET_ROOT
if (HANVIET_ROOT && fs.existsSync(path.join(HANVIET_ROOT, '.ather/profile.json'))) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-web-'))
  for (const name of ['.ather/profile.json', 'package.json', 'AGENTS.md']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.copyFileSync(path.join(HANVIET_ROOT, name), path.join(root, name))
  }
  if (fs.existsSync(path.join(HANVIET_ROOT, 'docs/intent'))) fs.cpSync(path.join(HANVIET_ROOT, 'docs/intent'), path.join(root, 'docs/intent'), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/intent/zz-web-lens\n')
  const dir = path.join(root, 'docs/intent/zz-web-lens')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompt.md'), '# Word engine lens\n\n- Rev: 1\n- Status: active\n- Area: Platform\n- Owner: Tin Nguyen\n\n## Goal\n\nA lens over the word engine.\n\n## Acceptance\n\n- A1: The lens opens.\n- A2: It reads the word.\n')
  fs.writeFileSync(path.join(dir, 'progress.md'), '# zz-web-lens: Progress\n\n- Worker: `lens-worker`\n- PR: none yet\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n| A1 | met | x |\n| A2 | met | y |\n')
  const engine = createEngine({ root, surfaces: ['terminal'], user: 'Tin Nguyen' })
  engine.store.set('tz', tzFor(12))
  engine.store.set('role:web:tinnguyen', 'engineer')
  register(engine.on, { briefGate: 'warn' })
  await engine.start()
  await new Promise(resolve => setTimeout(resolve, 1500))
  engine.store.set('tz', tzFor(12))
  await run(engine, [], 'ather', 'intent zz-web-lens')
  const bad = /S2Editor|\bPIE\b|Unreal|Editor (free|busy|owner)/
  for (const width of [72, 110]) {
    const pane = check(await engine.render('Pane', { bodyColumns: width }, 'ather'), width)
    screens.push([`Web (han-viet) · an intent to prove, engineer (${width} columns)`, pane.lines.join('\n')])
    const text = pane.lines.join('\n')
    expect(`web pane at ${width} columns: Prove is next, it names what is still needed, and nothing is wider than the pane`, /Prove it works/.test(text) && /passing tests/.test(text) && pane.problems.length === 0, pane.problems.length > 0 ? pane.problems : pane.lines.slice(0, 16))
    expect(`web pane at ${width} columns: no S2Editor, PIE, Unreal or Editor lock wording`, !bad.test(text), text.split('\n').filter(line => bad.test(line)))
  }
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  const submits = engine.record.submits.length
  findKey(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 'next')?.props.onPress()
  await engine.flush()
  const prove = engine.record.submits.slice(submits).join('\n')
  expect("the web Prove prompt names the profile's gates: npm test, npm run lint, npm run build", /`npm test`/.test(prove) && /`npm run lint`/.test(prove) && /`npm run build`/.test(prove) && !bad.test(prove), prove)
  // A designer proves with the browser check.
  engine.store.set('role:web:tinnguyen', 'designer')
  await run(engine, [], 'ather', 'intent zz-web-lens')
  const designerPane = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72).lines.join('\n')
  expect('for a designer, Prove waits on the browser check', /a passing browser check/.test(designerPane), designerPane.split('\n').slice(0, 16))
  // Proof read from tool output: the gates pass, and Ship lands with proof and checks production.
  engine.store.set('role:web:tinnguyen', 'engineer')
  // Outputs captured from han-viet runs, the unit tests' fixtures.
  const fixture = name => fs.readFileSync(new URL(`../../ather-automata/tests/fixtures/web/${name}`, import.meta.url), 'utf8')
  await engine.modelTool({ tool: 'Bash', command: 'npm test', __text: fixture('node-test-pass.txt') })
  await engine.modelTool({ tool: 'Bash', command: 'npm run lint', __text: fixture('eslint-pass.txt') })
  await engine.modelTool({ tool: 'Bash', command: 'npm run ui:verify', __text: fixture('playwright-pass.txt') })
  await engine.flush()
  const evidence = evidenceOf(engine)
  expect('npm test, lint and ui:verify outputs are read as tests, build, lint and ui passed', ['tests', 'build', 'lint', 'ui'].every(rung => evidence?.[rung]?.state === 'pass'), evidence)
  await run(engine, [], 'ather', 'intent zz-web-lens')
  for (const width of [72, 110]) {
    const pane = check(await engine.render('Pane', { bodyColumns: width }, 'ather'), width)
    screens.push([`Web (han-viet) · proven, ready to ship (${width} columns)`, pane.lines.join('\n')])
    expect(`web pane at ${width} columns: proven, Ship is next and the proof line shows tests, lint, build and UI`, /Ship it/.test(pane.lines.join('\n')) && /tests ✓ · lint ✓ · build ✓ · UI ✓/.test(pane.lines.join('\n')) && pane.problems.length === 0, pane.lines.slice(0, 16))
  }
  const shipped = engine.record.submits.length
  findKey(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 'next')?.props.onPress()
  await engine.flush()
  const ship = engine.record.submits.slice(shipped).join('\n')
  expect('the web Ship prompt names every gate, merges with proof and runs the Vercel production check', /`npm run ui:verify`/.test(ship) && /with-proof/.test(ship) && /Vercel deployment for the merge commit READY/.test(ship), ship)
  // ✦ Create: the web skills.
  findKey(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 'action:create')?.props.onPress()
  for (const width of [72, 110]) {
    const pane = check(await engine.render('Pane', { bodyColumns: width }, 'ather'), width)
    screens.push([`Web (han-viet) · Create (${width} columns)`, pane.lines.join('\n')])
    const text = pane.lines.join('\n')
    expect(`web Create at ${width} columns offers frontend-design, run, code-review, security-review and simplify, no Editor`, /Design or restyle a page or component/.test(text) && /Review the change for security issues/.test(text) && /Clean up the changed code/.test(text) && /Run the app and see the change working/.test(text) && /Review the current change for bugs/.test(text) && !bad.test(text) && pane.problems.length === 0, pane.lines)
  }
  // Away: a production deploy is held; a merge passes with every gate proven.
  await run(engine, [], 'away', '8h ship the lens')
  const deploy = await engine.modelTool({ tool: 'Bash', command: 'npm run build && npx vercel deploy --prod' })
  const merge = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 21 --squash' })
  expect('while away, a production deploy is held and a merge with every gate proven goes through (with-proof)', typeof deploy.deny === 'string' && /Production deploys/.test(deploy.deny) && merge.deny === undefined, [deploy.deny, merge.deny])
  // Proof from before this session (an hour old, still within the day evidence is kept) does not let a merge through.
  const stored = engine.store.get('evidence:zz-web-lens')
  engine.store.set('evidence:zz-web-lens', Object.fromEntries(Object.entries(stored).map(([rung, value]) => [rung, { ...value, at: Date.now() - 3600000 }])))
  const stale = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 21 --squash' })
  expect("a merge on proof from before this session is held (D2: passed in this session's tool output)", typeof stale.deny === 'string' && /Merges/.test(stale.deny), stale.deny)
  expect('no hook threw in the web scenario', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  fs.rmSync(root, { recursive: true, force: true })
} else if (HANVIET_ROOT) {
  expect('HANVIET_ROOT names a han-viet checkout with .ather/profile.json', false, HANVIET_ROOT)
}

{
  // Every worker Claude Code lists is shown, those another worker started included; clocks are true.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-home-'))
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' }, env: { USERPROFILE: home } })
  // A worker started before Ather loaded: its start and model come from Claude Code's record of it.
  // The record's folder differs in case from the checkout path, as E--s2- did for E:\S2_.
  const records = path.join(home, '.claude/projects', root.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(), 'harness-session-0001/subagents')
  fs.mkdirSync(records, { recursive: true })
  fs.writeFileSync(path.join(records, 'agent-w-old.jsonl'), `{"type":"user","timestamp":"${new Date(Date.now() - 10 * 60000).toISOString()}"}\n{"type":"assistant","timestamp":"${new Date().toISOString()}"}\n`)
  fs.writeFileSync(path.join(records, 'agent-w-old.meta.json'), '{"agentType":"general-purpose","description":"Separate PR: rule book gap","model":"opus"}')
  engine.addAgent({ id: 'w-old', description: 'Separate PR: rule book gap' })
  engine.addAgent({ id: 'w-lost', description: 'Worker with no record' })
  await engine.spawn({ agentId: 'w-fix', description: 'Thermo round 1 fixes', prompt: 'Apply the fixes from the thermo-nuclear review findings: review each finding and fix it.' })
  await engine.spawn({ agentId: 'w-f1', description: 'F1 thermo fixes outside plugin', prompt: 'Fix finding F1.', parentId: 'w-fix' })
  await engine.agentTool('w-f1', { tool: 'Edit', file_path: 'Source/S2/A.cpp', old_string: 'a', new_string: 'b' })
  // The fix round answers and ends; its fixer keeps running. Claude Code's status catches up later.
  await engine.agentTurnEnd('w-fix')
  await new Promise(resolve => setTimeout(resolve, 2500))
  engine.setAgentStatus('w-fix', 'completed')
  const text = check(await engine.render('Pane', { bodyColumns: 100 }, 'ather'), 100).lines.join('\n')
  screens.push(['Terminal · workers a worker started, and one from before Ather loaded (100 columns)', text])
  expect('a worker another worker started is counted and shown, naming who started it', /Workers 3/.test(text) && /W O R K E R S   ·   R U N N I N G   3/.test(text) && /F1 thermo fixes outside plugin\n  Builder · Opus · editing files\n  running 0:0\d · 1 tool call · started by Thermo round 1 fixes/.test(text), text)
  expect("a worker's time ends when its turn ends, not when the pane is next drawn", /Thermo round 1 fixes\n  Builder · Opus · finished\n  ✓ · took 0:0[0-1]/.test(text), text)
  expect('a worker from before Ather loaded gets its start and model from Claude Code\'s record', /Separate PR: rule book gap\n  General · Opus · working\n  running 10:0\d\n/.test(text), text)
  expect('a worker with no record shows no clock and no count rather than wrong ones', /Worker with no record\n  General · working\n  running · start unknown\n/.test(text), text)
  done()
  fs.rmSync(home, { recursive: true, force: true })
}

// ---------------------------------------------------------------- report

const passed = results.filter(one => one.ok).length
const lines = ['# Ather Automata end-to-end run', '', `${passed} of ${results.length} checks passed.`, '']
for (const one of results) lines.push(`- ${one.ok ? '✅' : '❌'} ${one.name}${one.ok || !one.detail ? '' : `  \n  ${one.detail}`}`)
lines.push('', '# Screens', '')
for (const [title, body] of screens) lines.push(`## ${title}`, '', '```text', body, '```', '')
fs.writeFileSync(OUT, lines.join('\n'))
if (LAYOUTS) {
  fs.mkdirSync(LAYOUTS, { recursive: true })
  for (const width of [72, 110]) {
    const drawn = layouts.map((one, index) => [one, index]).filter(([one]) => one.width === width)
    fs.writeFileSync(path.join(LAYOUTS, `layouts-${width}.txt`), drawn.map(([one, index]) => `=== #${index} (${width} columns)\n${one.lines.join('\n')}\n`).join('\n'))
  }
  console.log(`layouts: ${LAYOUTS}`)
}
console.log(`${passed}/${results.length} passed`)
for (const one of results.filter(r => !r.ok)) console.log(`FAIL ${one.name}\n     ${one.detail.slice(0, 400)}`)
