// End-to-end run of the Ather Automata hooks module against a sandbox copy of
// the repo's intents, as the desktop app and the terminal drive it.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { AFK, createEngine } from './engine.mjs'
import { check, draw, layouts } from './screen.mjs'
import { repoId } from './out/hooks/state.mjs'

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
  // The folder's real path: a checkout's id is made from it (macOS's temporary folder is behind a link).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ather-e2e-')))
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

// `ownFindingsOnly`: the copied intents come without their findings, so the only decisions that wait are the
// ones a block writes itself. Needs you draws nine rows, and a checkout whose person has that many open
// decisions would leave a block's own rows undrawn.
const boot = async ({ surfaces = [], user = 'Tin Nguyen', hour = 12, store = {}, ghIssues, ghPrs, env, ownFindingsOnly = false } = {}) => {
  const root = sandbox()
  if (ownFindingsOnly) for (const entry of fs.readdirSync(path.join(root, 'docs/intent'), { withFileTypes: true })) if (entry.isDirectory()) fs.rmSync(path.join(root, 'docs/intent', entry.name, 'findings.md'), { force: true })
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
// What the mod keeps per repository (an intent's proof, a person's "Continue …") is under `<prefix>:<repo>|<id>`;
// the sandboxes have no origin, so their repository is their folder.
const scopedKey = (engine, prefix, id) => [...engine.store.keys()].find(key => key === `${prefix}:${id}` || (key.startsWith(`${prefix}:`) && key.endsWith(`|${id}`)))
const scoped = (engine, prefix, id) => engine.store.get(scopedKey(engine, prefix, id) ?? '')
// Where a session's evidence is: its tracked intent (no commit in the sandbox, which has no refs), or the session.
const evidenceOf = (engine, sid = 'harness-session-0001') => {
  const pinned = engine.store.get(`pinned:${sid}`)
  return pinned === undefined ? engine.store.get(`evidence:${sid}`) : scoped(engine, 'evidence', pinned)
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

// Presses the Button with this key (a label can change with the data: "+19 more ›").
const pressKey = (tree, key) => {
  const stack = [tree]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (node.type === 'Button' && node.props.key === key) {
      node.props.onPress()
      return true
    }
    stack.push(...(node.children ?? []))
  }
  return false
}

// The node with this key, anywhere in a tree.
const nodeOf = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => nodeOf(child, key)).find(Boolean) ?? null)

// Search as a surface with a text field does (0.2.0): Search… opens the field, Enter submits the words.
// Returns the field, or null when none was drawn.
const searchField = async (render, words) => {
  nodeOf(await render(), 'pick-search')?.props.onPress()
  const field = nodeOf(await render(), 'pick-search-field')
  field?.props.onSubmit(words, {})
  return field
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
  expect('four model tools: status, away, profile, repos', engine.record.registeredTools.join(',') === 'status,away,profile,repos', engine.record.registeredTools)
  done()
  const quiet = createEngine({ root: sandbox(), surfaces: [], user: 'Tin Nguyen' })
  register(quiet.on, {})
  await quiet.start(false)
  // The desktop app starts sessions as the SDK does (not interactive, no surface): the commands are
  // there at once, and the console's reading starts the first time it is drawn, never before.
  const quietReads = () => quiet.record.logs.length + quiet.record.invalidations
  const before = quietReads()
  expect('a session the desktop app starts (not interactive) still gets /ather and /away, and reads nothing until drawn', quiet.record.commands.join(',') === 'ather,away' && quiet.record.registeredTools.join(',') === 'status,away,profile,repos' && quietReads() === before, quiet.record.commands)
  const desk = createEngine({ root: sandbox(), surfaces: [], user: 'Tin Nguyen', ghIssues: [{ number: 28887, title: '[BUG][GAS] Dodge cancels the wrong montage', url: 'https://github.com/sipherxyz/s2/issues/28887', labels: [{ name: 'combat' }], updatedAt: new Date().toISOString() }] })
  register(desk.on, {})
  await desk.start(false)
  await desk.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band', 'desktop')
  await new Promise(resolve => setTimeout(resolve, 1500))
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  // Home previews five of the person's own rows, and on a checkout where they own that many intents the issue
  // is not one of them: it is looked for where every row is, in Everything open.
  findKey(await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop'), 'all')?.props.onPress({})
  const deskPane = check(await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop'), 70)
  const narrow = check(await desk.render('Pane', { bodyColumns: 30 }, 'ather', 'desktop'), 1000)
  expect('on the desktop nothing is cut by column count: the full issue title shows, and rows span the panel', narrow.lines.some(line => line.includes('#28887') && line.includes('Dodge cancels the wrong montage') && line.length > 30), narrow.lines)
  findKey(await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop'), 'pick-issue:28887')?.props.onPress({})
  const deskCard = await desk.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop')
  expect("the desktop's issue card opens GitHub with a real link", findKey(deskCard, 'issue-open')?.type === 'Link' && findKey(deskCard, 'issue-open')?.props.href === 'https://github.com/sipherxyz/s2/issues/28887', findKey(deskCard, 'issue-open'))
  expect('on the desktop, the first draw starts the console: the assigned issue shows in the pane', /Dodge cancels the wrong montage/.test(deskPane.lines.join('\n')), deskPane.lines)
}

// ---------------------------------------------------------------- desktop: one question, never a loop

{
  const { engine, done } = await boot()
  // However many calls the checkout has: one is offered as itself, several as one walk-through.
  const first = await run(engine, [question => question.options.find(option => /^(Decide F-|Go through \d+ things)/.test(option.label))?.label ?? '__missing__'])
  screens.push(['Desktop · /ather, decide the waiting call', `${dialogText(first.dialogs)}\n  → output: ${first.out}\n  → sent: ${first.sent[0] ?? '(nothing)'}`])
  const menu = first.dialogs[0]
  expect('/ather asks exactly one question', first.dialogs.length === 1 && menu?.header === 'Ather', first.dialogs.length)
  expect('the question says where things stand and what waits', /Nothing tracked in this session\. Waiting on you: F-\d+ on [a-z-]+(, F-\d+ on [a-z-]+)*\. What now\?/.test(menu?.question ?? ''), menu?.question)
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
  expect('… Work on it here tracks it and moves "Continue …" to it', pinnedNow() === 'fluid-snow-sand-look' && scoped(engine, 'last', 'tinnguyen') === 'fluid-snow-sand-look' && work.out === 'Now tracking fluid-snow-sand-look.' && work.sent.length === 0, work.out)
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
  expect('… and each says when it ends: a question asked through $.ui.ask (labels only) keeps what each choice does', (away.dialogs[0]?.options ?? []).length === 3 && away.dialogs[0]?.options.every(o => /^(Ends when|until )/.test(o.description ?? '')), away.dialogs[0]?.options.map(o => o.description))
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
  const both = await run(engine, [pick('Go through')])
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
  // The Work question offers four rows, fewer than a person with many intents has: Everything open lists every one.
  engine.setSurfaces(['terminal'])
  await run(engine, [], 'ather', 'pick')
  const labels = check(await engine.render('Pane', { bodyColumns: 110 }, 'ather', 'terminal'), 110).lines
  expect('an issue that already has an intent is listed as that intent only', !labels.some(label => /#28887/.test(label)) && labels.some(label => /time-dilation-ownership/.test(label)) && labels.some(label => /#31360/.test(label)), labels)
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
  pressKey(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'all')
  const all = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
  screens.push(['Terminal · Everything open (72 columns)', all.lines.join('\n')])
  expect('"Everything open" groups by source, each with its count and a fold: your assigned issues, then the teammates\' intents', /▾ A S S I G N E D {3}I S S U E S {3}· {3}1\n1: #28887/.test(all.lines.join('\n')) && /▾ T E A M M A T E S ' {3}I N T E N T S/.test(all.lines.join('\n')) && all.problems.length === 0, all.problems)
  const subHeads = all.lines.map(line => /^([▸▾]) ([^‖].*) · (\d+)$/.exec(line)).filter(Boolean)
  expect('A7: in a real team list every sub-group of more than six starts folded and every smaller one open', subHeads.length > 0 && subHeads.every(([, fold, , count]) => (Number(count) > 6) === (fold === '▸')), subHeads.map(([line]) => line))
  // The list's own controls: fold a group, filter by age, search, and a teammate's name after the title in its colour.
  const pickTree = () => engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const pickText = async () => check(await pickTree(), 72).lines.join('\n')
  const collect = (node, test) => (!node || typeof node !== 'object' ? [] : [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(child => collect(child, test))])
  expect('"Everything open" starts unfiltered and sorted by Recent; the age chips are gone (A5)', /s: Search… {3}o: Sort: Recent {3}g: Group: Person\n/.test(await pickText()) && !/Any time|7 days/.test(await pickText()))
  // A teammate's intent in this checkout, whichever it is: the first row under their heading (past its sub-heads).
  const teammate = /T E A M M A T E S '[^\n]*\n(?:[^\n]*\n)*?\d: \S+ (\S+)/.exec(await pickText())?.[1] ?? ''
  find(await pickTree(), 'group-issues-fold')?.props.onPress()
  const folded = await pickText()
  expect('folding a group hides its rows and keeps its heading and count', /▸ A S S I G N E D {3}I S S U E S {3}· {3}1/.test(folded) && !/#28887/.test(folded) && teammate !== '' && folded.includes(teammate), folded)
  find(await pickTree(), 'group-issues-fold')?.props.onPress()
  expect('… and unfolding brings them back', /#28887/.test(await pickText()))
  // The stage blocks are the ungrouped list's (Group: None); grouped, each sub-group keeps the sort's order.
  for (let turn = 0; turn < 3; turn += 1) find(await pickTree(), 'pick-group')?.props.onPress()
  const sorts = []
  for (let turn = 0; turn < 3; turn += 1) {
    find(await pickTree(), 'pick-sort')?.props.onPress()
    sorts.push(await pickText())
  }
  screens.push(['Terminal · Everything open sorted for closing (72 columns)', sorts[0]])
  expect('Sort cycles Recent → Ready to close → Oldest → Recent; Ready to close shows bold stage blocks with counts (A5)', /o: Sort: Ready to close/.test(sorts[0]) && /^(Ready to close|Proving|Building|Parked) · \d+$/m.test(sorts[0]) && /o: Sort: Oldest/.test(sorts[1]) && !/^Proving · \d+$/m.test(sorts[1]) && /o: Sort: Recent/.test(sorts[2]), sorts[0])
  const blockTree = (find(await pickTree(), 'pick-sort')?.props.onPress(), await pickTree())
  const blockHeads = collect(blockTree, node => node.type === 'Text' && /^group-others-(met|prove|build|parked)$/.test(node.props.key ?? ''))
  expect('the stage blocks are subgroups: bold, not letter-spaced, and never lime', blockHeads.length > 0 && blockHeads.every(node => node.props.bold && node.props.color !== '#DDFF00' && !/ {2}/.test(node.props.children)), blockHeads.map(node => node.props))
  find(await pickTree(), 'pick-sort')?.props.onPress()
  find(await pickTree(), 'pick-sort')?.props.onPress()
  find(await pickTree(), 'pick-group')?.props.onPress()
  engine.record.dialogs.length = 0
  find(await pickTree(), 'pick-search')?.props.onPress()
  const fieldTree = await pickTree()
  const fieldCheck = check(fieldTree, 72)
  screens.push(['Terminal · Everything open, Search opened as a field (72 columns)', fieldCheck.lines.slice(0, 6).join('\n')])
  const searchInput = find(fieldTree, 'pick-search-field')
  expect('A7: Search opens a text field, focused, in place of the question dialog; the first row gives up its focus', searchInput?.type === 'Input' && searchInput.props.autoFocus === true && /^Search: \[title, issue number, area or owner\]/m.test(fieldCheck.lines.join('\n')) && fieldCheck.problems.length === 0, [searchInput?.props, fieldCheck.problems])
  searchInput?.props.onSubmit('dodge', {})
  await engine.flush()
  const searched = await pickText()
  expect('A7: Enter in the field narrows the list (here to the Dodge issue), no dialog asked, and the field closes', /#28887/.test(searched) && !searched.includes(teammate) && /^1 of \d+$/m.test(searched) && /Search: dodge/.test(searched) && engine.record.dialogs.length === 0 && !find(await pickTree(), 'pick-search-field'), searched)
  find(await pickTree(), 'pick-search-clear')?.props.onPress()
  // Where the surface draws no field (the mobile app), Search is the question dialog as before.
  engine.script.length = 0
  engine.script.push(typed('dodge'))
  find(await engine.render('Pane', { bodyColumns: 72 }, 'ather', 'mobile'), 'pick-search')?.props.onPress()
  await engine.flush()
  expect('A7: on a surface without a text field, Search asks one question and the words typed under Other narrow the list', engine.record.dialogs.at(-1)?.header === 'Search' && /Search: dodge/.test(await pickText()) && !find(await engine.render('Pane', { bodyColumns: 72 }, 'ather', 'mobile'), 'pick-search-field'), engine.record.dialogs.at(-1))
  find(await pickTree(), 'pick-search-clear')?.props.onPress()
  // /ather find <words> is unchanged: the list searched in the pane, or the matches in a line without one.
  engine.record.dialogs.length = 0
  await run(engine, [], 'ather', 'find dodge')
  expect('A7: /ather find <words> still opens Everything open searched, with no dialog', /Search: dodge/.test(await pickText()) && engine.record.dialogs.length === 0)
  find(await pickTree(), 'pick-search-clear')?.props.onPress()
  engine.setSurfaces([])
  const foundLine = await run(engine, [], 'ather', 'find dodge')
  engine.setSurfaces(['terminal'])
  expect('A7: … and without a pane it answers in a line', /^1 match "dodge": #28887/.test(foundLine.out), foundLine.out)
  find(await pickTree(), 'pick-search-clear')?.props.onPress()
  expect('✕ Clear shows everything again', (await pickText()).includes(teammate) && !/Search: /.test(await pickText()))
  const owners = collect(await pickTree(), node => node.type === 'Text' && /^pick-intent:.*-owner-text$/.test(node.props.key ?? ''))
  const ownerColours = new Map(owners.map(node => [node.props.children.trim(), node.props.color]))
  expect("a teammate's name sits in the owner column, tidied, in its own colour, dimmed", owners.length > 0 && owners.every(node => /^#[0-9a-f]{6}$/.test(node.props.color) && node.props.color !== '#8E918A' && !/-(Art|VFX|TA)\b/.test(node.props.children)), [...ownerColours])
  expect('no two teammates share a colour while there are eight or fewer', new Set(ownerColours.values()).size === Math.min(ownerColours.size, 8), [...ownerColours])
  // One anatomy: every row's right-hand columns end at the same place, and the legend sits at the foot (A8).
  for (const cols of [72, 110]) {
    const drawn = check(await engine.render('Pane', { bodyColumns: cols }, 'ather'), cols)
    const rowsDrawn = drawn.lines.filter(line => /^\d: [●◐✓‖#]/.test(line))
    const ages = rowsDrawn.filter(line => /[●◐✓‖] /.test(line)).map(line => /\s(\d+[mhd])\s/.exec(line)).map(match => (match ? match.index + match[0].length : -1))
    expect(`Everything open @${cols}: every intent row's age column ends at the same column, no line wider than the pane`, drawn.problems.length === 0 && ages.length > 0 && new Set(ages).size === 1 && rowsDrawn.every(line => line.length === cols), [drawn.problems, ages, rowsDrawn])
    expect(`Everything open @${cols}: the legend at the foot`, /● Building {2}◐ Items met, PR not merged {2}✓ Ready to close {2}‖ Parked\n\n0: Back/.test(drawn.lines.join('\n')), drawn.lines.slice(-4))
  }
  const limes = collect(await pickTree(), node => (node.props.color === '#DDFF00' || node.props.borderColor === '#DDFF00'))
  expect('Everything open has no lime: nothing there is waiting on the person (A9)', limes.length === 0, limes.map(node => node.props.key))
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
  const evidence = scoped(engine, 'evidence', 'box-scale-tool')
  expect("yesterday's build and tests still count today", evidence?.build?.state === 'pass' && evidence?.automation?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
  done()
}

{
  // While a merge's losses are unreviewed, Next waits; the pane shows what needs you first.
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer', 'lost:harness-session-0001': { paths: ['Content/S2/BP_Sash.uasset'], isDisclosed: false } } })
  // The tracked intent has a decision of its own waiting: the loss comes before it.
  fs.appendFileSync(path.join(root, 'docs/intent/box-scale-tool/findings.md'), '\n## F-9 (2026-10-07) | blocking: no | status: open (director)\n\nWhich handle should scale from the centre?\n')
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
  expect("a tech artist's last proof is offered as one press, and recorded", (menu.dialogs[0]?.options ?? []).some(o => o.label === 'I checked it in the Editor') && scoped(engine, 'evidence', 'snow-trail-lod-pop')?.editor?.state === 'pass', menu.dialogs[0]?.options.map(o => o.label))
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
  // Handed over the walk-through way (/ather's question where nothing is drawn), not answered in place.
  engine.setSurfaces([])
  await run(engine, [question => question.options.find(option => /^(Decide F-10|Go through \d+ things)/.test(option.label))?.label ?? '__missing__'])
  engine.setSurfaces(['terminal'])
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
  pressKey(await pane(110), 'all')
  const all = check(await pane(72), 72)
  screens.push(['Terminal · All intents (72 columns)', all.lines.join('\n')])
  expect('All intents lists every open intent, cleanly, under one status line', all.problems.length === 0 && /Everything open\n\d+ open · yours first/.test(all.lines.join('\n')), all.problems)
  pressIn(await pane(110), 'Back')
  // A decision's row opens it in place (0.2.0): nothing is sent and the pane stays (fixtures below check the answers).
  const callKeys = []
  const collectCalls = node => (!node || typeof node !== 'object' ? undefined : (node.type === 'Button' && /^item-call:/.test(node.props.key ?? '') && callKeys.push(node.props.key), (node.children ?? []).forEach(collectCalls)))
  const before = await pane(110)
  collectCalls(before)
  const closesBefore = engine.record.closes.length
  // One not opened yet; with a single decision (opened from the start), its press closes it and a second opens it again.
  const lastCall = callKeys.find(key => !nodeOf(before, `explain-${key.slice('item-'.length)}`)) ?? callKeys[0] ?? ''
  if (nodeOf(before, `explain-${lastCall.slice('item-'.length)}`)) pressKey(before, lastCall)
  pressKey(await pane(110), lastCall)
  await engine.flush()
  expect('pressing a Needs-you decision opens its answers in place: nothing sent, the pane stays', lastCall !== '' && engine.record.submits.length === 0 && engine.record.closes.length === closesBefore && Boolean(nodeOf(await pane(110), `explain-${lastCall.slice('item-'.length)}`)), callKeys)
  await engine.close('ather')
  expect('no hook threw in the terminal', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

// ---------------------------------------------------------------- decide in place (0.2.0)

{
  // Two fixture intents of Tin's. zz-decide, the newer so it comes first: F-1 in the list format (A recommended)
  // and F-3 resolved (inline, Resolution filled). zz-group: F-2 inline (B recommended) and F-4 with no options,
  // two decisions that wait as one block. A trap seen in three sessions waits too, and the Editor is held
  // (a designer's Ask for the Editor: an item with nothing to answer, offered while an intent is tracked).
  const { engine, root, done } = await boot({ surfaces: ['terminal'], ownFindingsOnly: true, store: { 'role:tinnguyen': 'designer', gotchaHits: { 'live-coding': { title: 'A running Editor blocks the build (Live Coding)', fix: 'Close the Editor.', count: 3 } } } })
  const fixture = (slug, findings) => {
    fs.mkdirSync(path.join(root, 'docs/intent', slug), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs/intent', slug, 'prompt.md'), `# ${slug}\n\n- Status: active\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: one\n- A2: two\n`)
    fs.writeFileSync(path.join(root, 'docs/intent', slug, 'findings.md'), ['# Findings', '', ...findings, ''].join('\n'))
  }
  fixture('zz-decide', [
    '## F-1 (2026-09-29, rev 6) | blocking: no | status: open (director)',
    '',
    '**Found:** in the snow/sand lab, neither Nine Tails hook can be driven by its production trigger, so both are proven by automation tests plus a lab force.',
    '',
    '**Options:**',
    '- A (recommended): prove both on a map where Fox Form and FoxScan run for real, the Winter or Loc_03 test maps, at the first production trial.',
    '- B: add a lab rig that grants Fox Form, which means driving the production ability with its resources set up.',
    '',
    '**Resolution:**',
    '',
    '## F-3 (open, not blocking): already settled',
    '',
    '- Options: (a) one way; (b) another way. Recommendation: (a).',
    '- Resolution (orchestrator, 2026-10-05): accepted (a).',
  ])
  fixture('zz-group', [
    '## F-2 (open, not blocking): restart one quest also restores every flow-owned actor',
    '',
    '- Options: (a) keep it as is, with the confirmation; (b) add a runtime hook that restores only the restarted quest; (c) re-run the',
    "  other quests' entry actions. Recommendation: (b).",
    '',
    '## F-4 (2026-10-07) | blocking: yes | status: open (director)',
    '',
    'Which pool size should the spawner use?',
  ])
  fs.writeFileSync(path.join(root, 'Saved/EDITOR_OWNER.txt'), 'held by lane-7')
  // With nothing tracked the intents come newest first: zz-group is a second older, and still newer than the copied ones.
  const earlier = new Date(Date.now() - 1000)
  for (const file of fs.readdirSync(path.join(root, 'docs/intent/zz-group'))) fs.utimesSync(path.join(root, 'docs/intent/zz-group', file), earlier, earlier)
  await run(engine, [], 'ather', 'intent zz-decide')
  const pane = (cols = 72, surface = 'terminal') => engine.render('Pane', { bodyColumns: cols }, 'ather', surface)
  const text = async (cols = 72) => check(await pane(cols), cols).lines.join('\n')
  const id = n => `call:${n === 1 || n === 3 ? 'zz-decide' : 'zz-group'}:F-${n}`
  // A section label is spaced out, its count too: "N E E D S   Y O U   ·   1 2" is twelve.
  const waiting = async () => Number((/N E E D S   Y O U   ·   (\d(?: \d)*)/.exec(await text(110))?.[1] ?? '-1').replace(/ /g, ''))

  // A session answers for the intent it tracks: another intent's decisions wait for a session that tracks it, or none.
  const tracked = await pane(72)
  expect("tracking zz-decide, Needs you offers its decision and not zz-group's; the repeated problem and Ask for the Editor stay", Boolean(nodeOf(tracked, `item-${id(1)}`)) && !nodeOf(tracked, 'calls-zz-group') && !nodeOf(tracked, `item-${id(2)}`) && !nodeOf(tracked, `item-${id(4)}`) && Boolean(nodeOf(tracked, 'item-rule:live-coding')) && Boolean(nodeOf(tracked, 'item-editor')) && (await waiting()) === 3, check(tracked, 72).lines)
  await run(engine, [], 'ather', 'untrack')
  const first = await pane(72)
  expect("after /ather untrack, zz-group's decisions are offered again, beside zz-decide's", Boolean(nodeOf(first, `item-${id(1)}`)) && Boolean(nodeOf(first, 'calls-zz-group')), check(first, 72).lines)
  const first72 = check(first, 72)
  screens.push(['Terminal · Needs you, the first decision opened with its answers (72 columns)', first72.lines.join('\n')])
  const shown72 = first72.lines.join('\n')
  expect(
    'A3: the first decision is opened: its whole question, A (recommended, primary) and B as buttons, then Explain, Type an answer, Open findings',
    /◆ \d: Decide F-1 on zz-decide\n {5}In the snow\/sand lab, neither Nine Tails hook can be driven/.test(shown72) &&
      /\[ A: Prove both on a map where Fox Form and[^\]]*\(recommended\) \]/.test(shown72) &&
      /\[ B: Add a lab rig that grants Fox Form \]/.test(shown72) &&
      /x: Explain {3}t: Type an answer {3}Open findings ›/.test(shown72) &&
      nodeOf(first, `option-${id(1)}-A`)?.props.variant === 'primary' &&
      nodeOf(first, `option-${id(1)}-B`)?.props.variant === undefined,
    first72.lines,
  )
  expect('A3: an intent with several decisions keeps its one folded row; a finding with a filled Resolution is not offered (A2)', /◆ \d: ▸ zz-group · 2 decisions\n/.test(shown72) && !nodeOf(first, `item-${id(2)}`) && !/F-3/.test(shown72), shown72)
  pressKey(first, 'calls-zz-group')
  const block = await text(72)
  expect('A3: opened, the block shows its decisions one line each, the first decision still the one opened', /▾ zz-group · 2 decisions\n {2}· \d: F-2 · Restart one quest also restores every flow-owned actor\n(?: {3,}[^\n]*\n)*? {2}· \d: F-4 · Which pool size should the spawner use\?/.test(block) && Boolean(nodeOf(await pane(), `option-${id(1)}-A`)) && !nodeOf(await pane(), `option-${id(2)}-A`), block)
  for (const cols of [72, 110]) {
    const drawn = check(await pane(cols), cols)
    expect(`A3: Needs you with a decision opened lays out cleanly at ${cols} columns, every hotkey unique`, drawn.problems.length === 0, drawn.problems)
  }
  const desk = await pane(110, 'desktop')
  const deskDrawn = check(desk, 1000)
  screens.push(['Desktop · Needs you, the first decision opened (tree drawn as text)', deskDrawn.lines.filter(line => /zz-decide|Decided|\[ [AB]:|Explain|snow\/sand/.test(line)).join('\n')])
  expect('A3: on the desktop every answer is a visible button and no key is drawn', ['A', 'B'].every(letter => nodeOf(desk, `option-${id(1)}-${letter}`)?.type === 'Button') && nodeOf(desk, `explain-${id(1)}`)?.props.hotkey === undefined && nodeOf(desk, `type-${id(1)}`)?.props.hotkey === undefined && nodeOf(desk, `findings-${id(1)}`)?.type === 'Button' && deskDrawn.problems.length === 0, deskDrawn.problems)

  // Another decision opens on its press, one at a time; a press on the opened one closes it.
  pressKey(await pane(), `item-${id(2)}`)
  const second = await pane()
  expect('A3: pressing another decision opens it and closes the first (F-2: B recommended, from "Recommendation: (b)")', nodeOf(second, `option-${id(2)}-B`)?.props.variant === 'primary' && /^C: /.test(nodeOf(second, `option-${id(2)}-C`)?.props.label ?? '') && !nodeOf(second, `option-${id(1)}-A`), nodeOf(second, `option-${id(2)}-B`)?.props)
  pressKey(await pane(), `item-${id(2)}`)
  expect('… and pressing the opened one closes it', !nodeOf(await pane(), `option-${id(2)}-B`) && !nodeOf(await pane(), `option-${id(1)}-A`))
  pressKey(await pane(), `item-${id(1)}`)

  // Explain asks without deciding: the row stays open and still waits.
  const waitingBefore = await waiting()
  const closesBefore = engine.record.closes.length
  pressKey(await pane(), `explain-${id(1)}`)
  await engine.flush()
  expect('A5: Explain hands the session the explain prompt; the row stays open and still counts as waiting; the pane stays', engine.record.submits.at(-1) === 'Explain decision F-1 on zz-decide: what it is about, each option and what it means, and why the recommendation; do not decide or change anything.' && Boolean(nodeOf(await pane(), `option-${id(1)}-A`)) && (await waiting()) === waitingBefore && engine.record.closes.length === closesBefore, engine.record.submits.at(-1))

  // An option decides: the session gets the D4 prompt, the row says so in place, then folds.
  // Pressed twice before the pane redraws (a double click, a second Enter): one answer goes out.
  const submitsBefore = engine.record.submits.length
  const optionTree = await pane()
  pressKey(optionTree, `option-${id(1)}-A`)
  pressKey(optionTree, `option-${id(1)}-A`)
  await engine.flush()
  expect('A4: an option pressed twice before the redraw sends one prompt', engine.record.submits.length === submitsBefore + 1, engine.record.submits.slice(submitsBefore))
  expect('A4: pressing an option hands the session "Decide F-1 on zz-decide: A — <full text>" and the record-it instruction; the pane stays', engine.record.submits.at(-1) === "Decide F-1 on zz-decide: A — Prove both on a map where Fox Form and FoxScan run for real, the Winter or Loc_03 test maps, at the first production trial. Record it as the intent skill's decision step says (mark the finding, fill its Resolution, fold an accepted amendment into prompt.md with a Rev bump and a Decisions entry); do not ask me again." && engine.record.closes.length === closesBefore, engine.record.submits.at(-1))
  const decided72 = check(await pane(72), 72)
  screens.push(['Terminal · Needs you just after answering: "✓ Decided" in place (72 columns)', decided72.lines.join('\n')])
  expect('A4: the row shows "✓ Decided: A" in place, Needs you counts one fewer, and the next decision opens', /✓ Decided: A · F-1 on zz-decide/.test(decided72.lines.join('\n')) && (await waiting()) === waitingBefore - 1 && Boolean(nodeOf(await pane(), `option-${id(2)}-B`)) && decided72.problems.length === 0, decided72.lines)
  const realNow = Date.now
  Date.now = () => realNow() + 9000
  try {
    const folded72 = check(await pane(72), 72)
    pressKey(await pane(), 'decided-fold')
    const unfolded = await text(72)
    screens.push(['Terminal · Needs you 9 s later: folded into "▸ 1 decided", then unfolded (72 columns)', `${folded72.lines.join('\n')}\n\n— unfolded —\n${unfolded}`])
    expect('A4: 8 seconds on, the row folds under "▸ 1 decided", which unfolds to the answer', !/✓ Decided: A/.test(folded72.lines.join('\n')) && /▸ 1 decided/.test(folded72.lines.join('\n')) && /▾ 1 decided\n {2}✓ F-1 on zz-decide: A/.test(unfolded) && folded72.problems.length === 0, folded72.lines)
    pressKey(await pane(), 'decided-fold')
  } finally {
    Date.now = realNow
  }

  // Type an answer: a field under the row (the terminal has one); Enter sends the words as the choice.
  pressKey(await pane(), `type-${id(2)}`)
  const typing = await pane(72)
  const typing72 = check(typing, 72)
  const field = nodeOf(typing, `typed-${id(2)}`)
  screens.push(['Terminal · Type an answer opens a field under the decision (72 columns)', typing72.lines.join('\n')])
  expect('A6: Type an answer opens a focused field under the row, named for the decision; nothing else takes the focus', field?.type === 'Input' && field.props.autoFocus === true && field.props.placeholder === 'Your answer to F-2 on zz-group' && typing72.problems.length === 0, [field?.props, typing72.problems])
  field?.props.onSubmit('keep it, but log which actors moved', {})
  await engine.flush()
  expect("A6: Enter hands the session the decision with the person's words as the choice", engine.record.submits.at(-1) === `Decide F-2 on zz-group: "keep it, but log which actors moved" (my own answer, in my words). Record it as the intent skill's decision step says (mark the finding, fill its Resolution, fold an accepted amendment into prompt.md with a Rev bump and a Decisions entry); do not ask me again.` && /✓ Decided: keep it, but log which actors moved · F-2/.test(await text(110)), engine.record.submits.at(-1))

  // A decision with no options: Explain, Type an answer and Open findings only.
  const none = await pane()
  expect('A1/D1: a finding without options opens with Explain, Type an answer and Open findings, and no option buttons', Boolean(nodeOf(none, `explain-${id(4)}`)) && !nodeOf(none, `option-${id(4)}-A`) && Boolean(nodeOf(none, `findings-${id(4)}`)), none)
  // With its typed answer open, Open findings leaves the row: Back does not land in the field again.
  pressKey(none, `type-${id(4)}`)
  expect('A6: the typed field opens on F-4 before leaving it', Boolean(nodeOf(await pane(), `typed-${id(4)}`)))
  pressKey(await pane(), `findings-${id(4)}`)
  const finding = await text(72)
  screens.push(['Terminal · Open findings › shows the finding as written (72 columns)', finding])
  expect('D3: Open findings › shows the finding as written, with Back', /^F I N D I N G\nF-4 on zz-group$/m.test(finding) && /## F-4 \(2026-10-07\)/.test(finding) && /Which pool size should the spawner use\?/.test(finding) && /0: Back/.test(finding), finding)
  pressKey(await pane(), 'finding-back')
  expect('D3: back from the finding, the row is opened again with its typed field closed', Boolean(nodeOf(await pane(), `explain-${id(4)}`)) && !nodeOf(await pane(), `typed-${id(4)}`))

  // Where the surface has no text field (mobile), Type an answer is the question dialog's Other.
  engine.record.dialogs.length = 0
  engine.script.length = 0
  engine.script.push(typed('a pool of eight'))
  const mobile = await pane(72, 'mobile')
  pressKey(mobile, `type-${id(4)}`)
  await engine.flush()
  const asked = engine.record.dialogs.at(-1)
  expect('A6: without a text field, Type an answer asks one question (2-4 answers) and the words typed under Other decide', asked?.header === 'Answer' && asked.options.length >= 2 && asked.options.length <= 4 && !nodeOf(await pane(72, 'mobile'), `typed-${id(4)}`) && engine.record.submits.at(-1) === `Decide F-4 on zz-group: "a pool of eight" (my own answer, in my words). Record it as the intent skill's decision step says (mark the finding, fill its Resolution, fold an accepted amendment into prompt.md with a Rev bump and a Decisions entry); do not ask me again.`, [asked, engine.record.submits.at(-1)])

  // D8: "make it a rule?" answers in place too. Every decision above is answered, so it is the one item left
  // waiting, and the one Needs you has opened.
  const rule = await pane(72)
  expect('A8: the repeated-problem item opens with Make it a rule / No, leave it, Explain and Type an answer (no Open findings)', /^A: Make it a rule$/.test(nodeOf(rule, 'option-rule:live-coding-A')?.props.label ?? '') && /^B: No, leave it$/.test(nodeOf(rule, 'option-rule:live-coding-B')?.props.label ?? '') && Boolean(nodeOf(rule, 'explain-rule:live-coding')) && !nodeOf(rule, 'findings-rule:live-coding') && check(rule, 72).problems.length === 0, check(rule, 72).lines)
  pressKey(rule, 'option-rule:live-coding-A')
  await engine.flush()
  expect('A8: Make it a rule hands the draft request (never a commit) and shows "✓ Decided: A" in place', /These traps keep coming back: "A running Editor blocks the build \(Live Coding\)", 3 sessions; its fix each time: Close the Editor\. Make it a rule: for each, draft the change that prevents it/.test(engine.record.submits.at(-1) ?? '') && /do not commit\.$/.test(engine.record.submits.at(-1) ?? '') && /✓ Decided: A · Turn a repeated problem into a rule\?/.test(await text(110)), engine.record.submits.at(-1))

  // An item with nothing to answer keeps today's press: it goes to the session and the pane closes.
  // Ask for the Editor is for the tracked intent's next step.
  await run(engine, [], 'ather', 'intent zz-decide')
  const closesTracked = engine.record.closes.length
  pressKey(await pane(), 'item-editor')
  await engine.flush()
  expect('D8: an item without options (Ask for the Editor) still hands over on its press and closes the pane', /^Find the session that holds the Editor owner lock/.test(engine.record.submits.at(-1) ?? '') && engine.record.closes.length > closesTracked, engine.record.submits.at(-1))
  expect('no hook threw while deciding in place', engine.record.hookErrors.length === 0, engine.record.hookErrors)
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
  expect('the title bar names Ather Automata, and no brand line under it repeats it (D7)', !/A T H E R   A U T O M A T A/.test(pane.lines.join('\n')) && engine.record.opens.some(one => one.title === 'ATHER AUTOMATA'), pane.lines.slice(0, 3))
  const issuesNow = await run(engine, [], 'ather', 'issues')
  expect('/ather issues reads them on the spot and says why when it cannot, or that there are none', /Could not read your GitHub issues|No open GitHub issues are assigned to you|N E X T|Pick/.test(issuesNow.out + issuesNow.dialogs.map(one => one.question).join(' ')) , issuesNow.out)
  expect('the desktop pane carries the Ather mark, is clicked (no hotkeys drawn) and lays out cleanly; the terminal draws no mark', find(desk, 'Svg')?.props.alt === 'Ather' && deskPane.problems.length === 0 && !/\b[a-z0-9]: /.test(deskPane.lines.join('\n')) && !find(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 'Svg'), deskPane.problems)
  expect("a newcomer's pane leads with the tour and offers teammates' intents", /N E X T\nn: Take the tour\n *Six short steps/.test(pane.lines.join('\n')) && /T E A M M A T E S '   I N T E N T S   ·   \d( \d)*\nRead-only/.test(pane.lines.join('\n')) && (pane.lines.join('\n').match(/tour/gi) ?? []).length === 1 && pane.problems.length === 0, pane.problems)
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
  expect("the running avatar's frame page takes the app's colour scheme (its root set to light dark), so no square shows behind it in either theme", avatars.every(one => one.props.source.includes('<style>:root{color-scheme:light dark;background:transparent}</style>')), avatars.map(one => one.props.source.slice(0, 160)))
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
  expect('Skills lists the present skills by group, each with the first sentence of its description', /R E V I E W   A N D   P R O O F\n1: thermo-nuclear-code-quality-review\n *What thermo-nuclear-code-quality-review does\.\n2: editor-video-walkthrough/.test(listed.lines.join('\n')) && /A G E N T I C   T E S T I N G\n3: talab/.test(listed.lines.join('\n')) && !/Use it when/.test(listed.lines.join('\n')) && listed.problems.length === 0, listed.lines)
  expect('a skill from the manual library is listed under Explain it to me', /E X P L A I N   I T   T O   M E\n\d: show-me\n *Help the user understand the topic visually\./.test(listed.lines.join('\n')), listed.lines)
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
  // What waits with nothing tracked: a session that tracks an intent is offered that intent's decisions only.
  const waiting = async () => /Waiting on you: [^.]*\./.exec((await run(engine, [dismiss])).dialogs[0]?.question ?? '')?.[0] ?? ''
  const before = await waiting()
  await run(engine, [], 'ather', 'intent box-scale-tool')
  expect('tracking writes the lane heartbeat at once, with the last activity', lane().intent === 'box-scale-tool' && typeof lane().lastActiveAt === 'number', lane())
  await engine.modelTool({ tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', __text: 'Result: Succeeded' })
  await engine.spawn({ agentId: 'w-guard', description: 'A2 worker', prompt: 'Implement A2.' })
  await run(engine, [], 'away', '4h')
  const refused = await run(engine, [], 'ather', 'untrack')
  expect('/ather untrack is refused while an away window runs', refused.out === 'End the away window first.' && pinned() === 'box-scale-tool', refused.out)
  await run(engine, [], 'away', 'end')
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })
  const untracked = await run(engine, [], 'ather', 'untrack')
  expect('/ather untrack stops tracking: the pin and "Continue …" go, the heartbeat says so at once, the proof stays with the intent', untracked.out === 'Stopped tracking box-scale-tool. Its proof so far stays with the intent.' && pinned() === undefined && scoped(engine, 'last', 'tinnguyen') === undefined && lane().intent === null && scoped(engine, 'evidence', 'box-scale-tool')?.build?.state === 'pass', [untracked.out, pinned(), lane().intent])
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
  expect('Work on this here tracks it and moves "Continue …" to it; the view then offers Stop tracking', pinned() === slug && scoped(engine, 'last', 'tinnguyen') === slug && Boolean(findKey(trackedTree, 'intent-untrack')) && !findKey(trackedTree, 'intent-work') && engine.record.toasts.includes(`Ather: Now tracking ${slug}.`), [pinned(), engine.record.toasts.slice(-2)])
  findKey(trackedTree, 'intent-untrack')?.props.onPress({})
  await engine.flush()
  const stoppedTree = await pane()
  expect('Stop tracking in the Intent view stops tracking, says the proof stays, and keeps the view on the intent with Work on this here', pinned() === undefined && scoped(engine, 'last', 'tinnguyen') === undefined && Boolean(findKey(stoppedTree, 'intent-work')) && new RegExp(`^I N T E N T\\n${slug}$`, 'm').test(check(stoppedTree, 72).lines.join('\n')) && engine.record.toasts.includes(`Ather: Stopped tracking ${slug}. Its proof so far stays with the intent.`), engine.record.toasts.slice(-2))
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
  pressKey(await pane(), 'all')
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
  engine.store.set(`evidence:${repoId('', root)}|fluid-snow-sand-look`, { build: { state: 'pass', detail: 'Result: Succeeded', at: now, by: '1a2b3c4d' } })
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
  const lensKey = scopedKey(engine, 'evidence', 'zz-web-lens') ?? ''
  const stored = engine.store.get(lensKey)
  engine.store.set(lensKey, Object.fromEntries(Object.entries(stored).map(([rung, value]) => [rung, { ...value, at: Date.now() - 3600000 }])))
  const stale = await engine.modelTool({ tool: 'Bash', command: 'gh pr merge 21 --squash' })
  expect("a merge on proof from before this session is held (D2: passed in this session's tool output)", typeof stale.deny === 'string' && /Merges/.test(stale.deny), stale.deny)
  expect('no hook threw in the web scenario', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  fs.rmSync(root, { recursive: true, force: true })
} else if (HANVIET_ROOT) {
  expect('HANVIET_ROOT names a han-viet checkout with .ather/profile.json', false, HANVIET_ROOT)
}

// ---------------------------------------------------------------- setting a repository up for intents
//
// A repository with a package.json and no docs/intent: /ather offers the setup, /ather setup hands the
// session one prompt naming the plugin's SETUP.md, the public repository and the pieces to add. The test
// then writes the pieces, standing in for the session. Nothing here is laid out: the layouts stay those of
// the blocks above.

{
  const { INTENT_REPOSITORY, SETUP_PIECES } = await import('./out/hooks/setup.mjs')
  const paths = SETUP_PIECES.map(one => one.path)
  const start = async root => {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true })
    fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n')
    const engine = createEngine({ root, surfaces: ['terminal'], user: 'Tin Nguyen' })
    engine.store.set('tz', tzFor(12))
    register(engine.on, { briefGate: 'warn' })
    await engine.start()
    await new Promise(resolve => setTimeout(resolve, 1500))
    engine.store.set('tz', tzFor(12))
    return engine
  }
  const put = (root, name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
  // The one prompt: it names the steps in the plugin's folder, the public repository, and which of the five target paths.
  const names = (sent, wanted) => sent.length === 1 && /templates\/intent-setup\/SETUP\.md/.test(sent[0]) && sent[0].includes(INTENT_REPOSITORY) && !/\.zip/.test(sent[0]) && paths.every(one => sent[0].includes(one) === wanted.includes(one))

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-setup-'))
  put(root, 'package.json', '{ "name": "new-here", "scripts": { "test": "node --test" } }\n')
  const engine = await start(root)
  const away = await run(engine, [], 'away', 'tonight')
  expect('setup: /away in a repository without intents asks nothing, sends nothing and says there are none here', away.dialogs.length === 0 && away.sent.length === 0 && /none here/.test(away.out) && !/\/ather setup/.test(away.out), away)
  const later = await run(engine, [pick('Not now')])
  expect('setup: /ather in a repository without intents asks one question, Set up intents here or Not now', later.dialogs.length === 1 && later.left === 0 && later.dialogs[0].options.map(option => option.label).join('|') === 'Set up intents here|Not now', dialogText(later.dialogs))
  expect('setup: "Not now" sends nothing and answers as /away does, with the command that sets up later', later.sent.length === 0 && later.filled.length === 0 && later.out.startsWith(away.out) && /\/ather setup/.test(later.out) && engine.record.opens.length === 0, later)
  const dismissed = await run(engine, [dismiss])
  expect('setup: the question dismissed sends nothing', dismissed.dialogs.length === 1 && dismissed.sent.length === 0 && dismissed.out === later.out, dismissed)
  const chosen = await run(engine, [pick('Set up intents here')])
  expect('setup: "Set up intents here" submits exactly one prompt, naming SETUP.md, the repository and the five target paths', chosen.dialogs.length === 1 && names(chosen.sent, paths), chosen)
  for (const word of ['setup', 'init']) {
    const typedOut = await run(engine, [], 'ather', word)
    expect(`setup: /ather ${word} asks nothing and submits exactly one prompt, naming SETUP.md, the repository and the five target paths`, typedOut.dialogs.length === 0 && names(typedOut.sent, paths) && paths.every(one => typedOut.out.includes(one)), typedOut)
  }
  expect('setup: the prompt names the web pack beside a package.json', / web\b/.test(chosen.sent[0] ?? '') && !/unreal/.test(chosen.sent[0] ?? ''), chosen.sent)

  // The session's writing, done here: the five pieces, with a profile whose gate no default names.
  const write = folder => {
    put(folder, '.agents/skills/intent/SKILL.md', '---\nname: intent\ndescription: Run a feature as an intent.\n---\n')
    put(folder, 'docs/intent/README.md', '# Intents\n\n## Areas\n\n- `app`: the app.\n- `api`: the server.\n')
    put(folder, '.ather/profile.json', JSON.stringify({ version: 1, pack: 'web', gates: [{ id: 'tests', command: 'npm run zz-proof', proofs: ['tests'], proves: 'the unit tests' }], mergePolicy: 'hold', areas: ['app', 'api'] }))
    put(folder, '.gitignore', 'node_modules/\n.ather/local/\n')
    put(folder, 'AGENTS.md', 'Features run as intents: read `.agents/skills/intent/SKILL.md`.\n')
  }
  // The areas the registered profile tool lets the model record.
  const toolAreas = one => one.record.toolSpecs.get('profile')?.inputSchema?.properties?.area?.enum ?? []
  const areasBefore = toolAreas(engine)
  write(root)
  const opened = await run(engine, [])
  expect('setup: with the five pieces written, /ather in the same session opens Home and asks no setup question', opened.dialogs.length === 0 && opened.sent.length === 0 && engine.record.opens.some(pane => pane.id === 'ather'), [opened, engine.record.opens])
  expect("setup: the profile tool is registered again with the new profile's areas (app, api), which it did not list before", toolAreas(engine).join(',') === 'app,api' && areasBefore.join(',') !== 'app,api' && engine.record.registeredTools.join(',') === 'status,away,profile,repos,status,away,profile,repos', [areasBefore, toolAreas(engine), engine.record.registeredTools])
  const tree = JSON.stringify(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), (key, value) => (typeof value === 'function' ? undefined : value))
  expect('setup: Home is drawn for the repository, with the tour as the next step', /tour/i.test(tree), tree.slice(0, 600))
  const role = await run(engine, [], 'ather', 'skip')
  expect("setup: the same session reads the new profile (the role question names the profile's gate)", role.dialogs.some(dialog => dialog.options.some(option => /npm run zz-proof/.test(option.description))), dialogText(role.dialogs))
  const again = await run(engine, [], 'ather', 'setup')
  expect('setup: with nothing missing, /ather setup submits nothing and reads the profile back (web, 1 gate, 2 areas)', again.sent.length === 0 && again.dialogs.length === 0 && /\bweb\b/.test(again.out) && /\b1 gate\b/.test(again.out) && /\b2 areas\b/.test(again.out), again)
  expect('no hook threw in the setup scenario', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  fs.rmSync(root, { recursive: true, force: true })

  // A repository that already runs intents, with its readme and no profile: only what is missing is named.
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-setup-'))
  put(partial, 'package.json', '{ "name": "runs-intents" }\n')
  put(partial, 'docs/intent/README.md', '# Intents\n\n## Areas\n\n- `app`: the app.\n')
  const second = await start(partial)
  const some = await run(second, [], 'ather', 'setup')
  expect('setup: where docs/intent/README.md is there and the profile is not, the prompt names .ather/profile.json and not the readme, and still the repository (the skill is missing too)', names(some.sent, paths.filter(one => one !== 'docs/intent/README.md')) && some.dialogs.length === 0, some)
  const home = await run(second, [])
  expect('setup: a repository that runs intents with pieces missing still opens Home on /ather, with no setup question', home.dialogs.length === 0 && home.sent.length === 0 && second.record.opens.some(pane => pane.id === 'ather'), [home, second.record.opens])
  expect('no hook threw in the partial setup scenario', second.record.hookErrors.length === 0, second.record.hookErrors)
  fs.rmSync(partial, { recursive: true, force: true })
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

{
  // 0.1.9: who waits on whom. Calls held in flight (a foreground Agent call, a long build, a wait on the Editor
  // lock), workers drawn under the worker that started them, and the quiet-worker toast on the same rule.
  const { engine, root, done } = await boot({ surfaces: ['terminal'], store: { 'role:tinnguyen': 'engineer' } })
  const findAll = (node, test) => (!node || typeof node !== 'object' ? [] : [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(child => findAll(child, test))])
  const keyed = (node, key) => findAll(node, one => one.props?.key === key)[0]
  const squash = text => text.replace(/ /g, '')
  const realNow = Date.now
  const at = minutes => {
    const base = realNow()
    Date.now = () => base + minutes * 60000
  }
  fs.writeFileSync(path.join(root, 'Saved/EDITOR_OWNER.txt'), 'Lane B holds the Editor until 15:40 for the snow proof\nsession 1a2b3c4d')
  const brief = 'Fix it in Source/S2/A.cpp. Acceptance: S2Editor builds. Shared tree: path-scoped staging only.'
  await engine.spawn({ agentId: 'w-lead', description: 'Thermo round 1 fixes', prompt: `Apply the thermo-nuclear review findings. ${brief}` })
  // The lead calls Agent in the foreground: the call stays in flight until its worker ends.
  const agentCall = engine.holdTool('w-lead', { tool: 'Agent', tool_use_id: 'agent-f1', description: 'F1 thermo fixes', prompt: `Fix finding F1. ${brief}`, subagent_type: 'general-purpose' })
  await agentCall.reached
  await engine.spawn({ agentId: 'w-f1', description: 'F1 thermo fixes', prompt: `Fix finding F1. ${brief}`, parentId: 'w-lead', toolUseId: 'agent-f1', background: false })
  const build = engine.holdTool('w-f1', { tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', description: 'Build S2Editor Development' })
  await build.reached
  // Four fixers the lead started earlier have finished: three are drawn under it, the fourth folds.
  for (const n of [2, 3, 4, 5]) {
    await engine.spawn({ agentId: `w-f${n}`, description: `F${n} thermo fixes`, prompt: `Fix finding F${n}. ${brief}`, parentId: 'w-lead' })
    await engine.agentTool(`w-f${n}`, { tool: 'Edit', file_path: 'Source/S2/A.cpp', old_string: 'a', new_string: 'b' })
    await engine.agentTurnEnd(`w-f${n}`)
    engine.setAgentStatus(`w-f${n}`, 'completed')
  }
  // A worker whose starter has finished, one waiting on the Editor lock, one that has gone quiet, one found running later.
  await engine.spawn({ agentId: 'w-gone', description: 'Snow proof planner', prompt: `Plan the snow proof. ${brief}` })
  await engine.spawn({ agentId: 'w-orphan', description: 'Snow proof runner', prompt: `Prove it in PIE. ${brief}`, parentId: 'w-gone' })
  await engine.agentTurnEnd('w-gone')
  engine.setAgentStatus('w-gone', 'completed')
  const lockWait = engine.holdTool('w-orphan', { tool: 'PowerShell', command: 'while ((Get-Content Saved/EDITOR_OWNER.txt) -notmatch "free") { Start-Sleep 30 }', description: 'Wait for the Editor lock' })
  await lockWait.reached
  await engine.spawn({ agentId: 'w-quiet', description: 'Says nothing', prompt: `Implement A2. ${brief}` })
  await engine.agentTool('w-quiet', { tool: 'Edit', file_path: 'Source/S2/B.cpp', old_string: 'a', new_string: 'b' })
  engine.addAgent({ id: 'w-adopted', description: 'Worker with no record' })
  engine.setAgentStatus('w-adopted', 'running')
  // A call whose permission dialog was shown to the person (classic.PermissionRequest): it waits on a decision, not running.
  await engine.spawn({ agentId: 'w-ask', description: 'Clean-up worker', prompt: `Implement A3. ${brief}` })
  const asking = engine.holdTool('w-ask', { tool: 'Bash', command: 'rm -rf Saved/Cache', description: 'Delete the old build cache' }, { dialog: true })
  await asking.reached
  // tool.check said "ask" but no dialog was shown (auto mode's classifier allowed it): it is running, not asking.
  await engine.spawn({ agentId: 'w-auto', description: 'Auto-approved worker', prompt: `Implement A4. ${brief}` })
  const approved = engine.holdTool('w-auto', { tool: 'Bash', command: 'Build.bat S2Editor Win64 Development', description: 'Long approved build' }, { ask: true })
  await approved.reached
  engine.record.toasts.length = 0
  let term = null
  let wide = ''
  let desk = null
  let toasts = []
  let stuck = ''
  try {
    at(11)
    term = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72)
    wide = check(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 110).lines.join('\n')
    desk = await engine.render('Pane', { bodyColumns: 70 }, 'ather', 'desktop')
    await engine.timers()
    toasts = [...engine.record.toasts]
    at(26)
    stuck = check(await engine.render('Pane', { bodyColumns: 72 }, 'ather'), 72).lines.join('\n')
  } finally {
    Date.now = realNow
  }
  const text = term.lines.join('\n')
  screens.push(['Terminal · the worker tree, calls in flight (72 columns)', text])
  screens.push(['Terminal · the worker tree, calls in flight (110 columns)', wide])
  const heading = term.lines.find(line => /^W O R K E R S|^WORKERS/.test(line)) ?? ''
  expect('A6: the heading reads "Workers · Running N · Waiting on M", waiting on counting the ⏳ lines', squash(heading) === 'WORKERS·RUNNING7·WAITINGON5' && (text.match(/⏳/g) ?? []).length === 5, heading)
  expect('round 3: tool.check said "ask" but no permission dialog was shown: the call reads as running (its own ⏳ line), never "asked permission", and raises no toast', /● Auto-approved worker\n  Builder · Opus · building\n  running 11:\d\d · 1 tool call\n  ⏳ Long approved build\n/.test(text) && !/asked permission[^\n]*Long approved build/.test(text) && !toasts.some(one => /Auto-approved worker/.test(one)), text)
  expect('round 2: a call waiting on the permission dialog reads "⏳ asked permission N min ago: <what>" (only what is known), not quiet; past 25 min it warns like any call, since an approved build may run on', /● Clean-up worker\n  Builder · Opus · working\n  running 11:\d\d · 1 tool call\n  ⏳ asked permission (just now|\d+ min ago): Delete the old build cache\n/.test(text) && /Delete the old build cache\n  ⚠ one call running \d+ min/.test(stuck), [text, stuck])
  expect('round 2: past the threshold the toast names the worker waiting on permission, and what for', toasts.some(one => /^Ather: worker "Clean-up worker" asked permission to run Bash \d+ min ago and has not finished: Delete the old build cache\.$/.test(one)) && toasts.length === 2, toasts)
  expect('A1, A4: a foreground Agent call in flight reads "⏳ waiting on <its worker>" under the worker that made it', /● Thermo round 1 fixes\n  Builder · Opus · [^\n]*\n  running 11:\d\d · 1 tool call\n  ⏳ waiting on F1 thermo fixes\n/.test(text), text)
  expect('A3: a worker is drawn under the one that started it, with no "started by" when that one is right above', /⏳ waiting on F1 thermo fixes\n└ ● F1 thermo fixes\n    Builder · Opus · building\n    running 11:\d\d · 1 tool call\n    ⏳ Build S2Editor Development\n/.test(text) && !/started by Thermo round 1 fixes/.test(text), text)
  expect('A3: past three finished workers under one parent, the rest fold to "+N finished"', (text.match(/└ ✓ F\d thermo fixes/g) ?? []).length === 3 && /\n└ \+1 finished\n/.test(text), text)
  expect('A3: a worker whose starter finished is a root that says "started by X (finished)"', /● Snow proof runner\n[^\n]*\n  running 11:\d\d · 1 tool call · started by Snow proof planner \(finished\)\n/.test(text), text)
  expect('A4: a long shell call that names the lock file quotes its description and the lock file\'s first line', /  ⏳ Wait for the Editor lock · Lane B holds the Editor until 15:40 for the…\n|  ⏳ Wait for the Editor lock · Lane B holds the Editor until 15:40 for the snow …\n/.test(text) || /⏳ Wait for the Editor lock · Lane B holds the Editor until 15:40 for the snow …/.test(wide), [text, wide])
  expect('A2: a worker with nothing in flight and nothing heard for minutes reads quiet; one in flight does not', /● Says nothing\n  Builder · Opus · quiet\n/.test(text) && !/F1 thermo fixes\n    Builder · Opus · quiet/.test(text), text)
  expect('A4: a worker found running later, with no call seen, shows no in-flight line', /● Worker with no record\n  General · working\n  running · start unknown\n(?!  ⏳)/.test(text), text)
  expect('A2: past ten minutes the stuck-permission toast names the quiet worker only, never one with a call in flight', toasts.some(one => /"Says nothing" has been quiet for 11 min after Edit\. Possibly a stuck permission prompt/.test(one)) && !toasts.some(one => /Thermo round 1 fixes|F1 thermo fixes|Snow proof runner/.test(one)), toasts)
  expect('A5: one call in flight 25 minutes or more says "⚠ one call running N min"', /⏳ Build S2Editor Development\n    ⚠ one call running 26 min\n/.test(stuck), stuck)
  expect('A3: the terminal tree lays out cleanly at 72 and 110 columns, keys and hotkeys unique', term.problems.length === 0 && check(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 110).problems.length === 0, term.problems)
  const nested = keyed(desk, 'tree-w-f1')
  expect('A3 (desktop): a child sits in an indented box under its parent with its own avatar; the fold line is indented too; no hotkeys', nested?.props.paddingLeft === 4 && findAll(nested, one => one.type === 'Svg').length === 1 && keyed(desk, 'fold-w-lead-finished')?.props.paddingLeft === 4 && !findAll(desk, one => one.type === 'Button' && one.props.hotkey).length && findAll(desk, one => one.type === 'Text' && one.props.children === '⏳ waiting on F1 thermo fixes' && one.props.color === '#f2a516').length === 1, nested?.props)
  // The calls settle: the build ran, the lead's worker ended and its Agent call returned; nothing waits any more.
  build.release()
  await build.done
  await engine.agentTurnEnd('w-f1')
  engine.setAgentStatus('w-f1', 'completed')
  agentCall.release()
  await agentCall.done
  lockWait.release()
  await lockWait.done
  asking.release()
  await asking.done
  approved.release()
  await approved.done
  // A refused call and a call that throws are cleared too.
  const refused = engine.holdTool('w-lead', { tool: 'Bash', command: 'npm run lint', description: 'Run the linter' })
  await refused.reached
  const failing = engine.holdTool('w-orphan', { tool: 'Monitor', command: 'tail -f S2.log', description: 'Watch the PIE log' })
  await failing.reached
  // A dispatch aborted (Esc) and a worker whose turn ended: their calls never settle, and are cleared anyway.
  const aborted = engine.holdTool('w-quiet', { tool: 'Bash', command: 'sleep 9999', description: 'A soak that is cut' })
  await aborted.reached
  const orphaned = engine.holdTool('w-ask', { tool: 'Bash', command: 'sleep 9999', description: 'A call left behind' })
  await orphaned.reached
  let held = ''
  let after = ''
  try {
    at(3)
    held = check(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 110).lines.join('\n')
    refused.deny()
    await refused.done
    failing.fail()
    await failing.done.catch(() => undefined)
    aborted.abort()
    await engine.agentTurnEnd('w-ask')
    after = check(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 110).lines.join('\n')
  } finally {
    Date.now = realNow
  }
  expect('A1: calls in flight are cleared when they run, are refused, throw, are aborted or their turn ends: the ⏳ lines go, and so does "Waiting on"', /⏳ Run the linter/.test(held) && /⏳ Watch the PIE log/.test(held) && /⏳ A soak that is cut/.test(held) && /⏳ A call left behind/.test(held) && !/⏳/.test(after) && !squash(after.split('\n').find(line => /^W O R K E R S|^WORKERS/.test(line)) ?? '').includes('WAITINGON'), [held, after])
  expect('no hook threw in the worker-tree scenario', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  done()
}

{
  // Round 2 (D7, D9): a search opens the sub-groups and the Parked block that hold its matches. A list of its own:
  // nine intents for one teammate (a sub-group that starts folded), one for another, one parked.
  const root = sandbox()
  fs.rmSync(path.join(root, 'docs/intent'), { recursive: true, force: true })
  const intentFile = (slug, owner, status = 'active') => {
    fs.mkdirSync(path.join(root, 'docs/intent', slug), { recursive: true })
    fs.writeFileSync(path.join(root, 'docs/intent', slug, 'prompt.md'), `# ${slug}\n\n- Status: ${status}\n- Area: Tools\n- Owner: ${owner}\n\n## Acceptance\n\n- A1: one\n- A2: two\n`)
  }
  for (const slug of ['alpha-one', 'beta-two', 'gamma-three', 'delta-four', 'epsilon-five', 'zeta-north', 'zeta-south', 'eta-eight', 'theta-nine']) intentFile(slug, 'HaiHuynhTA')
  intentFile('small-one', 'DuyTranSipher')
  intentFile('resting-quietly', 'LamPhung-Art', 'parked')
  const engine = createEngine({ root, surfaces: ['terminal'], user: 'Tin Nguyen' })
  engine.store.set('tz', tzFor(12))
  register(engine.on, { briefGate: 'warn' })
  await engine.start()
  await new Promise(resolve => setTimeout(resolve, 1500))
  await run(engine, [])
  const pane = () => engine.render('Pane', { bodyColumns: 72 }, 'ather')
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  const text = async () => check(await pane(), 72).lines.join('\n')
  findKey(await pane(), 'all')?.props.onPress()
  const opened = await text()
  expect('round 2: unsearched, the teammate with nine intents starts folded and the Parked block too', /\n▸ Hai Huynh · 9\n/.test(opened) && /\n▾ Duy Tran · 1\n\d: ● small-one/.test(opened) && /\n▸ ‖ Parked · 1\n/.test(opened) && !/zeta-north|resting-quietly/.test(opened), opened)
  const search = async words => {
    await searchField(pane, words)
    await engine.flush()
    return text()
  }
  const zeta = await search('zeta')
  screens.push(['Terminal · a search opens the folded sub-group holding its matches (72 columns)', zeta])
  expect('round 2: a search matching 2 of 9 in a folded sub-group opens it and shows both rows', /\n▾ Hai Huynh · 2 of 9\n\d: ● zeta-(north|south)[^\n]*\n\d: ● zeta-(north|south)/.test(zeta) && !/Duy Tran/.test(zeta), zeta)
  findKey(await pane(), 'sub-others-0-fold')?.props.onPress()
  expect('round 2: … and a press on its head still folds it', /\n▸ Hai Huynh · 2 of 9\n/.test(await text()) && !/zeta-north/.test(await text()), await text())
  const parked = await search('resting')
  expect('round 2: a search matching only a parked intent shows it in an open Parked block', /\n▾ ‖ Parked · 1 of 1\n\d: ‖ resting-quietly/.test(parked), parked)
  expect('no hook threw in the search-opens-groups scenario', engine.record.hookErrors.length === 0 && check(await pane(), 72).problems.length === 0, engine.record.hookErrors)
  fs.rmSync(root, { recursive: true, force: true })
}

// ---------------------------------------------------------------- the team's real state (0.1.5)

{
  // A real git checkout behind its origin: main has intents the working tree lacks. Commits are dated
  // days apart; the checkout's folders all carry one pull time.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-git-'))
  const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const at = days => new Date(Date.now() - days * 86400000).toISOString()
  const write = (dir, file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const commit = (dir, message, days, author = 'Tin Nguyen') => {
    git(dir, ['add', '-A'])
    git(dir, ['-c', `user.name=${author}`, '-c', 'user.email=a@b.c', 'commit', '-q', '-m', message], { GIT_AUTHOR_DATE: at(days), GIT_COMMITTER_DATE: at(days) })
  }
  const intentText = (title, fields, items = ['A1: one', 'A2: two']) => `# ${title}\n\n${Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Acceptance\n\n${items.map(item => `- ${item}`).join('\n')}\n`
  const verdicts = rows => `# Progress\n\n## Acceptance\n\n| Item | Verdict |\n| --- | --- |\n${rows.map(([id, verdict]) => `| ${id} | ${verdict} |`).join('\n')}\n`
  const origin = path.join(base, 'origin.git')
  const seed = path.join(base, 'seed')
  const root = path.join(base, 'S2')
  git(base, ['init', '-q', '--bare', '-b', 'main', origin])
  git(base, ['init', '-q', '-b', 'main', seed])
  git(seed, ['remote', 'add', 'origin', origin])
  write(seed, 'S2.uproject', '{}\n')
  write(seed, 'docs/intent/teammate-a/prompt.md', intentText('Teammate A', { Status: 'active', Area: 'Tools', Owner: 'LamPhung-Art' }, ['A1: one', 'A2: two', 'A3: three']))
  write(seed, 'docs/intent/teammate-a/progress.md', verdicts([['A1', 'met'], ['A2', 'open'], ['A3', 'open']]))
  commit(seed, 'teammate a', 3, 'LamPhung-Art')
  write(seed, 'docs/intent/teammate-b/prompt.md', intentText('Teammate B', { Status: 'active', Area: 'VFX', Owner: 'Cinematic' }))
  commit(seed, 'teammate b', 1, 'Cinematic')
  git(seed, ['push', '-q', 'origin', 'main'])
  git(base, ['clone', '-q', origin, root])
  // Newer work reaches main after this checkout last pulled.
  write(seed, 'docs/intent/ownerless/prompt.md', intentText('Ownerless', { Status: 'active', Area: 'Tools' }))
  write(seed, 'docs/intent/teammate-c/prompt.md', intentText('Teammate C', { Status: 'active', Area: 'Tools', Owner: 'DuyTranSipher' }))
  write(seed, 'docs/intent/teammate-d/prompt.md', intentText('Teammate D', { Status: 'parked', Area: 'VFX', Owner: 'TienDang-VFX' }))
  write(seed, 'docs/intent/mine-met/prompt.md', intentText('Mine, all met', { Status: 'active', Area: 'Tools', Owner: 'Tin Nguyen' }))
  write(seed, 'docs/intent/mine-met/progress.md', verdicts([['A1', 'met'], ['A2', 'met']]))
  write(seed, 'docs/intent/mine-parked/prompt.md', intentText('Mine, parked', { Status: 'parked', Area: 'Tools', Owner: 'Tin Nguyen' }))
  write(seed, 'docs/intent/quest-calls/prompt.md', intentText('Quest calls', { Status: 'active', Area: 'Tools', Owner: 'Tin Nguyen' }))
  write(seed, 'docs/intent/quest-calls/findings.md', `# Findings\n\n${[1, 2, 3, 4].map(n => `## F-${n} (2026-10-07) | blocking: yes | status: open (director)\n\nCall number ${n}: which way?\n`).join('\n')}`)
  commit(seed, 'newer intents', 0.1, 'trucnguyen')
  git(seed, ['push', '-q', 'origin', 'main'])
  // The checkout's own draft, never committed; and every folder it has carries the same pull time.
  write(root, 'docs/intent/local-draft/prompt.md', intentText('Local draft', { Status: 'active', Area: 'Tools', Owner: 'Tin Nguyen' }))
  write(root, 'Saved/EDITOR_OWNER.txt', 'free since 14:18')
  const pulled = new Date(Date.now() - 3600000)
  for (const dir of ['teammate-a', 'teammate-b', 'local-draft']) for (const file of fs.readdirSync(path.join(root, 'docs/intent', dir))) fs.utimesSync(path.join(root, 'docs/intent', dir, file), pulled, pulled)

  const engine = createEngine({ root, surfaces: ['terminal'], user: 'Tin Nguyen' })
  engine.store.set('tz', tzFor(12))
  register(engine.on, { briefGate: 'warn' })
  await engine.start()
  const until = async (test, ms = 15000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) if (await test()) return true
    return false
  }
  const fetches = () => engine.record.gitRuns.filter(one => one.argv.includes('fetch'))
  const pane = (cols = 72, surface = 'terminal') => engine.render('Pane', { bodyColumns: cols }, 'ather', surface)
  const text = async (cols = 72) => check(await pane(cols), cols).lines.join('\n')
  const findKey = (node, key) => (!node || typeof node !== 'object' ? null : node.props?.key === key ? node : (node.children ?? []).map(child => findKey(child, key)).find(Boolean) ?? null)
  await new Promise(resolve => setTimeout(resolve, 1500))
  // Before anything is drawn there is no fetch: the list is what origin/main held at the last pull.
  engine.setSurfaces([])
  const before = (await run(engine, [dismiss], 'ather', 'pick')).dialogs[0]?.options.map(one => one.label) ?? []
  engine.setSurfaces(['terminal'])
  expect('before the pane is drawn nothing is fetched, and the list is origin/main as last pulled plus the local draft', before.includes('teammate-a') && before.includes('local-draft') && !before.includes('mine-met') && fetches().length === 0, before)
  await run(engine, [])
  await pane()
  const synced = await until(async () => /synced just now ↻/.test(await text()))
  const home72 = await text()
  screens.push(["Terminal · Home from origin/main, a checkout behind it (72 columns)", home72])
  expect("the pane's first draw fetches origin's main in the background, and the list then holds main's open intents the checkout lacks (A1)", synced && fetches().length === 1 && /mine-met/.test(home72) && /quest-calls/.test(home72), home72)
  const [fetch] = fetches()
  expect('the fetch moves origin/main by an explicit refspec, no tags, no FETCH_HEAD, no submodules, no auto gc, with GIT_OPTIONAL_LOCKS=0 and no prompt (A3)', fetch?.argv.slice(3).join(' ') === '-c gc.auto=0 -c maintenance.auto=false fetch --no-tags --no-write-fetch-head --no-recurse-submodules origin +refs/heads/main:refs/remotes/origin/main' && fetch?.env.GIT_OPTIONAL_LOCKS === '0' && fetch?.env.GIT_TERMINAL_PROMPT === '0', fetch)
  expect('every git call Ather makes runs with GIT_OPTIONAL_LOCKS=0, and none writes the working tree or the index (A3, D2)', engine.record.gitRuns.filter(one => one.argv.join(' ') !== 'git config user.name').every(one => one.env.GIT_OPTIONAL_LOCKS === '0') && !engine.record.gitRuns.some(one => one.argv.some(arg => ['checkout', 'reset', 'stash', 'add', 'restore', 'switch', 'pull', 'merge', 'update-index'].includes(arg))), engine.record.gitRuns.map(one => one.argv.slice(3).join(' ')))
  // Reads run one at a time: three turn ends at once make at most two reads (the running one, then one more).
  const reads = () => engine.record.gitRuns.filter(one => one.argv.includes('--show-toplevel')).length
  const statuses = () => engine.record.gitRuns.filter(one => one.argv.includes('status')).length
  const [readsBefore, statusesBefore] = [reads(), statuses()]
  await Promise.all([engine.turnEnd(), engine.turnEnd(), engine.turnEnd()])
  await until(async () => false, 1500)
  expect('reads run one at a time: three turn ends at once make at most two reads, and with nothing changed none asks git status again (D2)', reads() - readsBefore <= 2 && reads() > readsBefore && statuses() === statusesBefore, [reads() - readsBefore, statuses() - statusesBefore])
  const logs = engine.record.gitRuns.filter(one => one.argv.includes('log') && !one.argv.some(arg => arg.includes('..')))
  expect('dates come from one batched git log for all of docs/intent, never one per intent (A2)', logs.length >= 1 && logs.every(one => one.argv.at(-1) === 'docs/intent' && !one.argv.some(arg => /docs\/intent\/./.test(arg))), logs.map(one => one.argv.slice(3).join(' ')))
  expect('the status line ends in "synced N min ago ↻" in the terminal, f fetches now (A4)', /\nf: synced just now ↻\n/.test(home72) || /f: synced just now ↻$/m.test(home72), home72.split('\n').slice(0, 3))
  const teamRows = /T E A M M A T E S '   I N T E N T S   ·   5\nRead-only[^\n]*\n((?:[a-z]: [●◐✓‖][^\n]*\n){4})i: \+1 more ›/.exec(home72)
  expect("Home previews four teammates' intents, then \"+1 more ›\" (A8)", Boolean(teamRows) && check(await pane(), 72).problems.length === 0, home72)
  const deskHome = await pane(110, 'desktop')
  expect('… on the desktop too: four rows with their column boxes, then "+1 more ›", no keys drawn (A8)', findKey(deskHome, 'all')?.props.label === '+1 more ›' && ['teammate-a', 'teammate-b', 'teammate-c', 'teammate-d', 'ownerless'].filter(slug => findKey(deskHome, `work-intent:${slug}-cols`)).length === 4 && !findKey(deskHome, 'all')?.props.hotkey, findKey(deskHome, 'all')?.props)
  // A teammate's parked intent warns on its row, but asks nothing of the person.
  expect("a teammate's parked intent without a reason warns on its own row and is not in the person's Needs attention (D5, D7)", /teammate-d ⚠ parked, no reason/.test(await text(110)) && !/teammate-d · parked, no reason/.test(await text(110)), await text(110))
  // Needs you: an intent's four decisions wait as one row that opens them (A9).
  expect('four decisions on one intent wait as one block, "quest-calls · 4 decisions" (A9)', /◆ \d: ▸ quest-calls · 4 decisions/.test(home72) && !/Decide F-1 on quest-calls/.test(home72), home72)
  findKey(await pane(), 'calls-quest-calls')?.props.onPress()
  const opened = await text()
  expect('… and pressing it opens the four, each its own press', /▾ quest-calls · 4 decisions/.test(opened) && (opened.match(/· \d: F-\d · Call number \d/g) ?? []).length === 4, opened)
  findKey(await pane(), 'calls-quest-calls')?.props.onPress()
  // Needs attention: the person's own all-met and parked-without-reason intents, above Next (A6).
  const attention = home72.indexOf('N E E D S   A T T E N T I O N')
  expect("Needs attention lists the person's own all-met and parked-without-reason intents, above Next (A6)", attention > 0 && attention < home72.indexOf('N E X T') && /✓ \d: mine-met · ready to close · Close it\?/.test(home72) && /‖ \d: mine-parked · parked, no reason · Add one\?/.test(home72) && !/teammate-a · ready to close/.test(home72), home72)
  findKey(await pane(), 'attention:mine-met')?.props.onPress()
  const view = await text()
  expect('… each opens its intent, and nothing is done for them', /^I N T E N T\nmine-met$/m.test(view) && engine.record.submits.length === 0, view.split('\n').slice(0, 3))
  pressIn(await pane(), 'Back')
  // Lime only on what needs the person (A9).
  const limes = []
  const walkLime = (node, trail) => {
    if (!node || typeof node !== 'object') return
    const here = node.props?.key ? [...trail, node.props.key] : trail
    if (node.props?.color === '#DDFF00' || node.props?.borderColor === '#DDFF00') limes.push(here)
    for (const child of node.children ?? []) walkLime(child, here)
  }
  walkLime(await pane(), [])
  expect('lime only on Needs you, Needs attention and Next (A9)', limes.length > 0 && limes.every(trail => trail.some(key => ['needs', 'attention', 'next-section', 'strip'].includes(key))), limes.map(trail => trail.join('>')))
  // Everything open: sources, commit ages, tidied owners, one row anatomy.
  findKey(await pane(), 'all')?.props.onPress()
  const all110 = await text(110)
  const all72 = await text(72)
  screens.push(['Terminal · Everything open from origin/main (110 columns)', all110])
  screens.push(['Terminal · Everything open from origin/main (72 columns)', all72])
  const ageOf = slug => new RegExp(`${slug}\\b[^\\n]*?\\s(\\d+[mhd])\\s`).exec(all110)?.[1]
  expect("folders with the same file times get their own ages from their commits: 3d and 1d, not the pull's 1h (A2)", ageOf('teammate-a') === '3d' && ageOf('teammate-b') === '1d', [ageOf('teammate-a'), ageOf('teammate-b')])
  expect("each row records its source: the checkout's own draft is tagged local, main's are not (A1, D1)", /local-draft local/.test(all110) && !/teammate-a local/.test(all110), all110)
  expect('owners tidied: LamPhung-Art is Lam Phung, Cinematic is "Tien Dang · Cinematic", the ownerless intent shows its first committer (A7)', /teammate-a[^\n]*Lam Phung/.test(all110) && /teammate-b[^\n]*Tien Dang · Cinematic/.test(all110) && /ownerless[^\n]*Truc Nguyen/.test(all110), all110)
  for (const [cols, drawn] of [[72, all72], [110, all110]]) {
    const rows = drawn.split('\n').filter(line => /^\d: [●◐✓‖]/.test(line))
    const counts = rows.map(line => /\d+\/\d+/.exec(line)).map(match => (match ? match.index + match[0].length : -1))
    expect(`one anatomy @${cols}: every intent row as wide as the pane, its count column ending at one place, a mini bar beside it (A8)`, rows.length >= 6 && rows.every(line => line.length === cols && /[▰▱]{5}/.test(line)) && new Set(counts).size === 1, rows)
  }
  // 0.1.9: the teammates' intents grouped by Person when the list opens; each group's parked intents folded at its end.
  const byPerson = await text(72)
  screens.push(['Terminal · Everything open grouped by Person, parked folded (72 columns)', byPerson])
  expect("A7: Everything open groups the teammates' intents by Person when it opens: foldable sub-heads with counts, tidied names, a team with its lead", /▾ T E A M M A T E S ' {3}I N T E N T S {3}· {3}5\n▾ Duy Tran · 1\n\d: ● teammate-c[^\n]*\n▾ Lam Phung · 1\n\d: ● teammate-a[^\n]*\n▾ Tien Dang · Cinematic · 1\n\d: ● teammate-b[^\n]*\n▾ Truc Nguyen · 1\n\d: ● ownerless[^\n]*\n▸ ‖ Parked · 1\n/.test(byPerson) && /g: Group: Person/.test(byPerson), byPerson)
  expect('A8: parked intents fold into "‖ Parked · N" at the end of each top group, yours and teammates\'', /Y O U R {3}I N T E N T S[^\n]*\n(?:\d: [●◐✓][^\n]*\n)+▸ ‖ Parked · 1\n/.test(byPerson) && !/mine-parked|teammate-d/.test(byPerson), byPerson)
  findKey(await pane(), 'park-others-fold')?.props.onPress()
  expect('A8: unfolded, a parked intent with no reason keeps its ⚠ on its row inside', /▾ ‖ Parked · 1\n\d: ‖ teammate-d ⚠ parked, no reason/.test(await text(72)), await text(72))
  findKey(await pane(), 'park-others-fold')?.props.onPress()
  const groupings = []
  for (let turn = 0; turn < 4; turn += 1) {
    findKey(await pane(), 'pick-group')?.props.onPress()
    groupings.push(await text(72))
  }
  expect('A7: Group cycles Person → Area → Stage → None → Person: area and stage sub-heads with counts, None draws the rows under the group head', /g: Group: Area/.test(groupings[0]) && /\n▾ Tools · 3\n/.test(groupings[0]) && /\n▾ VFX · 1\n/.test(groupings[0]) && /g: Group: Stage/.test(groupings[1]) && /\n▾ Building · 4\n/.test(groupings[1]) && /g: Group: None/.test(groupings[2]) && /I N T E N T S {3}· {3}5\n\d: ●/.test(groupings[2]) && /g: Group: Person/.test(groupings[3]), groupings.map(one => one.split('\n').filter(line => /^[▸▾]|Group/.test(line)).join(' | ')))
  const deskGroup = findKey(await pane(110, 'desktop'), 'pick-group')
  expect('A7: on the desktop Group is a visible button with no key drawn', deskGroup?.type === 'Button' && deskGroup.props.label === 'Group: Person' && deskGroup.props.hotkey === undefined, deskGroup?.props)
  expect('A7: the Group key g is unique on the pick view, and Home has no Group button', check(await pane(72), 72).problems.length === 0 && (findKey(await pane(), 'pick-back')?.props.onPress(), !findKey(await pane(), 'pick-group')), check(await pane(72), 72).problems)
  findKey(await pane(), 'all')?.props.onPress()
  await searchField(pane, 'teammate')
  await engine.flush()
  const searchedGroups = await text(72)
  screens.push(['Terminal · Everything open searched, heads show x of y (72 columns)', searchedGroups])
  expect('A9: while a search is active, the group and sub-group heads say "x of y"', /T E A M M A T E S ' {3}I N T E N T S {3}· {3}4 {3}O F {3}5\n/.test(searchedGroups) && /\n▾ Duy Tran · 1 of 1\n/.test(searchedGroups) && /\n▾ ‖ Parked · 1 of 1\n/.test(searchedGroups) && !/Y O U R {3}I N T E N T S/.test(searchedGroups), searchedGroups)
  findKey(await pane(), 'pick-search-clear')?.props.onPress()
  // The desktop: the same columns as fixed-width boxes, no keys drawn, the sync line a press.
  const desk = await pane(110, 'desktop')
  // The bar is an SVG of fixed pixels (glyphs took the font's widths and spilled into the count); the other columns are boxes.
  const barWidth = slug => findKey(desk, `pick-intent:${slug}-bar`)?.children.find(child => child?.type === 'Svg')?.props.width
  const colBoxes = slug => [barWidth(slug), ...['count', 'age', 'owner'].map(name => findKey(desk, `pick-intent:${slug}-${name}`)?.props.width)]
  expect('on the desktop every row has the same columns (an SVG bar, then count, age, owner boxes) of the same widths, and no hotkeys (A8)', JSON.stringify(colBoxes('teammate-a')) === JSON.stringify(colBoxes('mine-met')) && colBoxes('teammate-a').every(width => width > 0) && !findKey(desk, 'pick-intent:teammate-a')?.props.hotkey, [colBoxes('teammate-a'), colBoxes('mine-met')])
  const deskSync = findKey(desk, 'sync')
  expect('on the desktop the sync line is a press with no key drawn (A4)', /^synced just now ↻$/.test(deskSync?.props.label ?? '') && deskSync?.props.hotkey === undefined, deskSync?.props)
  // ↻ fetches now, one at a time; the timer fetches at most every ten minutes (A3, A4).
  write(seed, 'docs/intent/late-one/prompt.md', intentText('Late one', { Status: 'active', Area: 'Tools', Owner: 'HaiHuynhTA' }))
  commit(seed, 'late one', 0, 'HaiHuynhTA')
  git(seed, ['push', '-q', 'origin', 'main'])
  await engine.timers()
  expect('the minute timer does not fetch again within ten minutes', fetches().length === 1, fetches().length)
  deskSync?.props.onPress()
  deskSync?.props.onPress()
  await until(async () => /late-one/.test(await text(110)))
  expect('↻ fetches now, and two quick presses make one fetch; the new intent shows (A4)', fetches().length === 2 && /late-one/.test(await text(110)), fetches().length)
  // An intent only on origin/main can't be worked on here, but can be asked about: the session reads it from main.
  findKey(await pane(110, 'desktop'), 'pick-intent:late-one')?.props.onPress({})
  const lateView = await pane(110, 'desktop')
  expect('an intent only on origin/main offers Ask about it (primary), no Work on this here, and says why', findKey(lateView, 'intent-ask')?.props.variant === 'primary' && !findKey(lateView, 'intent-work') && /pull main to work on it here/.test(JSON.stringify(lateView)), findKey(lateView, 'intent-actions'))
  const asked = engine.record.submits.length
  findKey(lateView, 'intent-ask')?.props.onPress({})
  await engine.flush()
  const askText = engine.record.submits.slice(asked).join('\n')
  // The section around Back shares its key: the press is on the Button inside.
  const backBox = findKey(await pane(110, 'desktop'), 'intent-back')
  const backTo = backBox?.type === 'Button' ? backBox : backBox?.children.find(child => child?.type === 'Button')
  expect('the intent view has its Back press', typeof backTo?.props.onPress === 'function', backTo)
  backTo?.props.onPress?.({})
  expect('Ask about it hands the session a read-only look at the intent on origin/main: its files by git show, its recent history, no fetch, pull, checkout or tracking', askText.includes('git show origin/main:docs/intent/late-one/<file>') && askText.includes('origin/main -- docs/intent/late-one') && askText.includes('Do not fetch, pull, check out, track it or write anything'), askText)
  // A failing fetch keeps the list and says so.
  git(root, ['remote', 'set-url', 'origin', path.join(base, 'gone.git')])
  findKey(await pane(), 'sync')?.props.onPress()
  await until(async () => /sync failed/.test(await text()))
  const failed = await text(110)
  expect('a failed fetch keeps every row and the sync line says so (A3)', /sync failed · synced (just now|\d+ min ago) ↻/.test(failed) && /teammate-a/.test(failed) && /late-one/.test(failed) && fetches().length === 3, failed.split('\n').slice(0, 3))
  const realNow = Date.now
  Date.now = () => realNow() + 11 * 60000
  try {
    await engine.timers()
    await until(async () => fetches().length === 4, 5000)
  } finally {
    Date.now = realNow
  }
  await until(async () => !/syncing…/.test(await text()), 5000)
  expect('after ten minutes the timer fetches again on its own', fetches().length === 4, fetches().length)
  // A7: the Group choice is the person's, kept across a reload (a new session on the same store); folds are not.
  if (!findKey(await pane(), 'pick-group')) findKey(await pane(), 'all')?.props.onPress()
  findKey(await pane(), 'pick-group')?.props.onPress()
  await until(async () => engine.store.get('groupBy:tinnguyen') === 'area', 3000)
  const reloaded = createEngine({ root, surfaces: ['terminal'], user: 'Tin Nguyen' })
  for (const [key, value] of engine.store) reloaded.store.set(key, value)
  register(reloaded.on, { briefGate: 'warn' })
  await reloaded.start()
  await run(reloaded, [])
  findKey(await reloaded.render('Pane', { bodyColumns: 72 }, 'ather'), 'all')?.props.onPress()
  const afterReload = check(await reloaded.render('Pane', { bodyColumns: 72 }, 'ather'), 72).lines.join('\n')
  expect('A7: the Group choice is remembered across a reload, read from the store (Area here)', engine.store.get('groupBy:tinnguyen') === 'area' && /g: Group: Area/.test(afterReload) && /\n▾ Tools · \d+\n/.test(afterReload), afterReload.split('\n').filter(line => /Group|^[▸▾]/.test(line)))
  expect('no hook threw on the git checkout', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  fs.rmSync(base, { recursive: true, force: true })
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
