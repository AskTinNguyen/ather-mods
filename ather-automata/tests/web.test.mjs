// @ts-check
// The packs: which one a repository gets (A2), and the web pack's proof (A3), held
// actions (A4), traps (A5) and words (A6). Tool outputs under fixtures/web were
// captured from runs in a scratch checkout of AskTinNguyen/han-viet (machine paths
// stripped); han-viet-profile.json and han-viet-package.json are its .ather/profile.json
// and package.json scripts on main. pnpm-recursive-*.txt are `pnpm test` in a scratch
// pnpm workspace of two packages. go-test-*.txt and cargo-test-*.txt are `go test ./...`
// and `cargo test` in a scratch Go module and Rust crate of three tests, without dependencies.
import { describe, expect, test } from 'claude-code/testing'
import fs from 'fs'

import { HELD_LABELS, HELD_NOUNS, heldLabel, heldNoun, heldShell, matchGotchas, recurringGotchas, countGotcha } from '../hooks/guards.mjs'
import { buildHome } from '../hooks/home.mjs'
import { ledgerWithWindow, mandateText, newWindow, offAway } from '../hooks/away.mjs'
import { emptyEvidence, nextStep, parseIntent } from '../hooks/model.mjs'
import { choosePack, core, forgetPacks, makeWebPack, packFor, unreal } from '../hooks/packs/index.mjs'
import { WEB_TRAPS, readToolOutput } from '../hooks/packs/web.mjs'
import * as state from '../hooks/state.mjs'

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

// A session's store, and a command run in it as the hook runs one: read by the pack, each reading kept, the evidence read back.
/** @param {import('../hooks/packs/index.mjs').Pack} pack */
const session = pack => {
  const store = new Map()
  const io = /** @type {any} */ ({
    get: async (/** @type {string} */ key) => store.get(key),
    set: async (/** @type {string} */ key, /** @type {unknown} */ value) => void store.set(key, JSON.parse(JSON.stringify(value))),
    read: async () => null,
    exists: async () => false,
    sessionId: async () => 's1',
    root: async () => 'R',
    redraw: () => undefined,
  })
  /** @param {string} command @param {string} [text] @param {boolean} [isError] @param {string} [deny] a call that was refused */
  const run = async (command, text = '', isError = false, deny) => {
    for (const one of pack.readShell(command, text, deny === undefined ? { isError } : { deny }).rungs) await state.setRung(io, 's1', one.rung, one.value, one.gates)
    return state.readEvidence(io, 's1', pack)
  }
  return { store, run }
}

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
  test('npm test proves tests and build from one run; exit 0 with no counts proves nothing about tests run directly', () => {
    expect(read('npm test', fixture('node-test-pass.txt'))).toEqual({ tests: 'pass', build: 'pass' })
    expect(read('npm test', fixture('node-test-fail.txt'), true)).toEqual({ tests: 'fail', build: 'fail' })
    expect(read('node --test tests/learner-engine.test.mjs', 'all good')).toEqual({ tests: 'none' })
  })
  test('vitest and jest summaries (their documented formats)', () => {
    expect(read('npx vitest run', ' Test Files  3 passed (3)\n      Tests  12 passed (12)\n')).toEqual({ tests: 'pass' })
    expect(read('npx vitest run', ' Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed (12)\n', true)).toEqual({ tests: 'fail' })
    expect(read('npx jest', 'Tests:       12 passed, 12 total\n')).toEqual({ tests: 'pass' })
    expect(read('npx jest', 'Tests:       1 failed, 11 passed, 12 total\n', true)).toEqual({ tests: 'fail' })
    expect(read('npx vitest run', 'No test files found, exiting with code 1\n', true)).toEqual({ tests: 'fail' })
  })
  test('pnpm -r: the counts of every workspace package are read behind its prefix, even piped', () => {
    const pnpm = makeWebPack({ pack: 'web', packageManager: 'pnpm', gates: [{ id: 'test', command: 'pnpm test', proofs: ['tests'] }] }, null)
    /** @param {string} command @param {string} text @param {boolean} [isError] */
    const tests = (command, text, isError = false) => pnpm.readShell(command, text, { isError }).rungs.find(one => one.rung === 'tests')?.value
    // Three root runs (3, 2 and 2 tests), then packages/contracts (4) and packages/web (6).
    expect(tests('pnpm test', fixture('pnpm-recursive-pass.txt'))).toEqual({ state: 'pass', detail: '17 passed, 0 failed' })
    expect(tests('pnpm test | tail -40', fixture('pnpm-recursive-fail.txt'))?.state).toBe('fail')
    expect(tests('pnpm test', fixture('pnpm-recursive-fail.txt'), true)?.state).toBe('fail')
    // Text that only holds a count is still no summary line.
    expect(tests('pnpm test | tail -5', 'the last run said: ℹ pass 3\nsee the note: pass 3\n')?.state).toBe('none')
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

describe('several gates on one rung', () => {
  const GATES = [
    { id: 'tests', command: 'pnpm test', proofs: ['tests'] },
    { id: 'lint', command: 'pnpm lint', proofs: ['lint'] },
    { id: 'typecheck', command: 'pnpm typecheck', proofs: ['lint'] },
    { id: 'build', command: 'pnpm build', proofs: ['build'] },
    { id: 'portable-paths', command: 'pnpm check:portable-paths', proofs: ['lint'] },
  ]
  const pack = makeWebPack({ pack: 'web', packageManager: 'pnpm', gates: GATES, mergePolicy: 'with-proof' }, null)
  const COMMANDS = GATES.map(gate => gate.command)

  test('the prompts name every gate of the rungs they ask for', () => {
    const prompt = `# Lens\n\n- Rev: 1\n- Status: active\n- Area: Platform\n- Owner: Tin Nguyen\n\n## Acceptance\n\n- A1: one\n`
    const progress = '# p\n\n## Acceptance\n\n| Item | Verdict |\n| --- | --- |\n| A1 | met |\n'
    const intent = parseIntent({ slug: 'lens', prompt, findings: '', progress, files: [], hasDebrief: false, updatedAt: 1, source: 'local', firstAuthor: '' }, pack)
    const prove = nextStep('engineer', intent, emptyEvidence(pack), 0, 'Tin Nguyen', {}, pack)
    expect(prove?.key).toBe('prove')
    const proven = Object.fromEntries(['tests', 'lint', 'build'].map(rung => [rung, { state: 'pass', detail: '' }]))
    const ship = nextStep('engineer', intent, proven, 0, 'Tin Nguyen', {}, pack)
    expect(ship?.key).toBe('land')
    for (const command of COMMANDS) {
      expect(prove?.prompt ?? '').toContain(`\`${command}\``)
      expect(ship?.prompt ?? '').toContain(`\`${command}\``)
    }
  })
  test('one gate of a rung passing does not prove the rung; every gate passing does', async () => {
    const { run } = session(pack)
    const one = await run('pnpm lint')
    expect(one.lint.state).toBe('none')
    expect(pack.isProven({ ...one, tests: { state: 'pass', detail: '' }, build: { state: 'pass', detail: '' } }, 'engineer')).toBe(false)
    expect((await run('pnpm typecheck')).lint.state).toBe('none')
    expect((await run('pnpm check:portable-paths')).lint.state).toBe('pass')
  })
  test("a later gate's pass does not hide an earlier gate's failure", async () => {
    const { run } = session(pack)
    expect((await run('pnpm typecheck', fixture('tsc-fail.txt'), true)).lint.state).toBe('fail')
    expect((await run('pnpm check:portable-paths')).lint.state).toBe('fail')
    expect((await run('pnpm typecheck', fixture('tsc-pass.txt'))).lint.state).toBe('none')
    expect((await run('pnpm lint')).lint.state).toBe('pass')
  })
  test('a failing tool run that is no gate fails the rung until one of its gates runs again', async () => {
    const { run } = session(pack)
    await run('pnpm lint && pnpm typecheck')
    expect((await run('pnpm check:portable-paths')).lint.state).toBe('pass')
    expect((await run('npx tsc --noEmit', fixture('tsc-fail.txt'), true)).lint.state).toBe('fail')
    expect((await run('pnpm typecheck', fixture('tsc-pass.txt'))).lint.state).toBe('pass')
    // Passing, it proves nothing the gates have not.
    const fresh = session(pack)
    expect((await fresh.run('npx tsc --noEmit', fixture('tsc-pass.txt'))).lint.state).toBe('none')
  })
  test("a gate's run replaces only its own result, and an unreadable run is no evidence", async () => {
    const { run } = session(pack)
    await run('pnpm lint && pnpm typecheck && pnpm check:portable-paths')
    expect((await run('pnpm lint | tail -3')).lint.state).toBe('none')
    expect((await run('pnpm lint')).lint.state).toBe('pass')
    // A rung with one gate reads as it always did.
    const tests = (await run('pnpm test', fixture('node-test-pass.txt'))).tests
    expect([tests.state, tests.detail]).toEqual(['pass', '77 passed, 0 failed'])
    expect((await run('pnpm test | tail -3', 'all good')).tests.state).toBe('none')
    expect((await run('pnpm build')).build.state).toBe('pass')
  })
  test("a gate's result older than a day no longer counts", async () => {
    const { run, store } = session(pack)
    await run('pnpm lint && pnpm typecheck')
    await run('pnpm check:portable-paths')
    const stored = store.get('evidence:s1')
    stored.lint.gates.typecheck.at = Date.now() - 25 * 3600 * 1000
    expect((await run('pnpm build')).lint.state).toBe('none')
  })
})

describe('how a gate passes', () => {
  /** @param {object[]} gates @param {any} [packageJson] */
  const packOf = (gates, packageJson = null) => makeWebPack({ pack: 'web', gates, mergePolicy: 'with-proof' }, packageJson)
  /** @param {import('../hooks/packs/index.mjs').Pack} pack @param {string} command @param {string} text @param {boolean} [isError] */
  const tests = (pack, command, text, isError = false) => pack.readShell(command, text, { isError }).rungs.filter(one => one.rung === 'tests').map(one => one.value.state)
  const GO = { id: 'tests', command: 'go test ./...', proofs: ['tests'] }
  const CARGO = { id: 'tests', command: 'cargo test', proofs: ['tests'] }
  const RUNS = /** @type {const} */ ([[GO, 'go-test-pass.txt', 'go-test-fail.txt'], [CARGO, 'cargo-test-pass.txt', 'cargo-test-fail.txt']])

  test('the profile field is read in both forms of gates; anything but "exit" or "counts" is no field', () => {
    const values = ['exit', 'counts', 'sometimes', 7, null, ['exit'], { on: 'exit' }]
    const list = packOf([...values.map((passOn, index) => ({ id: `g${index}`, command: `make check${index}`, proofs: ['tests'], passOn })), { id: 'bare', command: 'make bare', proofs: ['tests'] }])
    expect(list.gates.map(gate => gate.passOn)).toEqual(['exit', 'counts', undefined, undefined, undefined, undefined, undefined, undefined])
    const named = makeWebPack({ pack: 'web', gates: { unit: { command: 'go test ./...', proofs: ['tests'], passOn: 'counts' }, e2e: { command: 'make e2e', proof: 'ui', passOn: 'exit' }, vet: 'go vet ./...' } }, null)
    expect(named.gates.map(gate => [gate.id, gate.passOn])).toEqual([['unit', 'counts'], ['e2e', 'exit'], ['vet', undefined]])
    // An unknown value reads as a gate without the field.
    for (const index of [0, 2, 3, 4, 5, 6]) expect(tests(list, `make check${index}`, 'all good')).toEqual(['pass'])
    expect(tests(list, 'make bare', 'all good')).toEqual(['pass'])
    expect(tests(list, 'make check1', 'all good')).toEqual(['none'])
  })
  test("han-viet's profile as written: each gate run by itself passes, all of them prove an engineer, one failing fails its rung", async () => {
    const outputs = {
      'npm test': fixture('node-test-pass.txt'),
      'npm run lint': fixture('eslint-pass.txt'),
      'npm run curriculum:verify': 'curriculum ok\nstudy layer ok\ncharacter layer ok\n',
      'npm run learner:test': fixture('node-test-pass.txt'),
      'npm run build': fixture('vinext-build-pass.txt'),
      'npm run build:next': fixture('next-build-pass.txt'),
      'npm run ui:verify': fixture('playwright-pass.txt'),
    }
    expect(Object.keys(outputs)).toEqual(WEB.gates.map(gate => gate.command))
    for (const gate of WEB.gates) {
      const { run, store } = session(WEB)
      await run(gate.command, outputs[/** @type {keyof typeof outputs} */ (gate.command)])
      const kept = store.get('evidence:s1')
      expect(gate.proofs.map(rung => kept[rung]?.gates?.[gate.id ?? '']?.state)).toEqual(gate.proofs.map(() => 'pass'))
    }
    const { run } = session(WEB)
    let evidence = await run('npm test', outputs['npm test'])
    expect(WEB.isProven(evidence, 'engineer')).toBe(false)
    for (const [command, text] of Object.entries(outputs)) evidence = await run(command, text)
    expect(['tests', 'lint', 'build', 'ui'].map(rung => evidence[rung]?.state)).toEqual(['pass', 'pass', 'pass', 'pass'])
    expect(WEB.isProven(evidence, 'engineer')).toBe(true)
    evidence = await run('npm run curriculum:verify', 'Exit code 1\nlesson 12: unknown reference', true)
    expect(evidence.tests?.state).toBe('fail')
    expect(WEB.isProven(evidence, 'engineer')).toBe(false)
  })
  test('a Go gate and a Rust gate that pass on exit: the passing run passes, the failing run fails, a piped run is not proven', async () => {
    for (const [gate, passing, failing] of RUNS) {
      const pack = packOf([{ ...gate, passOn: 'exit' }])
      expect(tests(pack, gate.command, fixture(passing))).toEqual(['pass'])
      expect(tests(pack, gate.command, fixture(failing), true)).toEqual(['fail'])
      const piped = pack.readShell(`${gate.command} 2>&1 | tail -5`, fixture(passing), {})
      expect(piped.rungs.map(one => one.value.state)).toEqual(['none'])
      expect(piped.context).toHaveLength(1)
      const { run } = session(pack)
      expect(pack.isProven(await run(gate.command, fixture(failing), true), 'engineer')).toBe(false)
      expect(pack.isProven(await run(gate.command, fixture(passing)), 'engineer')).toBe(true)
    }
  })
  test("the exit code passes a gate only when it is the gate's own: not after a pipe, \";\" or \"||\"", async () => {
    const hidden = ['go test ./... | cat', "go test ./... 2>&1 | sed -n '1,80p'", 'go test ./...; echo "exit=$?"', 'go test ./... || true', 'go test ./...\necho done']
    for (const passOn of ['exit', undefined]) {
      const pack = packOf([{ ...GO, passOn }, { id: 'unit', command: 'pnpm test', proofs: ['tests'], passOn }])
      for (const command of hidden) {
        // The exit code is another command's, so the tool call is no error whatever the tests did.
        for (const text of [fixture('go-test-fail.txt'), fixture('go-test-pass.txt')]) {
          const reading = pack.readShell(command, text, {})
          expect(reading.rungs.map(one => one.value.state)).toEqual(['none'])
          expect(reading.context).toHaveLength(1)
        }
      }
      for (const command of ['go test ./...', 'cd api && go test ./... 2>&1', 'go test ./... -run "TestA|TestB"', "go test ./... -run 'TestA;TestB'"]) {
        const reading = pack.readShell(command, fixture('go-test-pass.txt'), {})
        expect(reading.rungs.map(one => one.value.state)).toEqual(['pass'])
        expect(reading.context).toHaveLength(0)
      }
      // Counts decide as before, whatever joins the commands.
      expect(tests(pack, 'pnpm test; echo done', fixture('node-test-pass.txt'))).toEqual(['pass'])
      expect(pack.readShell('pnpm test; echo done', fixture('node-test-pass.txt'), {}).context).toHaveLength(0)
      expect(tests(pack, 'pnpm test; echo done', fixture('node-test-fail.txt'))).toEqual(['fail'])
      const single = packOf([{ ...GO, passOn }])
      const { run } = session(single)
      expect(single.isProven(await run('go test ./...', fixture('go-test-pass.txt')), 'engineer')).toBe(true)
      const later = await run('go test ./...; echo done', fixture('go-test-fail.txt'))
      expect(later.tests?.state).toBe('none')
      expect(single.isProven(later, 'engineer')).toBe(false)
    }
  })
  test('a gate found inside a script that is no gate is read on counts, not on the outer exit code', async () => {
    const scripts = { check: 'go test ./... | cat', soft: 'go test ./... || true', echo: 'go test ./...; echo "exit=$?"', wrap: 'go test ./...', unit: 'pnpm test' }
    for (const passOn of ['exit', undefined]) {
      const pack = packOf([{ ...GO, passOn }], { scripts })
      for (const script of ['check', 'soft', 'echo', 'wrap']) {
        for (const text of [fixture('go-test-fail.txt'), fixture('go-test-pass.txt')]) {
          const reading = pack.readShell(`npm run ${script}`, text, {})
          expect(reading.rungs.map(one => [one.value.state, one.gates?.ran])).toEqual([['none', ['tests']]])
          expect(reading.context).toHaveLength(0)
        }
        const { run, store } = session(pack)
        expect(pack.isProven(await run('go test ./...', fixture('go-test-pass.txt')), 'engineer')).toBe(true)
        const later = await run(`npm run ${script}`, fixture('go-test-fail.txt'))
        expect(store.get('evidence:s1').tests.gates.tests.state).toBe('none')
        expect(pack.isProven(later, 'engineer')).toBe(false)
      }
      // With counts nothing changes: a script that wraps a counted gate passes it on counts.
      const counted = packOf([{ id: 'unit', command: 'pnpm test', proofs: ['tests'], passOn }], { scripts })
      expect(tests(counted, 'pnpm unit', fixture('node-test-pass.txt'))).toEqual(['pass'])
      expect(tests(counted, 'pnpm unit', fixture('node-test-fail.txt'))).toEqual(['fail'])
      expect(tests(counted, 'pnpm unit', 'all good')).toEqual(['none'])
    }
  })
  test('a call that was denied never ran: nothing is read from it', async () => {
    const denied = { deny: 'refused by the person' }
    for (const passOn of ['exit', undefined]) {
      const pack = packOf([{ ...GO, passOn }, { id: 'lint', command: 'pnpm lint', proofs: ['lint'], passOn }, { id: 'build', command: 'pnpm build', proofs: ['build'], passOn }])
      for (const command of ['go test ./...', 'pnpm lint', 'pnpm build', 'go test ./... && pnpm lint && pnpm build']) {
        const reading = pack.readShell(command, '', denied)
        expect([reading.rungs, reading.context]).toEqual([[], []])
        expect(pack.readShell(command, '', {}).rungs.every(one => one.value.state === 'pass')).toBe(true)
      }
      const single = packOf([{ ...GO, passOn }])
      const { run } = session(single)
      expect(single.isProven(await run('go test ./...', '', false, denied.deny), 'engineer')).toBe(false)
      expect(single.isProven(await run('go test ./...', fixture('go-test-pass.txt')), 'engineer')).toBe(true)
      expect(single.isProven(await run('go test ./...', '', false, denied.deny), 'engineer')).toBe(true)
    }
  })
  test('the same gates on counts are not proven by a passing run the pack reads no counts in', async () => {
    for (const [gate, passing, failing] of RUNS) {
      const pack = packOf([{ ...gate, passOn: 'counts' }])
      expect(tests(pack, gate.command, fixture(passing))).toEqual(['none'])
      expect(tests(pack, gate.command, fixture(failing), true)).toEqual(['fail'])
      const { run } = session(pack)
      expect(pack.isProven(await run(gate.command, fixture(passing)), 'engineer')).toBe(false)
    }
  })
  test('on exit, a run that says no tests ran still fails, and so does a failure count, also piped', () => {
    for (const passOn of ['exit', undefined]) {
      const pack = packOf([{ id: 'test', command: 'pnpm test', proofs: ['tests'], passOn }, { id: 'ui', command: 'pnpm e2e', proofs: ['ui'], passOn }])
      expect(tests(pack, 'pnpm test', 'No tests found, exiting with code 0\n')).toEqual(['fail'])
      expect(tests(pack, 'pnpm test', 'ℹ tests 0\nℹ pass 0\nℹ fail 0\n')).toEqual(['fail'])
      expect(tests(pack, 'pnpm test', fixture('pnpm-recursive-fail.txt'))).toEqual(['fail'])
      expect(tests(pack, 'pnpm test | tail -40', fixture('pnpm-recursive-fail.txt'))).toEqual(['fail'])
      expect(tests(pack, 'pnpm test', fixture('pnpm-recursive-pass.txt'))).toEqual(['pass'])
      expect(tests(pack, 'pnpm test | tail -40', fixture('pnpm-recursive-pass.txt'))).toEqual(['pass'])
      // The browser check is read the same way.
      expect(pack.readShell('pnpm e2e', 'all good', {}).rungs.map(one => [one.rung, one.value.state])).toEqual([['ui', 'pass']])
      expect(pack.readShell('pnpm e2e | tail -3', 'all good', {}).rungs.map(one => [one.rung, one.value.state])).toEqual([['ui', 'none']])
      expect(pack.readShell('pnpm e2e', fixture('playwright-fail.txt'), {}).rungs.map(one => [one.rung, one.value.state])).toEqual([['ui', 'fail']])
    }
  })
  test('what is no gate of the profile is not proven by exit 0 alone: a tool, a script with no gate in it, a repository without a profile, the core', async () => {
    expect(read('node --test tests/learner-engine.test.mjs', 'all good')).toEqual({ tests: 'none' })
    expect(read('npx vitest run', 'all good')).toEqual({ tests: 'none' })
    expect(read('npx playwright test', 'all good')).toEqual({ ui: 'none' })
    // profile:verify runs node --test and is no gate of han-viet's profile.
    expect(read('npm run profile:verify', 'all good')).toEqual({ tests: 'none' })
    const { run } = session(WEB)
    for (const gate of WEB.gates.filter(one => one.id !== 'curriculum')) await run(gate.command, gate.proofs.includes('ui') ? fixture('playwright-pass.txt') : fixture('node-test-pass.txt'))
    expect((await run('npm run profile:verify', 'all good')).tests?.state).toBe('none')
    const bare = makeWebPack(null, { scripts: { test: 'node --test', build: 'next build' } })
    expect(bare.readShell('npm test', 'all good', {}).rungs.map(one => [one.rung, one.value.state])).toEqual([['tests', 'none']])
    expect((await session(bare).run('npm test', 'all good')).tests?.state).toBe('none')
    expect(core.readShell('node --test', 'all good', {}).rungs.map(one => one.value.state)).toEqual(['none'])
    expect(readToolOutput('tests', 'node --test', 'all good', {})?.state).toBe('none')
    expect(readToolOutput('ui', 'playwright test', 'all good', {})?.state).toBe('none')
  })
  test('one command that ran a gate on exit and a gate on counts: each is read its own way', async () => {
    const gates = [{ id: 'unit', command: 'pnpm test:unit', proofs: ['tests'] }, { id: 'strict', command: 'pnpm test:strict', proofs: ['tests'], passOn: 'counts' }, { id: 'lint', command: 'pnpm lint', proofs: ['lint'], passOn: 'counts' }]
    const pack = packOf(gates, { scripts: { check: 'pnpm test:unit && pnpm test:strict && pnpm lint' } })
    const all = ['unit', 'strict']
    // Typed, the command runs the gates itself. Through a script that is no gate, both are read on counts.
    const readings = /** @type {const} */ ([
      ['pnpm test:unit && pnpm test:strict && pnpm lint', [['tests', 'pass', { ran: ['unit'], all }], ['tests', 'none', { ran: ['strict'], all }], ['lint', 'pass', { ran: ['lint'], all: ['lint'] }]], 'pass'],
      ['pnpm check', [['tests', 'none', { ran: all, all }], ['lint', 'pass', { ran: ['lint'], all: ['lint'] }]], 'none'],
    ])
    for (const [command, expected, unit] of readings) {
      const reading = pack.readShell(command, 'all good', {}).rungs
      expect(reading.map(one => [one.rung, one.value.state, one.gates])).toEqual(expected)
      const { run, store } = session(pack)
      const evidence = await run(command, 'all good')
      const kept = store.get('evidence:s1').tests.gates
      expect([kept.unit.state, kept.strict.state, evidence.tests?.state, evidence.lint?.state]).toEqual([unit, 'none', 'none', 'pass'])
      expect((await run(command, fixture('node-test-pass.txt'))).tests?.state).toBe('pass')
      // A failure fails both.
      const failed = await run(command, fixture('node-test-fail.txt'), true)
      expect([failed.tests?.state, store.get('evidence:s1').tests.gates.unit.state, store.get('evidence:s1').tests.gates.strict.state]).toEqual(['fail', 'fail', 'fail'])
    }
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

describe("without profile gates: the repository's package manager", () => {
  const SCRIPTS = { test: 'node --test', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'vite build' }
  const FOUR = {
    npm: ['npm test', 'npm run lint', 'npm run typecheck', 'npm run build'],
    pnpm: ['pnpm test', 'pnpm lint', 'pnpm typecheck', 'pnpm build'],
    yarn: ['yarn test', 'yarn lint', 'yarn typecheck', 'yarn build'],
    bun: ['bun run test', 'bun run lint', 'bun run typecheck', 'bun run build'],
  }
  /** @param {import('../hooks/packs/index.mjs').Pack} pack */
  const prove = pack => pack.prompts.prove('engineer', 'lens')
  // The runner of the command the Prove prompt names for the test script.
  /** @param {import('../hooks/packs/index.mjs').Pack} pack */
  const runner = pack => /`(npm|pnpm|yarn|bun)( run)? test`/.exec(prove(pack))?.[1] ?? ''
  /** @param {string} text @param {string[]} commands */
  const names = (text, commands) => {
    for (const command of commands) expect(text).toContain(`\`${command}\``)
  }

  for (const name of /** @type {const} */ (['pnpm', 'yarn', 'bun'])) {
    test(`packageManager ${name}: Prove, the worker brief and the role description name its commands and no npm command`, () => {
      const pack = makeWebPack(null, { packageManager: `${name}@9.12.0+sha512.abc`, scripts: SCRIPTS })
      for (const text of [prove(pack), pack.prompts.brief('engineer', 'lens'), pack.roleDescriptions.engineer ?? '']) {
        names(text, FOUR[name])
        expect(text).not.toMatch(/`npm /)
      }
    })
  }
  test('the lockfile alone names the runner; with several, pnpm, then yarn, then bun', () => {
    const pack = (/** @type {string[]} */ ...files) => makeWebPack(null, { scripts: SCRIPTS }, { files })
    expect(runner(pack('package.json', 'pnpm-lock.yaml'))).toBe('pnpm')
    expect(runner(pack('yarn.lock'))).toBe('yarn')
    expect(runner(pack('bun.lock'))).toBe('bun')
    expect(runner(pack('bun.lockb'))).toBe('bun')
    expect(runner(pack('bun.lock', 'yarn.lock', 'pnpm-lock.yaml'))).toBe('pnpm')
    expect(runner(pack('bun.lockb', 'yarn.lock'))).toBe('yarn')
    expect(runner(pack('package-lock.json'))).toBe('npm')
    names(prove(pack('pnpm-lock.yaml')), FOUR.pnpm)
  })
  test("packageManager wins over another runner's lockfile; the profile's packageManager wins over both", () => {
    expect(runner(makeWebPack(null, { packageManager: 'yarn@4.5.0', scripts: SCRIPTS }, { files: ['pnpm-lock.yaml'] }))).toBe('yarn')
    expect(runner(makeWebPack({ pack: 'web', packageManager: 'bun' }, { packageManager: 'yarn@4.5.0', scripts: SCRIPTS }, { files: ['pnpm-lock.yaml'] }))).toBe('bun')
  })
  test('a packageManager that is no string or names no known runner is skipped, and nothing throws', () => {
    for (const odd of ['deno@2', 42, {}, '', null, ['pnpm'], 'pnpmx@1']) {
      expect(runner(makeWebPack(null, { packageManager: odd, scripts: SCRIPTS }))).toBe('npm')
      expect(runner(makeWebPack(null, { packageManager: odd, scripts: SCRIPTS }, { files: ['yarn.lock'] }))).toBe('yarn')
      expect(runner(makeWebPack({ pack: 'web', packageManager: odd }, { packageManager: 'pnpm@9.12.0', scripts: SCRIPTS }))).toBe('pnpm')
    }
    for (const odd of [null, 42, 'pnpm-lock.yaml', { files: 'pnpm-lock.yaml' }, { files: [42, null] }]) {
      expect(runner(makeWebPack(null, { scripts: SCRIPTS }, /** @type {any} */ (odd)))).toBe('npm')
    }
  })
  test('the typecheck script is named on the lint rung, after lint; alone, it is what lint names', () => {
    names(prove(makeWebPack(null, { scripts: SCRIPTS })), FOUR.npm)
    expect(prove(makeWebPack(null, { scripts: SCRIPTS }))).toMatch(/`npm run lint`, `npm run typecheck`/)
    const only = prove(makeWebPack(null, { scripts: { typecheck: 'tsc --noEmit' } }, { files: ['pnpm-lock.yaml'] }))
    expect(only).toContain('`pnpm typecheck`')
    expect(only).not.toMatch(/`pnpm lint`/)
  })
  test('through choosePack: a pnpm-lock.yaml at the root names pnpm, by marker and under a profile that names web', async () => {
    const files = { 'package.json': JSON.stringify({ scripts: SCRIPTS }) }
    const marker = await choosePack(fakeIo(files, ['package.json', 'pnpm-lock.yaml']).io, 'R')
    expect(marker.source).toBe('marker')
    names(prove(marker.pack), FOUR.pnpm)
    const named = await choosePack(fakeIo({ ...files, '.ather/profile.json': '{"pack":"web"}' }, ['.ather', 'package.json', 'pnpm-lock.yaml']).io, 'R')
    expect(named.source).toBe('profile')
    names(prove(named.pack), FOUR.pnpm)
    // A root that cannot be listed is a root with no lockfile.
    const fake = fakeIo({ ...files, '.ather/profile.json': '{"pack":"web"}' })
    const unlisted = await choosePack({ ...fake.io, list: async () => { throw new Error('no such folder') } }, 'R')
    expect(runner(unlisted.pack)).toBe('npm')
  })
  test('a profile that names unreal or core still returns its pack without listing the root', async () => {
    for (const [name, pack] of /** @type {const} */ ([['unreal', unreal], ['core', core]])) {
      const fake = fakeIo({ '.ather/profile.json': `{"pack":"${name}"}`, 'package.json': '{}' }, ['package.json', 'pnpm-lock.yaml'])
      let lists = 0
      const chosen = await choosePack({ ...fake.io, list: async () => { lists += 1; return [] } }, 'R')
      expect(chosen.pack).toBe(pack)
      expect(lists).toBe(0)
      expect(fake.reads.count).toBe(2)
    }
  })

  test('npm with test, lint and build scripts and no typecheck reads as it did, to the letter', () => {
    const pack = makeWebPack(null, { scripts: { test: 'node --test', lint: 'eslint .', build: 'vite build' } }, { files: ['package.json', 'package-lock.json'] })
    expect(prove(pack)).toBe("Prove intent lens: run `npm test`, `npm run lint` and `npm run build` and report each command's own exit code and its pass and fail counts. Ather reads the result from tool output.")
    expect(prove(makeWebPack(null, { scripts: { test: 'node --test', lint: 'eslint .', build: 'vite build' } }))).toBe(prove(pack))
  })
  test("a profile with gates names the profile's commands, whatever the lockfile says", () => {
    const pack = makeWebPack(PROFILE, { ...PACKAGE, packageManager: 'pnpm@9.12.0' }, { files: ['pnpm-lock.yaml'] })
    for (const role of ['engineer', 'designer', 'product']) expect(pack.prompts.prove(role, 'lens')).toBe(WEB.prompts.prove(role, 'lens'))
    expect(pack.prompts.ship('engineer', 'lens')).toBe(WEB.prompts.ship('engineer', 'lens'))
    expect(pack.roleDescriptions).toEqual(WEB.roleDescriptions)
  })
  test('with profile gates, a rung that no gate declares names the one script it named before, with the runner', () => {
    const profile = { pack: 'web', gates: [{ id: 'test', command: 'npm test', proofs: ['tests'] }, { id: 'build', command: 'npm run build', proofs: ['build'] }], mergePolicy: 'with-proof', required: ['tests', 'lint', 'build'] }
    const scripts = { test: 'node --test', lint: 'eslint .', build: 'vite build' }
    const pack = makeWebPack(profile, { scripts: { ...scripts, typecheck: 'tsc --noEmit' } })
    const before = makeWebPack(profile, { scripts })
    for (const [text, was] of [[pack.prompts.ship('engineer', 'lens'), before.prompts.ship('engineer', 'lens')], [pack.mandate.allowed, before.mandate.allowed]]) {
      expect(text).toContain('`npm run lint`')
      expect(text).not.toMatch(/typecheck/)
      expect(text).toBe(was)
    }
    const pnpm = makeWebPack(profile, { scripts: { ...scripts, typecheck: 'tsc --noEmit' } }, { files: ['pnpm-lock.yaml'] }).mandate.allowed
    expect(pnpm).toContain('`pnpm lint`')
    expect(pnpm).not.toMatch(/typecheck|`npm run lint`/)
  })
  test('without a profile there are still no gates, and running the named command proves the rung', () => {
    const pack = makeWebPack(null, { packageManager: 'pnpm@9.12.0', scripts: SCRIPTS }, { files: ['pnpm-lock.yaml'] })
    expect(pack.gates).toEqual([])
    expect(pack.rungGates).toEqual({})
    for (const command of ['pnpm test', 'bun run test', 'yarn test', 'npm test', 'node --test']) {
      expect(pack.readShell(command, fixture('node-test-pass.txt'), {}).rungs).toEqual([{ rung: 'tests', value: { state: 'pass', detail: '77 passed, 0 failed' } }])
    }
    expect(pack.readShell('pnpm typecheck', fixture('tsc-pass.txt'), {}).rungs.map(one => [one.rung, one.value.state])).toEqual([['lint', 'pass']])
    expect(pack.readShell('npx eslint .', fixture('eslint-pass.txt'), {}).rungs.map(one => [one.rung, one.value.state])).toEqual([['lint', 'pass']])
  })
})

describe('a base branch that is not main', () => {
  const PLAIN = { pack: 'web', gates: [{ id: 'test', command: 'npm test', proofs: ['tests'] }] }
  const DEVELOP = makeWebPack({ ...PLAIN, baseBranch: 'develop' }, PACKAGE)
  const NONE = makeWebPack(PLAIN, PACKAGE)
  const held = ['merge', 'push-main']
  /** @param {string} branch */
  const on = branch => () => branch
  /** @param {import('../hooks/packs/index.mjs').Pack} pack */
  const texts = pack => [pack.mandate.allowed, pack.held.labels['push-main'], pack.held.nouns['push-main'], pack.prompts.ship('engineer', 'lens'), pack.prompts.ship('product', 'lens')]

  test('a push to it is held as push-main, however the push names it', () => {
    for (const command of ['git push origin develop', 'git push origin HEAD:develop', 'git push origin feat/x:refs/heads/develop', 'git push origin +develop']) {
      expect(heldShell(command, held, on('feat/x'), DEVELOP)).toBe('push-main')
    }
    expect(heldShell('git push', held, on('develop'), DEVELOP)).toBe('push-main')
    const layout = (/** @type {string | null} */ folder) => (folder === 'E:/wt/dev' ? 'develop' : 'feat/x')
    expect(heldShell('git -C E:/wt/dev push', held, layout, DEVELOP)).toBe('push-main')
  })
  test('a local merge while it is checked out is held as a merge', () => {
    expect(heldShell('git merge feat/x', held, on('develop'), DEVELOP)).toBe('merge')
  })
  test('feature branches are ordinary work, also when their name has the base branch in it', () => {
    expect(heldShell('git push -u origin feat/develop-menu', held, on('develop'), DEVELOP)).toBe(null)
    expect(heldShell('git push', held, on('feat/x'), DEVELOP)).toBe(null)
    expect(heldShell('git merge origin/develop', held, on('feat/x'), DEVELOP)).toBe(null)
  })
  test('main stays held, and a PR merge is held whatever branch the PR goes into', () => {
    expect(heldShell('git push origin main', held, on('feat/x'), DEVELOP)).toBe('push-main')
    expect(heldShell('git merge feat/x', held, on('main'), DEVELOP)).toBe('merge')
    expect(heldShell('gh pr merge 5', held, on('feat/x'), DEVELOP)).toBe('merge')
    expect(heldShell('gh pr merge 5', held, on('feat/x'), NONE)).toBe('merge')
    expect(heldShell('gh pr merge 5', held, on('develop'), unreal)).toBe('merge')
  })
  test('with-proof frees a proven merge into the base branch, and never a push to it', () => {
    const proven = makeWebPack({ ...PLAIN, baseBranch: 'develop', mergePolicy: 'with-proof' }, PACKAGE)
    expect(heldShell('git merge feat/x', held, on('develop'), proven)).toBe('merge')
    expect(heldShell('git merge feat/x', held, on('develop'), proven, { isProven: true })).toBe(null)
    expect(heldShell('git push origin develop', held, on('feat/x'), proven, { isProven: true })).toBe('push-main')
  })
  test('another checkout in the command is judged by its own base branch', () => {
    const at = (/** @type {string | null} */ folder) => (folder === '../web' ? { pack: DEVELOP, held, isProven: false } : null)
    expect(heldShell('cd ../web && git push origin develop', held, on('feat/x'), unreal, { at })).toBe('push-main')
    expect(heldShell('git push origin develop', held, on('feat/x'), unreal, { at })).toBe(null)
  })
  test('without the field, in the Unreal pack and in the core pack, develop is a branch like any other', () => {
    for (const pack of [NONE, unreal, core]) {
      for (const command of ['git push origin develop', 'git push origin HEAD:develop', 'git push origin feat/x:refs/heads/develop', 'git push origin +develop']) {
        expect(heldShell(command, held, on('feat/x'), pack)).toBe(null)
      }
      expect(heldShell('git push', held, on('develop'), pack)).toBe(null)
      expect(heldShell('git merge feat/x', held, on('develop'), pack)).toBe(null)
      expect(heldShell('git push origin main', held, on('feat/x'), pack)).toBe('push-main')
    }
    expect(unreal.baseBranch).toBe(undefined)
    expect(core.baseBranch).toBe(undefined)
  })
  test('the texts name the base branch: what is allowed, what is held, and where the PR goes', () => {
    expect(DEVELOP.baseBranch).toBe('develop')
    expect(DEVELOP.mandate.allowed).toContain('develop')
    expect(DEVELOP.mandate.allowed).not.toMatch(/\bmain\b/)
    const proven = makeWebPack({ ...PLAIN, baseBranch: 'develop', mergePolicy: 'with-proof' }, PACKAGE)
    expect(proven.mandate.allowed).toContain('develop')
    expect(proven.mandate.allowed).not.toMatch(/\bmain\b/)
    for (const text of [DEVELOP.held.labels['push-main'], DEVELOP.held.nouns['push-main']]) {
      expect(text).toContain('develop')
      expect(text).toContain('main')
    }
    expect(DEVELOP.prompts.ship('engineer', 'lens')).toContain('develop')
    expect(proven.prompts.ship('engineer', 'lens')).toContain('develop')
  })
  test('the mandate and the ledger of a window name the base branch among what is held', () => {
    const away = newWindow({ hours: 8, untilDone: false, goal: '', held: [...DEVELOP.held.defaults] }, 0, 'L.md', { person: 'p', root: 'R' })
    expect(mandateText(away, 0, DEVELOP)).toMatch(/Held until the user has reviewed the window[^:]*: [^.]*develop/)
    expect(mandateText({ ...away, phase: 'review', endedAt: 1 }, 0, DEVELOP)).toMatch(/held actions \([^)]*develop/)
    expect(ledgerWithWindow('', away, 0, DEVELOP)).toMatch(/- Held: .*develop/)
    expect(heldLabel('push-main', DEVELOP)).toContain('develop')
    expect(heldNoun('push-main', DEVELOP)).toContain('develop')
    // A kind the pack does not word reads as every pack words it.
    expect(heldLabel('merge', DEVELOP)).toBe(HELD_LABELS.merge)
    expect(heldNoun('asset-save', DEVELOP)).toBe(HELD_NOUNS['asset-save'])
  })
  test('without a base branch every text is what it was', () => {
    expect(NONE.baseBranch).toBe('')
    expect(NONE.mandate.allowed).toBe('push branches, open draft PRs, open PRs to main')
    expect(NONE.held.labels['push-main']).toBe(undefined)
    expect(NONE.held.nouns['push-main']).toBe(undefined)
    const away = newWindow({ hours: 8, untilDone: false, goal: '', held: [...NONE.held.defaults] }, 0, 'L.md', { person: 'p', root: 'R' })
    expect(mandateText(away, 0, NONE)).toContain('Pushes to main')
    expect(mandateText(away, 0, NONE)).not.toContain('develop')
    expect(mandateText(away, 0)).toContain('Pushes to main')
    for (const pack of [NONE, unreal, core]) {
      expect(heldLabel('push-main', pack)).toBe('Pushes to main')
      expect(heldNoun('push-main', pack)).toBe('a push to main')
    }
    expect(heldLabel('deploy-prod', unreal)).toBe(HELD_LABELS['deploy-prod'])
  })
  test('main, master and a value that is no branch name read as no base branch, and nothing throws', () => {
    for (const odd of ['main', 'master', 'refs/heads/main', 42, '', '   ', 'a b', {}, ['develop'], null, 'x'.repeat(101)]) {
      const pack = makeWebPack({ ...PLAIN, baseBranch: odd }, PACKAGE)
      expect(pack.baseBranch).toBe('')
      expect(texts(pack)).toEqual(texts(NONE))
      expect(pack.held).toEqual(NONE.held)
      expect(heldShell('git push origin develop', held, on('feat/x'), pack)).toBe(null)
      expect(heldShell('git push origin main', held, on('feat/x'), pack)).toBe('push-main')
    }
    const proven = { ...PLAIN, mergePolicy: 'with-proof' }
    expect(texts(makeWebPack({ ...proven, baseBranch: 'master' }, PACKAGE))).toEqual(texts(makeWebPack(proven, PACKAGE)))
    expect(makeWebPack({ ...PLAIN, baseBranch: ' refs/heads/release/1.x ' }, PACKAGE).baseBranch).toBe('release/1.x')
  })
  test("the fallback is the clone's default branch; the profile's word wins, main included", () => {
    expect(makeWebPack(PLAIN, PACKAGE, { defaultBranch: 'develop' }).baseBranch).toBe('develop')
    expect(makeWebPack(null, PACKAGE, { defaultBranch: 'develop' }).baseBranch).toBe('develop')
    expect(makeWebPack({ ...PLAIN, baseBranch: 'main' }, PACKAGE, { defaultBranch: 'develop' }).baseBranch).toBe('')
    expect(makeWebPack({ ...PLAIN, baseBranch: 'staging' }, PACKAGE, { defaultBranch: 'develop' }).baseBranch).toBe('staging')
    expect(makeWebPack({ ...PLAIN, baseBranch: 'a b' }, PACKAGE, { defaultBranch: 'develop' }).baseBranch).toBe('develop')
    for (const odd of ['main', 'master', '', 'a b', 42, null]) {
      expect(makeWebPack(PLAIN, PACKAGE, /** @type {any} */ ({ defaultBranch: odd })).baseBranch).toBe('')
    }
  })

  const GIT = { '.git/HEAD': 'ref: refs/heads/feat/x\n' }
  const WEB_FILES = { '.ather/profile.json': JSON.stringify(PLAIN), 'package.json': '{}' }
  /** @param {Record<string, string>} files */
  const chosenBase = async files => (await choosePack(fakeIo(files, ['package.json']).io, 'R')).pack.baseBranch
  test('through choosePack: origin/HEAD names the base branch when the profile does not', async () => {
    expect(await chosenBase({ ...WEB_FILES, ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n' })).toBe('develop')
    expect(await chosenBase({ 'package.json': '{}', ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n' })).toBe('develop')
    expect(await chosenBase({ ...WEB_FILES, ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/main\n' })).toBe('')
    expect(await chosenBase({ ...WEB_FILES, ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/master\n' })).toBe('')
    expect(await chosenBase({ ...WEB_FILES, ...GIT })).toBe('')
    expect(await chosenBase(WEB_FILES)).toBe('')
    expect(await chosenBase({ ...WEB_FILES, ...GIT, '.git/refs/remotes/origin/HEAD': '4f2a9c0d\n' })).toBe('')
    expect(await chosenBase({ ...WEB_FILES, ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/a b\n' })).toBe('')
  })
  test("through choosePack: the profile's baseBranch wins over origin/HEAD, main included", async () => {
    const origin = { ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n', 'package.json': '{}' }
    expect(await chosenBase({ ...origin, '.ather/profile.json': JSON.stringify({ ...PLAIN, baseBranch: 'main' }) })).toBe('')
    expect(await chosenBase({ ...origin, '.ather/profile.json': JSON.stringify({ ...PLAIN, baseBranch: 'staging' }) })).toBe('staging')
    expect(await chosenBase({ ...origin, '.ather/profile.json': JSON.stringify({ ...PLAIN, baseBranch: 42 }) })).toBe('develop')
  })
  test('through choosePack: a worktree is read through to the git folder its clone shares', async () => {
    const shared = { '/M/.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n' }
    expect(await chosenBase({ ...WEB_FILES, '.git': 'gitdir: /M/.git/worktrees/w\n', '/M/.git/worktrees/w/commondir': '../..\n', ...shared })).toBe('develop')
    expect(await chosenBase({ ...WEB_FILES, '.git': 'gitdir: /M/.git/worktrees/w\n', '/M/.git/worktrees/w/commondir': '/M/.git\n', ...shared })).toBe('develop')
    // A worktree whose own folder has no commondir file and no origin/HEAD has no fallback.
    expect(await chosenBase({ ...WEB_FILES, '.git': 'gitdir: /M/.git/worktrees/w\n', ...shared })).toBe('')
  })
  test('through choosePack: an Io that throws on a missing file gives no fallback and still a pack', async () => {
    const fake = fakeIo({ ...WEB_FILES, ...GIT })
    const throwing = { ...fake.io, read: async (/** @type {string} */ path) => { if (/\.git\//.test(path)) throw new Error(`ENOENT ${path}`); return fake.io.read(path) } }
    const chosen = await choosePack(throwing, 'R')
    expect(chosen.pack.id).toBe('web')
    expect(chosen.pack.baseBranch).toBe('')
  })
  test('through choosePack: a profile that names unreal or core reads nothing of .git', async () => {
    for (const name of ['unreal', 'core']) {
      const fake = fakeIo({ '.ather/profile.json': `{"pack":"${name}","baseBranch":"develop"}`, 'package.json': '{}', ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n' })
      /** @type {string[]} */
      const asked = []
      const chosen = await choosePack({ ...fake.io, read: async path => { asked.push(path); return fake.io.read(path) }, exists: async path => { asked.push(path); return fake.io.exists(path) } }, 'R')
      expect(chosen.pack.id).toBe(name)
      expect(chosen.pack.baseBranch).toBe(undefined)
      expect(asked.filter(path => /\.git/.test(path))).toEqual([])
      expect(heldShell('git push origin develop', held, on('feat/x'), chosen.pack)).toBe(null)
    }
    // A repository with a .uproject and no profile is Unreal, whatever its default branch.
    const marker = await choosePack(fakeIo({ ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n' }, ['S2.uproject']).io, 'R')
    expect(marker.pack).toBe(unreal)
  })
  test('the base branch is read once per session, with the pack', async () => {
    forgetPacks()
    const fake = fakeIo({ ...WEB_FILES, ...GIT, '.git/refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/develop\n' })
    const first = await packFor(fake.io, 'R')
    expect(first.pack.baseBranch).toBe('develop')
    const reads = fake.reads.count
    expect(await packFor(fake.io, 'R')).toBe(first)
    expect(fake.reads.count).toBe(reads)
    forgetPacks()
  })
})
