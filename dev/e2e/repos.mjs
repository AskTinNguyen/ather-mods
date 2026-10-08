// End-to-end run of the Ather Automata hooks module over several real git checkouts: a parent
// folder holding an S2 checkout and a web checkout, each with a local bare origin, driven
// through the stand-in engine. Needs no S2_ROOT. `node repos.mjs [report.md]`.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { createEngine } from './engine.mjs'

const OUT = process.argv[2]
const { register } = await import('./out/hooks/ather.mjs')

// The person's own git settings (signing, hooks, default branch) stay out of these repositories and of the hooks' git calls.
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-repos-'))
fs.writeFileSync(path.join(BASE, 'gitconfig'), '')
process.env.GIT_CONFIG_GLOBAL = path.join(BASE, 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

const results = []
const expect = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// One checkout at <parent>/<folder>: `git init`, the files given, one commit on main pushed to a bare
// origin at <parent>-origins/<owner>/<name>.git (so the repository is named owner/name), then `branch` checked out.
const makeCheckout = (parent, folder, { owner, name, files = {}, branch = 'main' }) => {
  const root = path.join(parent, folder)
  const origin = path.join(`${parent}-origins`, owner, `${name}.git`)
  fs.mkdirSync(origin, { recursive: true })
  git(origin, 'init', '--bare', '-q', '-b', 'main')
  fs.mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Tin Nguyen')
  git(root, 'config', 'user.email', 'tin@example.com')
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'start')
  git(root, 'remote', 'add', 'origin', origin)
  git(root, 'push', '-q', 'origin', 'main')
  if (branch !== 'main') git(root, 'checkout', '-q', '-b', branch)
  return root
}

// docs/intent with a file in it, so git keeps the folder.
const INTENTS = { 'docs/intent/README.md': '# Intents\n' }
const WEB_PROFILE = { version: 1, pack: 'web', gates: [{ id: 'test', command: 'npm test', proofs: ['tests'] }], mergePolicy: 'with-proof', required: ['tests'] }

// A parent folder with s2/ (Unreal, on a feature branch) and web/ (web profile, on main).
const makeWorkspace = () => {
  const parent = fs.mkdtempSync(path.join(BASE, 'work-'))
  const s2 = makeCheckout(parent, 's2', { owner: 'sipher', name: 's2', branch: 'feat/x', files: { ...INTENTS, 'S2.uproject': '{}\n' } })
  const web = makeCheckout(parent, 'web', {
    owner: 'AskTinNguyen',
    name: 'web',
    files: { ...INTENTS, 'package.json': `${JSON.stringify({ name: 'web', scripts: { test: 'node --test' } }, null, 2)}\n`, '.ather/profile.json': `${JSON.stringify(WEB_PROFILE, null, 2)}\n` },
  })
  return { parent, s2, web }
}

// A session opened in `root`, started as the app starts it.
const boot = async ({ root, sessionId = 'harness-session-0001', user = 'Tin Nguyen', options = {}, writable }) => {
  const engine = createEngine({ root, surfaces: [], user, writable })
  engine.setSessionId(sessionId)
  register(engine.on, { briefGate: 'warn', ...options })
  await engine.start()
  // The timezone probe and the workspace read run in the background.
  await new Promise(resolve => setTimeout(resolve, 500))
  return { engine, sessionId }
}

// The model runs a shell command; `text` is what it printed.
const bash = (engine, command, text) => engine.modelTool({ tool: 'Bash', command, ...(text === undefined ? {} : { __text: text }) })
const startAway = engine => engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'start', hours: 2, goal: 'nap' })
const parked = (engine, sid) => engine.store.get(`away:${sid}`)?.parked ?? []

const NODE_TEST_PASS = fs.readFileSync(new URL('../../ather-automata/tests/fixtures/web/node-test-pass.txt', import.meta.url), 'utf8')

// ---------------------------------------------------------------- commands and proof by checkout

{
  const { s2 } = makeWorkspace()
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
  const webScope = engine.store.get(`evidence:${sid}|asktinnguyen/web`)
  expect('a passing npm test in ../web records tests under <sid>|asktinnguyen/web', webScope?.tests?.state === 'pass', webScope)
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
  expect('and in no per-repository scope', !engine.store.has(`evidence:${sid}|asktinnguyen/web`), [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
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

  await bash(engine, 'cd ../web && npm test', NODE_TEST_PASS)
  expect("npm test passing in web proves the intent: evidence:asktinnguyen/web|login", engine.store.get('evidence:asktinnguyen/web|login')?.tests?.state === 'pass', engine.store.get('evidence:asktinnguyen/web|login'))
  expect("and not the session's proof in web", !engine.store.has(`evidence:${sid}|asktinnguyen/web`), [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
  await bash(engine, 'Build.bat S2Editor Win64 Development', 'Result: Succeeded')
  expect("a build in s2 itself lands in the session's scope, not the intent's", engine.store.get(`evidence:${sid}`)?.build?.state === 'pass' && engine.store.get('evidence:asktinnguyen/web|login')?.build?.state !== 'pass', engine.store.get(`evidence:${sid}`))

  await startAway(engine)
  const ledger = engine.store.get(`away:${sid}`)?.ledgerPath
  expect("the owner's away ledger is web/docs/intent/login/decisions.md", ledger === `${web}/docs/intent/login/decisions.md` && fs.existsSync(ledger), ledger)
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'end' })
  await engine.modelTool({ tool: 'mcp__ather-automata__away', action: 'close' })

  await engine.timers()
  const ownBeat = readJson(path.join(s2, 'Saved/AtherAutomata/lanes', `${sid}.json`))
  const webBeat = readJson(path.join(web, '.ather/local/lanes', `${sid}.json`))
  expect("the heartbeat is in s2's lanes and in web's, naming login", ownBeat?.intent === 'login' && webBeat?.intent === 'login' && webBeat.branch === 'main' && ownBeat.branch === 'feat/x', { ownBeat, webBeat })

  await engine.command('ather', 'untrack')
  expect('/ather untrack clears it', !engine.store.has(`pinned:${sid}`), engine.store.get(`pinned:${sid}`))
  expect("and web's Continue", engine.store.get('last:asktinnguyen/web|tinnguyen') === undefined, [...engine.store.keys()].filter(key => key.startsWith('last:')))

  await engine.end('other')
  const ended = [readJson(path.join(s2, 'Saved/AtherAutomata/lanes', `${sid}.json`)), readJson(path.join(web, '.ather/local/lanes', `${sid}.json`))]
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
  expect("and a build there proves it, as before", engine.store.get('evidence:sipher/s2|own')?.build?.state === 'pass', [...engine.store.keys()].filter(key => key.startsWith('evidence:')))
}

{
  // /ather intent <name>: a name only another workspace checkout has is tracked there.
  const { s2, web } = makeWorkspace()
  fs.mkdirSync(path.join(web, 'docs/intent/search'), { recursive: true })
  fs.writeFileSync(path.join(web, 'docs/intent/search/prompt.md'), LOGIN)
  const { engine, sessionId: sid } = await boot({ root: s2, sessionId: 'harness-session-0005', options: { repos: '../web' } })
  await engine.command('ather', 'intent search')
  expect('/ather intent search tracks it in web, the workspace checkout that has it', JSON.stringify(engine.store.get(`pinned:${sid}`)) === JSON.stringify({ slug: 'search', root: web }), engine.store.get(`pinned:${sid}`))
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
