// End-to-end run of the Ather Automata hooks module over several real git checkouts: a parent
// folder holding an S2 checkout and a web checkout, each with a local bare origin, driven
// through the stand-in engine. Needs no S2_ROOT. `node repos.mjs [report.md]`.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { aborts, createEngine } from './engine.mjs'

const OUT = process.argv[2]
const { register } = await import('./out/hooks/ather.mjs')

// The person's own git settings (signing, hooks, default branch) stay out of these repositories and of the hooks' git calls.
// Folders with forward slashes, as the hooks name a checkout: on Windows path.join and the temporary folder give backslashes.
const join = (...parts) => path.join(...parts).split(path.sep).join('/')
// The folder's real path: git names a checkout by it (macOS's temporary folder is behind a link).
const BASE = join(fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'ather-repos-'))))
fs.writeFileSync(join(BASE, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = join(BASE, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const results = []
const expect = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })

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

// A session opened in `root`, started as the app starts it.
const boot = async ({ root, sessionId = 'harness-session-0001', user = 'Tin Nguyen', options = {}, writable, ghAt, kept, cwd }) => {
  const engine = createEngine({ root, surfaces: [], user, writable, ghAt, kept })
  engine.setSessionId(sessionId)
  register(engine.on, { briefGate: 'warn', ...options })
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

  // web is not in this session's workspace (s2 is a checkout, no repos option): its view still draws.
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
  // /ather intent <name>: a name only another workspace checkout has is tracked there.
  const { s2, web } = makeWorkspace()
  fs.mkdirSync(join(web, 'docs/intent/search'), { recursive: true })
  fs.writeFileSync(join(web, 'docs/intent/search/prompt.md'), LOGIN)
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0005', options: { repos: '../web' } })
  await engine.command('ather', 'intent search')
  expect('/ather intent search tracks it in web, the workspace checkout that has it', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'search', root: web }), engine.store.get(`pinned:${sid}`))
}

// ---------------------------------------------------------------- one pane over the workspace

// Every node of a drawn pane, depth first.
const nodesOf = node => (!node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(nodesOf)])
const byKey = (tree, key) => nodesOf(tree).find(node => node.props?.key === key)
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
  // A session opened in the parent folder over s2/ and web/, both with intents, `login` in both.
  const { parent, s2, web } = makeWorkspace()
  writeIntent(s2, 'login')
  writeIntent(web, 'login')
  // web's login is the later of the two by a clear second: Home offers the newer one to the next session,
  // and two files written within one tick of the clock carry one time on Windows.
  const earlier = new Date(Date.now() - 1000)
  fs.utimesSync(join(s2, 'docs/intent/login/prompt.md'), earlier, earlier)
  writeIntent(web, 'search', LOGIN.replace('Owner: Tin Nguyen', 'Owner: TienPham'))
  const ahead = { s2: advanceOrigin(s2), web: advanceOrigin(web) }
  const { engine, sessionId: sid } = await boot({ root: parent, sessionId: 'harness-session-0006' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const pick = await pane()
  const rows = intentRows(pick)
  const ids = rows.map(one => one.id).sort()
  expect("Everything open lists both checkouts' intents by key", JSON.stringify(ids) === JSON.stringify(['intent:s2/login', 'intent:web/login', 'intent:web/search']), ids)
  expect('the same slug in both checkouts is two rows', rows.filter(one => /\/login$/.test(one.id)).length === 2, rows.map(one => one.id))
  expect('each row carries its repository\'s name', rows.length === 3 && rows.every(one => one.repo === one.id.slice('intent:'.length).split('/')[0]), rows.map(one => [one.id, one.repo]))

  // The first draw fetches each checkout's origin, one after the other.
  await engine.flush()
  await engine.flush()
  const fetches = fetchRuns(engine).map(run => run.argv[2])
  expect('the first draw fetches both origins, one at a time, in workspace order', JSON.stringify(fetches) === JSON.stringify([s2, web]), fetches)
  const mains = { s2: git(s2, 'rev-parse', 'origin/main'), web: git(web, 'rev-parse', 'origin/main') }
  expect("after it, each checkout's origin/main is at what its origin holds", mains.s2 === ahead.s2 && mains.web === ahead.web, { mains, ahead })
  const synced = byKey(await pane(), 'sync')
  // ↻ fetches every checkout that may fetch now.
  synced?.props.onPress()
  await engine.flush()
  await engine.flush()
  expect('↻ fetches both checkouts again', fetchRuns(engine).length === 4, fetchRuns(engine).map(run => run.argv[2]))

  // Work on this here on web's login tracks it in web.
  rows.find(one => one.id === 'intent:web/login')?.press()
  const view = await pane()
  byKey(view, 'intent-work')?.props.onPress()
  await engine.flush()
  expect("Work on this here on web/login tracks { slug: 'login', root: web }", JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: web }), engine.store.get(`pinned:${sid}`))

  // A parent-folder session still writes its heartbeat (to web only) and tells the model about the intent.
  await engine.timers()
  const webBeat = readJson(join(web, '.ather/local/lanes', `${sid}.json`))
  expect("the heartbeat lands in web's lanes, naming login", webBeat?.intent === 'login', webBeat)
  expect('and nowhere in the parent folder or s2', !fs.existsSync(join(parent, '.ather')) && !fs.existsSync(join(s2, 'Saved/AtherAutomata/lanes', `${sid}.json`)), fs.readdirSync(parent))
  const composed = await engine.compose()
  expect('the lane text reaches the model', composed.sections.some(one => one.id === 'ather-automata:lane'), composed.sections.map(one => one.id))

  await engine.command('ather', 'untrack')
  expect('/ather untrack clears it', !engine.store.has(`pinned:${sid}`), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent web/login')
  expect('/ather intent web/login tracks it in web', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: web }), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent s2/login')
  expect('/ather intent s2/login tracks the other one, in s2', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: s2 }), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent web/login')
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
  expect("on session end the parent-folder session's heartbeat in web says ended", readJson(join(web, '.ather/local/lanes', `${sid}.json`))?.hasEnded === true, readJson(join(web, '.ather/local/lanes', `${sid}.json`)))

  // The next session in the parent folder offers to continue web's login, and Next tracks it there.
  const next = await boot({ root: parent, sessionId: 'harness-session-0007' })
  next.engine.setSurfaces(['terminal'])
  await next.engine.command('ather', '')
  const home = await next.engine.render('Pane', { bodyColumns: 110 }, 'ather')
  byKey(home, 'next')?.props.onPress()
  await next.engine.flush()
  expect('Continue on Home tracks the intent in web', JSON.stringify(next.engine.store.get(`pinned:${next.sessionId}`)) === JSON.stringify({ slug: 'login', root: web }), next.engine.store.get(`pinned:${next.sessionId}`))
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

// ---------------------------------------------------------------- issues and PRs from every checkout

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
  // A parent-folder session over s2/ and web/: each has its own issues and its own PR #12.
  const { parent, s2, web } = makeWorkspace()
  withPr(s2, 'pay')
  withPr(web, 'pay')
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield'), issue(3, 'Rain')], prs: { 12: 'OPEN' } }, [web]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')], prs: { 12: 'MERGED' } } }
  const { engine } = await boot({ root: parent, sessionId: 'harness-session-0009', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, ghAt)
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('gh issue list runs once in each checkout, with the same argv', JSON.stringify(lists) === JSON.stringify([s2, web]), engine.record.ghAt)
  expect('each list is kept under its repository', engine.store.get('issues:sipher/s2|tinnguyen')?.list?.length === 2 && engine.store.get('issues:asktinnguyen/web|tinnguyen')?.list?.length === 1, [...engine.store.keys()].filter(key => key.startsWith('issues')))

  await engine.command('ather', 'pick')
  const pane = () => engine.render('Pane', { bodyColumns: 110 }, 'ather')
  const rows = issueRows(await pane())
  const ids = rows.map(one => one.id).sort()
  expect('both lists show, #7 in both as two rows', JSON.stringify(ids) === JSON.stringify(['issue:s2#3', 'issue:s2#7', 'issue:web#7']), ids)
  expect("each issue row carries its repository's name", rows.length === 3 && rows.every(one => one.repo === one.id.slice('issue:'.length).split('#')[0]), rows.map(one => [one.id, one.repo]))

  // PRs: each checkout's #12 read with gh there and kept under its repository; each intent's stage follows its own.
  await engine.flush()
  const prViews = engine.record.ghAt.filter(run => run.argv.startsWith('gh pr view 12 ')).map(run => run.cwd).sort()
  expect("gh pr view 12 runs in each intent's checkout", JSON.stringify(prViews) === JSON.stringify([s2, web].sort()), engine.record.ghAt.filter(run => run.argv.startsWith('gh pr')))
  expect("web's #12 is MERGED and s2's OPEN, each under its repository", engine.store.get('prStates:asktinnguyen/web')?.[12]?.state === 'MERGED' && engine.store.get('prStates:sipher/s2')?.[12]?.state === 'OPEN', [engine.store.get('prStates:asktinnguyen/web'), engine.store.get('prStates:sipher/s2')])
  const staged = await pane()
  expect("web/pay is ready to close on web's merged #12; s2/pay still waits on s2's open #12", glyphOf(staged, 'intent:web/pay') === '✓' && glyphOf(staged, 'intent:s2/pay') === '◐', [glyphOf(staged, 'intent:web/pay'), glyphOf(staged, 'intent:s2/pay')])

  // Start an intent on web#7: the session is told to create it under web's docs/intent.
  rows.find(one => one.id === 'issue:web#7')?.press()
  const card = await pane()
  // Open on GitHub runs gh in web; Copy link copies web#7's address.
  byKey(card, 'issue-open')?.props.onPress()
  await engine.flush()
  const opened = engine.record.ghAt.filter(run => run.argv === 'gh issue view 7 --web')
  expect("Open on GitHub on web#7 runs gh issue view 7 --web in web's root", opened.length === 1 && opened[0].cwd === web, opened)
  byKey(card, 'issue-copy')?.props.onPress({})
  await engine.flush()
  expect("Copy link on web#7 copies web's issue URL", engine.record.copies.at(-1) === 'https://github.com/AskTinNguyen/web/issues/7', engine.record.copies)
  byKey(card, 'issue-start')?.props.onPress()
  await engine.flush()
  const sent = engine.record.submits.at(-1) ?? ''
  const text = typeof sent === 'string' ? sent : (sent.text ?? '')
  expect("Start an intent on web#7 names web's docs/intent", text.includes(`${web}/docs/intent`) && text.includes('#7'), text)

  // /ather issue: s2's #3 alone; web#7 exactly.
  await engine.command('ather', 'issue 3')
  await engine.flush()
  const three = engine.record.submits.at(-1)
  const threeText = typeof three === 'string' ? three : (three?.text ?? '')
  expect('/ather issue 3 starts the first checkout that has it (s2)', threeText.includes(`${s2}/docs/intent`), threeText)
  await engine.command('ather', 'issue web#7')
  await engine.flush()
  const seven = engine.record.submits.at(-1)
  const sevenText = typeof seven === 'string' ? seven : (seven?.text ?? '')
  expect('/ather issue web#7 picks web', sevenText.includes(`${web}/docs/intent`), sevenText)
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

{
  // A session in s2/ with web/ as well: /ather issue 7 is s2's own #7 (as before); web#7 is web's.
  const { s2, web } = makeWorkspace()
  writeIntent(s2, 'login')
  writeIntent(web, 'search')
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [web]: { issues: [issue(7, 'Login form')] } }
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0011', options: { repos: '../web' }, ghAt })
  await issuesRead(engine, ghAt)
  await engine.command('ather', 'issue 7')
  await engine.flush()
  const own = String(engine.record.submits.at(-1) ?? '')
  expect("/ather issue 7 prefers the session checkout's #7", own.includes('Boss shield') && !own.includes(`${web}/docs/intent`), own)
  await engine.command('ather', 'issue #7')
  await engine.flush()
  expect('#7 is the same issue', String(engine.record.submits.at(-1) ?? '') === own, engine.record.submits.at(-1))
  await engine.command('ather', 'issue web#7')
  await engine.flush()
  const other = String(engine.record.submits.at(-1) ?? '')
  expect('/ather issue web#7 is web\'s', other.includes('Login form') && other.includes(`${web}/docs/intent`), other)
}

{
  // A session in s2/ with web/ (repos) that has no docs/intent yet: web's issues are still read and listed.
  const { s2, web } = makeWorkspace()
  writeIntent(s2, 'login')
  fs.rmSync(join(web, 'docs'), { recursive: true, force: true })
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [web]: { issues: [issue(5, 'Login form', 'AskTinNguyen/web')] } }
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0012', options: { repos: '../web' }, ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, ghAt)
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('gh issue list runs in s2 and in web, which has no intents', JSON.stringify(lists) === JSON.stringify([s2, web]), engine.record.ghAt)
  await engine.command('ather', 'pick')
  const rows = issueRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  expect("web's issue is listed with its name, s2's as issue:7", JSON.stringify(rows.map(one => [one.id, one.repo]).sort()) === JSON.stringify([['issue:7', 's2'], ['issue:web#5', 'web']]), rows.map(one => [one.id, one.repo]))
  expect('and no PR or intent read runs in web', !engine.record.ghAt.some(run => run.cwd === web && run.argv.startsWith('gh pr')), engine.record.ghAt)
}

// ---------------------------------------------------------------- deciding in place and grouping, over the workspace

const DECISION = '# Findings\n\n## F-1 (2026-10-01, rev 1) | blocking: yes | status: open (director)\n\nOne page or two?\n\n**Options:**\n- A (recommended): one page\n- B: two pages\n'
const writeFindings = (root, slug, text = DECISION) => fs.writeFileSync(join(root, 'docs/intent', slug, 'findings.md'), text)
const lastSubmit = engine => {
  const sent = engine.record.submits.at(-1) ?? ''
  return typeof sent === 'string' ? sent : (sent.text ?? '')
}

{
  // A parent-folder session over s2/ and web/: `login` is yours in both, each with an open decision; `board` is a teammate's in both.
  const { parent, s2, web } = makeWorkspace()
  for (const root of [s2, web]) {
    writeIntent(root, 'login')
    writeFindings(root, 'login')
    writeIntent(root, 'board', LOGIN.replace('Owner: Tin Nguyen', 'Owner: TienPham'))
  }
  const { engine, sessionId: sid } = await boot({ root: parent, sessionId: 'harness-session-0013' })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', '')
  const pane = (surface = 'terminal') => engine.render('Pane', { bodyColumns: 110 }, 'ather', surface)
  const keys = tree => nodesOf(tree).map(node => node.props?.key).filter(key => typeof key === 'string')
  const WEB_CALL = 'call:web/login:F-1'
  const S2_CALL = 'call:s2/login:F-1'
  let home = await pane()
  expect("Needs you lists both checkouts' decisions, each by its intent's key", [WEB_CALL, S2_CALL].every(id => keys(home).includes(`item-${id}`)), keys(home).filter(key => key.startsWith('item-')))
  const desk = keys(await pane('desktop'))
  expect('on the desktop too: both decisions, and no element key drawn twice', [WEB_CALL, S2_CALL].every(id => desk.includes(`item-${id}`)) && desk.every((key, at, list) => list.indexOf(key) === at), desk.filter(key => /call:/.test(key)))
  home = await pane()
  // Open web's decision if the other is the one opened, then answer A.
  if (!byKey(home, `option-${WEB_CALL}-A`)) {
    byKey(home, `item-${WEB_CALL}`)?.props.onPress()
    home = await pane()
  }
  const before = engine.record.submits.length
  byKey(home, `option-${WEB_CALL}-A`)?.props.onPress()
  await engine.flush()
  const answer = engine.record.submits.length > before ? lastSubmit(engine) : ''
  expect("answering A on web's decision hands the session web/login and web's findings file", answer.includes('F-1 on web/login') && answer.includes(`${web}/docs/intent/login/findings.md`) && !answer.includes(s2), answer)
  const answered = await pane()
  expect("web's row reads decided; s2's same-slug decision still waits, with its answers", keys(answered).includes(`item-${WEB_CALL}-done`) && !keys(answered).includes(`item-${S2_CALL}-done`) && Boolean(byKey(answered, `option-${S2_CALL}-A`)), keys(answered).filter(key => /call:/.test(key)))
  byKey(answered, `explain-${S2_CALL}`)?.props.onPress()
  await engine.flush()
  expect("Explain on s2's decision names s2/login and s2's findings file", lastSubmit(engine).includes('F-1 on s2/login') && lastSubmit(engine).includes(`${s2}/docs/intent/login/findings.md`), lastSubmit(engine))
  byKey(answered, `findings-${S2_CALL}`)?.props.onPress()
  const finding = await pane()
  expect("Open findings on s2's decision shows that finding", textIn(byKey(finding, 'title')).includes('s2/login') && byKey(finding, 'finding-markdown')?.props.text.startsWith('## F-1'), textIn(byKey(finding, 'title')))
  nodesOf(finding).find(node => node.type === 'Button' && node.props.key === 'finding-back')?.props.onPress()
  // The session records the answer in web's findings: read again, web's decision is gone and s2's is still there.
  writeFindings(web, 'login', `${DECISION}\n**Resolution:** accepted A.\n`)
  await engine.turnEnd()
  await engine.flush()
  const settled = keys(await pane())
  expect("once web's findings read resolved, its decision leaves Needs you and s2's stays", !settled.some(key => key.includes(WEB_CALL)) && settled.includes(`item-${S2_CALL}`), settled.filter(key => /call:/.test(key)))

  // Everything open, grouped by Person (the default): both checkouts' rows, the teammate's two under one head, on either surface.
  await engine.command('ather', 'pick')
  for (const surface of ['terminal', 'desktop']) {
    const pick = await pane(surface)
    const rows = intentRows(pick)
    const ids = rows.map(one => one.id).sort()
    expect(`Everything open (${surface}) lists each checkout's rows once, the same slugs twice`, JSON.stringify(ids) === JSON.stringify(['intent:s2/board', 'intent:s2/login', 'intent:web/board', 'intent:web/login']), ids)
    expect(`each row (${surface}) carries its repository's name`, rows.length === 4 && rows.every(one => one.repo === one.id.slice('intent:'.length).split('/')[0]), rows.map(one => [one.id, one.repo]))
    const heads = nodesOf(pick).filter(node => /^sub-others-\d+-text$/.test(node.props?.key ?? '')).map(textIn)
    expect(`grouped by Person (${surface}), the teammate's intents from both checkouts are one group of 2`, heads.length === 1 && / · 2$/.test(heads[0]), heads)
    expect(`no element key is drawn twice (${surface})`, keys(pick).every((key, at, list) => list.indexOf(key) === at), keys(pick).filter((key, at, list) => list.indexOf(key) !== at))
  }

  // Without a pane, the Work question names each intent by its key: choosing the second works on that one.
  engine.setSurfaces([])
  engine.script.push(question => question.options[1].label)
  await engine.command('ather', 'pick')
  await engine.flush()
  const asked = engine.record.dialogs.at(-1)
  const labels = (asked?.options ?? []).map(option => option.label)
  expect('the Work question lists the same slug in two checkouts as two different choices', labels.includes('s2/login') && labels.includes('web/login'), labels)
  const chosen = { 's2/login': s2, 'web/login': web }[asked?.answer]
  expect('choosing one of them tracks it in its own checkout', chosen !== undefined && JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: chosen }), [asked?.answer, engine.store.get(`pinned:${sid}`)])
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

// ---------------------------------------------------------------- two checkouts of one repository

{
  // A parent folder holding two clones of one origin, s2/ and s2-b/: `login` is yours in both, each with an open decision.
  const { parent, s2 } = makeWorkspace()
  fs.rmSync(join(parent, 'web'), { recursive: true, force: true })
  const second = join(parent, 's2-b')
  git(parent, 'clone', '-q', git(s2, 'remote', 'get-url', 'origin'), second)
  git(second, 'config', 'user.name', 'Tin Nguyen')
  git(second, 'config', 'user.email', 'tin@example.com')
  for (const root of [s2, second]) {
    writeIntent(root, 'login')
    writeFindings(root, 'login')
  }
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [second]: { issues: [issue(7, 'Boss shield')] } }
  const { engine, sessionId: sid } = await boot({ root: parent, sessionId: 'harness-session-0015', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [s2]: {} })
  await engine.flush()
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect("gh issue list runs once for the repository, in its first checkout", JSON.stringify(lists) === JSON.stringify([s2]), engine.record.ghAt)

  const pane = (surface = 'terminal') => engine.render('Pane', { bodyColumns: 110 }, 'ather', surface)
  const keys = tree => nodesOf(tree).map(node => node.props?.key).filter(key => typeof key === 'string')
  const twice = tree => keys(tree).filter((key, at, list) => list.indexOf(key) !== at)
  await engine.command('ather', 'pick')
  for (const surface of ['terminal', 'desktop']) {
    const pick = await pane(surface)
    const rows = intentRows(pick)
    expect(`two clones of one repository (${surface}): login is two rows with different keys`, JSON.stringify(rows.map(one => one.id).sort()) === JSON.stringify(['intent:s2-b/login', 'intent:s2/login']), rows.map(one => one.id))
    expect(`each row (${surface}) carries its own checkout's name`, JSON.stringify(rows.map(one => one.repo).sort()) === JSON.stringify(['s2', 's2-b']), rows.map(one => [one.id, one.repo]))
    expect(`no element key is drawn twice (${surface})`, twice(pick).length === 0, twice(pick))
    const issues = issueRows(pick)
    expect(`the repository's assigned issue is listed once (${surface}), under its first checkout`, JSON.stringify(issues.map(one => [one.id, one.repo])) === JSON.stringify([['issue:s2#7', 's2']]), issues.map(one => [one.id, one.repo]))
  }

  await engine.command('ather', 'intent s2-b/login')
  expect('/ather intent s2-b/login tracks it in its own folder', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: second }), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'intent s2/login')
  expect('/ather intent s2/login tracks the first clone', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: s2 }), engine.store.get(`pinned:${sid}`))
  await engine.command('ather', 'untrack')

  // Both decisions wait, each under its own key; answering one leaves the other waiting.
  await engine.command('ather', '')
  const FIRST_CALL = 'call:s2/login:F-1'
  const SECOND_CALL = 'call:s2-b/login:F-1'
  let home = await pane()
  expect("Needs you lists both clones' decisions, each by its own key", [FIRST_CALL, SECOND_CALL].every(id => keys(home).includes(`item-${id}`)), keys(home).filter(key => key.startsWith('item-')))
  const desk = await pane('desktop')
  expect('on the desktop too: both decisions, and no element key drawn twice', [FIRST_CALL, SECOND_CALL].every(id => keys(desk).includes(`item-${id}`)) && twice(desk).length === 0, twice(desk))
  home = await pane()
  if (!byKey(home, `option-${SECOND_CALL}-A`)) {
    byKey(home, `item-${SECOND_CALL}`)?.props.onPress()
    home = await pane()
  }
  const before = engine.record.submits.length
  byKey(home, `option-${SECOND_CALL}-A`)?.props.onPress()
  await engine.flush()
  const answer = engine.record.submits.length > before ? lastSubmit(engine) : ''
  expect("answering the second clone's decision hands the session its findings file, not the first's", answer.includes(`${second}/docs/intent/login/findings.md`) && !answer.includes(`${s2}/docs`), answer)
  const answered = await pane()
  expect("the second clone's row reads decided; the first's still waits, with its answers", keys(answered).includes(`item-${SECOND_CALL}-done`) && !keys(answered).includes(`item-${FIRST_CALL}-done`) && Boolean(byKey(answered, `option-${FIRST_CALL}-A`)), keys(answered).filter(key => /call:/.test(key)))
  writeFindings(second, 'login', `${DECISION}\n**Resolution:** accepted A.\n`)
  await engine.turnEnd()
  await engine.flush()
  const settled = keys(await pane())
  expect("once the second clone's findings read resolved, its decision leaves and the first's stays", !settled.some(key => key.includes(SECOND_CALL)) && settled.includes(`item-${FIRST_CALL}`), settled.filter(key => /call:/.test(key)))

  // /ather issue s2-b#7: the repository's issue, started in the checkout named.
  await engine.command('ather', 'issue s2-b#7')
  await engine.flush()
  expect('/ather issue s2-b#7 starts the assigned issue in the second clone', lastSubmit(engine).includes('Boss shield') && lastSubmit(engine).includes(`${second}/docs/intent`), lastSubmit(engine))
  // Without a pane, /ather find names each match by its key.
  engine.setSurfaces([])
  const found = String((await engine.command('ather', 'find login'))?.text ?? '')
  expect('/ather find login without a pane names both clones\' intents by key', found.includes('s2/login') && found.includes('s2-b/login'), found)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
}

{
  // A session in s2/ with a second clone named by the repos option: its own rows stay bare, the clone's carry its folder's name.
  const { parent, s2 } = makeWorkspace()
  const second = join(parent, 's2-b')
  git(parent, 'clone', '-q', git(s2, 'remote', 'get-url', 'origin'), second)
  writeIntent(s2, 'login')
  writeIntent(second, 'login')
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [second]: { issues: [issue(7, 'Boss shield')] } }
  const { engine } = await boot({ root: s2, sessionId: 'harness-session-0016', options: { repos: '../s2-b' }, ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [s2]: {} })
  await engine.flush()
  expect("gh issue list runs once, in the session's own checkout", JSON.stringify(engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)) === JSON.stringify([s2]), engine.record.ghAt)
  await engine.command('ather', 'pick')
  const pick = await engine.render('Pane', { bodyColumns: 110 }, 'ather')
  expect("the session's own login keeps its bare slug; the clone's is s2-b/login", JSON.stringify(intentRows(pick).map(one => one.id).sort()) === JSON.stringify(['intent:login', 'intent:s2-b/login']), intentRows(pick).map(one => one.id))
  expect("the issue is listed once, under the session's own checkout, by its bare number", JSON.stringify(issueRows(pick).map(one => one.id)) === JSON.stringify(['issue:7']), issueRows(pick).map(one => one.id))
}

// ---------------------------------------------------------------- proof, changes and Continue per checkout

{
  // A parent folder holding two clones of one with-proof repository, web/ and web-b/, `login` yours in both.
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const web = makeCheckout(parent, 'web', {
    owner: 'AskTinNguyen',
    name: 'web',
    files: { ...INTENTS, 'package.json': `${JSON.stringify({ name: 'web', scripts: { test: 'node --test' } }, null, 2)}\n`, '.ather/profile.json': `${JSON.stringify(WEB_PROFILE, null, 2)}\n` },
  })
  const webB = join(parent, 'web-b')
  git(parent, 'clone', '-q', git(web, 'remote', 'get-url', 'origin'), webB)
  git(webB, 'config', 'user.name', 'Tin Nguyen')
  git(webB, 'config', 'user.email', 'tin@example.com')
  for (const root of [web, webB]) writeIntent(root, 'login')
  const ids = { web: checkoutId('asktinnguyen/web', web), webB: checkoutId('asktinnguyen/web', webB) }
  const kept = (engine, prefix) => [...engine.store.keys()].filter(key => key.startsWith(prefix))
  const ghAt = { [web]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] }, [webB]: { issues: [issue(7, 'Login form', 'AskTinNguyen/web')] } }
  const { engine, sessionId: sid } = await boot({ root: parent, sessionId: 'harness-session-0017', writable: [parent], ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [web]: {} })
  await engine.flush()

  // Nothing tracked: this session's proof in one clone is not its proof in the other.
  await startAway(engine)
  expect('the away window runs in the parent folder', engine.store.get(`away:${sid}`)?.phase === 'running', engine.store.get(`away:${sid}`))
  await bash(engine, 'cd web && npm test', NODE_TEST_PASS)
  expect("a passing npm test in web/ is this session's proof in web/ only", engine.store.get(`evidence:${sid}|${ids.web}`)?.tests?.state === 'pass' && kept(engine, 'evidence:').length === 1, kept(engine, 'evidence:'))
  const otherMerge = await bash(engine, 'cd web-b && gh pr merge 3')
  expect("web/'s proof does not allow a with-proof merge in web-b/", otherMerge.deny !== undefined && parked(engine, sid).at(-1)?.command === 'cd web-b && gh pr merge 3', { deny: otherMerge.deny, parked: parked(engine, sid) })
  const sameMerge = await bash(engine, 'cd web && gh pr merge 3')
  expect('it allows the merge in web/ itself', sameMerge.deny === undefined, sameMerge.deny)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })

  // web/login tracked and proved, then edited: neither its proof nor its changes are web-b/login's.
  await engine.command('ather', 'intent web/login')
  expect('/ather intent web/login tracks it in web/', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: web }), engine.store.get(`pinned:${sid}`))
  await bash(engine, 'cd web && npm test', NODE_TEST_PASS)
  expect("npm test in web/ proves web/'s login", engine.store.get(`evidence:${ids.web}|login`)?.tests?.state === 'pass', kept(engine, 'evidence:'))
  expect("and records nothing for web-b/'s login", !engine.store.has(`evidence:${ids.webB}|login`), kept(engine, 'evidence:'))
  await engine.modelTool({ tool: 'Edit', file_path: 'web/docs/intent/login/prompt.md', old_string: '- [ ] A2', new_string: '- [x] A2' })
  await engine.flush()
  expect("an edit to web/'s login records its change for web/ only", engine.store.get(`changes:${ids.web}|login`)?.length === 1 && kept(engine, 'changes:').length === 1, kept(engine, 'changes:'))

  // The other clone's login tracked: its own Continue, and the first clone's proof does not count for it.
  await engine.command('ather', 'intent web-b/login')
  expect('/ather intent web-b/login tracks it in web-b/', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'login', root: webB }), engine.store.get(`pinned:${sid}`))
  expect('each clone keeps its own Continue', engine.store.get(`last:${ids.web}|tinnguyen`) === 'login' && engine.store.get(`last:${ids.webB}|tinnguyen`) === 'login' && kept(engine, 'last:').length === 2, kept(engine, 'last:'))
  const status = JSON.parse((await engine.modelTool({ tool: 'mcp__ather-automata__status' })).result)
  expect("web-b/'s login has no proof from web/'s test run", status.tracked?.checkout === webB && status.evidence?.tests?.state !== 'pass', [status.tracked, status.evidence])
  await startAway(engine)
  const intentMerge = await bash(engine, 'cd web-b && gh pr merge 3')
  expect("web/login's proof does not allow web-b/login's merge", intentMerge.deny !== undefined, intentMerge.deny)
  await bash(engine, 'cd web-b && npm test', NODE_TEST_PASS)
  const proved = await bash(engine, 'cd web-b && gh pr merge 3')
  expect("web-b/'s own passing test run does", proved.deny === undefined && engine.store.get(`evidence:${ids.webB}|login`)?.tests?.state === 'pass', [proved.deny, kept(engine, 'evidence:')])
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })

  // The repository's issue is GitHub's: read once, listed once.
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('gh issue list still runs once for the repository', JSON.stringify(lists) === JSON.stringify([web]), engine.record.ghAt)
  expect('and its list is kept under the repository', kept(engine, 'issues:').length === 1 && engine.store.get('issues:asktinnguyen/web|tinnguyen')?.list?.length === 1, kept(engine, 'issues:'))
  await engine.command('ather', 'pick')
  const issues = issueRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  expect("the repository's assigned issue is listed once", JSON.stringify(issues.map(one => one.id)) === JSON.stringify(['issue:web#7']), issues.map(one => one.id))

  // Untracking web-b/login takes web-b/'s Continue only: the next session continues web/'s.
  await engine.command('ather', 'untrack')
  expect("untracking web-b/login leaves web/'s Continue", engine.store.get(`last:${ids.web}|tinnguyen`) === 'login' && kept(engine, 'last:').length === 1, kept(engine, 'last:'))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
  const next = await boot({ root: parent, sessionId: 'harness-session-0018' })
  next.engine.setSurfaces(['terminal'])
  await next.engine.command('ather', '')
  byKey(await next.engine.render('Pane', { bodyColumns: 110 }, 'ather'), 'next')?.props.onPress()
  await next.engine.flush()
  expect("Continue on Home tracks web/'s login, not web-b/'s", JSON.stringify(next.engine.store.get(`pinned:${next.sessionId}`)) === JSON.stringify({ slug: 'login', root: web }), next.engine.store.get(`pinned:${next.sessionId}`))
}

// ---------------------------------------------------------------- one id through a symbolic link

{
  // web/ reached through a link to it, then by its real path: `login` and `pay` yours, `login` tracked and proved through the link.
  const { parent, web } = makeWorkspace()
  for (const slug of ['login', 'pay']) writeIntent(web, slug)
  const link = join(BASE, 'link-web')
  fs.symlinkSync(web, link)
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

  // The parent folder through a link: web/ is another checkout there, with the same id.
  const linkParent = join(BASE, 'link-work')
  fs.symlinkSync(parent, linkParent)
  const above = await boot({ root: linkParent, sessionId: 'harness-session-0021', kept: engine.store })
  await bash(above.engine, 'cd web && npm test', NODE_TEST_PASS)
  expect("a session in the linked parent folder keeps its proof in web/ under web's real folder", above.engine.store.get(`evidence:${above.sessionId}|${id}`)?.tests?.state === 'pass', kept(above.engine, 'evidence:'))
  await above.engine.command('ather', 'intent web/pay')
  expect('and tracking web/pay moves the one Continue', JSON.stringify(above.engine.store.get(`pinned:${above.sessionId}`)) === JSON.stringify({ slug: 'pay', root: `${linkParent}/web` }) && above.engine.store.get(`last:${id}|tinnguyen`) === 'pay' && kept(above.engine, 'last:').length === 1, [above.engine.store.get(`pinned:${above.sessionId}`), ...kept(above.engine, 'last:')])
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
  // A parent folder over s2/ (on GitHub, one issue) and web/ (its remotes are not on GitHub).
  const { parent, s2, web } = makeWorkspace()
  const ghAt = { [s2]: { issues: [issue(7, 'Boss shield')] }, [web]: { fails: NOT_ON_GITHUB } }
  const { engine } = await boot({ root: parent, sessionId: 'harness-session-0022', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, ghAt)
  await engine.flush()
  expect('reading issues at the start schedules no retry for the checkout that is not on GitHub', !engine.record.afters.includes(60000), engine.record.afters)
  const quiet = await refresh(engine)
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('gh issue list ran in both checkouts', lists.includes(s2) && lists.includes(web), lists)
  expect('a refresh reports no failure for the checkout that is not on GitHub', quiet.said !== '' && !quiet.said.includes('none of the git remotes') && !quiet.said.includes(web), quiet.said)
  expect('and schedules no retry', quiet.retries === 0, quiet)
  expect("the GitHub checkout's issue is kept, and an empty list for the other", engine.store.get('issues:sipher/s2|tinnguyen')?.list?.length === 1 && engine.store.get('issues:asktinnguyen/web|tinnguyen')?.list?.length === 0, [...engine.store.keys()].filter(key => key.startsWith('issues')))
  const rows = issueRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather'))
  expect("the GitHub checkout's issue is listed", JSON.stringify(rows.map(one => one.id)) === JSON.stringify(['issue:s2#7']), rows.map(one => one.id))

  // A real failure in s2/ is one: named by the checkout's short name, and tried again.
  ghAt[s2] = { fails: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' }
  const failed = await refresh(engine)
  expect("a real failure is reported with its checkout's short name, not its folder", failed.said.includes('s2') && failed.said.includes('HTTP 502') && !failed.said.includes(s2) && !failed.said.includes(parent), failed.said)
  expect('and says nothing of the checkout that is not on GitHub', !failed.said.includes('none of the git remotes') && !failed.said.includes('web'), failed.said)
  expect('and is tried again', failed.retries === 1, failed)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

{
  // One checkout whose remotes are not on GitHub: a failure, as before.
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

{
  // Two clones of one repository whose remotes are not on GitHub: several checkouts, one gh call.
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: INTENTS })
  const webB = join(parent, 'web-b')
  git(parent, 'clone', '-q', git(web, 'remote', 'get-url', 'origin'), webB)
  const ghAt = { [web]: { fails: NOT_ON_GITHUB }, [webB]: { fails: NOT_ON_GITHUB } }
  const { engine } = await boot({ root: parent, sessionId: 'harness-session-0024', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [web]: {} })
  await engine.flush()
  const both = await refresh(engine)
  const lists = engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect('two clones of a repository that is not on GitHub are asked once each time, in the first', lists.length > 0 && lists.every(cwd => cwd === web), lists)
  expect('and no retry is scheduled, at the start or on a refresh', !engine.record.afters.includes(60000), engine.record.afters)
  // What a refresh that worked and found nothing says is what was said of them.
  ghAt[web] = { issues: [] }
  const empty = await refresh(engine)
  expect('and are no failure: an empty list is kept, and the refresh says what one with no issues says', engine.store.get('issues:asktinnguyen/web|tinnguyen')?.list?.length === 0 && both.said !== '' && both.said === empty.said, [both.said, empty.said])
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- the workspace stays with the session's root

{
  // A session opened in the parent folder starts again (a resume, a reload) after the shell moved into web/.
  const { parent, s2, web } = makeWorkspace()
  writeIntent(s2, 'login')
  writeIntent(web, 'login')
  const { engine } = await boot({ root: parent, sessionId: 'harness-session-0025', cwd: web })
  engine.setSurfaces(['terminal'])
  await engine.command('ather', 'pick')
  const ids = intentRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather')).map(one => one.id).sort()
  expect("a session started with the shell in web/ still lists both checkouts' intents by key", JSON.stringify(ids) === JSON.stringify(['intent:s2/login', 'intent:web/login']), ids)
  await engine.command('ather', 'intent s2/login')
  expect('and tracks s2/login by its key', JSON.stringify(engine.store.get('pinned:harness-session-0025')) === JSON.stringify({ slug: 'login', root: s2 }), engine.store.get('pinned:harness-session-0025'))
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- setting up, in a workspace

{
  const { SETUP_PIECES } = await import('./out/hooks/setup.mjs')
  const paths = SETUP_PIECES.map(one => one.path)
  const PACKAGE = { 'package.json': `${JSON.stringify({ name: 'app' }, null, 2)}\n` }
  // One /ather: the dialogs it asked (each dismissed) and the prompts it submitted.
  const run = async (engine, args) => {
    const dialogs = engine.record.dialogs.length
    const submits = engine.record.submits.length
    const out = await engine.command('ather', args)
    await engine.flush()
    return { out: out.text, dialogs: engine.record.dialogs.slice(dialogs), sent: engine.record.submits.slice(submits) }
  }

  // The session's own checkout has no intents; web/, beside it, has one.
  const parent = fs.mkdtempSync(join(BASE, 'work-'))
  const app = makeCheckout(parent, 'app', { owner: 'AskTinNguyen', name: 'app', files: PACKAGE })
  const web = makeCheckout(parent, 'web', { owner: 'AskTinNguyen', name: 'web', files: { ...INTENTS, ...PACKAGE } })
  writeIntent(web, 'login')
  const { engine } = await boot({ root: app, sessionId: 'harness-session-0026', options: { repos: '../web' } })
  engine.setSurfaces(['terminal'])
  const opened = await run(engine, 'pick')
  const ids = intentRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather')).map(one => one.id)
  expect("a session whose own checkout has no intents opens the pane on the other checkout's, and is asked no setup question", opened.dialogs.length === 0 && opened.sent.length === 0 && engine.record.opens.some(pane => pane.id === 'ather') && JSON.stringify(ids) === JSON.stringify(['intent:web/login']), [opened, ids])
  const setup = await run(engine, 'setup')
  expect("/ather setup there submits the one setup prompt, for the session's own checkout: all five pieces, its folder named and not web's", setup.dialogs.length === 0 && setup.sent.length === 1 && /templates\/intent-setup\/SETUP\.md/.test(setup.sent[0]) && paths.every(one => setup.sent[0].includes(one)) && setup.sent[0].includes(`the repository at ${app};`) && !setup.sent[0].includes(web), setup)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')

  // A parent folder whose checkouts have no intents at all.
  const bare = fs.mkdtempSync(join(BASE, 'work-'))
  makeCheckout(bare, 'app', { owner: 'AskTinNguyen', name: 'app', files: PACKAGE })
  makeCheckout(bare, 'site', { owner: 'AskTinNguyen', name: 'site', files: PACKAGE })
  const none = await boot({ root: bare, sessionId: 'harness-session-0027' })
  none.engine.setSurfaces(['terminal'])
  const asked = await run(none.engine, '')
  expect('a parent folder whose checkouts have no intents: /ather asks the one setup question and opens no pane', asked.dialogs.length === 1 && asked.dialogs[0].options.map(option => option.label).join('|') === 'Set up intents here|Not now' && asked.sent.length === 0 && none.engine.record.opens.length === 0, [asked, none.engine.record.opens])
  expect('no hook threw', none.engine.record.hookErrors.length === 0, none.engine.record.hookErrors)
  await none.engine.end('other')
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
    const { parent, s2, web } = makeWorkspace()
    const x = join(s2, '.claude/worktrees/x')
    git(s2, 'worktree', 'add', '-q', '-b', 'x', x)
    writeIntent(web, 'login')
    writeIntent(x, 'draft')
    return { parent, s2, web, x }
  }
  const idsOf = async engine => {
    engine.setSurfaces(['terminal'])
    await engine.command('ather', 'pick')
    const ids = intentRows(await engine.render('Pane', { bodyColumns: 110 }, 'ather')).map(one => one.id).sort()
    await engine.flush()
    await engine.flush()
    return ids
  }

  const above = nested()
  const first = await boot({ root: above.parent, sessionId: 'harness-session-0032' })
  const ids = await idsOf(first.engine)
  expect("a parent-folder session finds the worktree nested in one of its checkouts", JSON.stringify(ids) === JSON.stringify(['intent:web/login', 'intent:x/draft']), ids)
  expect('and fetches twice in a pass, once for each clone', JSON.stringify(fetchRuns(first.engine).map(run => run.argv[2])) === JSON.stringify([above.s2, above.web]), fetchRuns(first.engine).map(run => run.argv[2]))
  expect('no hook threw', first.engine.record.hookErrors.length === 0, first.engine.record.hookErrors)
  await first.engine.end('other')

  const named = nested()
  const second = await boot({ root: named.web, sessionId: 'harness-session-0033', options: { repos: '../s2' } })
  const found = await idsOf(second.engine)
  expect("a session in web whose repos option names the clone finds its worktree", JSON.stringify(found) === JSON.stringify(['intent:login', 'intent:x/draft']), found)
  expect('and fetches twice in a pass, once for each clone', JSON.stringify(fetchRuns(second.engine).map(run => run.argv[2])) === JSON.stringify([named.web, named.s2]), fetchRuns(second.engine).map(run => run.argv[2]))
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

// ---------------------------------------------------------------- the traced folders

{
  const KEPT = 'tracedFolders'
  const kept = engine => engine.store.get(KEPT) ?? []
  // Wide enough that no folder is cut short.
  const pane = engine => engine.render('Pane', { bodyColumns: 400 }, 'ather')
  const idsOf = async engine => {
    await engine.command('ather', 'pick')
    return intentRows(await pane(engine)).map(one => one.id).sort()
  }
  // The Repositories view, opened from its row at the foot of Home.
  const reposView = async engine => {
    await engine.command('ather', '')
    byKey(await pane(engine), 'home-repos')?.props.onPress()
    return pane(engine)
  }
  // The folders the view lists, in order (each row's second line begins with the whole path), and whether each has Remove.
  const sources = tree => nodesOf(tree).filter(node => /^repos-path-\d+$/.test(node.props?.key ?? '')).map(node => ({ folder: textIn(node).split(' · ')[0].trim(), hasRemove: Boolean(byKey(tree, node.props.key.replace('path', 'remove'))) }))
  // A press there, until the pane says what came of it; the issues are then read in the background.
  const said = async (engine, press) => {
    const before = engine.record.toasts.length
    press()
    for (let tries = 0; tries < 100 && engine.record.toasts.length === before; tries += 1) await engine.flush()
    await engine.flush()
    return engine.record.toasts.slice(before).join('\n')
  }
  // Add a folder: its field, then the path typed into it.
  const add = async (engine, folder) => {
    byKey(await reposView(engine), 'repos-add')?.props.onPress()
    const field = byKey(await pane(engine), 'repos-add-field')
    return said(engine, () => field?.props.onSubmit(folder))
  }
  const threw = engine => [...engine.record.hookErrors, ...engine.record.toasts.filter(text => /Error/.test(text))]

  // web/ beside s2/, which has a worktree with an intent of its own; app/ is a third checkout.
  const { parent, s2, web } = makeWorkspace()
  const tree = join(parent, 's2-x')
  git(s2, 'worktree', 'add', '-q', '-b', 'x', tree)
  const app = makeCheckout(parent, 'app', { owner: 'AskTinNguyen', name: 'app', files: INTENTS })
  writeIntent(web, 'login')
  writeIntent(s2, 'boss')
  writeIntent(tree, 'draft')
  const ghAt = { [web]: { issues: [] }, [s2]: { issues: [issue(7, 'Boss shield')] }, [app]: { issues: [] } }
  const { engine, sessionId: sid } = await boot({ root: web, sessionId: 'harness-session-0040', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [web]: {} })
  const lists = () => engine.record.ghAt.filter(run => run.argv === LIST).map(run => run.cwd)
  expect("a session in web lists web's intents alone, and its view its own checkout, without Remove", JSON.stringify(await idsOf(engine)) === JSON.stringify(['intent:login']) && JSON.stringify(sources(await reposView(engine))) === JSON.stringify([{ folder: web, hasRemove: false }]) && !lists().includes(s2), [await idsOf(engine), sources(await reposView(engine)), lists()])

  expect('Everything open has no Repositories row', (await engine.command('ather', 'pick'), !nodesOf(await pane(engine)).some(node => /repos/.test(node.props?.key ?? ''))), nodesOf(await pane(engine)).map(node => node.props?.key).filter(key => /repos/.test(key ?? '')))
  nodesOf(await reposView(engine)).find(node => node.type === 'Button' && node.props?.key === 'repos-back')?.props.onPress()
  expect('Back in the view returns to Home', Boolean(byKey(await pane(engine), 'home-repos')) && !byKey(await pane(engine), 'repos-add'), nodesOf(await pane(engine)).map(node => node.props?.key).filter(Boolean))
  expect('on the desktop Home draws the row too', Boolean(byKey(await engine.render('Pane', { bodyColumns: 110 }, 'ather', 'desktop'), 'home-repos')))

  const added = await add(engine, '../s2')
  expect("Add a folder with ../s2 keeps s2's folder for the machine", added !== '' && JSON.stringify(kept(engine)) === JSON.stringify([s2]), [added, kept(engine)])
  expect('the view lists it after the session checkout, with Remove', JSON.stringify(sources(await pane(engine))) === JSON.stringify([{ folder: web, hasRemove: false }, { folder: s2, hasRemove: true }]), sources(await pane(engine)))
  const ids = await idsOf(engine)
  expect("without a restart the pane lists s2's intents and its worktree's", JSON.stringify(ids) === JSON.stringify(['intent:login', 'intent:s2-x/draft', 'intent:s2/boss']), ids)
  expect('and gh issue list has run in s2', lists().includes(s2), engine.record.ghAt)

  // Proof this session saw in s2 is kept for that checkout.
  await bash(engine, 'cd ../s2 && Build.bat S2Editor Win64 Development', 'Result: Succeeded')
  const proof = `evidence:${sid}|${checkoutId('sipher/s2', s2)}`
  expect("a build in ../s2 is kept under s2's checkout", engine.store.get(proof)?.build?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
  const store = new Map(engine.store)

  const view = await reposView(engine)
  const gone = await said(engine, () => byKey(view, 'repos-remove-1')?.props.onPress())
  const after = await idsOf(engine)
  expect("Remove takes s2's intents and its worktree's out of the pane, and the folder out of the list", gone !== '' && JSON.stringify(after) === JSON.stringify(['intent:login']) && kept(engine).length === 0, [gone, after, kept(engine)])
  expect("the proof kept for s2's checkout is still in the store", engine.store.get(proof)?.build?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))

  const loose = fs.mkdtempSync(join(BASE, 'loose-'))
  const nowhere = await add(engine, loose)
  expect('a path in no checkout stores nothing and says why', nowhere !== '' && kept(engine).length === 0, [nowhere, kept(engine)])
  const own = await add(engine, join(web, 'docs'))
  expect("the session's own checkout again stores nothing and says why", own !== '' && own !== nowhere && kept(engine).length === 0, [own, kept(engine)])
  expect('no hook threw', threw(engine).length === 0, threw(engine))
  await engine.end('other')

  // A second session, in app/, on the machine as it was while s2 was kept.
  const second = await boot({ root: app, sessionId: 'harness-session-0041', ghAt, kept: store })
  second.engine.setSurfaces(['terminal'])
  const fromStart = await idsOf(second.engine)
  expect("a second session in another folder, with the same store, lists s2's intents from its start", JSON.stringify(fromStart) === JSON.stringify(['intent:s2-x/draft', 'intent:s2/boss']), fromStart)
  expect('no hook threw', threw(second.engine).length === 0, threw(second.engine))
  await second.engine.end('other')

  // Eight checkouts: the session's and seven the setting names. A ninth is not added.
  const full = fs.mkdtempSync(join(BASE, 'full-'))
  const nine = [makeCheckout(full, 'c1', { owner: 'AskTinNguyen', name: 'c1', files: INTENTS })]
  for (const name of ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']) {
    fs.mkdirSync(join(full, name))
    git(join(full, name), 'init', '-q', '-b', 'main')
    nine.push(join(full, name))
  }
  const eight = await boot({ root: nine[0], sessionId: 'harness-session-0042', options: { repos: nine.slice(1, 8).map(one => `../${path.basename(one)}`).join(';') } })
  eight.engine.setSurfaces(['terminal'])
  const ninth = await add(eight.engine, nine[8])
  expect('a ninth checkout stores nothing and says why', ninth !== '' && ninth !== own && ninth !== nowhere && kept(eight.engine).length === 0, [ninth, kept(eight.engine)])
  expect('no hook threw', threw(eight.engine).length === 0, threw(eight.engine))
  await eight.engine.end('other')

  // The same by command, in a session that draws no pane.
  const typed = await boot({ root: web, sessionId: 'harness-session-0043', ghAt })
  const run = async args => {
    const out = await typed.engine.command('ather', args)
    await typed.engine.flush()
    return out.text
  }
  const addedBy = await run('repos add ../s2')
  expect('/ather repos add ../s2 keeps s2 and replies', addedBy !== '' && JSON.stringify(kept(typed.engine)) === JSON.stringify([s2]), [addedBy, kept(typed.engine)])
  const again = await run(`repos add ${tree}`)
  expect("/ather repos add of s2's worktree, already in the workspace, stores nothing more", again !== addedBy && JSON.stringify(kept(typed.engine)) === JSON.stringify([s2]), [again, kept(typed.engine)])
  const listed = await run('repos')
  expect('/ather repos without a pane replies with the folders, and opens nothing', listed.includes(web) && listed.includes(s2) && typed.engine.record.opens.length === 0 && typed.engine.record.dialogs.length === 0, [listed, typed.engine.record.opens])
  await run('intent s2/boss')
  expect('the added checkout is worked with at once: /ather intent s2/boss tracks it there', JSON.stringify(typed.engine.store.get('pinned:harness-session-0043')) === JSON.stringify({ slug: 'boss', root: s2 }), typed.engine.store.get('pinned:harness-session-0043'))
  const removedBy = await run('repos remove s2')
  expect('/ather repos remove s2, its name in the pane, takes it out', removedBy !== '' && kept(typed.engine).length === 0, [removedBy, kept(typed.engine)])
  await run('repos add ../s2')
  await run('repos remove ../s2')
  expect('/ather repos remove ../s2, its folder, takes it out too', kept(typed.engine).length === 0, kept(typed.engine))
  // Kept through a link to s2/, removed by its real path: one folder under two spellings.
  const link = join(BASE, 'link-s2')
  fs.symlinkSync(s2, link)
  await run(`repos add ${link}`)
  const through = kept(typed.engine)
  await run('repos remove ../s2')
  expect('a folder kept through a link is removed by its real path', JSON.stringify(through) === JSON.stringify([link]) && kept(typed.engine).length === 0, [through, kept(typed.engine)])
  const unknown = await run('repos remove ../app')
  expect('/ather repos remove of a folder that was not added says so and changes nothing', unknown !== removedBy && kept(typed.engine).length === 0, [unknown, kept(typed.engine)])
  expect('no hook threw', threw(typed.engine).length === 0, threw(typed.engine))
  await typed.engine.end('other')

  // A session in a repository with no docs/intent adds the folder that has intents.
  const plain = makeCheckout(parent, 'plain', { owner: 'AskTinNguyen', name: 'plain', files: { 'package.json': '{ "name": "plain" }\n' } })
  const none = await boot({ root: plain, sessionId: 'harness-session-0044', ghAt })
  none.engine.setSurfaces(['terminal'])
  const dialogs = none.engine.record.dialogs.length
  const first = (await none.engine.command('ather', 'repos add ../s2')).text
  await none.engine.flush()
  const found = await idsOf(none.engine)
  expect("in a repository with no intents, /ather repos add ../s2 asks no setup question and the pane then lists s2's intents", first !== '' && none.engine.record.dialogs.length === dialogs && JSON.stringify(kept(none.engine)) === JSON.stringify([s2]) && JSON.stringify(found) === JSON.stringify(['intent:s2-x/draft', 'intent:s2/boss']), [first, none.engine.record.dialogs.slice(dialogs), kept(none.engine), found])
  expect('no hook threw', threw(none.engine).length === 0, threw(none.engine))
  await none.engine.end('other')
}

// ---------------------------------------------------------------- the traced folders, set by the session

{
  // The model's own tool: asked in words ("add s2 to Ather"), the session adds the folder itself.
  const KEPT = 'tracedFolders'
  const tool = (engine, input) => engine.modelTool({ tool: 'mcp__ather-automata__repos', ...input }).then(answer => String(answer?.result ?? ''))
  const pane = engine => engine.render('Pane', { bodyColumns: 400 }, 'ather')
  const ids = async engine => intentRows(await pane(engine)).map(one => one.id).sort()
  const { parent, s2, web } = makeWorkspace()
  const tree = join(parent, 's2-x')
  git(s2, 'worktree', 'add', '-q', '-b', 'x', tree)
  writeIntent(web, 'login')
  writeIntent(s2, 'boss')
  writeIntent(tree, 'draft')
  const ghAt = { [web]: { issues: [] }, [s2]: { issues: [issue(7, 'Boss shield')] } }
  const { engine } = await boot({ root: web, sessionId: 'harness-session-0045', ghAt })
  engine.setSurfaces(['terminal'])
  await issuesRead(engine, { [web]: {} })
  expect('the session is given a repos tool beside status, away and profile', engine.record.registeredTools.includes('repos'), engine.record.registeredTools)
  // The pane is open on Everything open, and stays there: the person watches it change.
  await engine.command('ather', 'pick')
  expect("before, the open pane lists web's intent alone", JSON.stringify(await ids(engine)) === JSON.stringify(['intent:login']), await ids(engine))
  const listed = await tool(engine, { action: 'list' })
  expect('list names the session folder and nothing kept', listed.includes(web) && !listed.includes(s2), listed)

  const invalidations = engine.record.invalidations
  const added = await tool(engine, { action: 'add', folder: '../s2' })
  await engine.flush()
  expect("add with ../s2 keeps s2's folder for the machine and says so", JSON.stringify(engine.store.get(KEPT) ?? []) === JSON.stringify([s2]) && added.includes(s2), [added, engine.store.get(KEPT)])
  expect("the open pane is asked to redraw and, with no command and no restart, lists s2's intents and its worktree's", engine.record.invalidations > invalidations && JSON.stringify(await ids(engine)) === JSON.stringify(['intent:login', 'intent:s2-x/draft', 'intent:s2/boss']), await ids(engine))
  const after = await tool(engine, { action: 'list' })
  expect('list then names both folders', after.includes(web) && after.includes(s2), after)

  const again = await tool(engine, { action: 'add', folder: s2 })
  const nowhere = await tool(engine, { action: 'add', folder: BASE })
  const unnamed = await tool(engine, { action: 'add' })
  expect('a folder already listed, a path in no checkout and no folder at all store nothing, each with a reason of its own', JSON.stringify(engine.store.get(KEPT)) === JSON.stringify([s2]) && [again, nowhere, unnamed].every(text => text !== '' && !/^Added/.test(text)) && new Set([again, nowhere, unnamed]).size === 3, [again, nowhere, unnamed])

  const removed = await tool(engine, { action: 'remove', folder: 's2' })
  await engine.flush()
  expect("remove by the checkout's name takes it out, and the open pane is back to web's intent", (engine.store.get(KEPT) ?? []).length === 0 && removed.includes(s2) && JSON.stringify(await ids(engine)) === JSON.stringify(['intent:login']), [removed, await ids(engine)])
  const odd = await tool(engine, { action: 'sweep' })
  expect('an action the tool does not have changes nothing and names the three it has', (engine.store.get(KEPT) ?? []).length === 0 && /list/.test(odd) && /add/.test(odd) && /remove/.test(odd), odd)
  expect('no hook threw', engine.record.hookErrors.length === 0, engine.record.hookErrors)
  await engine.end('other')
}

// ---------------------------------------------------------------- report

fs.rmSync(BASE, { recursive: true, force: true })
const passed = results.filter(one => one.ok).length
const lines = ['# Ather Automata across checkouts', '', `${passed} of ${results.length} checks passed.`, '']
for (const one of results) lines.push(`- ${one.ok ? '✅' : '❌'} ${one.name}${one.ok || !one.detail ? '' : `  \n  ${one.detail}`}`)
if (OUT) fs.writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(`${passed}/${results.length} passed`)
for (const one of results.filter(r => !r.ok)) console.log(`FAIL ${one.name}\n     ${one.detail.slice(0, 400)}`)
// Timers the hooks started (the 30-second tick, background fetches) must not keep the run alive.
process.exit(passed === results.length ? 0 : 1)
