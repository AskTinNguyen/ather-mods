// @ts-check
// The packs: which one a repository gets (A2), and the web pack's proof (A3), held
// actions (A4), traps (A5) and words (A6). Tool outputs under fixtures/web were
// captured from runs in a scratch checkout of AskTinNguyen/han-viet (machine paths
// stripped); han-viet-profile.json and han-viet-package.json are its .ather/profile.json
// and package.json scripts on main.
import { describe, expect, test } from 'claude-code/testing'
import fs from 'fs'

import { heldShell, matchGotchas, recurringGotchas, countGotcha } from '../hooks/guards.mjs'
import { buildHome } from '../hooks/home.mjs'
import { mandateText, newWindow, offAway } from '../hooks/away.mjs'
import { emptyEvidence, nextStep, parseIntent } from '../hooks/model.mjs'
import { choosePack, core, forgetPacks, makeWebPack, packFor, unreal } from '../hooks/packs/index.mjs'
import { WEB_TRAPS, gatesOf, rungsOfCommand } from '../hooks/packs/web.mjs'

/** @param {string} name */
const fixture = name => fs.readFileSync(new URL(`./fixtures/web/${name}`, import.meta.url), 'utf8')
const PROFILE = JSON.parse(fixture('han-viet-profile.json'))
const PACKAGE = JSON.parse(fixture('han-viet-package.json'))
const WEB = makeWebPack(PROFILE, PACKAGE)

/** @param {Record<string, string>} files @param {string[]} [names] */
const fakeIo = (files, names = Object.keys(files)) => {
  const reads = { count: 0 }
  let sid = 'session-1'
  return {
    reads,
    setSession: (/** @type {string} */ id) => { sid = id },
    io: {
      read: async (/** @type {string} */ path) => {
        reads.count += 1
        const name = path.replace(/^R\//, '')
        return files[name] ?? null
      },
      exists: async (/** @type {string} */ path) => path.replace(/^R\//, '') in files,
      list: async () => names.map(name => ({ name, kind: 'file' })),
      sessionId: async () => sid,
    },
  }
}

/** @param {string} command @param {string} text @param {boolean} [isError] */
const read = (command, text, isError = false) => Object.fromEntries(WEB.readShell(command, text, { isError }).rungs.map(one => [one.rung, one.value.state]))

describe('pack selection (A2)', () => {
  test('the profile decides first: pack "web" even beside a .uproject, pack "unreal" even beside package.json', async () => {
    const web = await choosePack(fakeIo({ '.ather/profile.json': '{"pack":"web"}' }, ['.ather', 'S2.uproject']).io, 'R')
    expect(web.pack.id).toBe('web')
    expect(web.source).toBe('profile')
    const s2 = await choosePack(fakeIo({ '.ather/profile.json': '{"pack":"unreal"}', 'package.json': '{}' }).io, 'R')
    expect(s2.pack).toBe(unreal)
  })
  test('then markers: a .uproject is unreal; package.json or pyproject.toml is web', async () => {
    expect((await choosePack(fakeIo({}, ['S2.uproject', 'Source']).io, 'R')).pack).toBe(unreal)
    const node = await choosePack(fakeIo({ 'package.json': '{"scripts":{"test":"node --test"}}' }).io, 'R')
    expect(node.pack.id).toBe('web')
    expect(node.source).toBe('marker')
    expect((await choosePack(fakeIo({}, ['pyproject.toml']).io, 'R')).pack.id).toBe('web')
  })
  test('a .uproject wins over package.json among markers', async () => {
    expect((await choosePack(fakeIo({ 'package.json': '{}' }, ['package.json', 'Game.uproject']).io, 'R')).pack).toBe(unreal)
  })
  test('then the core alone; a profile that is not JSON is ignored', async () => {
    const none = await choosePack(fakeIo({}, ['README.md']).io, 'R')
    expect(none.pack).toBe(core)
    expect(none.source).toBe('none')
    expect((await choosePack(fakeIo({ '.ather/profile.json': '{ not json' }, ['.ather', 'README.md']).io, 'R')).pack).toBe(core)
  })
  test('read once per session and cached; a new session reads again', async () => {
    forgetPacks()
    const fake = fakeIo({ '.ather/profile.json': JSON.stringify(PROFILE), 'package.json': JSON.stringify(PACKAGE) })
    const first = await packFor(fake.io, 'R')
    const reads = fake.reads.count
    const again = await packFor(fake.io, 'R')
    expect(again).toBe(first)
    expect(fake.reads.count).toBe(reads)
    fake.setSession('session-2')
    await packFor(fake.io, 'R')
    expect(fake.reads.count > reads).toBe(true)
    forgetPacks()
  })
  test("the han-viet profile reads as written: seven gates, Vercel production, with-proof", () => {
    expect(WEB.gates).toHaveLength(7)
    expect(WEB.gates.find(gate => gate.command === 'npm run build:next')?.proofs).toEqual(['build', 'lint'])
    expect(WEB.production?.url).toBe('https://han-viet-asktinnguyens-projects.vercel.app/')
    expect(WEB.mergePolicy).toBe('with-proof')
    expect([...(WEB.mergeRungs ?? [])].sort()).toEqual(['build', 'lint', 'tests', 'ui'])
  })
})

describe('web proof from tool output (A3)', () => {
  test('node --test: pass and fail counts, through the profile gate and directly', () => {
    expect(read('npm run learner:test', fixture('node-test-pass.txt'))).toEqual({ tests: 'pass' })
    expect(read('node --experimental-strip-types --no-warnings --import ./tests/support/ts-resolve.mjs --test tests/learner-engine.test.mjs tests/zz-fail.test.mjs', fixture('node-test-fail.txt'), true)).toEqual({ tests: 'fail' })
    // A failure count wins even when the exit code is lost in a pipe.
    expect(read('npm run learner:test 2>&1 | tail -40', fixture('node-test-fail.txt'))).toEqual({ tests: 'fail' })
    expect(read('npm run learner:test | tail -12', fixture('node-test-pass.txt'))).toEqual({ tests: 'pass' })
  })
  test('ESLint and tsc: errors fail, exit 0 passes, warnings do not count', () => {
    expect(read('npm run lint', fixture('eslint-pass.txt'))).toEqual({ lint: 'pass' })
    expect(read('npm run lint', fixture('eslint-fail.txt'), true)).toEqual({ lint: 'fail' })
    expect(read('npx tsc --noEmit', fixture('tsc-pass.txt'))).toEqual({ lint: 'pass' })
    expect(read('npx tsc --noEmit', fixture('tsc-fail.txt'), true)).toEqual({ lint: 'fail' })
    expect(read('npx eslint .', '✖ 2 problems (0 errors, 2 warnings)')).toEqual({ lint: 'pass' })
    expect(read('npx eslint . | tail -3', fixture('eslint-fail.txt'))).toEqual({ lint: 'fail' })
  })
  test('next build proves build and typecheck; a type error fails both', () => {
    expect(read('npm run build:next', fixture('next-build-pass.txt'))).toEqual({ build: 'pass', lint: 'pass' })
    expect(read('npm run build:next', fixture('next-build-fail.txt'), true)).toEqual({ build: 'fail', lint: 'fail' })
    expect(read('npx next build 2>&1 | tail -20', fixture('next-build-fail.txt')).build).toBe('fail')
  })
  test('vinext build: "Build complete." passes; a failed bundle fails, even piped', () => {
    expect(read('npm run build', fixture('vinext-build-pass.txt'))).toEqual({ build: 'pass' })
    expect(read('npm run build', fixture('vinext-build-fail.txt'), true)).toEqual({ build: 'fail' })
    expect(read('npm run build 2>&1 | tail -30', fixture('vinext-build-fail.txt'))).toEqual({ build: 'fail' })
    expect(read('npm run build 2>&1 | tail -5', fixture('vinext-build-pass.txt'))).toEqual({ build: 'pass' })
  })
  test('Playwright through ui:verify: 20 passed is a pass; one failed route fails', () => {
    expect(read('npm run ui:verify', fixture('playwright-pass.txt'))).toEqual({ ui: 'pass' })
    expect(read('npm run ui:verify', fixture('playwright-fail.txt'), true)).toEqual({ ui: 'fail' })
    expect(read('npx playwright test --project=w1365', fixture('playwright-fail.txt'), true)).toEqual({ ui: 'fail' })
  })
  test('npm test proves tests and build from one run; exit 0 with no counts proves nothing about tests', () => {
    expect(read('npm test', fixture('node-test-pass.txt'))).toEqual({ tests: 'pass', build: 'pass' })
    expect(read('npm test', fixture('node-test-fail.txt'), true)).toEqual({ tests: 'fail', build: 'fail' })
    expect(read('npm run learner:test', 'all good')).toEqual({ tests: 'none' })
  })
  test('vitest and jest summaries (their documented formats)', () => {
    expect(read('npx vitest run', ' Test Files  3 passed (3)\n      Tests  12 passed (12)\n')).toEqual({ tests: 'pass' })
    expect(read('npx vitest run', ' Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed (12)\n', true)).toEqual({ tests: 'fail' })
    expect(read('npx jest', 'Tests:       12 passed, 12 total\n')).toEqual({ tests: 'pass' })
    expect(read('npx jest', 'Tests:       1 failed, 11 passed, 12 total\n', true)).toEqual({ tests: 'fail' })
    expect(read('npx vitest run', 'No test files found, exiting with code 1\n', true)).toEqual({ tests: 'fail' })
  })
  test('production: the commit status through gh, and a probe of the public URL', () => {
    expect(read('gh api repos/AskTinNguyen/han-viet/commits/5b71d7f/status', '{"state":"success","statuses":[]}')).toEqual({ prod: 'pass' })
    expect(read('gh api repos/AskTinNguyen/han-viet/commits/5b71d7f/status', '{"state":"failure"}')).toEqual({ prod: 'fail' })
    expect(read('curl -sI https://han-viet-asktinnguyens-projects.vercel.app/', 'HTTP/2 200\ncontent-type: text/html')).toEqual({ prod: 'pass' })
    expect(read('curl -sI https://han-viet-asktinnguyens-projects.vercel.app/', 'HTTP/2 404')).toEqual({ prod: 'fail' })
    expect(read('curl -sI https://example.com/', 'HTTP/2 200')).toEqual({})
  })
  test('a command that is no gate and runs no known tool records nothing', () => {
    expect(read('git status', 'nothing to commit')).toEqual({})
    expect(read('npm run curriculum:build', 'done')).toEqual({})
  })
  test('the core alone reads tests and builds the same way', () => {
    expect(core.readShell('node --test', fixture('node-test-pass.txt'), {}).rungs.map(one => one.value.state)).toEqual(['pass'])
  })
})

describe('gates as people type them', () => {
  // The gates of sipherxyz/ninetails-monitoring's setup, the wide validate run listed before the narrow one.
  const WIDE = { command: 'python3 scripts/validate.py', proofs: ['tests', 'lint', 'build'] }
  const NARROW = { command: 'python3 scripts/validate.py --structural-only', proofs: ['lint'] }
  const REST = [
    { command: 'python3 scripts/check_docs.py', proofs: ['lint'] },
    { command: 'pnpm run typecheck', proofs: ['lint'] },
    { command: 'pnpm test', proofs: ['tests'] },
    { command: 'pnpm --dir web test:node', proofs: ['tests'] },
    { command: 'pnpm run build', proofs: ['build'] },
    { command: 'cd app && python3 -m unittest discover -s tests', proofs: ['tests'] },
  ]
  const GATES = gatesOf({ gates: [WIDE, NARROW, ...REST] })
  /** @param {string} command */
  const rungs = (command, gates = GATES) => rungsOfCommand(command, {}, gates).sort()

  test('the longest gate that matches is the gate, wherever it stands in the profile', () => {
    for (const gates of [GATES, gatesOf({ gates: [NARROW, WIDE, ...REST] })]) {
      expect(rungs('python3 scripts/validate.py --structural-only', gates)).toEqual(['lint'])
      expect(rungs('python3 scripts/validate.py', gates)).toEqual(['build', 'lint', 'tests'])
    }
  })
  test('the first word is a program: a venv python, a versioned one, a Windows python.exe and an env prefix all run the python3 gate', () => {
    for (const command of [
      '.venv/bin/python scripts/validate.py',
      'python scripts/validate.py',
      '/usr/local/bin/python3.12 scripts/validate.py',
      '.venv\\Scripts\\python.exe scripts/validate.py',
      'DYLD_LIBRARY_PATH=/x python3 scripts/validate.py',
    ]) expect(rungs(command)).toEqual(['build', 'lint', 'tests'])
  })
  test('a gate written "cd <folder> && <command>" needs both segments, one after the other', () => {
    expect(rungs('cd app && python3 -m unittest discover -s tests')).toEqual(['tests'])
    expect(rungs('python3 -m unittest discover -s tests')).toEqual([])
    expect(rungs('cd web && python3 -m unittest discover -s tests')).toEqual([])
  })
  test('a "cd" gate needs "&&" between the two segments: "||", a pipe and ";" do not count', () => {
    expect(rungs('npm ci && cd app && python3 -m unittest discover -s tests')).toEqual(['tests'])
    expect(rungs('cd app || python3 -m unittest discover -s tests')).toEqual([])
    expect(rungs('cd app | python3 -m unittest discover -s tests')).toEqual([])
    expect(rungs('cd app; python3 -m unittest discover -s tests')).toEqual([])
  })
  test('a gate whose first word is a path is compared as written', () => {
    const gates = gatesOf({ gates: [{ command: './scripts/check.sh', proofs: ['lint'] }] })
    expect(rungs('./scripts/check.sh', gates)).toEqual(['lint'])
    expect(rungs('./scripts/check.sh --fast', gates)).toEqual(['lint'])
    expect(rungs('./other/check.sh', gates)).toEqual([])
    expect(rungs('/tmp/check.sh', gates)).toEqual([])
    expect(rungs('scripts\\check.sh.exe', gates)).toEqual([])
  })
  test('a command that only looks like a gate proves nothing', () => {
    expect(rungs('python3 scripts/other.py')).toEqual([])
    expect(rungs('ruby scripts/validate.py')).toEqual([])
    expect(rungs('pnpm --dir web test')).toEqual([])
  })
})

describe('web held actions while away (A4)', () => {
  const held = [...WEB.held.defaults]
  const feature = () => 'feature'
  /** @param {string} command @param {object} [context] */
  const hold = (command, context = {}) => heldShell(command, held, feature, WEB, context)
  test('production deploys, however they are spelled', () => {
    expect(hold('vercel --prod')).toBe('deploy-prod')
    expect(hold('vercel deploy --prod')).toBe('deploy-prod')
    expect(hold('npx vercel deploy --prod --yes')).toBe('deploy-prod')
    expect(hold('vercel promote https://x.vercel.app')).toBe('deploy-prod')
    expect(hold('wrangler deploy')).toBe('deploy-prod')
    expect(hold('npx wrangler deploy --dry-run')).toBe(null)
    expect(hold('vercel deploy')).toBe(null)
    expect(hold('gh api -X POST repos/o/r/deployments -f ref=main -f environment=production')).toBe('deploy-prod')
  })
  test('migrations against a non-local database; a local one is ordinary work', () => {
    expect(hold('npx drizzle-kit migrate')).toBe('migrate')
    expect(hold('npx prisma migrate deploy')).toBe('migrate')
    expect(hold('DATABASE_URL=postgres://localhost:5432/dev npx drizzle-kit push')).toBe(null)
    expect(hold('npx wrangler d1 migrations apply DB --remote')).toBe('migrate')
    expect(hold('npx wrangler d1 migrations apply DB --local')).toBe(null)
    expect(hold('npx drizzle-kit generate')).toBe(null)
  })
  test('env and secret changes, through the CLIs and gh api; reading them is not held', () => {
    expect(hold('vercel env add NEXT_PUBLIC_X production')).toBe('env-secret')
    expect(hold('vercel env rm X preview')).toBe('env-secret')
    expect(hold('vercel env ls')).toBe(null)
    expect(hold('vercel env pull .env.local')).toBe(null)
    expect(hold('wrangler secret put API_KEY')).toBe('env-secret')
    expect(hold('gh secret set TOKEN < token.txt')).toBe('env-secret')
    expect(hold('gh api -X PUT repos/o/r/actions/secrets/TOKEN -f encrypted_value=x')).toBe('env-secret')
    expect(hold('gh api --method DELETE /repos/o/r/environments/production/secrets/TOKEN')).toBe('env-secret')
    expect(hold('gh api repos/o/r/actions/secrets')).toBe(null)
  })
  test('npm publish and terraform apply; dry runs and plans are not held', () => {
    expect(hold('npm publish')).toBe('publish')
    expect(hold('pnpm publish --access public')).toBe('publish')
    expect(hold('npm publish --dry-run')).toBe(null)
    expect(hold('terraform apply -auto-approve')).toBe('infra-apply')
    expect(hold('terraform plan')).toBe(null)
  })
  test('chained commands and npm scripts are read segment by segment; quoted text is not a command', () => {
    expect(hold('npm run build && vercel --prod')).toBe('deploy-prod')
    expect(hold('npm test; npx wrangler deploy')).toBe('deploy-prod')
    expect(hold('git commit -m "then vercel --prod" && git push origin feature')).toBe(null)
    expect(hold('npm run deploy', { scripts: { deploy: 'npm run build && vercel deploy --prod' } })).toBe('deploy-prod')
    expect(hold('npm run release', { scripts: { release: 'npm run build && npm publish' } })).toBe('publish')
  })
  test('merges follow the profile: held until every required gate passed, then allowed (with-proof)', () => {
    expect(hold('gh pr merge 15 --squash')).toBe('merge')
    expect(hold('gh pr merge 15 --squash', { isProven: true })).toBe(null)
    expect(hold('gh api -X PUT repos/AskTinNguyen/han-viet/pulls/15/merge')).toBe('merge')
    expect(hold("gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'")).toBe('merge')
    expect(hold("gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'", { isProven: true })).toBe(null)
    expect(hold('npm test && gh pr merge 15', { isProven: true })).toBe(null)
    // Proof never lets a push to main or a production deploy through.
    expect(heldShell('git push origin main', held, feature, WEB, { isProven: true })).toBe('push-main')
    expect(hold('gh pr merge 15 && vercel --prod', { isProven: true })).toBe('deploy-prod')
  })
  test('S2 keeps holding merges whatever the proof; a kind the window does not hold passes', () => {
    expect(heldShell('gh pr merge 15', ['merge', 'push-main'], feature, unreal, { isProven: true })).toBe('merge')
    expect(heldShell('vercel --prod', ['merge', 'push-main'], feature, WEB)).toBe(null)
  })
  test("a folder in another checkout is judged by that checkout's pack, held kinds and proof", () => {
    const windowHeld = ['merge', 'push-main']
    // The session is an Unreal checkout; ../web is a web checkout with its own defaults.
    const at = (/** @type {boolean} */ isProven) => (/** @type {string | null} */ folder) => (folder === '../web' ? { pack: WEB, held: [...WEB.held.defaults], isProven } : null)
    expect(heldShell('cd ../web && vercel --prod', windowHeld, feature, unreal, { at: at(false) })).toBe('deploy-prod')
    expect(heldShell('cd ../web && gh pr merge 3', windowHeld, feature, unreal, { at: at(false) })).toBe('merge')
    expect(heldShell('cd ../web && gh pr merge 3', windowHeld, feature, unreal, { at: at(true) })).toBe(null)
    // The session's own folder keeps the session's pack: proof elsewhere does not free an Unreal merge.
    expect(heldShell('gh pr merge 3 && cd ../web && npm test', windowHeld, feature, unreal, { at: at(true) })).toBe('merge')
    // Without a lookup, as before: the Unreal pack holds no deploy.
    expect(heldShell('cd ../web && vercel --prod', windowHeld, feature, unreal)).toBe(null)
    expect(heldShell('cd ../web && vercel --prod', windowHeld, feature, unreal, { at: () => null })).toBe(null)
  })
  test("the web window's defaults hold every web kind, and its mandate says how merges go", () => {
    expect(WEB.held.defaults).toEqual(['merge', 'push-main', 'deploy-prod', 'migrate', 'env-secret', 'publish', 'infra-apply'])
    const away = newWindow({ hours: 8, untilDone: false, goal: '', held: [...WEB.held.defaults] }, 0, 'L.md', { person: 'p', root: 'R' })
    const text = mandateText(away, 0, WEB)
    expect(text).toMatch(/merge only when every gate the profile requires has passed/)
    expect(text).toMatch(/Production deploys/)
    expect(text).not.toMatch(/CVar/)
    expect(mandateText(away, 0)).toMatch(/never merge/)
  })
})

describe('web traps (A5)', () => {
  const samples = {
    'web-port-in-use': fixture('trap-eaddrinuse.txt'),
    'web-posix-env': fixture('trap-posix-env.txt'),
    'web-hydration': "Error: Hydration failed because the server rendered HTML didn't match the client.",
    'web-stale-cache': "Error: Cannot find module './chunks/vendor-chunks/next.js'",
    'web-lockfile-drift': 'npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync.',
    'web-node-version': 'npm warn EBADENGINE Unsupported engine { required: { node: ">=22.13.0" }, current: { node: "v20.11.0" } }',
    'web-next-public-env': 'Error: NEXT_PUBLIC_SITE_URL is not defined',
    'web-playwright-browsers': "browserType.launch: Executable doesn't exist at C:\\x\\ms-playwright\\chromium_headless_shell-1234\\chrome.exe",
    'web-next-lock': 'Unable to acquire lock at /repo/.next/lock, is another instance of next build running?',
  }
  test('at least eight, each with a title and a fix', () => {
    expect(WEB_TRAPS.length >= 8).toBe(true)
    for (const trap of WEB_TRAPS) expect(trap.fix.length > 40 && trap.title.length > 10).toBe(true)
  })
  test('each is recognised in real or typical output, and only it', () => {
    for (const [id, text] of Object.entries(samples)) expect(matchGotchas(text, WEB).map(one => one.id)).toEqual([id])
    expect(matchGotchas(fixture('node-test-pass.txt'), WEB)).toHaveLength(0)
    expect(matchGotchas(fixture('playwright-pass.txt'), WEB)).toHaveLength(0)
  })
  test('an Unreal trap is not a web trap, and the reverse', () => {
    expect(matchGotchas('Unable to build while Live Coding is active', WEB)).toHaveLength(0)
    expect(matchGotchas(fixture('trap-eaddrinuse.txt'))).toHaveLength(0)
    const [eaddr] = matchGotchas(fixture('trap-eaddrinuse.txt'), WEB)
    const live = unreal.traps[0]
    if (!eaddr || !live) throw new Error('missing traps')
    let hits = {}
    for (let i = 0; i < 3; i += 1) hits = countGotcha(countGotcha(hits, eaddr), live)
    expect(recurringGotchas(hits, [], WEB).map(one => one.id)).toEqual(['web-port-in-use'])
    expect(recurringGotchas(hits, []).map(one => one.id)).toEqual(['live-coding'])
  })
})

describe('web words: Next, Prove and Create (A6)', () => {
  const prompt = `# Lens\n\n- Rev: 1\n- Status: active\n- Area: Platform\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: one\n`
  const progress = '# p\n\n## Acceptance\n\n| Item | Verdict |\n| --- | --- |\n| A1 | met |\n'
  const intent = parseIntent({ slug: 'lens', prompt, findings: '', progress, files: [], hasDebrief: false, updatedAt: 1, source: 'local', firstAuthor: '' }, WEB)
  const proven = Object.fromEntries(['tests', 'lint', 'build', 'ui'].map(rung => [rung, { state: 'pass', detail: '' }]))
  test('Prove names the profile gates for the role, never S2Editor or PIE', () => {
    const engineer = nextStep('engineer', intent, emptyEvidence(WEB), 0, 'Tin Nguyen', {}, WEB)
    expect(engineer?.key).toBe('prove')
    expect(engineer?.prompt ?? '').toMatch(/`npm test`/)
    expect(engineer?.prompt ?? '').not.toMatch(/S2Editor|PIE|Editor/)
    expect(engineer?.hint ?? '').toMatch(/Still needed: passing tests, a clean lint and typecheck and a build that succeeded/)
    const designer = nextStep('designer', intent, emptyEvidence(WEB), 0, 'Tin Nguyen', {}, WEB)
    expect(designer?.prompt ?? '').toMatch(/`npm run ui:verify`/)
  })
  test('Ship lands with proof: every gate, then the Vercel production check', () => {
    const ship = nextStep('engineer', intent, proven, 0, 'Tin Nguyen', {}, WEB)
    expect(ship?.key).toBe('land')
    expect(ship?.prompt ?? '').toMatch(/`npm test`.*`npm run ui:verify`/)
    expect(ship?.prompt ?? '').toMatch(/merge it \(merge policy with-proof\)/)
    expect(ship?.prompt ?? '').toMatch(/Vercel deployment for the merge commit READY, then https:\/\/han-viet-asktinnguyens-projects\.vercel\.app\/ answers 200/)
  })
  test('the Create list offers the web skills, with no skills folder needed, and no Editor', () => {
    const model = buildHome({ intents: [intent], pinned: 'lens', me: 'Tin Nguyen', role: 'engineer', area: '', tourDone: true, evidence: emptyEvidence(WEB), away: offAway(), ledger: '', lost: null, lock: WEB.parseLock(null, 0), recurring: [], issues: [], sent: [], workers: 0, now: 0, tz: 0, pack: WEB })
    const names = model.create.flatMap(group => group.items.map(item => item.name)).sort()
    expect(names).toEqual(['code-review', 'frontend-design', 'run', 'security-review', 'simplify'])
    expect(model.header.lock).toBe('')
    expect(JSON.stringify(model.create)).not.toMatch(/Unreal|Editor owner lock/)
    expect(model.header.role).toBe('Engineer')
  })
})
