// @ts-check
// Setting a repository up for intents: which of the five pieces it has, what the session is handed
// for the missing ones, and the bundle under templates/intent-setup read from disk as it ships.
import { describe, expect, test } from 'claude-code/testing'
import fs from 'fs'

import { parseIntent } from '../hooks/model.mjs'
import { makeWebPack } from '../hooks/packs/index.mjs'
import * as state from '../hooks/state.mjs'
import { SETUP_PIECES, readSetup, setupPrompt, setupSummary, suggestPack } from '../hooks/setup.mjs'

const BUNDLE = new URL('../templates/intent-setup/', import.meta.url)
/** @param {string} name */
const bundled = name => fs.readFileSync(new URL(name, BUNDLE), 'utf8')

const ZIP = '/plugins/ather-automata/templates/intent-setup.zip'
const IDS = ['skill', 'readme', 'profile', 'ignore', 'pointer']

/** A repository with every piece. @type {Record<string, string>} */
const FULL = {
  '.agents/skills/intent/SKILL.md': '# Intent',
  'docs/intent/README.md': '# Intents\n\n## Areas\n\n- `app`: the app.\n',
  '.ather/profile.json': '{"version":1,"pack":"web","gates":[{"id":"test","command":"npm test","proofs":["tests"]},{"id":"lint","command":"npm run lint","proofs":["lint"]}],"areas":["app","api","docs"]}',
  '.gitignore': 'node_modules/\n.ather/local/\n',
  'AGENTS.md': 'Use `.agents/skills/intent/SKILL.md`.\n',
}
/** The file that holds each piece in FULL. @type {Record<string, string>} */
const HOLDER = { skill: '.agents/skills/intent/SKILL.md', readme: 'docs/intent/README.md', profile: '.ather/profile.json', ignore: '.gitignore', pointer: 'AGENTS.md' }

/** @param {Record<string, string>} files */
const fakeIo = files => ({
  read: async (/** @type {string} */ path) => files[path.replace(/^R\//, '')] ?? null,
  exists: async (/** @type {string} */ path) => path.replace(/^R\//, '') in files,
})

/** @param {Record<string, string>} files */
const reading = files => readSetup(fakeIo(files), 'R')

/** @param {string} id */
const without = id => Object.fromEntries(Object.entries(FULL).filter(([name]) => name !== HOLDER[id]))

/** @param {string} id */
const targetOf = id => SETUP_PIECES.find(one => one.id === id)?.path ?? ''

describe('which pieces a repository has', () => {
  test('the five pieces, in the order they are set up, each with its target path', () => {
    expect(SETUP_PIECES.map(one => one.id)).toEqual(IDS)
    expect(SETUP_PIECES.map(one => one.path)).toEqual(['.agents/skills/intent/', 'docs/intent/README.md', '.ather/profile.json', '.gitignore', 'AGENTS.md'])
  })
  test('nothing there: all five are missing and there is no profile', async () => {
    const setup = await reading({})
    expect(setup.missing).toEqual(IDS)
    expect(setup.isComplete).toBe(false)
    expect(setup.profile).toBe(null)
    expect(Object.values(setup.pieces)).toEqual([false, false, false, false, false])
  })
  test('everything there: nothing is missing, and the profile is read', async () => {
    const setup = await reading(FULL)
    expect(setup.missing).toEqual([])
    expect(setup.isComplete).toBe(true)
    expect(setup.profile).toEqual({ pack: 'web', gates: 2, areas: 3 })
  })
  for (const id of IDS) {
    test(`only ${id} missing: missing is exactly that piece`, async () => {
      const setup = await reading(without(id))
      expect(setup.missing).toEqual([id])
      expect(setup.isComplete).toBe(false)
      expect(setup.pieces[id]).toBe(false)
    })
  }
  test('a profile that is not JSON, is not an object, or names no pack counts as missing', async () => {
    for (const text of ['{ not json', '[]', '"web"', '{"gates":[]}', '{"pack":7}']) {
      const setup = await reading({ ...FULL, '.ather/profile.json': text })
      expect(setup.missing).toEqual(['profile'])
      expect(setup.profile).toBe(null)
    }
  })
  test('the readme counts only with an Areas heading', async () => {
    expect((await reading({ ...FULL, 'docs/intent/README.md': '# Intents\n\nAreas are listed elsewhere.\n' })).missing).toEqual(['readme'])
  })
  test('the ignore line: .ather/local/, .ather/local or .ather/ on a line of its own; anything else is not it', async () => {
    for (const line of ['.ather/local/', '.ather/local', '.ather/', '  .ather/local/  ', '.ather/local/\r']) {
      expect((await reading({ ...FULL, '.gitignore': `dist/\n${line}\n` })).pieces.ignore).toBe(true)
    }
    for (const text of ['dist/\n', '# .ather/local/\n', '.ather/profile.json\n']) {
      expect((await reading({ ...FULL, '.gitignore': text })).pieces.ignore).toBe(false)
    }
  })
  test('the pointer may live in CLAUDE.md instead; an instruction file that does not name the skill is no pointer', async () => {
    expect((await reading({ ...without('pointer'), 'CLAUDE.md': 'Intents: see .claude/skills/intent.\n' })).missing).toEqual([])
    expect((await reading({ ...FULL, 'AGENTS.md': '# Agents\n\nRun the tests.\n' })).missing).toEqual(['pointer'])
  })
})

describe('the suggested pack', () => {
  test('unreal when a .uproject file is at the root, web otherwise', () => {
    expect(suggestPack([{ name: 'Game.uproject', kind: 'file' }, { name: 'package.json', kind: 'file' }])).toBe('unreal')
    expect(suggestPack([{ name: 'package.json', kind: 'file' }, { name: 'src', kind: 'directory' }])).toBe('web')
    expect(suggestPack([{ name: 'old.uproject', kind: 'directory' }])).toBe('web')
    expect(suggestPack([])).toBe('web')
  })
})

describe('what the session is handed', () => {
  test('a repository with nothing: the zip and every target path', () => {
    const prompt = setupPrompt({ zip: ZIP, missing: IDS, pack: 'web' })
    expect(prompt).toContain(ZIP)
    expect(prompt).toContain('SETUP.md')
    for (const piece of SETUP_PIECES) expect(prompt).toContain(piece.path)
  })
  test('a partial repository: only the missing pieces are named, by target path', () => {
    for (const id of IDS) {
      const prompt = setupPrompt({ zip: ZIP, missing: [id], pack: 'web' })
      expect(prompt).toContain(ZIP)
      for (const piece of SETUP_PIECES) {
        if (piece.id === id) expect(prompt).toContain(piece.path)
        else expect(prompt).not.toContain(piece.path)
      }
    }
    const two = setupPrompt({ zip: ZIP, missing: ['profile', 'ignore'], pack: 'web' })
    for (const id of IDS) {
      if (id === 'profile' || id === 'ignore') expect(two).toContain(targetOf(id))
      else expect(two).not.toContain(targetOf(id))
    }
  })
  test('the pack is suggested with the profile, and only then', () => {
    expect(setupPrompt({ zip: ZIP, missing: ['profile'], pack: 'unreal' })).toMatch(/\bunreal\b/)
    expect(setupPrompt({ zip: ZIP, missing: ['profile'], pack: 'web' })).toMatch(/\bweb\b/)
    expect(setupPrompt({ zip: ZIP, missing: ['skill'], pack: 'unreal' })).not.toMatch(/\bunreal\b/)
  })
  test('areas and gates are asked about only when the readme or the profile is to be written', () => {
    for (const id of ['readme', 'profile']) expect(setupPrompt({ zip: ZIP, missing: [id], pack: 'web' })).toMatch(/\bgates\b/)
    for (const id of ['skill', 'ignore', 'pointer']) expect(setupPrompt({ zip: ZIP, missing: [id], pack: 'web' })).not.toMatch(/\bgates\b/)
  })
  test('the complete case reads back the pack and the counts in one line', async () => {
    const line = setupSummary(await reading(FULL))
    expect(line).toMatch(/\bweb\b/)
    expect(line).toMatch(/\b2 gates\b/)
    expect(line).toMatch(/\b3 areas\b/)
    expect(line.includes('\n')).toBe(false)
    expect(setupSummary(await reading({ ...FULL, '.ather/profile.json': '{"pack":"core","gates":[{"command":"make test"}]}' }))).toMatch(/\bcore\b.*\b1 gate\b.*\b0 areas\b/)
  })
})

describe('the bundle as it ships', () => {
  const TEMPLATES = 'files/.agents/skills/intent/assets/templates/'
  test('the four templates parse as a new intent: active, one acceptance item, none met', () => {
    expect(fs.readdirSync(new URL(TEMPLATES, BUNDLE)).sort()).toEqual(['findings.md', 'log.md', 'progress.md', 'prompt.md'])
    const prompt = bundled(`${TEMPLATES}prompt.md`)
    const progress = bundled(`${TEMPLATES}progress.md`)
    const intent = parseIntent({ slug: 'new', prompt, findings: bundled(`${TEMPLATES}findings.md`), progress, files: [], hasDebrief: false, updatedAt: 1, source: 'local', firstAuthor: '' })
    expect(intent.status).toBe('active')
    expect(prompt).toMatch(/^- Rev: 1$/m)
    expect(progress).toMatch(/^- Working under rev: 1$/m)
    expect(intent.acceptanceTotal).toBe(1)
    expect(intent.acceptanceDone).toBe(0)
    expect(intent.findings).toEqual([])
    expect(intent.prs).toEqual([])
    expect(intent.hasWorker).toBe(true)
  })
  test('the example profile is a web profile with its own areas and one gate', () => {
    const profile = JSON.parse(bundled('files/.ather/profile.example.json'))
    const pack = makeWebPack(profile, null)
    expect(pack.areas).toEqual(profile.areas)
    expect(profile.areas.length > 0).toBe(true)
    expect(pack.gates).toHaveLength(1)
    expect(pack.mergePolicy).toBe('hold')
  })
  test('a repository made of the bundled files reads as set up', async () => {
    const setup = await reading({
      '.agents/skills/intent/SKILL.md': bundled('files/.agents/skills/intent/SKILL.md'),
      'docs/intent/README.md': bundled('files/docs/intent/README.md'),
      '.ather/profile.json': bundled('files/.ather/profile.example.json'),
      '.gitignore': '.ather/local/\n',
      'AGENTS.md': bundled('files/AGENTS.intent.md'),
    })
    expect(setup.missing).toEqual([])
  })
  test('every piece has its source in the bundle, and SETUP.md names every target path', () => {
    const steps = bundled('SETUP.md')
    for (const piece of SETUP_PIECES) {
      expect(fs.existsSync(new URL(piece.source, BUNDLE))).toBe(true)
      expect(steps).toContain(piece.path)
    }
    expect(steps).toContain('.ather/local/')
    for (const name of ['SKILL.md', 'agents/openai.yaml', 'assets/worker-brief.md']) expect(fs.existsSync(new URL(`files/.agents/skills/intent/${name}`, BUNDLE))).toBe(true)
  })
  test('the bundle has no Unreal words: it serves any kind of repository', () => {
    /** @param {URL} dir @returns {string[]} */
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : [fs.readFileSync(new URL(entry.name, dir), 'utf8')]))
    for (const text of walk(BUNDLE)) expect(text).not.toMatch(/\bPIE\b|Editor|\bS2\b/)
  })
})

describe('a repository set up while the session runs', () => {
  const PROFILE = '{"version":1,"pack":"web","gates":[{"id":"tests","command":"npm run zz-proof","proofs":["tests"]}],"areas":["app","api"]}'
  /** The checkout as state.mjs reads it: `files` by path under the root, a folder there when a file is under it. @param {string} root @param {Record<string, string>} files @param {string} user */
  const checkout = (root, files, user) =>
    /** @type {any} */ ({
      read: async (/** @type {string} */ path) => files[path.slice(root.length + 1)] ?? null,
      exists: async (/** @type {string} */ path) => Object.keys(files).some(name => name === path.slice(root.length + 1) || name.startsWith(`${path.slice(root.length + 1)}/`)),
      list: async () => Object.keys(files).filter(name => !name.includes('/')).map(name => ({ name, kind: 'file' })),
      sessionId: async () => 'setup-session',
      root: async () => root,
      gitUser: async () => user,
    })
  /** @param {Record<string, string>} files */
  const setUp = files => Object.assign(files, { 'docs/intent/README.md': '# Intents\n\n## Areas\n', '.ather/profile.json': PROFILE })
  /** @param {{ pack: import('../hooks/packs/index.mjs').Pack }} lane */
  const gates = lane => lane.pack.gates.map(gate => gate.command)

  test('with no git user name the checkout is read again each time: after the setup its pack is the profile\'s, and whoever asked is told once', async () => {
    /** @type {Record<string, string>} */
    const files = { 'package.json': '{}' }
    const io = checkout('/setup/nameless', files, '')
    /** @type {string[][]} */
    const told = []
    state.onSetUp('test', pack => void told.push([...pack.areas]))
    const before = await state.lane(io, '/setup/nameless')
    expect([before.isS2, gates(before)]).toEqual([false, []])
    setUp(files)
    const after = await state.lane(io, '/setup/nameless')
    expect([after.isS2, gates(after), [...after.pack.areas]]).toEqual([true, ['npm run zz-proof'], ['app', 'api']])
    await state.lane(io, '/setup/nameless')
    expect(told).toEqual([['app', 'api']])
  })
  test('a kept reading without intents is read again by laneAgain once the folder is there, and whoever asked is told the new pack once', async () => {
    /** @type {Record<string, string>} */
    const files = { 'package.json': '{}' }
    const io = checkout('/setup/named', files, 'Tin Nguyen')
    /** @type {string[][]} */
    const told = []
    state.onSetUp('test', pack => void told.push(pack.gates.map(gate => gate.command)))
    expect((await state.laneAgain(io, '/setup/named')).isS2).toBe(false)
    setUp(files)
    expect(gates(await state.lane(io, '/setup/named'))).toEqual([])
    expect(gates(await state.laneAgain(io, '/setup/named'))).toEqual(['npm run zz-proof'])
    await state.laneAgain(io, '/setup/named')
    expect(told).toEqual([['npm run zz-proof']])
  })
  test('the session\'s root also kept as a workspace checkout is set up once: the reading kept by its root no longer says it has no intents', async () => {
    /** @type {Record<string, string>} */
    const files = { 'package.json': '{}' }
    const io = checkout('/setup/shared', files, 'Tin Nguyen')
    /** @type {string[][]} */
    const told = []
    state.onSetUp('test', pack => void told.push(pack.gates.map(gate => gate.command)))
    expect([(await state.lane(io, '/setup/shared')).isS2, (await state.laneAt(io, '/setup/shared')).isS2]).toEqual([false, false])
    setUp(files)
    expect([(await state.laneAt(io, '/setup/shared')).isS2, told]).toEqual([false, []])
    const after = await state.laneAgain(io, '/setup/shared')
    expect([after.isS2, gates(after)]).toEqual([true, ['npm run zz-proof']])
    const byRoot = await state.laneAt(io, '/setup/shared')
    expect([byRoot.isS2, gates(byRoot)]).toEqual([true, ['npm run zz-proof']])
    await state.laneAgain(io, '/setup/shared')
    await state.lane(io, '/setup/shared')
    expect(told).toEqual([['npm run zz-proof']])
  })
  test('a repository that runs intents from the start is read once, and nobody is told', async () => {
    const io = checkout('/setup/runs', setUp({ 'package.json': '{}' }), 'Tin Nguyen')
    let told = 0
    state.onSetUp('test', () => void (told += 1))
    const first = await state.lane(io, '/setup/runs')
    expect([first.isS2, gates(first), await state.laneAgain(io, '/setup/runs') === first, told]).toEqual([true, ['npm run zz-proof'], true, 0])
  })
})
