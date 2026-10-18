// End-to-end run of the Ather Automata hooks module over several real git checkouts: an S2
// checkout and a web checkout side by side, each with a local bare origin, some with worktrees,
// driven through the stand-in engine. Needs no S2_ROOT. `node repos.mjs [report.md]`.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { aborts, createEngine } from './engine.mjs'
import { byKey, checks, join, nodesOf, sandbox } from './harness.mjs'

const OUT = process.argv[2]
const { register } = await import('./out/hooks/ather.mjs')

const BASE = sandbox('ather-checkouts-')
const { expect, finish } = checks()

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// One checkout at <parent>/<folder>: `git init`, the files given, one commit on main pushed to a bare
// origin at <parent>-origins/<owner>/<name>.git (so the repository is named owner/name), then `branch` checked out.
const makeCheckout = (parent, folder, { owner, name, files = {}, branch = 'main' }) => {
  const root = join(parent, folder)
  // The origin as the system writes a folder (backslashes on Windows): the repository is named owner/name either way.
  const origin = path.join(`${parent}-origins`, owner, `${name}.git`)
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '--bare', '-q', '-b', 'main')
  fs.mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Tin Nguyen')
  git(root, 'config', 'user.email', 'tin@example.com')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(join(root, file)), { recursive: true })
    fs.writeFileSync(join(root, file), text)
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'start')
  git(root, 'remote', 'add', 'origin', origin)
  git(root, 'push', '-q', 'origin', 'main')
  if (branch !== 'main') git(root, 'checkout', '-q', '-b', branch)
  return root
}

// Someone else pushes a commit to a checkout's origin: its origin/main is behind until it fetches. Resolves the new sha.
const advanceOrigin = root => {
  const origin = git(root, 'remote', 'get-url', 'origin')
  const other = fs.mkdtempSync(join(BASE, 'other-'))
  git(other, 'clone', '-q', origin, '.')
  git(other, '-c', 'user.name=Lam Phung', '-c', 'user.email=lam@example.com', 'commit', '-q', '--allow-empty', '-m', 'teammate')
  git(other, 'push', '-q', 'origin', 'main')
  return git(other, 'rev-parse', 'HEAD')
}

// docs/intent with a file in it, so git keeps the folder.
const INTENTS = { 'docs/intent/README.md': '# Intents\n' }
const WEB_PROFILE = { version: 1, pack: 'web', gates: [{ id: 'test', command: 'npm test', proofs: ['tests'] }], mergePolicy: 'with-proof', required: ['tests'] }

// A parent folder with s2/ (Unreal, on a feature branch) and web/ (web profile, on main).
const makeWorkspace = () => {
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const s2 = makeCheckout(parent, 's2', { owner: 'sipher', name: 's2', branch: 'feat/x', files: { ...INTENTS, 'S2.uproject': '{}\n' } })
  const web = makeCheckout(parent, 'web', {
    owner: 'AskTinNguyen',
    name: 'web',
    files: { ...INTENTS, 'package.json': `${JSON.stringify({ name: 'web', scripts: { test: 'node --test' } }, null, 2)}\n`, '.ather/profile.json': `${JSON.stringify(WEB_PROFILE, null, 2)}\n` },
  })
  return { parent, s2, web }
}

// A worktree of `root` at <its parent>/<folder>, on a new branch of that name.
const addTree = (root, folder) => {
  const tree = join(path.dirname(root), folder)
  git(root, 'worktree', 'add', '-q', '-b', folder, tree)
  return tree
}

// A session opened in `root`, started as the app starts it.
const boot = async ({ root, sessionId = 'harness-session-0001', user = 'Tin Nguyen', writable, ghAt, kept, cwd }) => {
  const engine = createEngine({ root, surfaces: [], user, writable, ghAt, kept })
  engine.setSessionId(sessionId)
  register(engine.on, { briefGate: 'warn' })
  await engine.start(true, cwd)
  // The timezone probe and the workspace read run in the background.
  await new Promise(resolve => setTimeout(resolve, 500))
  return { engine, sessionId }
}

// The model runs a shell command; `text` is what it printed.
const bash = (engine, command, text) => engine.modelTool({ tool: 'Bash', command, ...(text === undefined ? {} : { __text: text }) })
const startAway = engine => engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'start', hours: 2, goal: 'nap' })
const parked = (engine, sid) => engine.store.get(`away:${sid}`)?.parked ?? []

// A checkout's id as the store keys hold it: its repository's id and its folder, lowercased.
const checkoutId = (repo, root) => `${repo}@${root.toLowerCase()}`

const NODE_TEST_PASS = fs.readFileSync(new URL('../../ather-automata/tests/fixtures/web/node-test-pass.txt', import.meta.url), 'utf8')

// ---------------------------------------------------------------- commands and proof by checkout

{
  const { s2, web } = makeWorkspace()
  const { engine, sessionId: sid } = await boot({ root: s2 })
  await startAway(engine)
  expect('the away window runs', engine.store.get(`away:${sid}`)?.phase === 'running', engine.store.get(`away:${sid}`))

  const deploy = await bash(engine, 'cd ../web && vercel --prod')
  expect("a production deploy in ../web is held by web's defaults, though the session's Unreal window does not list it", deploy.deny !== undefined && parked(engine, sid).some(one => one.kind === 'deploy-prod' && one.command === 'cd ../web && vercel --prod'), { deny: deploy.deny, parked: parked(engine, sid) })
  const ownDeploy = await bash(engine, 'vercel --prod')
  expect('the same deploy in the Unreal checkout itself is not held (as before)', ownDeploy.deny === undefined, ownDeploy.deny)

  const pushMain = await bash(engine, 'git -C ../web push origin main')
  expect('git -C ../web push origin main is held as a push to main', pushMain.deny !== undefined && parked(engine, sid).at(-1)?.kind === 'push-main', parked(engine, sid).at(-1))
  const barePush = await bash(engine, 'git -C ../web push')
  expect("a bare push in ../web is judged on web's branch (main): held", barePush.deny !== undefined && parked(engine, sid).at(-1)?.command === 'git -C ../web push', parked(engine, sid).at(-1))
  const ownPush = await bash(engine, 'git push')
  expect("a bare push in s2 is judged on s2's branch (feat/x): allowed", ownPush.deny === undefined, ownPush.deny)

  const before = await bash(engine, 'cd ../web && gh pr merge 3')
  expect("a with-proof merge in ../web is held before web's proof", before.deny !== undefined && parked(engine, sid).at(-1)?.kind === 'merge', parked(engine, sid).at(-1))

  await bash(engine, 'cd ../web && npm test', NODE_TEST_PASS)
  const webScope = engine.store.get(`evidence:${sid}|${checkoutId('asktinnguyen/web', web)}`)
  expect("a passing npm test in ../web records tests under <sid>|<web's checkout id>", webScope?.tests?.state === 'pass', webScope)
  expect("nothing lands in the session's own scope", engine.store.get(`evidence:${sid}`) === undefined, engine.store.get(`evidence:${sid}`))

  const after = await bash(engine, 'cd ../web && gh pr merge 3')
  expect("the merge in ../web is allowed after web's proof in this session", after.deny === undefined, after.deny)
  const ownMerge = await bash(engine, 'gh pr merge 4')
  expect("web's proof does not free a merge in the Unreal checkout", ownMerge.deny !== undefined, ownMerge.deny)

  // One checkout as before: a build run in s2 itself is the session's proof.
  await bash(engine, 'Build.bat S2Editor Win64 Development', 'Result: Succeeded')
  expect("a build in s2 itself lands in the session's scope", engine.store.get(`evidence:${sid}`)?.build?.state === 'pass', engine.store.get(`evidence:${sid}`))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
}

// ---------------------------------------------------------------- one checkout, as before

{
  const { web } = makeWorkspace()
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0002' })
  await bash(engine, 'npm test', NODE_TEST_PASS)
  expect("a session in web/ itself: npm test lands in the session's scope", engine.store.get(`evidence:${sid}`)?.tests?.state === 'pass', engine.store.get(`evidence:${sid}`))
  expect('and in no other scope', JSON.stringify([...engine.store.keys()].filter(key => key.startsWith('evidence:'))) === JSON.stringify([`evidence:${sid}`]), [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
}

// ---------------------------------------------------------------- two gates on one rung

{
  const parent = fs.mkdtempSync(join(BASE, 'gates-'))
  const profile = { ...WEB_PROFILE, gates: [...WEB_PROFILE.gates, { id: 'lint', command: 'npm run lint', proofs: ['lint'] }, { id: 'typecheck', command: 'npm run typecheck', proofs: ['lint'] }], required: ['tests', 'lint'] }
  const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: { ...INTENTS, '.ather/profile.json': `${JSON.stringify(profile, null, 2)}\n` } })
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0046' })
  const lint = () => engine.store.get(`evidence:${sid}`)?.lint
  await startAway(engine)
  await bash(engine, 'npm test', NODE_TEST_PASS)
  await engine.modelTool({ tool: 'Bash', command: 'npm run typecheck', __text: 'src/a.ts(1,1): error TS2322: wrong\nFound 1 error.', __isError: true })
  await bash(engine, 'npm run lint')
  const failed = await bash(engine, 'gh pr merge 3')
  expect("a lint gate that passed after the rung's other gate failed leaves lint failed", lint()?.state === 'fail', lint())
  expect('and the with-proof merge is held', failed.deny !== undefined && parked(engine, sid).at(-1)?.kind === 'merge', failed.deny)
  await bash(engine, 'npm run typecheck')
  const proven = await bash(engine, 'gh pr merge 3')
  expect('with both lint gates and the tests passed in this session, the merge goes through', lint()?.state === 'pass' && proven.deny === undefined, [lint(), proven.deny])
  const record = engine.store.get(`evidence:${sid}`)
  if (record?.lint?.gates?.lint) record.lint.gates.lint.at = Date.now() - 60 * 60 * 1000
  const stale = await bash(engine, 'gh pr merge 3')
  expect('a gate that passed before this session does not prove the merge, though the other passed in it', stale.deny !== undefined, [record?.lint, stale.deny])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- a gate that passes on its exit code

for (const [index, [name, command]] of [['go', 'go test ./...'], ['cargo', 'cargo test']].entries()) {
  const output = kind => fs.readFileSync(new URL(`../../ather-automata/tests/fixtures/web/${name}-test-${kind}.txt`, import.meta.url), 'utf8')
  const parent = fs.mkdtempSync(join(BASE, 'exit-'))
  const profile = { version: 1, pack: 'web', gates: [{ id: 'tests', command, proofs: ['tests'], passOn: 'exit' }], mergePolicy: 'with-proof' }
  const repo = makeCheckout(parent, name, { owner: 'AskTinNguyen', name, files: { ...INTENTS, '.ather/profile.json': `${JSON.stringify(profile, null, 2)}\n` } })
  const { engine, sessionId: sid } = await boot({ root: repo, sessionId: `harness-session-00${47 + index}` })
  const tests = () => engine.store.get(`evidence:${sid}`)?.tests
  await startAway(engine)
  await engine.modelTool({ tool: 'Bash', command, __text: output('fail'), __isError: true })
  const failed = await bash(engine, 'gh pr merge 3')
  expect(`${command}, a gate that passes on exit: the failing run fails tests`, tests()?.state === 'fail', tests())
  expect('and the with-proof merge is held', failed.deny !== undefined && parked(engine, sid).at(-1)?.kind === 'merge', failed.deny)
  await bash(engine, command, output('pass'))
  const proven = await bash(engine, 'gh pr merge 3')
  expect(`${command}: the passing run, which prints no counts the pack reads, passes tests and the merge goes through`, tests()?.state === 'pass' && proven.deny === undefined, [tests(), proven.deny])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- an intent tracked in another checkout

const LOGIN = '# Login\n\n- Rev: 1\n- Status: active\n- Area: Web\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- [x] A1: the form posts.\n- [ ] A2: errors show.\n'
const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

{
  const { parent, s2, web } = makeWorkspace()
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0003', writable: [parent] })
  await engine.modelTool({ tool: 'Write', file_path: '../web/docs/intent/login/prompt.md', content: LOGIN })
  await engine.flush()
  expect("a main-conversation write of ../web/docs/intent/login/prompt.md tracks login in web's checkout", JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: web }), engine.store.get(`pinned:${sid}`))

  const status = JSON.parse((await engine.modelTool({ tool: 'mcp__ather-automata__status' })).result)
  expect("the status tool names login with web's files", status.tracked?.slug === 'login' && status.tracked.checkout === web && status.tracked.checklist === '1/2', status.tracked)
  expect("… and the gates that prove it are web's, though the session is in s2", status.pack === 'web' && status.mergePolicy === 'with-proof' && status.gates.some(gate => gate.startsWith('npm test')), [status.pack, status.gates, status.mergePolicy])

  // web is not in this session's workspace (s2 is a checkout, web is beside it): its view still draws.
  engine.setSurfaces(['terminal'])
  await engine.modelTool({ tool: 'Edit', file_path: '../web/docs/intent/login/prompt.md', old_string: '- [ ] A2', new_string: '- [x] A2' })
  await engine.flush()
  const flat = node => (!node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(flat)])
  const band = await engine.render('AbovePrompt', {}, 'band')
  flat(band).find(node => node.props?.key === 'ather-intent-see')?.props.onPress()
  await engine.flush()
  const view = flat(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  const title = view.find(node => node.props?.key === 'title')
  expect("the tracked intent's view draws from web's files, though web is not one of the pane's checkouts", title && /web\/login/.test(title.children.join('')) && view.some(node => node.props?.key === 'intent-untrack'), title?.children)

  await bash(engine, 'cd ../web && npm test', NODE_TEST_PASS)
  const loginProof = `evidence:${checkoutId('asktinnguyen/web', web)}|login`
  expect("npm test passing in web proves the intent: evidence:<web's checkout id>|login", engine.store.get(loginProof)?.tests?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
  expect("and not the session's proof in web", ![...engine.store.keys()].some(key => key.startsWith(`evidence:${sid}|`)), [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
  await bash(engine, 'Build.bat S2Editor Win64 Development', 'Result: Succeeded')
  expect("a build in s2 itself lands in the session's scope, not the intent's", engine.store.get(`evidence:${sid}`)?.build?.state === 'pass' && engine.store.get(loginProof)?.build?.state !== 'pass', engine.store.get(`evidence:${sid}`))

  await startAway(engine)
  const ledger = engine.store.get(`away:${sid}`)?.ledgerPath
  expect("the owner's away ledger is web/docs/intent/login/decisions.md", ledger === `${web}/docs/intent/login/decisions.md` && fs.existsSync(ledger), ledger)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })

  await engine.timers()
  const ownBeat = readJson(join(s2, 'Saved/AtherAutomata/lanes', `${sid}.json`))
  const webBeat = readJson(join(web, '.ather/local/lanes', `${sid}.json`))
  expect("the heartbeat is in s2's lanes and in web's, naming login", ownBeat?.intent === 'login' && webBeat?.intent === 'login' && webBeat.branch === 'main' && ownBeat.branch === 'feat/x', { ownBeat, webBeat })

  await engine.command('ather', 'untrack')
  expect('/ather untrack clears it', !engine.store.has(`pinned:${sid}`), engine.store.get(`pinned:${sid}`))
  expect("and web's Continue", ![...engine.store.keys()].some(key => key.startsWith('last:')), [...engine.store.keys()].filter(key => key.startsWith('last:')))

  // The stop is web's: a write into web's login does not track it again, a new login in s2 does.
  await engine.modelTool({ tool: 'Write', file_path: '../web/docs/intent/login/log.md', content: '# Log\n' })
  await engine.flush()
  expect("a write into web's login after the stop does not track it again", !engine.store.has(`pinned:${sid}`), engine.store.get(`pinned:${sid}`))
  await engine.modelTool({ tool: 'Write', file_path: 'docs/intent/login/prompt.md', content: LOGIN })
  await engine.flush()
  expect("a new login in s2 is tracked: web's stop does not stop it", engine.store.get(`pinned:${sid}`) === 'login', [engine.store.get(`pinned:${sid}`), engine.store.get(`untracked:${sid}`)])

  await engine.end('other')
  const ended = [readJson(join(s2, 'Saved/AtherAutomata/lanes', `${sid}.json`)), readJson(join(web, '.ather/local/lanes', `${sid}.json`))]
  expect('on session end both heartbeats say ended', ended.every(one => one?.hasEnded === true), ended)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
}

{
  // One checkout as before: an intent written in s2 itself is kept as its plain slug.
  const { s2 } = makeWorkspace()
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0004', writable: [s2] })
  await engine.modelTool({ tool: 'Write', file_path: 'docs/intent/own/prompt.md', content: LOGIN })
  await engine.flush()
  expect('an intent written in s2 itself is tracked as its plain slug', engine.store.get(`pinned:${sid}`) === 'own', engine.store.get(`pinned:${sid}`))
  await bash(engine, 'Build.bat S2Editor Win64 Development', 'Result: Succeeded')
  expect("and a build there proves it, as before", engine.store.get(`evidence:${checkoutId('sipher/s2', s2)}|own`)?.build?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
}

{
  // /ather intent <name>: a name only a worktree of the session's clone has is tracked there.
  const { s2 } = makeWorkspace()
  const tree = addTree(s2, 's2-x')
  fs.mkdirSync(join(tree, 'docs/intent/search'), { recursive: true })
  fs.writeFileSync(join(tree, 'docs/intent/search/prompt.md'), LOGIN)
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0005' })
  await engine.command('ather', 'intent search')
  expect('/ather intent search tracks it in the worktree that has it', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'search', root: tree }), engine.store.get(`pinned:${sid}`))
}

// ---------------------------------------------------------------- one pane over the workspace

// Every node of a drawn pane, depth first.
const textIn = node => (!node || typeof node !== 'object' ? String(node ?? '') : (node.children ?? []).map(textIn).join(''))
// The intent rows a pane draws: each row's work id (intent:<key>) and its repository's name.
const intentRows = tree =>
  nodesOf(tree)
    .filter(node => node.type === 'Button' && /(^|-)intent:[^\s]+$/.test(node.props?.key ?? ''))
    .map(node => ({ key: node.props.key, id: /intent:[^\s]+$/.exec(node.props.key)[0], repo: textIn(byKey(tree, `${node.props.key}-repo`)).trim(), press: node.props.onPress }))
const fetchRuns = engine => engine.record.gitRuns.filter(run => run.argv.includes('fetch'))
const writeIntent = (root, slug, text = LOGIN) => {
  fs.mkdirSync(join(root, 'docs/intent', slug), { recursive: true })
  fs.writeFileSync(join(root, 'docs/intent', slug, 'prompt.md'), text)
}

{
  // A session in s2/, which has a worktree s2-x/ beside it, with web/ beside both: `login` in all three.
  const { parent, s2, web } = makeWorkspace()
  const tree = addTree(s2, 's2-x')
  writeIntent(s2, 'login')
  writeIntent(tree, 'login', LOGIN.replace('- [ ] A2', '- [x] A2'))
  writeIntent(tree, 'draft', LOGIN.replace('# Login', '# Draft'))
  writeIntent(web, 'login')
  writeIntent(web, 'search', LOGIN.replace('Owner: Tin Nguyen', 'Owner: TienPham'))
  // The worktree's login is the latest by a clear second: Home offers the newest to the next session.
  const earlier = new Date(Date.now() - 1000)
  for (const file of [join(s2, 'docs/intent/login/prompt.md'), join(tree, 'docs/intent/draft/prompt.md')]) fs.utimesSync(file, earlier, earlier)
  const ahead = { s2: advanceOrigin(s2), web: advanceOrigin(web) }
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0006' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const pick = await pane()
  const rows = intentRows(pick)
  const ids = rows.map(one => one.id).sort()
  expect("Everything open lists the session's intents and its worktree's, by key, and nothing of web beside it", JSON.stringify(ids) === JSON.stringify(['intent:login', 'intent:s2-x/draft', 'intent:s2-x/login']), ids)
  expect("each row carries its checkout's name: s2's own, and the worktree's folder's", rows.length === 3 && rows.every(one => one.repo === (one.id.startsWith('intent:s2-x/') ? 's2-x' : 's2')), rows.map(one => [one.id, one.repo]))

  // The first draw fetches the session's origin alone.
  await engine.flush()
  await engine.flush()
  const fetches = fetchRuns(engine).map(run => run.argv[2])
  expect("the first draw fetches the session's checkout only", JSON.stringify(fetches) === JSON.stringify([s2]), fetches)
  const mains = { s2: git(s2, 'rev-parse', 'origin/main'), web: git(web, 'rev-parse', 'origin/main') }
  expect("after it, s2's origin/main is at what its origin holds, and web's was not fetched", mains.s2 === ahead.s2 && mains.web !== ahead.web, { mains, ahead })
  byKey(await pane(), 'sync')?.props.onPress()
  await engine.flush()
  await engine.flush()
  expect("↻ fetches the session's checkout again, and web still not", JSON.stringify(fetchRuns(engine).map(run => run.argv[2])) === JSON.stringify([s2, s2]), fetchRuns(engine).map(run => run.argv[2]))

  // Work on this here on the worktree's login tracks it there.
  rows.find(one => one.id === 'intent:s2-x/login')?.press()
  byKey(await pane(), 'intent-work')?.props.onPress()
  await engine.flush()
  expect("Work on this here on s2-x/login tracks { slug: 'login', root: the worktree }", JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: tree }), engine.store.get(`pinned:${sid}`))
  await engine.timers()
  const treeBeat = readJson(join(tree, 'Saved/AtherAutomata/lanes', `${sid}.json`))
  expect("the heartbeat lands in the worktree's lanes, naming login, and none in web", treeBeat?.intent === 'login' && !fs.existsSync(join(web, '.ather/local/lanes', `${sid}.json`)), treeBeat)

  await engine.command('ather', 'untrack')
  expect('/ather untrack clears it', !engine.store.has(`pinned:${sid}`), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent login')
  expect("/ather intent login tracks the session's own login", engine.store.get(`pinned:${sid}`) === 'login', engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent web/login')
  expect('/ather intent web/login tracks nothing: web is no checkout of the pane', engine.store.get(`pinned:${sid}`) === 'login', engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent s2-x/login')
  expect('/ather intent s2-x/login tracks it in the worktree', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: tree }), engine.store.get(`pinned:${sid}`))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
  expect("on session end the heartbeat in the worktree says ended", readJson(join(tree, 'Saved/AtherAutomata/lanes', `${sid}.json`))?.hasEnded === true, readJson(join(tree, 'Saved/AtherAutomata/lanes', `${sid}.json`)))

  // The next session in s2 offers to continue the worktree's login, and Next tracks it there.
  const next = await boot({ root: s2, sessionId: 'harness-session-0007' })
  next.engine.setSurfaces(['terminal'])
  await next.engine.command('ather', '')
  const home = await next.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  byKey(home, 'next')?.props.onPress()
  await next.engine.flush()
  expect('Continue on Home tracks the intent in the worktree', JSON.stringify(next.engine.store.get(`pinned:${next.sessionId}`)) === JSON.stringify({ slug: 'login', root: tree }), next.engine.store.get(`pinned:${next.sessionId}`))
  expect("and the parent folder holds nothing of Ather's", !fs.existsSync(join(parent, '.ather')) && !fs.existsSync(join(parent, 'Saved')), fs.readdirSync(parent))
}

{
  // A session in s2/ alone: no repository names, ids as before.
  const { s2 } = makeWorkspace()
  writeIntent(s2, 'login')
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0008' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const rows = intentRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  expect('a session in s2 alone lists its intent as intent:login', JSON.stringify(rows.map(one => one.id)) === JSON.stringify(['intent:login']), rows.map(one => one.id))
  expect('with no repository name', rows.length === 1 && rows.every(one => one.repo === ''), rows.map(one => one.repo))
  await engine.flush()
  expect('and fetches its one origin', fetchRuns(engine).length === 1, fetchRuns(engine).map(run => run.argv))
}

// ---------------------------------------------------------------- no profile, a pnpm lockfile

{
  const parent = fs.mkdtempSync(join(BASE, 'pnpm-'))
  const scripts = { test: 'node --test', lint: 'eslint .', build: 'vite build' }
  const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: { ...INTENTS, 'package.json': `${JSON.stringify({ name: 'web', scripts }, null, 2)}\n`, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" } })
  writeIntent(web, 'pay', '# Pay\n\n- Rev: 1\n- Status: active\n- Area: Web\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- [x] A1: it pays.\n')
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0047' })
  engine.setSurfaces(['terminal'])
  await bash(engine, 'pnpm test', NODE_TEST_PASS)
  expect('without a profile, a passing pnpm test records tests as passed', engine.store.get(`evidence:${sid}`)?.tests?.state === 'pass', engine.store.get(`evidence:${sid}`))
  await engine.command('ather', 'intent pay')
  const submits = engine.record.submits.length
  byKey(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'next')?.props.onPress()
  await engine.flush()
  const prove = engine.record.submits.slice(submits).join('\n')
  expect("with a pnpm-lock.yaml and no profile, Prove names pnpm test, pnpm lint and pnpm build, and no npm command", ['`pnpm test`', '`pnpm lint`', '`pnpm build`'].every(command => prove.includes(command)) && !/`npm /.test(prove), prove)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- pull requests into another branch than main

{
  const parent = fs.mkdtempSync(join(BASE, 'base-'))
  // A web checkout on a feature branch, with a develop branch on its origin.
  const makeWeb = (folder, profile) => {
    const root = makeCheckout(parent, folder, { owner: 'AskTinNguyen', name: folder, files: { ...INTENTS, 'package.json': '{ "name": "web" }\n', '.ather/profile.json': `${JSON.stringify(profile, null, 2)}\n` } })
    git(root, 'checkout', '-q', '-b', 'develop')
    git(root, 'push', '-q', 'origin', 'develop')
    git(root, 'checkout', '-q', '-b', 'feat/x')
    return root
  }
  const isHeldAs = (engine, sid, answer, kind, command) => answer.deny !== undefined && parked(engine, sid).at(-1)?.kind === kind && parked(engine, sid).at(-1)?.command === command
  const OLD_PROFILE = { version: 1, pack: 'web', gates: [{ id: 'test', command: 'npm test', proofs: ['tests'] }] }

  {
    const web = makeWeb('named', { ...OLD_PROFILE, baseBranch: 'develop' })
    const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0048' })
    const started = String((await startAway(engine))?.result ?? '')
    expect('with "baseBranch": "develop", the away tool says PRs open to develop and names develop among what is held', /open PRs to develop/.test(started) && /Held: [^.]*develop/.test(started) && !/PRs to main/.test(started), started)
    const develop = await bash(engine, 'git push origin develop')
    expect('git push origin develop is held and parked as push-main', isHeldAs(engine, sid, develop, 'push-main', 'git push origin develop'), [develop.deny, parked(engine, sid)])
    expect('and the refusal names develop', /develop/.test(String(develop.deny).replace('git push origin develop', '')), develop.deny)
    const main = await bash(engine, 'git push origin main')
    expect('git push origin main is still held', isHeldAs(engine, sid, main, 'push-main', 'git push origin main'), [main.deny, parked(engine, sid)])
    const feature = await bash(engine, 'git push -u origin feat/x')
    expect('a push of a feature branch is not held', feature.deny === undefined, feature.deny)
    const bare = await bash(engine, 'git push')
    expect('a bare push on a feature branch is not held', bare.deny === undefined, bare.deny)
    const pr = await bash(engine, 'gh pr merge 5')
    expect('gh pr merge 5 is held, whatever branch the PR goes into', isHeldAs(engine, sid, pr, 'merge', 'gh pr merge 5'), [pr.deny, parked(engine, sid)])
    const pull = await bash(engine, 'git merge origin/develop')
    expect('git merge origin/develop on a feature branch is not held', pull.deny === undefined, pull.deny)
    git(web, 'checkout', '-q', 'develop')
    const merge = await bash(engine, 'git merge feat/x')
    expect('git merge feat/x while develop is checked out is held as a merge', isHeldAs(engine, sid, merge, 'merge', 'git merge feat/x'), [merge.deny, parked(engine, sid)])
    const barePush = await bash(engine, 'git push')
    expect('a bare git push while develop is checked out is held', isHeldAs(engine, sid, barePush, 'push-main', 'git push'), [barePush.deny, parked(engine, sid)])
    expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
    await engine.end('other')
  }

  {
    // A profile as 0.2.5 wrote it; the clone knows develop as the default branch of its origin.
    const web = makeWeb('default', OLD_PROFILE)
    git(web, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0049' })
    const started = String((await startAway(engine))?.result ?? '')
    expect("with no field and origin/HEAD at develop, the away tool says PRs open to develop", /open PRs to develop/.test(started), started)
    const develop = await bash(engine, 'git push origin develop')
    expect('and a push to develop is held as push-main', isHeldAs(engine, sid, develop, 'push-main', 'git push origin develop'), [develop.deny, parked(engine, sid)])
    const main = await bash(engine, 'git push origin main')
    expect('and a push to main is held', isHeldAs(engine, sid, main, 'push-main', 'git push origin main'), [main.deny, parked(engine, sid)])
    expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
    await engine.end('other')
  }

  {
    // The same clone from a worktree of it: origin/HEAD is in the git folder the worktrees share.
    const web = makeWeb('shared', OLD_PROFILE)
    git(web, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    const worktree = join(parent, 'shared-wt')
    git(web, 'worktree', 'add', '-q', '-b', 'feat/y', worktree)
    const { engine, sessionId: sid } = await boot({ root: worktree, sessionId: 'harness-session-0050' })
    await startAway(engine)
    const develop = await bash(engine, 'git push origin develop')
    expect("in a worktree of that clone, a push to develop is held as push-main", isHeldAs(engine, sid, develop, 'push-main', 'git push origin develop'), [develop.deny, parked(engine, sid)])
    expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
    await engine.end('other')
  }

  {
    // The same profile and no origin/HEAD: as before.
    const web = makeWeb('plain', OLD_PROFILE)
    expect('a checkout made by push has no origin/HEAD', !fs.existsSync(join(web, '.git/refs/remotes/origin/HEAD')))
    const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0051' })
    const started = String((await startAway(engine))?.result ?? '')
    expect('with no field and no origin/HEAD, the away tool reads as before: PRs to main, "Pushes to main"', /open PRs to main/.test(started) && /Pushes to main/.test(started) && !/develop/.test(started), started)
    const develop = await bash(engine, 'git push origin develop')
    expect('and a push to develop is not held (as before)', develop.deny === undefined, develop.deny)
    git(web, 'checkout', '-q', 'develop')
    const merge = await bash(engine, 'git merge feat/x')
    expect('nor a local merge while develop is checked out (as before)', merge.deny === undefined, merge.deny)
    const main = await bash(engine, 'git push origin main')
    expect('and a push to main is held (as before)', isHeldAs(engine, sid, main, 'push-main', 'git push origin main'), [main.deny, parked(engine, sid)])
    expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
    await engine.end('other')
  }
}

// ---------------------------------------------------------------- issues and PRs of the session's repository

// `gh issue list --json …` rows.
const issue = (number, title, repo = 'x/y') => ({ number, title, url: `https://github.com/${repo}/issues/${number}`, labels: [], updatedAt: '2026-10-01T00:00:00Z' })
// An intent whose every item is met, naming PR #12: its stage waits on that PR.
const SHIPPED = '# Pay\n\n- Rev: 1\n- Status: active\n- Area: Web\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- [x] A1: it pays.\n'
const withPr = (root, slug) => {
  writeIntent(root, slug, SHIPPED)
  fs.writeFileSync(join(root, 'docs/intent', slug, 'progress.md'), '# Progress\n\n- PR: #12\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n| A1 | met | t |\n')
}
const LIST = 'gh issue list --assignee @me --state open --limit 30 --json number,title,url,labels,updatedAt'
// The issue lists are read in the background, one checkout at a time: wait until each checkout's is kept.
const issuesRead = async (engine, ghAt) => {
  const kept = () => [...engine.store.keys()].filter(key => key.startsWith('issues:')).length
  for (let tries = 0; tries < 100 && kept() < Object.keys(ghAt).length; tries += 1) await engine.flush()
}
// The issue rows a pane draws: each row's work id and its repository's name.
const issueRows = tree =>
  nodesOf(tree)
    .filter(node => node.type === 'Button' && /^(pick|work)-issue:/.test(node.props?.key ?? ''))
    .map(node => ({ id: node.props.key.replace(/^(pick|work)-/, ''), repo: textIn(byKey(tree, `${node.props.key}-repo`)).trim(), press: node.props.onPress }))
// An intent row's stage glyph, from its drawn label.
const glyphOf = (tree, id) => (nodesOf(tree).find(node => node.type === 'Button' && [`pick-${id}`, `work-${id}`].includes(node.props?.key))?.props.label ?? '').trim().charAt(0)

{
  // A session in s2/, with a worktree, and web/ beside it: each repository has its own issues and its own PR #12.
  const { s2, web } = makeWorkspace()
  addTree(s2, 's2-x')
  withPr(s2, 'pay')
  withPr(web, 'pay')
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield'), issue(3, 'Rain')], prs: { 12: 'OPEN' } }, [web]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')], prs: { 12: 'MERGED' } } }
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0009', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [s2]: {} })
  await engine.flush()
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect("gh issue list runs once, in the session's checkout, and never in web beside it", JSON.stringify(lists) === JSON.stringify([s2]), engine.record.ghAt)
  expect("only s2's list is kept", JSON.stringify([...engine.store.keys()].filter(key => key.startsWith('issues:'))) === JSON.stringify(['issues:sipher/s2|tinnguyen']), [...engine.store.keys()].filter(key => key.startsWith('issues')))

  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const rows = issueRows(await pane())
  expect("s2's issues show by their bare numbers, with no repository name, and web's #7 does not", JSON.stringify(rows.map(one => [one.id, one.repo]).sort()) === JSON.stringify([['issue:3', ''], ['issue:7', '']]), rows.map(one => [one.id, one.repo]))

  // PRs: s2's #12 read with gh there; web's never asked.
  await engine.flush()
  const prViews = engine.record.ghAt.filter(run => run.argv.startsWith('gh pr view 12 ')).map(run => run.cwd)
  expect("gh pr view 12 runs in s2 only", prViews.length > 0 && prViews.every(cwd => cwd === s2), engine.record.ghAt.filter(run => run.argv.startsWith('gh pr')))
  expect("s2's #12 is kept OPEN, and nothing of web's", engine.store.get('prStates:sipher/s2')?.[12]?.state === 'OPEN' && !engine.store.has('prStates:asktinnguyen/web'), [engine.store.get('prStates:sipher/s2'), engine.store.get('prStates:asktinnguyen/web')])
  const staged = await pane()
  expect("s2's pay waits on its open #12, and web's pay is not listed", glyphOf(staged, 'intent:pay') === '◐' && !intentRows(staged).some(one => one.id !== 'intent:pay'), [glyphOf(staged, 'intent:pay'), intentRows(staged).map(one => one.id)])

  // Open on GitHub and Copy link on #7 are s2's.
  rows.find(one => one.id === 'issue:7')?.press()
  const card = await pane()
  byKey(card, 'issue-open')?.props.onPress()
  await engine.flush()
  const opened = engine.record.ghAt.filter(run => run.argv === 'gh issue view 7 --web')
  expect("Open on GitHub on #7 runs gh issue view 7 --web in s2", opened.length === 1 && opened[0].cwd === s2, opened)
  byKey(card, 'issue-copy')?.props.onPress({})
  await engine.flush()
  expect("Copy link on #7 copies s2's issue URL", engine.record.copies.at(-1) === 'https://github.com/x/y/issues/7', engine.record.copies)

  // /ather issue 7 is s2's #7; web#7 names no checkout of the pane and starts nothing.
  await engine.command('ather', 'issue 7')
  await engine.flush()
  const own = String(engine.record.submits.at(-1) ?? '')
  expect("/ather issue 7 starts s2's #7", own.includes('Boss shield'), own)
  const before = engine.record.submits.length
  await engine.command('ather', 'issue web#7')
  await engine.flush()
  expect('/ather issue web#7 starts nothing', engine.record.submits.length === before, engine.record.submits.slice(before))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
}

{
  // One checkout: a session in s2/ alone runs the one gh issue list and keeps issue:<n> ids.
  const { s2 } = makeWorkspace()
  writeIntent(s2, 'login')
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] } }
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0010', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, ghAt)
  const lists = engine.record.ghAt.filter(run => run.argv.startsWith('gh issue list'))
  expect('a session in s2 alone runs one gh issue list, in s2, as before', lists.length === 1 && lists[0].argv === LIST && lists[0].cwd === s2, lists)
  await engine.command('ather', 'pick')
  const rows = issueRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  expect('its issue is issue:7, with no repository name', JSON.stringify(rows.map(one => [one.id, one.repo])) === JSON.stringify([['issue:7', '']]), rows.map(one => [one.id, one.repo]))
}

// ---------------------------------------------------------------- deciding in place and grouping, over a checkout and its worktree

const DECISION = '# Findings\n\n## F-1 (2026-10-01, rev 1) | blocking: yes | status: open (director)\n\nOne page or two?\n\n**Options:**\n- A (recommended): one page\n- B: two pages\n'
// The worktree's branch added a decision of its own beside the shared F-1.
const TREE_DECISIONS = `${DECISION}\n## F-2 (2026-10-02, rev 1) | blocking: no | status: open (director)\n\nRed or blue?\n\n**Options:**\n- A (recommended): red\n- B: blue\n`
const writeFindings = (root, slug, text = DECISION) => fs.writeFileSync(join(root, 'docs/intent', slug, 'findings.md'), text)
const lastSubmit = engine => {
  const sent = engine.record.submits.at(-1) ?? ''
  return typeof sent === 'string' ? sent : (sent.text ?? '')
}

{
  // A session in s2/ with a worktree s2-x/: `login` is yours in both, sharing the open decision F-1, the worktree's
  // copy with its own F-2 beside it; `board` is a teammate's in both.
  const { s2 } = makeWorkspace()
  const tree = addTree(s2, 's2-x')
  for (const [root, text] of [[s2, LOGIN], [tree, LOGIN.replace('- [ ] A2', '- [x] A2')]]) {
    writeIntent(root, 'login', text)
    writeFindings(root, 'login', root === tree ? TREE_DECISIONS : DECISION)
    writeIntent(root, 'board', text.replace('Owner: Tin Nguyen', 'Owner: TienPham'))
  }
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [tree]: { issues: [issue(7, 'Boss shield')] } }
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0013', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [s2]: {} })
  await engine.flush()
  await engine.command('ather', '')
  const pane = (surface = 'terminal') => engine.render('Pane', { bodyColumns: 110 }, 'ather', surface)
  const keys = tree => nodesOf(tree).map(node => node.props?.key).filter(key => typeof key === 'string')
  const TREE_CALL = 'call:s2-x/login:F-2'
  const OWN_CALL = 'call:login:F-1'
  let home = await pane()
  expect("Needs you lists the shared decision once, from the session's own checkout, and the worktree's own by its key", [TREE_CALL, OWN_CALL].every(id => keys(home).includes(`item-${id}`)) && !keys(home).includes('item-call:s2-x/login:F-1'), keys(home).filter(key => key.startsWith('item-')))
  const desk = keys(await pane('desktop'))
  expect('on the desktop too: both decisions, and no element key drawn twice', [TREE_CALL, OWN_CALL].every(id => desk.includes(`item-${id}`)) && desk.every((key, at, list) => list.indexOf(key) === at), desk.filter(key => /call:/.test(key)))
  home = await pane()
  // Open the worktree's decision if the other is the one opened, then answer A.
  if (!byKey(home, `option-${TREE_CALL}-A`)) {
    byKey(home, `item-${TREE_CALL}`)?.props.onPress()
    home = await pane()
  }
  const before = engine.record.submits.length
  byKey(home, `option-${TREE_CALL}-A`)?.props.onPress()
  await engine.flush()
  const answer = engine.record.submits.length > before ? lastSubmit(engine) : ''
  expect("answering A on the worktree's decision hands the session s2-x/login and the worktree's findings file", answer.includes('F-2 on s2-x/login') && answer.includes(`${tree}/docs/intent/login/findings.md`) && !answer.includes(`${s2}/docs`), answer)
  const answered = await pane()
  expect("the worktree's row reads decided; the shared decision still waits, with its answers", keys(answered).includes(`item-${TREE_CALL}-done`) && !keys(answered).includes(`item-${OWN_CALL}-done`) && Boolean(byKey(answered, `option-${OWN_CALL}-A`)), keys(answered).filter(key => /call:/.test(key)))
  byKey(answered, `explain-${OWN_CALL}`)?.props.onPress()
  await engine.flush()
  expect("Explain on s2's decision names its plain slug and nothing of the worktree", lastSubmit(engine).includes('F-1 on login') && !lastSubmit(engine).includes(tree), lastSubmit(engine))
  byKey(answered, `findings-${OWN_CALL}`)?.props.onPress()
  const finding = await pane()
  expect("Open findings on s2's decision shows that finding", textIn(byKey(finding, 'title')).includes('login') && !textIn(byKey(finding, 'title')).includes('s2-x') && byKey(finding, 'finding-markdown')?.props.text.startsWith('## F-1'), textIn(byKey(finding, 'title')))
  nodesOf(finding).find(node => node.type === 'Button' && node.props.key === 'finding-back')?.props.onPress()
  // The session records the answer in the worktree's findings: read again, its decision is gone and s2's is still there.
  writeFindings(tree, 'login', `${TREE_DECISIONS}\n**Resolution:** accepted A.\n`)
  await engine.turnEnd()
  await engine.flush()
  const settled = keys(await pane())
  expect("once the worktree's findings read resolved, its decision leaves Needs you and the shared one stays", !settled.some(key => key.includes(TREE_CALL)) && settled.includes(`item-${OWN_CALL}`), settled.filter(key => /call:/.test(key)))
  // Settled in the worktree's copy, the shared decision waits in neither.
  writeFindings(tree, 'login', DECISION.replace('status: open (director)', 'status: accepted (director)'))
  await engine.turnEnd()
  await engine.flush()
  const shared = keys(await pane())
  expect("once the worktree's copy settles the shared decision, it leaves Needs you though s2's copy still says open", !shared.some(key => key.startsWith('item-call:') && key.includes('login')), shared.filter(key => /call:/.test(key)))
  writeFindings(tree, 'login', `${TREE_DECISIONS}\n**Resolution:** accepted A.\n`)
  await engine.turnEnd()
  await engine.flush()

  // Everything open, grouped by Person (the default): both checkouts' rows, the teammate's two under one head, on either surface.
  await engine.command('ather', 'pick')
  for (const surface of ['terminal', 'desktop']) {
    const pick = await pane(surface)
    const rows = intentRows(pick)
    const ids = rows.map(one => one.id).sort()
    expect(`Everything open (${surface}) lists each checkout's rows once, the same slugs twice`, JSON.stringify(ids) === JSON.stringify(['intent:board', 'intent:login', 'intent:s2-x/board', 'intent:s2-x/login']), ids)
    expect(`each row (${surface}) carries its checkout's name`, rows.length === 4 && rows.every(one => one.repo === (one.id.startsWith('intent:s2-x/') ? 's2-x' : 's2')), rows.map(one => [one.id, one.repo]))
    const heads = nodesOf(pick).filter(node => /^sub-others-\d+-text$/.test(node.props?.key ?? '')).map(textIn)
    expect(`grouped by Person (${surface}), the teammate's intents from both checkouts are one group of 2`, heads.length === 1 && / · 2$/.test(heads[0]), heads)
    expect(`no element key is drawn twice (${surface})`, keys(pick).every((key, at, list) => list.indexOf(key) === at), keys(pick).filter((key, at, list) => list.indexOf(key) !== at))
    const issues = issueRows(pick)
    expect(`the repository's assigned issue is listed once (${surface}), by its bare number under the session's checkout`, JSON.stringify(issues.map(one => [one.id, one.repo])) === JSON.stringify([['issue:7', 's2']]), issues.map(one => [one.id, one.repo]))
  }
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect("gh issue list runs for the repository in the session's checkout only", lists.length > 0 && lists.every(cwd => cwd === s2), engine.record.ghAt)

  // /ather issue s2-x#7: the repository's issue, started in the worktree named.
  await engine.command('ather', 'issue s2-x#7')
  await engine.flush()
  expect('/ather issue s2-x#7 starts the assigned issue in the worktree', lastSubmit(engine).includes('Boss shield') && lastSubmit(engine).includes(`${tree}/docs/intent`), lastSubmit(engine))
  await engine.command('ather', 'intent s2-x/login')
  expect('/ather intent s2-x/login tracks it in the worktree', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: tree }), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'untrack')

  // Without a pane, /ather find names each match by its key, and the Work question names each intent by its key: choosing the second works on that one.
  engine.setSurfaces([])
  const found = String((await engine.command('ather', 'find login'))?.text ?? '')
  expect("/ather find login without a pane names both checkouts' intents by key", found.includes('s2-x/login') && found.replace(/s2-x\/login/g, '').includes('login'), found)
  engine.script.push(question => question.options[1].label)
  await engine.command('ather', 'pick')
  await engine.flush()
  const asked = engine.record.dialogs.at(-1)
  const labels = (asked?.options ?? []).map(option => option.label)
  expect('the Work question lists the same slug in two checkouts as two different choices', labels.includes('login') && labels.includes('s2-x/login'), labels)
  const chosen = { login: 'login', 's2-x/login': { slug: 'login', root: tree } }[asked?.answer]
  expect('choosing one of them tracks it in its own checkout', chosen !== undefined && JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify(chosen), [asked?.answer, engine.store.get(`pinned:${sid}`)])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
}

{
  // One checkout: a decision in s2 itself is call:<slug>:<finding>, and its answer names the plain slug, as before.
  const { s2 } = makeWorkspace()
  writeIntent(s2, 'login')
  writeFindings(s2, 'login')
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0014' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', '')
  const home = await engine.render('Pane', { bodyColumns: 110 }, 'ather')
  byKey(home, 'option-call:login:F-1-A')?.props.onPress()
  await engine.flush()
  expect('a session in s2 alone: the answer names the plain slug and no path', lastSubmit(engine).includes('F-1 on login:') && !lastSubmit(engine).includes('findings.md'), lastSubmit(engine))
}

// ---------------------------------------------------------------- proof, changes and Continue per checkout

{
  // A with-proof web checkout and its worktree web-b/ beside it, `login` yours in both; the session is in web/.
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const web = makeCheckout(parent, 'web', {
    owner: 'AskTinNguyen',
    name: 'web',
    files: { ...INTENTS, 'package.json': `${JSON.stringify({ name: 'web', scripts: { test: 'node --test' } }, null, 2)}\n`, '.ather/profile.json': `${JSON.stringify(WEB_PROFILE, null, 2)}\n` },
  })
  const webB = addTree(web, 'web-b')
  writeIntent(web, 'login')
  writeIntent(webB, 'login', LOGIN.replace('- [x] A1', '- [ ] A1'))
  const ids = { web: checkoutId('asktinnguyen/web', web), webB: checkoutId('asktinnguyen/web', webB) }
  const kept = (engine, prefix) => [...engine.store.keys()].filter(key => key.startsWith(prefix))
  const ghAt = { [web]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] }, [webB]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] } }
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0017', writable: [parent], ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [web]: {} })
  await engine.flush()

  // Nothing tracked: this session's proof in its checkout is not its proof in the worktree.
  await startAway(engine)
  await bash(engine, 'npm test', NODE_TEST_PASS)
  expect("a passing npm test in web/ is this session's proof in web/ only", engine.store.get(`evidence:${sid}`)?.tests?.state === 'pass' && kept(engine, 'evidence:').length === 1, kept(engine, 'evidence:'))
  const otherMerge = await bash(engine, 'cd ../web-b && gh pr merge 3')
  expect("web/'s proof does not allow a with-proof merge in the worktree", otherMerge.deny !== undefined && parked(engine, sid).at(-1)?.command === 'cd ../web-b && gh pr merge 3', { deny: otherMerge.deny, parked: parked(engine, sid) })
  const sameMerge = await bash(engine, 'gh pr merge 3')
  expect('it allows the merge in web/ itself', sameMerge.deny === undefined, sameMerge.deny)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })

  // web/login tracked and proved, then edited: neither its proof nor its changes are web-b/login's.
  await engine.command('ather', 'intent login')
  expect('/ather intent login tracks it in web/', engine.store.get(`pinned:${sid}`) === 'login', engine.store.get(`pinned:${sid}`))
  await bash(engine, 'npm test', NODE_TEST_PASS)
  expect("npm test in web/ proves web/'s login", engine.store.get(`evidence:${ids.web}|login`)?.tests?.state === 'pass', kept(engine, 'evidence:'))
  expect("and records nothing for web-b/'s login", !engine.store.has(`evidence:${ids.webB}|login`), kept(engine, 'evidence:'))
  await engine.modelTool({ tool: 'Edit', file_path: 'docs/intent/login/prompt.md', old_string: '- [ ] A2', new_string: '- [x] A2' })
  await engine.flush()
  expect("an edit to web/'s login records its change for web/ only", engine.store.get(`changes:${ids.web}|login`)?.length === 1 && kept(engine, 'changes:').length === 1, kept(engine, 'changes:'))

  // The worktree's login tracked: its own Continue, and web/'s proof does not count for it.
  await engine.command('ather', 'intent web-b/login')
  expect('/ather intent web-b/login tracks it in web-b/', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: webB }), engine.store.get(`pinned:${sid}`))
  expect('each checkout keeps its own Continue', engine.store.get(`last:${ids.web}|tinnguyen`) === 'login' && engine.store.get(`last:${ids.webB}|tinnguyen`) === 'login' && kept(engine, 'last:').length === 2, kept(engine, 'last:'))
  const status = JSON.parse((await engine.modelTool({ tool: 'mcp__ather-automata__status' })).result)
  expect("web-b/'s login has no proof from web/'s test run", status.tracked?.checkout === webB && status.evidence?.tests?.state !== 'pass', [status.tracked, status.evidence])
  await startAway(engine)
  const intentMerge = await bash(engine, 'cd ../web-b && gh pr merge 3')
  expect("web/login's proof does not allow web-b/login's merge", intentMerge.deny !== undefined, intentMerge.deny)
  await bash(engine, 'cd ../web-b && npm test', NODE_TEST_PASS)
  const proved = await bash(engine, 'cd ../web-b && gh pr merge 3')
  expect("web-b/'s own passing test run does", proved.deny === undefined && engine.store.get(`evidence:${ids.webB}|login`)?.tests?.state === 'pass', [proved.deny, kept(engine, 'evidence:')])
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })

  // The repository's issue is GitHub's: read once, listed once.
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('gh issue list runs once for the repository, in the session checkout', lists.length > 0 && lists.every(cwd => cwd === web), engine.record.ghAt)
  expect('and its list is kept under the repository', kept(engine, 'issues:').length === 1 && engine.store.get('issues:asktinnguyen/web|tinnguyen')?.list?.length === 1, kept(engine, 'issues:'))
  await engine.command('ather', 'pick')
  const issues = issueRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  expect("the repository's assigned issue is listed once", JSON.stringify(issues.map(one => one.id)) === JSON.stringify(['issue:7']), issues.map(one => one.id))

  // Untracking web-b/login takes web-b/'s Continue only: the next session continues web/'s.
  await engine.command('ather', 'untrack')
  expect("untracking web-b/login leaves web/'s Continue", engine.store.get(`last:${ids.web}|tinnguyen`) === 'login' && kept(engine, 'last:').length === 1, kept(engine, 'last:'))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
  const next = await boot({ root: web, sessionId: 'harness-session-0018' })
  next.engine.setSurfaces(['terminal'])
  await next.engine.command('ather', '')
  byKey(await next.engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'next')?.props.onPress()
  await next.engine.flush()
  expect("Continue on Home tracks web/'s login, not web-b/'s", next.engine.store.get(`pinned:${next.sessionId}`) === 'login', next.engine.store.get(`pinned:${next.sessionId}`))
}

// ---------------------------------------------------------------- one id through a symbolic link

{
  // web/ reached through a link to it, then by its real path: `login` and `pay` yours, `login` tracked and proved through the link.
  const { parent, web } = makeWorkspace()
  for (const slug of ['login', 'pay']) writeIntent(web, slug)
  const link = join(BASE, 'link-web')
  // A junction on Windows, which needs no Developer Mode; elsewhere the type is ignored and this is a symbolic link.
  fs.symlinkSync(web, link, 'junction')
  const id = checkoutId('asktinnguyen/web', web)
  const kept = (engine, prefix) => [...engine.store.keys()].filter(key => key.startsWith(prefix))
  const { engine, sessionId: sid } = await boot({ root: link, sessionId: 'harness-session-0019', writable: [link] })
  await engine.command('ather', 'intent login')
  expect('a session opened through a link tracks login in its own checkout', engine.store.get(`pinned:${sid}`) === 'login', engine.store.get(`pinned:${sid}`))
  await bash(engine, 'npm test', NODE_TEST_PASS)
  await engine.modelTool({ tool: 'Edit', file_path: join(link, 'docs/intent/login/prompt.md'), old_string: '- [ ] A2', new_string: '- [x] A2' })
  await engine.flush()
  expect("its proof is kept under the checkout's real folder", engine.store.get(`evidence:${id}|login`)?.tests?.state === 'pass' && kept(engine, 'evidence:').length === 1, kept(engine, 'evidence:'))
  expect('and its Continue', engine.store.get(`last:${id}|tinnguyen`) === 'login' && kept(engine, 'last:').length === 1, kept(engine, 'last:'))
  expect('and its changes', engine.store.get(`changes:${id}|login`)?.length === 1 && kept(engine, 'changes:').length === 1, kept(engine, 'changes:'))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')

  // The next session, opened by the real path over the same store, continues login and counts its proof.
  const next = await boot({ root: web, sessionId: 'harness-session-0020', kept: engine.store })
  next.engine.setSurfaces(['terminal'])
  await next.engine.command('ather', '')
  byKey(await next.engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'next')?.props.onPress()
  await next.engine.flush()
  expect('a session opened by the real path continues the intent tracked through the link', next.engine.store.get(`pinned:${next.sessionId}`) === 'login', next.engine.store.get(`pinned:${next.sessionId}`))
  const status = JSON.parse((await next.engine.modelTool({ tool: 'mcp__ather-automata__status' })).result)
  expect('and reads the proof recorded through the link', status.evidence?.tests?.state === 'pass', status.evidence)
  expect('it keeps one Continue and one proof record', kept(next.engine, 'last:').length === 1 && kept(next.engine, 'evidence:').length === 1, [...kept(next.engine, 'last:'), ...kept(next.engine, 'evidence:')])
  await next.engine.end('other')

  // s2/ beside it, opened through a link to their parent folder: web/ is another checkout there, with the same id.
  const linkParent = join(BASE, 'link-work')
  fs.symlinkSync(parent, linkParent, 'junction')
  const above = await boot({ root: `${linkParent}/s2`, sessionId: 'harness-session-0021', kept: engine.store, writable: [linkParent] })
  await bash(above.engine, 'cd ../web && npm test', NODE_TEST_PASS)
  expect("a session in s2 through the linked parent keeps its proof in ../web under web's real folder", above.engine.store.get(`evidence:${above.sessionId}|${id}`)?.tests?.state === 'pass', kept(above.engine, 'evidence:'))
  await above.engine.modelTool({ tool: 'Edit', file_path: '../web/docs/intent/pay/prompt.md', old_string: '- [ ] A2', new_string: '- [x] A2' })
  await above.engine.flush()
  expect("and an edit to pay in ../web tracks it there, its change kept under web's real folder", JSON.stringify(above.engine.store.get(`pinned:${above.sessionId}`)) === JSON.stringify({ slug: 'pay', root: `${linkParent}/web` }) && above.engine.store.get(`changes:${id}|pay`)?.length === 1 && kept(above.engine, 'changes:').every(key => key.startsWith(`changes:${id}|`)) && kept(above.engine, 'last:').length === 1, [above.engine.store.get(`pinned:${above.sessionId}`), ...kept(above.engine, 'changes:'), ...kept(above.engine, 'last:')])
  expect('no hook threw', next.engine.record.hookErrors.length === 0 && above.engine.record.hookErrors.length === 0, [...next.engine.record.hookErrors, ...above.engine.record.hookErrors])
  await above.engine.end('other')
}

// ---------------------------------------------------------------- a checkout that is not on GitHub

const NOT_ON_GITHUB = 'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`'
// Presses "Refresh GitHub issues" in the pane and resolves what it said, and the retries it started.
const refresh = async engine => {
  const before = { toasts: engine.record.toasts.length, retries: engine.record.afters.filter(ms => ms === 60000).length }
  await engine.command('ather', 'pick')
  byKey(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'issues-refresh')?.props.onPress()
  for (let tries = 0; tries < 100 && engine.record.toasts.length === before.toasts; tries += 1) await engine.flush()
  return { said: engine.record.toasts.slice(before.toasts).join('\n'), retries: engine.record.afters.filter(ms => ms === 60000).length - before.retries }
}

{
  // A checkout whose remotes are not on GitHub: a failure.
  const { web } = makeWorkspace()
  const ghAt = { [web]: { fails: NOT_ON_GITHUB } }
  const { engine } = await boot({ root: web, sessionId: 'harness-session-0023', ghAt })
  engine.setSurfaces(['terminal'])
  await engine.flush()
  const alone = await refresh(engine)
  // What a refresh that worked and found nothing says: the failure is something else.
  ghAt[web] = { issues: [] }
  const empty = await refresh(engine)
  expect('alone, a checkout that is not on GitHub still fails the refresh', alone.said !== '' && empty.said !== '' && alone.said !== empty.said, [alone, empty])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- the workspace stays with the session's root

{
  // A session opened in s2/ starts again (a resume, a reload) after the shell moved into web/ beside it.
  const { s2, web } = makeWorkspace()
  writeIntent(s2, 'login')
  writeIntent(web, 'login')
  writeIntent(web, 'search')
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0025', cwd: web })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const ids = intentRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather')).map(one => one.id).sort()
  expect("a session started with the shell in web/ still lists s2's intents alone", JSON.stringify(ids) === JSON.stringify(['intent:login']), ids)
  await engine.command('ather', 'intent login')
  expect("and tracks s2's login", engine.store.get('pinned:harness-session-0025') === 'login', engine.store.get('pinned:harness-session-0025'))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- no intents, and a parent folder

{
  const PACKAGE = { 'package.json': `${JSON.stringify({ name: 'app' }, null, 2)}\n` }
  // One /ather: the dialogs it asked (each dismissed) and the prompts it submitted.
  const run = async (engine, args) => {
    const dialogs = engine.record.dialogs.length
    const submits = engine.record.submits.length
    const out = await engine.command('ather', args)
    await engine.flush()
    return { out: out.text, dialogs: engine.record.dialogs.slice(dialogs), sent: engine.record.submits.slice(submits) }
  }

  // The session's own checkout has no intents; web/, beside it, has one: the session has no pane.
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const app = makeCheckout(parent, 'app', { owner: 'AskTinNguyen', name: 'app', files: PACKAGE })
  const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: { ...INTENTS, ...PACKAGE } })
  writeIntent(web, 'login')
  const { engine } = await boot({ root: app, sessionId: 'harness-session-0026' })
  engine.setSurfaces(['terminal'])
  const opened = await run(engine, 'pick')
  expect("a session whose own checkout has no intents opens no pane on the checkout beside it, and is asked nothing", opened.dialogs.length === 0 && opened.sent.length === 0 && engine.record.opens.length === 0, [opened, engine.record.opens])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')

  // A parent folder whose checkouts have no intents at all.
  const bare = fs.mkdtempSync(join(BASE, 'work-'))
  makeCheckout(bare, 'app', { owner: 'AskTinNguyen', name: 'app', files: PACKAGE })
  makeCheckout(bare, 'site', { owner: 'AskTinNguyen', name: 'site', files: PACKAGE })
  const none = await boot({ root: bare, sessionId: 'harness-session-0027' })
  none.engine.setSurfaces(['terminal'])
  const asked = await run(none.engine, '')
  expect('a parent folder whose checkouts have no intents: /ather asks nothing, submits nothing and opens no pane', asked.dialogs.length === 0 && asked.sent.length === 0 && none.engine.record.opens.length === 0, [asked, none.engine.record.opens])
  expect('no hook threw', none.engine.record.hookErrors.length === 0, none.engine.record.hookErrors)
  await none.engine.end('other')
}

{
  // A session opened in the parent folder of s2/ and web/, both with intents: it is in no checkout, so it has no pane,
  // even with a docs/intent of its own left there.
  const { parent, s2, web } = makeWorkspace()
  writeIntent(s2, 'login')
  writeIntent(web, 'login')
  writeIntent(parent, 'leftover')
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [web]: { issues: [issue(5, 'Login form', 'AskTinNguyen/web')] } }
  const said = async one => [String((await one.command('ather', ''))?.text ?? ''), String((await one.command('ather', 'pick'))?.text ?? ''), String((await one.command('away', '2h nap'))?.text ?? '')]
  // Each session is asked before the next one starts: the hooks keep one session's folder at a time.
  const { engine } = await boot({ root: parent, sessionId: 'harness-session-0060', ghAt })
  engine.setSurfaces(['terminal'])
  const parentSaid = await said(engine)
  await engine.flush()
  // A checkout with nothing that makes a pack of it, and no docs/intent: a repository without intents.
  const empty = makeCheckout(fs.mkdtempSync(join(BASE, 'plain-')), 'plain', { owner: 'AskTinNguyen', name: 'plain', files: { 'notes.txt': 'notes\n' } })
  const without = await boot({ root: empty, sessionId: 'harness-session-0061' })
  without.engine.setSurfaces(['terminal'])
  const withoutSaid = await said(without.engine)
  expect('a parent-folder session: /ather and /away answer as in a repository without intents', parentSaid[0] !== '' && JSON.stringify(parentSaid) === JSON.stringify(withoutSaid), [parentSaid, withoutSaid])
  expect('and open no pane, ask nothing and send nothing', engine.record.opens.length === 0 && engine.record.dialogs.length === 0 && engine.record.submits.length === 0, [engine.record.opens, engine.record.dialogs, engine.record.submits])
  expect("and read neither checkout's issues nor fetch either origin", engine.record.ghAt.length === 0 && fetchRuns(engine).length === 0, [engine.record.ghAt, fetchRuns(engine).map(run => run.argv)])
  expect('no hook threw', engine.record.hookErrors.length === 0 && without.engine.record.hookErrors.length === 0, [...engine.record.hookErrors, ...without.engine.record.hookErrors])
  await engine.end('other')
  await without.engine.end('other')
}

// ---------------------------------------------------------------- a clone's worktrees

{
  // A web checkout whose origin/main holds `login` and `pay`, alone in its parent folder; with `tree`, a worktree of it beside it.
  const makeClone = tree => {
    const parent = fs.mkdtempSync(join(BASE, 'clone-'))
    const web = makeCheckout(parent, 'web', {
      owner: 'AskTinNguyen',
      name: 'web',
      files: { ...INTENTS, '.ather/profile.json': `${JSON.stringify(WEB_PROFILE, null, 2)}\n`, 'docs/intent/login/prompt.md': LOGIN, 'docs/intent/pay/prompt.md': LOGIN.replace('# Login', '# Pay') },
    })
    if (tree) git(web, 'worktree', 'add', '-q', '-b', 'feat/x', join(parent, tree))
    return { web, tree: tree ? join(parent, tree) : '' }
  }
  const keysOf = tree => nodesOf(tree).map(node => node.props?.key).filter(key => typeof key === 'string')
  // The pick pane of a session in `web`, once its issues are read and its first fetch has ended.
  const drawn = async (web, sessionId, ghAt) => {
    const { engine } = await boot({ root: web, sessionId, writable: [path.dirname(web)], ghAt })
    engine.setSurfaces(['terminal'])
    await issuesRead(engine, { [web]: {} })
    await engine.command('ather', 'pick')
    const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
    await pane()
    await engine.flush()
    await engine.flush()
    return { engine, pane, pick: await pane() }
  }

  const alone = makeClone('')
  const before = await drawn(alone.web, 'harness-session-0030', { [alone.web]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] } })
  await before.engine.end('other')

  // The same checkout with a worktree that has nothing of its own.
  const { web, tree } = makeClone('web-x')
  const ghAt = { [web]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] }, [tree]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] } }
  const { engine, pane, pick } = await drawn(web, 'harness-session-0031', ghAt)
  const sid = 'harness-session-0031'
  const rows = intentRows(pick)
  expect("a worktree with nothing of its own: the pane lists main's intents once, by their bare keys", JSON.stringify(rows.map(one => one.id).sort()) === JSON.stringify(['intent:login', 'intent:pay']), rows.map(one => one.id))
  expect('its rows and keys are those of the checkout without the worktree', JSON.stringify(keysOf(pick)) === JSON.stringify(keysOf(before.pick)), [keysOf(pick), keysOf(before.pick)])
  expect('no row carries a repository name', rows.length === 2 && rows.every(one => one.repo === '') && issueRows(pick).every(one => one.repo === ''), [rows.map(one => one.repo), issueRows(pick)])
  expect("one pass runs one fetch, in the session's checkout", JSON.stringify(fetchRuns(engine).map(run => run.argv[2])) === JSON.stringify([web]), fetchRuns(engine).map(run => run.argv))
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('gh issue list runs once for the clone, whatever its worktrees', JSON.stringify(lists) === JSON.stringify([web]), engine.record.ghAt)

  // The worktree gets an intent of its own, committed on its branch, and an uncommitted changed copy of main's login.
  writeIntent(tree, 'draft', LOGIN.replace('# Login', '# Draft'))
  git(tree, 'add', 'docs/intent/draft')
  git(tree, 'commit', '-q', '-m', 'draft')
  writeIntent(tree, 'login', LOGIN.replace('- [ ] A2', '- [x] A2'))
  byKey(await pane(), 'sync')?.props.onPress()
  await engine.flush()
  await engine.flush()
  const more = intentRows(await pane())
  const ids = more.map(one => one.id).sort()
  expect("the worktree's own intent and its changed copy are listed under its folder's name, main's still once", JSON.stringify(ids) === JSON.stringify(['intent:login', 'intent:pay', 'intent:web-x/draft', 'intent:web-x/login']), ids)
  expect("each of the worktree's rows carries its folder's name", more.filter(one => one.id.startsWith('intent:web-x/')).every(one => one.repo === 'web-x'), more.map(one => [one.id, one.repo]))
  expect('and the pass still runs one fetch', JSON.stringify(fetchRuns(engine).map(run => run.argv[2])) === JSON.stringify([web, web]), fetchRuns(engine).map(run => run.argv[2]))

  more.find(one => one.id === 'intent:web-x/draft')?.press()
  byKey(await pane(), 'intent-work')?.props.onPress()
  await engine.flush()
  expect("Work on this here on the worktree's draft tracks { slug: 'draft', root: the worktree }", JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'draft', root: tree }), engine.store.get(`pinned:${sid}`))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')

  // The app aborts the session's first worktree lists: the pane starts with the checkout alone and finds the worktree at its next read.
  const late = makeClone('web-x')
  writeIntent(late.tree, 'draft', LOGIN.replace('# Login', '# Draft'))
  Object.assign(aborts, { argv: 'git worktree list', times: 99 })
  const slow = await boot({ root: late.web, sessionId: 'harness-session-0036' })
  slow.engine.setSurfaces(['terminal'])
  await slow.engine.command('ather', 'pick')
  const slowPane = () => slow.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const first = intentRows(await slowPane()).map(one => one.id).sort()
  expect('while git cannot list the worktrees, the pane lists the checkout alone', aborts.times < 99 && JSON.stringify(first) === JSON.stringify(['intent:login', 'intent:pay']), [aborts.times, first])
  await slow.engine.flush()
  await slow.engine.flush()
  aborts.times = 0
  byKey(await slowPane(), 'sync')?.props.onPress()
  await slow.engine.flush()
  await slow.engine.flush()
  const then = intentRows(await slowPane()).map(one => one.id).sort()
  expect("after its next read the pane lists the worktree's own intent, the checkout's keys unchanged", JSON.stringify(then) === JSON.stringify(['intent:login', 'intent:pay', 'intent:web-x/draft']), then)
  expect('no hook threw', slow.engine.record.hookErrors.length === 0, slow.engine.record.hookErrors)
  await slow.engine.end('other')
}

{
  // The app takes back the fetches the pane's draws start, as it does when a newer draw replaces one.
  const { s2 } = makeWorkspace()
  writeIntent(s2, 'login')
  const ahead = advanceOrigin(s2)
  Object.assign(aborts, { argv: `git -C ${s2} -c gc.auto=0`, times: 2 })
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0037' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  await pane()
  await engine.flush()
  await engine.flush()
  const line = String(byKey(await pane(), 'sync')?.props.label)
  await engine.flush()
  await engine.flush()
  expect('the first fetch of a session is rejected, and the sync line does not say the sync failed', aborts.times === 0 && fetchRuns(engine).length === 0 && !/failed/.test(line), [aborts.times, fetchRuns(engine).length, line])
  // No draw from here: the console's timer asks for the fetch that is still due.
  await engine.timers()
  await engine.flush()
  await engine.flush()
  expect("without another draw the console's timer fetches again: one fetch ended", fetchRuns(engine).length === 1 && git(s2, 'rev-parse', 'origin/main') === ahead, [fetchRuns(engine).map(run => run.argv[2]), git(s2, 'rev-parse', 'origin/main'), ahead])
  const after = String(byKey(await pane(), 'sync')?.props.label)
  await engine.timers()
  await engine.flush()
  expect('and the list is then synced, with no fetch after it', /^synced/.test(after) && fetchRuns(engine).length === 1, [after, fetchRuns(engine).length])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')

  // A fetch git itself fails (a bad origin) is a failed sync, and waits its ten minutes.
  const bad = makeWorkspace()
  writeIntent(bad.s2, 'login')
  git(bad.s2, 'remote', 'set-url', 'origin', join(BASE, 'no-such-origin.git'))
  const failing = await boot({ root: bad.s2, sessionId: 'harness-session-0038' })
  failing.engine.setSurfaces(['terminal'])
  await failing.engine.command('ather', 'pick')
  const badPane = () => failing.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  await badPane()
  await failing.engine.flush()
  await failing.engine.flush()
  await failing.engine.timers()
  await failing.engine.flush()
  const failed = String(byKey(await badPane(), 'sync')?.props.label)
  await failing.engine.flush()
  expect('a fetch git fails still says the sync failed, and is not tried again before its ten minutes', /failed/.test(failed) && fetchRuns(failing.engine).length === 1, [failed, fetchRuns(failing.engine).length])
  expect('no hook threw', failing.engine.record.hookErrors.length === 0, failing.engine.record.hookErrors)
  await failing.engine.end('other')
}

{
  // web/ beside s2/, which has a worktree nested inside it with an intent of its own.
  const nested = () => {
    const { s2, web } = makeWorkspace()
    const x = join(s2, '.claude/worktrees/x')
    git(s2, 'worktree', 'add', '-q', '-b', 'x', x)
    writeIntent(web, 'login')
    writeIntent(x, 'draft')
    return { s2, web, x }
  }
  const idsOf = async engine => {
    engine.setSurfaces(['terminal'])
    await engine.command('ather', 'pick')
    const ids = intentRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather')).map(one => one.id).sort()
    await engine.flush()
    await engine.flush()
    return ids
  }

  const inS2 = nested()
  const first = await boot({ root: inS2.s2, sessionId: 'harness-session-0032' })
  const ids = await idsOf(first.engine)
  expect('a session in s2 finds the worktree nested in it, and lists nothing of web beside it', JSON.stringify(ids) === JSON.stringify(['intent:x/draft']), ids)
  expect('and fetches once in a pass, for its clone', JSON.stringify(fetchRuns(first.engine).map(run => run.argv[2])) === JSON.stringify([inS2.s2]), fetchRuns(first.engine).map(run => run.argv[2]))
  expect('no hook threw', first.engine.record.hookErrors.length === 0, first.engine.record.hookErrors)
  await first.engine.end('other')

  const inWeb = nested()
  const second = await boot({ root: inWeb.web, sessionId: 'harness-session-0033' })
  const found = await idsOf(second.engine)
  expect("a session in web lists its own intent, and not the worktree of s2 beside it", JSON.stringify(found) === JSON.stringify(['intent:login']), found)
  expect('and fetches once in a pass, for its clone', JSON.stringify(fetchRuns(second.engine).map(run => run.argv[2])) === JSON.stringify([inWeb.web]), fetchRuns(second.engine).map(run => run.argv[2]))
  expect('no hook threw', second.engine.record.hookErrors.length === 0, second.engine.record.hookErrors)
  await second.engine.end('other')
}

{
  // A checkout with no origin (its repository is its folder), where gh is not signed in; with `tree`, a worktree beside it.
  const refreshed = async (tree, sessionId) => {
    const parent = fs.mkdtempSync(join(BASE, 'local-'))
    const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: { ...INTENTS, '.ather/profile.json': `${JSON.stringify(WEB_PROFILE, null, 2)}\n` } })
    git(web, 'remote', 'remove', 'origin')
    if (tree) git(web, 'worktree', 'add', '-q', '-b', 'feat/x', join(parent, tree))
    const { engine } = await boot({ root: web, sessionId, ghAt: {} })
    engine.setSurfaces(['terminal'])
    await issuesRead(engine, { [web]: {} })
    await engine.flush()
    const { said } = await refresh(engine)
    const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
    const errors = engine.record.hookErrors
    await engine.end('other')
    return { web, said, lists, errors }
  }
  const alone = await refreshed('', 'harness-session-0034')
  const withTree = await refreshed('web-x', 'harness-session-0035')
  expect('a checkout with no origin and a worktree: gh issue list runs once a read, in the checkout', JSON.stringify(withTree.lists) === JSON.stringify(alone.lists.map(() => withTree.web)) && alone.lists.length === 2, [alone.lists, withTree.lists])
  expect('and Refresh reports what it reports without the worktree', withTree.said !== '' && withTree.said === alone.said, [alone.said, withTree.said])
  expect('no hook threw', alone.errors.length === 0 && withTree.errors.length === 0, [...alone.errors, ...withTree.errors])
}

// ---------------------------------------------------------------- a team that merges into another branch

{
  // A clone at <parent>/<folder> of a bare origin whose default branch is `base`, so the checkout knows it
  // (refs/remotes/origin/HEAD, as any clone does). `also`: more branches the origin has, each at the first commit.
  const makeClone = (parent, folder, { owner, name, base, files = {}, also = [] }) => {
    const origin = path.join(`${parent}-origins`, owner, `${name}.git`)
    fs.mkdirSync(origin, { recursive: true })
    git(origin, 'init', '--bare', '-q', '-b', base)
    const seed = fs.mkdtempSync(join(BASE, 'seed-'))
    git(seed, 'init', '-q', '-b', base)
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(join(seed, file)), { recursive: true })
      fs.writeFileSync(join(seed, file), text)
    }
    git(seed, 'add', '-A')
    git(seed, '-c', 'user.name=Lam Phung', '-c', 'user.email=lam@example.com', 'commit', '-q', '-m', 'start')
    git(seed, 'push', '-q', origin, base, ...also.map(one => `${base}:${one}`))
    git(parent, 'clone', '-q', origin, folder)
    const root = join(parent, folder)
    git(root, 'config', 'user.name', 'Tin Nguyen')
    git(root, 'config', 'user.email', 'tin@example.com')
    return root
  }
  // A teammate merges an intent into `branch` of a checkout's origin: the checkout has not pulled it. Resolves its commit.
  const mergeIntent = (root, branch, slug) => {
    const other = fs.mkdtempSync(join(BASE, 'other-'))
    git(other, 'clone', '-q', '-b', branch, git(root, 'remote', 'get-url', 'origin'), '.')
    writeIntent(other, slug, LOGIN.replace('Owner: Tin Nguyen', 'Owner: Lam Phung'))
    git(other, 'add', '-A')
    git(other, '-c', 'user.name=Lam Phung', '-c', 'user.email=lam@example.com', 'commit', '-q', '-m', slug)
    git(other, 'push', '-q', 'origin', branch)
    return git(other, 'rev-parse', 'HEAD')
  }
  const warnOf = (tree, id) => textIn(byKey(tree, `${intentRows(tree).find(one => one.id === id)?.key}-warn`)).trim()
  const refsAsked = engine => engine.record.gitRuns.filter(run => run.argv.includes('--verify')).map(run => run.argv.at(-1))

  // nm/ merges into develop (its origin's main exists and stays behind); web/ beside it merges into main.
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const nm = makeClone(parent, 'nm', { owner: 'sipherxyz', name: 'nm', base: 'develop', also: ['main'], files: { ...INTENTS, 'pyproject.toml': '[project]\nname = "nm"\n' } })
  const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: { ...INTENTS, 'package.json': '{"name":"web"}\n' } })
  writeIntent(web, 'login')
  // One intent merged into develop and pulled, a later one the checkout has not pulled; main has neither.
  mergeIntent(nm, 'develop', 'merged')
  git(nm, 'pull', '-q', '--ff-only', 'origin', 'develop')
  const later = mergeIntent(nm, 'develop', 'later')
  const { engine, sessionId: sid } = await boot({ root: nm, sessionId: 'harness-session-0050' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const first = await pane()
  expect("a checkout whose origin's default is develop lists the intent merged there as the team's, not tagged local", intentRows(first).some(one => one.id === 'intent:merged') && warnOf(first, 'intent:merged') === '', [intentRows(first).map(one => one.id), warnOf(first, 'intent:merged')])
  await engine.flush()
  await engine.flush()
  const fetches = fetchRuns(engine).map(run => run.argv.slice(2))
  expect('its fetch names develop in both halves of the refspec', fetches.some(argv => argv[0] === nm && argv.at(-1) === '+refs/heads/develop:refs/remotes/origin/develop'), fetches)
  expect('the checkout on main beside it is not fetched', fetches.every(argv => argv[0] === nm) && fetches.length === 1, fetches)
  expect("after it, origin/develop is at what the teammate merged, and origin/main was not asked for in nm", git(nm, 'rev-parse', 'origin/develop') === later && !engine.record.gitRuns.some(run => run.argv[2] === nm && run.argv.at(-1) === 'origin/main^{commit}'), engine.record.gitRuns.filter(run => run.argv[2] === nm).map(run => run.argv.slice(3).join(' ')))
  const after = await pane()
  const rows = intentRows(after).map(one => one.id).sort()
  expect("the list then holds both of develop's intents and nothing of web beside it, the later one not in the checkout and not tagged local", JSON.stringify(rows) === JSON.stringify(['intent:later', 'intent:merged']) && warnOf(after, 'intent:later') === '' && !fs.existsSync(join(nm, 'docs/intent/later')), [rows, warnOf(after, 'intent:later')])
  const heads = engine.record.gitRuns.filter(run => run.argv.includes('symbolic-ref'))
  expect("no checkout's default branch is asked of git: it is read from the clone's files", heads.length === 0, heads)

  await startAway(engine)
  const toBase = await bash(engine, 'git push origin develop')
  expect('with an away window, git push origin develop is held as a push to the base', toBase.deny !== undefined && parked(engine, sid).at(-1)?.kind === 'push-main', [toBase.deny, parked(engine, sid)])
  const toMain = await bash(engine, 'git push origin main')
  expect('git push origin main is held there too', toMain.deny !== undefined && parked(engine, sid).length === 2, parked(engine, sid))
  const toFeature = await bash(engine, 'git push origin feature')
  expect('git push origin feature is not', toFeature.deny === undefined, toFeature.deny)
  const inWeb = await bash(engine, 'git -C ../web push origin develop')
  expect("develop is not web's base: a push to it there is not held", inWeb.deny === undefined, inWeb.deny)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')

  // The other way round: a session in web (base main), nm beside it. What is held in nm is said with nm's base.
  const beside = await boot({ root: web, sessionId: 'harness-session-0052' })
  await startAway(beside.engine)
  const there = await bash(beside.engine, 'git -C ../nm push origin develop')
  expect("from a session on main, a push to develop in ../nm is held and the denial names develop", there.deny !== undefined && /develop/.test(there.deny), there.deny)
  const here = await bash(beside.engine, 'git push origin main')
  expect("a push to main in the session's own checkout is said as before", here.deny !== undefined && !/develop/.test(here.deny), here.deny)
  await beside.engine.end('other')

  // rel/: the origin's default is main, the team merges into release, and the profile says so.
  const rel = makeClone(fs.mkdtempSync(join(BASE, 'work-')), 'rel', { owner: 'sipherxyz', name: 'rel', base: 'main', also: ['release'], files: { ...INTENTS, '.ather/profile.json': `${JSON.stringify({ version: 1, pack: 'core', baseBranch: 'release' })}\n` } })
  mergeIntent(rel, 'release', 'on-release')
  git(rel, 'fetch', '-q', 'origin')
  const profiled = await boot({ root: rel, sessionId: 'harness-session-0051' })
  profiled.engine.setSurfaces(['terminal'])
  await profiled.engine.command('ather', 'pick')
  const listed = intentRows(await profiled.engine.render('Pane', { bodyColumns: 110 }, 'ather')).map(one => one.id)
  await profiled.engine.flush()
  await profiled.engine.flush()
  expect('a profile with "baseBranch": "release" lists what origin/release holds', JSON.stringify(listed) === JSON.stringify(['intent:on-release']), listed)
  expect("and reads and fetches release, never main, whatever the remote's default", refsAsked(profiled.engine).includes('origin/release^{commit}') && !refsAsked(profiled.engine).includes('origin/main^{commit}') && fetchRuns(profiled.engine).every(run => run.argv.at(-1) === '+refs/heads/release:refs/remotes/origin/release') && fetchRuns(profiled.engine).length === 1, [refsAsked(profiled.engine), fetchRuns(profiled.engine).map(run => run.argv.at(-1))])
  expect('no hook threw', profiled.engine.record.hookErrors.length === 0, profiled.engine.record.hookErrors)
  await profiled.engine.end('other')

  // multi/ merges into main; its worktree beside it, multi-rel/, names release in a profile of its own.
  const group = fs.mkdtempSync(join(BASE, 'work-'))
  const multi = makeClone(group, 'multi', { owner: 'sipherxyz', name: 'multi', base: 'main', also: ['release'], files: { ...INTENTS } })
  const tree = join(group, 'multi-rel')
  git(multi, 'worktree', 'add', '-q', '-b', 'feat/rel', tree)
  fs.mkdirSync(join(tree, '.ather'), { recursive: true })
  fs.writeFileSync(join(tree, '.ather/profile.json'), `${JSON.stringify({ version: 1, pack: 'core', baseBranch: 'release' })}\n`)
  mergeIntent(multi, 'main', 'on-main')
  mergeIntent(multi, 'release', 'on-release')
  const two = await boot({ root: multi, sessionId: 'harness-session-0053', writable: [group] })
  two.engine.setSurfaces(['terminal'])
  await two.engine.command('ather', 'pick')
  await two.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  await two.engine.flush()
  await two.engine.flush()
  const pass = fetchRuns(two.engine).map(run => [run.argv[2], run.argv.at(-1)])
  expect('a clone on main with a worktree on another base: one pass fetches both branches, each in its own checkout', JSON.stringify(pass) === JSON.stringify([[multi, '+refs/heads/main:refs/remotes/origin/main'], [tree, '+refs/heads/release:refs/remotes/origin/release']]), pass)
  const drawn = await two.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const both = intentRows(drawn).map(one => one.id).sort()
  expect("the worktree's row for its base's intent is the team's, not tagged local, beside main's", JSON.stringify(both) === JSON.stringify(['intent:multi-rel/on-release', 'intent:on-main']) && warnOf(drawn, 'intent:multi-rel/on-release') === '', [both, warnOf(drawn, 'intent:multi-rel/on-release')])
  expect('no hook threw', two.engine.record.hookErrors.length === 0, two.engine.record.hookErrors)
  await two.engine.end('other')
}

// ---------------------------------------------------------------- a press while a turn runs

// Next's row as the pane draws it, and the last pop-up.
const nextRow = async engine => byKey(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'next')
const lastToast = engine => engine.record.toasts.at(-1) ?? ''
const buttonOf = (tree, key) => nodesOf(tree).find(node => node.type === 'Button' && node.props?.key === key)

{
  // One web checkout; the session tracks its intent, so Home has a Next step to hand over.
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  const { engine } = await boot({ root: web, sessionId: 'harness-session-0020' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'intent login')
  await engine.command('ather')
  const idle = await nextRow(engine)
  expect('Home offers a Next step for the tracked intent', idle && !/queued|sent/.test(idle.props.label), idle?.props.label)

  // The person typed a prompt and its turn runs: the engine holds a plugin's prompt until that turn ends.
  await engine.turnStart()
  const submitsBefore = engine.record.submits.length
  idle.props.onPress()
  await engine.flush()
  expect('pressed while a turn runs, Next is queued behind it: the session has nothing yet', engine.queued().length === 1 && engine.record.submits.length === submitsBefore, [engine.queued(), engine.record.submits.slice(submitsBefore)])
  expect('the pop-up says queued until the turn ends, never sent', /^Ather: Queued until this turn ends/.test(lastToast(engine)) && !/sent/i.test(lastToast(engine)), lastToast(engine))
  const waiting = await nextRow(engine)
  expect('its row reads queued, not sent', /^⏳ queued · /.test(waiting?.props.label ?? ''), waiting?.props.label)
  const band = await engine.render('AbovePrompt', {})
  expect('the line above the prompt says a press is queued', /queued until this turn ends/.test(textIn(band)), textIn(band))

  // A second press of the same row, by a click or its key, sends nothing more.
  waiting.props.onPress()
  await engine.flush()
  expect('pressed again while it waits: still one prompt queued, and the pop-up says it already waits', engine.queued().length === 1 && /^Ather: Already queued/.test(lastToast(engine)), [engine.queued().length, lastToast(engine)])

  await engine.turnEnd()
  await engine.flush()
  expect('when the turn ends the session gets the one prompt', engine.queued().length === 0 && engine.record.submits.length === submitsBefore + 1, engine.record.submits.slice(submitsBefore))
  expect('and the pop-up says it was sent, after how long', /^Ather: Sent to the session: it was queued for \d+s\.$/.test(lastToast(engine)), lastToast(engine))
  const done = await nextRow(engine)
  expect('its row then reads sent', /^✓ sent · /.test(done?.props.label ?? ''), done?.props.label)
  const debug = engine.record.logs.filter(line => /^Ather hand-off: /.test(line))
  expect('the debug log has the press, the second press and the delivery', debug.some(line => /pressed at .*queued behind the running turn/.test(line)) && debug.some(line => /pressed again while it waits/.test(line)) && debug.some(line => /delivered after \d+ ms/.test(line)), debug)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

{
  // "I'm back" pressed while a turn runs: the window must hold until the session has read it.
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0021' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'intent login')
  await engine.command('away', 'until done')
  await engine.flush()
  expect('an away window runs', engine.store.get(`away:${sid}`)?.phase === 'running', engine.store.get(`away:${sid}`))
  const asked = await engine.modelTool({ tool: 'AskUserQuestion', questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }], multiSelect: false }] })
  expect('a question during a window with no set end is refused with "until the work is done", not a time of day', /The user is away until the work is done \(hard stop \d\d:\d\d local time\)/.test(asked.deny ?? '') && !/away until \d/.test(asked.deny ?? ''), asked.deny)

  await engine.turnStart()
  await engine.command('ather')
  const back = buttonOf(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'end')
  const submitsBefore = engine.record.submits.length
  back?.props.onPress()
  await engine.flush()
  const waiting = engine.store.get(`away:${sid}`)
  expect("pressed mid-turn, the review is queued and the window is not closed: it waits for its review", engine.queued().some(text => /^I am back\./.test(text)) && engine.record.submits.length === submitsBefore && waiting?.phase === 'review', [engine.queued(), waiting?.phase])
  expect('the pop-up says it is queued and that merges are still held', /^Ather: Queued until this turn ends\. .*merges are still held/.test(lastToast(engine)), lastToast(engine))
  const held = await bash(engine, 'gh pr merge 5 --merge')
  expect('a merge the running turn tries meanwhile is still held', held.deny !== undefined && parked(engine, sid).at(-1)?.kind === 'merge', [held.deny, parked(engine, sid)])
  const again = await engine.modelTool({ tool: 'AskUserQuestion', questions: [{ question: 'Merge now?', header: 'Merge', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }], multiSelect: false }] })
  expect('and its question is still recorded, not asked', /has not reviewed the away window yet/.test(again.deny ?? ''), again.deny)

  await engine.turnEnd()
  await engine.flush()
  expect('when the turn ends the session gets "I am back", once', engine.record.submits.slice(submitsBefore).filter(text => /^I am back\./.test(text)).length === 1, engine.record.submits.slice(submitsBefore))
  expect('and only then the window closes', engine.store.get(`away:${sid}`) === undefined, engine.store.get(`away:${sid}`))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

{
  // "I'm back" waits behind a turn: the pane stays and offers to stop that turn. Only that press stops it.
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0022' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'intent login')
  await engine.command('away', '4h')
  await engine.flush()
  const running = await engine.turnStart()
  await engine.command('ather')
  const closesBefore = engine.record.closes.length
  const submitsBefore = engine.record.submits.length
  buttonOf(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'end')?.props.onPress()
  await engine.flush()
  const home = await engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const stop = nodesOf(home).find(node => node.type === 'Button' && /^now-review:\d+-press$/.test(node.props?.key ?? ''))
  expect('queued mid-turn, the pane stays open and the review reads queued', engine.record.closes.length === closesBefore && nodesOf(home).some(node => node.type === 'Button' && /^⏳ queued · Review/.test(node.props?.label ?? '')), [engine.record.closes.length - closesBefore, nodesOf(home).filter(node => node.type === 'Button').map(node => node.props.label)])
  expect('it offers to stop the running turn and send now; no turn is stopped unasked', stop?.props.label === 'Stop the running turn and send now' && engine.record.aborts.length === 0 && engine.store.get(`away:${sid}`)?.phase === 'review', [stop?.props.label, engine.record.aborts])
  stop?.props.onPress()
  await engine.flush()
  expect('that press stops the running turn, by its id', JSON.stringify(engine.record.aborts) === JSON.stringify([running]), [engine.record.aborts, running])
  expect('the session then gets "I am back" once, and the window closes', engine.record.submits.slice(submitsBefore).filter(text => /^I am back\./.test(text)).length === 1 && engine.queued().length === 0 && engine.store.get(`away:${sid}`) === undefined, [engine.record.submits.slice(submitsBefore), engine.store.get(`away:${sid}`)])
  const after = await engine.render('Pane', { bodyColumns: 110 }, 'ather')
  expect('nothing offers to stop a turn once it is delivered', !nodesOf(after).some(node => /^now-/.test(node.props?.key ?? '')), nodesOf(after).filter(node => node.type === 'Button').map(node => node.props.key))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

{
  // With the session idle "I'm back" goes at once: the pane closes as before, and nothing offers to stop a turn.
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0023' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'intent login')
  await engine.command('away', '4h')
  await engine.flush()
  await engine.command('ather')
  const closesBefore = engine.record.closes.length
  buttonOf(await engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'end')?.props.onPress()
  await engine.flush()
  expect('idle: the session has "I am back" at once, the window is closed, the pane closes, no turn is stopped', /^I am back\./.test(engine.record.submits.at(-1) ?? '') && engine.store.get(`away:${sid}`) === undefined && engine.record.closes.length === closesBefore + 1 && engine.record.aborts.length === 0 && lastToast(engine) === 'Ather: Sent to the session.', [engine.record.submits.at(-1), engine.store.get(`away:${sid}`), lastToast(engine)])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- a press about another session's intent

{
  // Two sessions on one checkout. The first tracks login; the second tracks nothing, so its Home offers
  // login's decision too. A press there asks where it goes before anything lands in a chat.
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  writeFindings(web, 'login')
  const first = await boot({ root: web, sessionId: 'harness-session-0030' })
  await first.engine.command('ather', 'intent login')
  await first.engine.timers()
  const lane = join(web, '.ather/local/lanes', 'harness-session-0030.json')
  const beat = readJson(lane)
  expect("the first session's heartbeat names login", beat?.intent === 'login' && beat.hasEnded === false, beat)

  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0031' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const CALL = 'call:login:F-1'
  const counts = () => [engine.record.sends.length, engine.record.submits.length, engine.record.dialogs.length]
  expect("the second session tracks nothing and is offered login's decision", !engine.store.has(`pinned:${sid}`) && Boolean(byKey(await pane(), `option-${CALL}-A`)), nodesOf(await pane()).map(node => node.props?.key).filter(key => /call:/.test(key ?? '')))

  // Closed without choosing: nothing goes anywhere.
  let [sends, submits, dialogs] = counts()
  engine.script.push(() => null)
  byKey(await pane(), `explain-${CALL}`)?.props.onPress()
  await engine.flush()
  const asked = engine.record.dialogs.at(-1)
  expect('Explain on it asks where it should go, naming the session that tracks login first', engine.record.dialogs.length === dialogs + 1 && asked?.header === 'Send where?' && /login is tracked in another session, not in this one/.test(asked.question) && JSON.stringify(asked.options.map(option => option.label)) === JSON.stringify(['Send to session harness- (Recommended)', 'Send here']), asked)
  expect('closed without an answer, nothing is sent to either session', engine.record.sends.length === sends && engine.record.submits.length === submits && lastToast(engine) === 'Ather: Not sent: it was not said where it should go.', [counts(), lastToast(engine)])

  // Send here: this session's chat gets it, as before, because the person said so.
  ;[sends, submits, dialogs] = counts()
  engine.script.push(() => 'Send here')
  byKey(await pane(), `explain-${CALL}`)?.props.onPress()
  await engine.flush()
  expect('"Send here" puts it in this session and sends nothing across', engine.record.sends.length === sends && engine.record.submits.length === submits + 1 && /^Explain decision F-1 on login/.test(lastSubmit(engine)), [counts(), lastSubmit(engine)])

  // The other session cannot be reached: said, and nothing lands here unasked.
  ;[sends, submits, dialogs] = counts()
  engine.setSend({ isDelivered: false, reason: 'that session is not running' })
  engine.script.push(question => question.options[0].label)
  byKey(await pane(), `explain-${CALL}`)?.props.onPress()
  await engine.flush()
  expect('a session that cannot be reached is said, with the reason, and nothing is put here instead', engine.record.sends.length === sends + 1 && engine.record.submits.length === submits && /^Ather: could not reach session harness-: that session is not running\. Nothing was sent/.test(lastToast(engine)), [counts(), lastToast(engine)])
  engine.setSend({ isDelivered: true })

  // The first session has ended: nobody else tracks login, so the press goes here with no question.
  ;[sends, submits, dialogs] = counts()
  fs.writeFileSync(lane, JSON.stringify({ ...beat, hasEnded: true }))
  byKey(await pane(), `explain-${CALL}`)?.props.onPress()
  await engine.flush()
  expect('with no other live session on login, it goes here unasked', engine.record.dialogs.length === dialogs && engine.record.sends.length === sends && engine.record.submits.length === submits + 1, counts())
  fs.writeFileSync(lane, JSON.stringify({ ...beat, updatedAt: Date.now() }))

  // The answer itself, sent to the session that tracks login: by its id, and not into this chat.
  ;[sends, submits, dialogs] = counts()
  engine.script.push(question => question.options[0].label)
  byKey(await pane(), `option-${CALL}-A`)?.props.onPress()
  await engine.flush()
  const routed = engine.record.sends.at(-1)
  expect("answering A sends the decision to the first session by its id, and nothing into this session's chat", engine.record.sends.length === sends + 1 && engine.record.submits.length === submits && JSON.stringify(routed?.to) === JSON.stringify({ sessionId: 'harness-session-0030' }), [counts(), routed?.to])
  expect('what it reads says where the press was made, names login and carries the decision whole', /^From the Ather pane of "session harness-": the person pressed this there/.test(routed?.text ?? '') && routed.text.includes('it tracks intent login') && routed.text.includes('Decide F-1 on login: A — One page'), routed?.text)
  expect('the pop-up names the session it went to', /^Ather: sent to session harness-, which tracks login\./.test(lastToast(engine)), lastToast(engine))
  const answered = nodesOf(await pane()).map(node => node.props?.key)
  expect('the row reads decided here', answered.includes(`item-${CALL}-done`), answered.filter(key => /call:/.test(key ?? '')))
  expect('no hook threw', engine.record.hookErrors.length === 0 && first.engine.record.hookErrors.length === 0, [engine.record.hookErrors, first.engine.record.hookErrors])
  await engine.end('other')
}

// ---------------------------------------------------------------- redraws: Ather's own pane, and only for what changed

{
  // A redraw hands out new press handles, and Claude Code answers a desktop press that names an older one
  // `handled: false`: the press is lost. So the console draws again only its own pane, and only when what it
  // shows has changed (time alone: once a minute while the pane is up).
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  const { engine } = await boot({ root: web, sessionId: 'harness-session-0040' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  await pane()
  await engine.flush()
  await engine.flush()
  expect("Ather's redraws select its own pane and never another plugin's", engine.selects('ui.render', { component: 'Pane', requestId: 'ather' }) && !engine.selects('ui.render', { component: 'Pane', requestId: 'review-debate' }))
  // The clocks' turn: the minute's read and check, the five seconds' worker clock.
  const tick = async () => {
    const before = engine.record.invalidations
    await engine.timers()
    await engine.flush()
    return engine.record.invalidations - before
  }
  const up = await tick()
  expect('with the pane up, its ages are drawn again once a minute', up === 1, up)
  await engine.close('ather')
  await engine.render('AbovePrompt', { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 110 }, 'band')
  const down = await tick()
  expect('with the pane closed, a read that finds nothing new and a band whose words stand draw nothing again', down === 0, down)
  writeIntent(web, 'search', LOGIN.replace('# Login', '# Search'))
  const found = await tick()
  expect('a read that finds a new intent draws again', found > 0, found)
  engine.addAgent({ id: 'worker-1', description: 'a worker' })
  const closedWorker = await tick()
  expect('with the pane closed, a running worker draws nothing again', closedWorker === 0, closedWorker)
  await engine.command('ather', 'pick')
  await pane()
  const pickWorker = await tick()
  await engine.command('ather')
  await pane()
  const homeWorker = await tick()
  expect("a running worker's clock draws the pane again on Home, which shows it, and not on Everything open", pickWorker === 1 && homeWorker === 2, [pickWorker, homeWorker])
  await engine.command('ather', 'pick')
  expect('the pane lists the new intent', intentRows(await pane()).some(one => one.id === 'intent:search'))
  // Back from an Intent view while it is still drawn: that drawing reads the intent's files, so it would end after
  // the list's. Claude Code keeps the press handles of the drawing that left the hook last and the surface shows the
  // one it asked for last: they must be one drawing, or every press on the list is lost.
  byKey(await pane(), 'pick-intent:login')?.props.onPress()
  const view = await pane()
  const left = []
  const slow = pane().then(() => left.push('older'))
  // The section around Back shares its key: the press is on the Button inside.
  nodesOf(view).find(node => node.type === 'Button' && node.props?.key === 'intent-back')?.props.onPress()
  const fast = pane().then(() => left.push('newer'))
  await Promise.all([slow, fast])
  expect('drawings of the pane leave the hook in the order they were asked for', JSON.stringify(left) === JSON.stringify(['older', 'newer']), left)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- Home in Simple and Advanced views (simple-view)

{
  const { web } = makeWorkspace()
  writeIntent(web, 'login')
  const { engine } = await boot({ root: web, sessionId: 'harness-session-0030' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'intent login')
  await engine.command('ather')
  const home = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const keysOf = tree => new Set(nodesOf(tree).map(node => node.props?.key).filter(Boolean))
  const hotkeysOf = tree => nodesOf(tree).filter(node => node.type === 'Button' && node.props?.hotkey).map(node => node.props.hotkey)
  // The parts this fixture draws in Advanced at any hour (no workers run here): the stage track, the meta line, the strip,
  // quick actions, Everything open, Stepping out?. Heading off? shows only in the evening: Simple must leave it out too.
  const PARTS = ['stages', 'meta', 'strip', 'actions', 'all', 'warm']
  const advanced = await home()
  expect('A3: Home opens in Advanced with all those parts and Next, and a quiet "Simple view" button keyed v', PARTS.every(key => keysOf(advanced).has(key)) && keysOf(advanced).has('next-section') && buttonOf(advanced, 'view-toggle')?.props.label === 'Simple view' && buttonOf(advanced, 'view-toggle')?.props.hotkey === 'v', PARTS.filter(key => !keysOf(advanced).has(key)))

  buttonOf(advanced, 'view-toggle').props.onPress()
  await engine.flush()
  const simple = await home()
  expect('A2: Simple leaves out the strip, quick actions, the track, the meta line, workers, previews and Stepping out?; keeps the title and Next', PARTS.every(key => !keysOf(simple).has(key)) && !keysOf(simple).has('away') && keysOf(simple).has('title') && keysOf(simple).has('next-section') && buttonOf(simple, 'view-toggle')?.props.label === 'Advanced view', [...keysOf(simple)])
  expect('A4: the press is kept for the person', engine.store.get('view:tinnguyen') === 'simple', engine.store.get('view:tinnguyen'))
  expect('A6: every key on Simple and Advanced Home is drawn once', [advanced, simple].every(tree => new Set(hotkeysOf(tree)).size === hotkeysOf(tree).length), [hotkeysOf(advanced), hotkeysOf(simple)])

  const next = await boot({ root: web, sessionId: 'harness-session-0031', kept: engine.store })
  next.engine.setSurfaces(['terminal'])
  await next.engine.command('ather')
  const again = await next.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  expect('A4: a new session opens Home in the view the person chose', !keysOf(again).has('warm') && buttonOf(again, 'view-toggle')?.props.label === 'Advanced view', [...keysOf(again)])

  const said = String((await next.engine.command('ather', 'advanced'))?.text ?? '')
  const back = await next.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  expect('A5: /ather advanced brings everything back and says how to go simple', /\/ather simple/.test(said) && keysOf(back).has('warm') && next.engine.store.get('view:tinnguyen') === 'advanced', [said, next.engine.store.get('view:tinnguyen')])
  const simpleSaid = String((await next.engine.command('ather', 'simple'))?.text ?? '')
  expect('A5: /ather simple shows less and says how to go back', /\/ather advanced/.test(simpleSaid) && next.engine.store.get('view:tinnguyen') === 'simple', simpleSaid)

  // Group in Everything open is remembered the same way (one shared helper): pressed, kept, read by the next session.
  await next.engine.command('ather', 'pick')
  const pick = () => next.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  buttonOf(await pick(), 'pick-group')?.props.onPress()
  await next.engine.flush()
  const grouped = buttonOf(await pick(), 'pick-group')?.props.label
  const third = await boot({ root: web, sessionId: 'harness-session-0032', kept: next.engine.store })
  third.engine.setSurfaces(['terminal'])
  await third.engine.command('ather', 'pick')
  const regrouped = buttonOf(await third.engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'pick-group')?.props.label
  expect('Group is kept for the person and read by a new session, as the view is', grouped === 'Group: Area' && next.engine.store.get('groupBy:tinnguyen') === 'area' && regrouped === 'Group: Area', [grouped, next.engine.store.get('groupBy:tinnguyen'), regrouped])
  await third.engine.end('other')
  await next.engine.command('ather')
  const desk = await next.engine.render('Pane', { bodyColumns: 110 }, 'ather', 'desktop')
  expect('A6: on the desktop the toggle is a button with no key drawn', buttonOf(desk, 'view-toggle')?.props.hotkey === undefined && buttonOf(desk, 'view-toggle')?.props.label === 'Advanced view', buttonOf(desk, 'view-toggle')?.props)
  expect('no hook threw', engine.record.hookErrors.length === 0 && next.engine.record.hookErrors.length === 0, [engine.record.hookErrors, next.engine.record.hookErrors])
  await engine.end('other')
  await next.engine.end('other')
}

// ---------------------------------------------------------------- report

fs.rmSync(BASE, { recursive: true, force: true })
finish({ title: 'Ather Automata across checkouts', report: OUT })
