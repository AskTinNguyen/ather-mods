// @ts-check
// The overlap check (docs/intent/overlap-check): reading an intent's branch, which pairs to merge, what
// `git merge-tree` says, and the whole read on real repositories made here with git.
import { describe, expect, test } from 'claude-code/testing'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { parseIntent } from '../hooks/model.mjs'
import { EMPTY_OVERLAPS, SPOTS_KEPT, canMergeTree, fetchBranches, gitVersion, pairKey, pairsToCheck, parseMergeTree, readOverlaps, spotsIn } from '../hooks/overlap.mjs'
import { fetchArgs } from '../hooks/team.mjs'

/** @param {string} prompt */
const intentOf = prompt => parseIntent({ slug: 'x', prompt, findings: '', progress: '', files: [], hasDebrief: false, updatedAt: 0, source: 'main', firstAuthor: '' })

describe('an intent’s branch (A1)', () => {
  test('the Branch line, its backticks dropped; none, or a template’s placeholder, is no branch', () => {
    expect(intentOf('# X\n\n- Branch: `intent/login`\n').branch).toBe('intent/login')
    expect(intentOf('# X\n\n- Branch: feature/a.b_c\n').branch).toBe('feature/a.b_c')
    expect([intentOf('# X\n\n- Status: active\n').branch, intentOf('# X\n\n- Branch: `intent/<feature>`\n').branch, intentOf('# X\n\n- Branch: the one Tin made\n').branch]).toEqual(['', '', ''])
  })

  test('this repository’s own intents, as written', () => {
    const read = (/** @type {string} */ slug) => intentOf(fs.readFileSync(new URL(`../../docs/intent/${slug}/prompt.md`, import.meta.url), 'utf8')).branch
    expect([read('track-guard'), read('overlap-check'), read('decide-in-place')]).toEqual(['intent/track-guard', 'intent/overlap-check', 'intent/decide-in-place'])
  })
})

describe('which pairs to merge (A2)', () => {
  const sides = [
    { key: 'dodge', branch: 'intent/dodge' },
    { key: 'vault', branch: 'intent/vault' },
    { key: 'dash', branch: 'intent/dash' },
    { key: 'idle', branch: 'intent/idle' },
    { key: 'twin', branch: 'intent/dodge' },
  ]
  const files = new Map([
    ['dodge', ['Combat/HitStop.cpp', 'Map.umap']],
    ['vault', ['Move/Vault.cpp', 'Move/Modes.cpp']],
    ['dash', ['Move/Modes.cpp']],
    ['idle', []],
    ['twin', ['Combat/HitStop.cpp']],
  ])
  test('each side with changes against the base; two sides only when they share a file; one branch is one piece of work', () => {
    expect(pairsToCheck(sides, files)).toEqual([
      { a: '', b: 'dodge' },
      { a: '', b: 'vault' },
      { a: '', b: 'dash' },
      { a: '', b: 'twin' },
      { a: 'dash', b: 'vault' },
    ])
  })
  test('a pair has one key whichever way round, the base first', () => {
    expect([pairKey('vault', 'dash'), pairKey('dash', 'vault'), pairKey('', 'dodge')]).toEqual(['dash|vault', 'dash|vault', '|dodge'])
  })
})

describe('what git says (A3, A4)', () => {
  // `git merge-tree --write-tree origin/main origin/intent/dodge`, as git 2.43 printed it.
  const OUT = [
    '04c6a6ee0e144f6ff1612a9622179eed8f5dd60f',
    '100644 d68dd4031d2ad5b7a3829ad7df6635e27a7daa22 1\tf.txt',
    '100644 898d447f93c0c0d35e839e6dd4352d06174156a4 2\tf.txt',
    '100644 9ea79ca50a4e5cd6d13519d0139054273676d378 3\tf.txt',
    '100644 587be6b4c3f93f93c489c0111bba5596147a26cb 1\tg.txt',
    '100644 975fbec8256d3e8a3797e7a3611380f27c49f4ac 2\tg.txt',
    '100644 88768efdf77ec78c9a995f94881793be6a41752b 1\th.bin',
    '100644 e73ddff3b53b01da79aaa663b0873ef58e52aa26 2\th.bin',
    '100644 6e47ce1be19aa29abf3e08ba84e483beeadd1c2b 3\th.bin',
    '',
    'Auto-merging f.txt',
    'CONFLICT (content): Merge conflict in f.txt',
    'CONFLICT (modify/delete): g.txt deleted in feat and modified in main.  Version main of g.txt left in tree.',
    'warning: Cannot merge binary files: h.bin (main vs. feat)',
    'Auto-merging h.bin',
    'CONFLICT (content): Merge conflict in h.bin',
    '',
  ].join('\n')
  test('the merged tree, each conflicted file’s stages, and the binary files git could not merge', () => {
    const parsed = parseMergeTree(OUT)
    expect(parsed.tree).toBe('04c6a6ee0e144f6ff1612a9622179eed8f5dd60f')
    expect([...parsed.stages].map(([file, stages]) => [file, [...stages]])).toEqual([['f.txt', [1, 2, 3]], ['g.txt', [1, 2]], ['h.bin', [1, 2, 3]]])
    expect([...parsed.binary]).toEqual(['h.bin'])
  })
  test('the places in a conflicted file: the line in the first side’s file, each side’s first changed line, a diff3 base skipped', () => {
    const text = ['a', '<<<<<<< origin/main', 'B-main', '||||||| base', 'B', '=======', 'B-feat', '>>>>>>> origin/feat', 'c', '<<<<<<< origin/main', '', '  two', '=======', '  deux', '>>>>>>> origin/feat', 'end'].join('\r\n')
    expect(spotsIn('f.txt', text)).toEqual([
      { path: 'f.txt', line: 2, kind: 'lines', ours: 'B-main', theirs: 'B-feat' },
      { path: 'f.txt', line: 4, kind: 'lines', ours: 'two', theirs: 'deux' },
    ])
    expect(spotsIn('f.txt', 'no markers\n')).toEqual([])
  })
  test('git’s version: merge-tree needs 2.38', () => {
    expect([gitVersion('git version 2.43.0'), gitVersion('git version 2.39.5.windows.1'), gitVersion('bash: git: not found')]).toEqual([[2, 43], [2, 39], null])
    expect([canMergeTree([2, 38]), canMergeTree([3, 0]), canMergeTree([2, 37]), canMergeTree(null)]).toEqual([true, true, false, false])
  })
  test('the fetch takes every branch named into its own remote-tracking ref, with the base’s flags', () => {
    expect(fetchArgs('main', 'intent/a').slice(-3)).toEqual(['origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/intent/a:refs/remotes/origin/intent/a'])
    expect(fetchArgs('main')).toContain('--no-tags')
  })
})

describe('a real repository (A3, A4, A6)', () => {
  // origin with main and three intent branches; main moved after dodge left it: the same line, and a binary map.
  const make = () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-overlap-'))
    /** @param {string} cwd @param {string[]} args @param {string} [who] */
    const git = (cwd, args, who = 'Tin Nguyen') => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(work, 'none'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: 'x@x' } })
    const origin = path.join(work, 'origin.git')
    const tree = path.join(work, 'tree')
    git(work, ['init', '-q', '--bare', origin])
    git(work, ['init', '-q', tree])
    /** @param {Record<string, string>} files @param {string} message @param {string} [who] */
    const commit = (files, message, who) => {
      for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true })
        fs.writeFileSync(path.join(tree, file), text)
      }
      git(tree, ['add', '-A'])
      git(tree, ['commit', '-q', '-m', message], who)
    }
    commit({ 'Combat/HitStop.cpp': 'a\nb\nreturn Budget;\nd\n', 'Move/Modes.cpp': 'case MOVE_Walk:\n', 'Map.umap': '\u0000\u0001map' }, 'start')
    git(tree, ['push', '-q', origin, 'HEAD:refs/heads/main'])
    for (const [branch, files] of /** @type {const} */ ([
      ['intent/dodge', { 'Combat/HitStop.cpp': 'a\nb\nreturn CanCancel(Dodge) ? 0.f : Budget;\nd\n', 'Map.umap': '\u0000\u0002dodge' }],
      ['intent/dash', { 'Move/Modes.cpp': 'case MOVE_Dash: return PhysDash(dt, Iter);\n' }],
      ['intent/vault', { 'Move/Modes.cpp': 'case MOVE_Dash: return PhysVault(dt, Iter);\n' }],
    ])) {
      git(tree, ['checkout', '-q', '-B', branch, 'main'])
      commit(files, branch)
      git(tree, ['push', '-q', origin, `HEAD:refs/heads/${branch}`])
    }
    git(tree, ['checkout', '-q', 'main'])
    commit({ 'Combat/HitStop.cpp': 'a\nb\nreturn FMath::Min(Budget, 0.070f);\nd\n', 'Map.umap': '\u0000\u0003main' }, 'Retune hit-stop', 'Lena Park')
    git(tree, ['push', '-q', origin, 'HEAD:refs/heads/main'])
    const clone = path.join(work, 'clone')
    git(work, ['clone', '-q', '--single-branch', '-b', 'main', origin, clone])
    let calls = 0
    const repo = {
      git: async (/** @type {readonly string[]} */ args) => {
        calls += 1
        const ran = spawnSync('git', args, { cwd: clone, encoding: 'utf8' })
        return { exitCode: ran.status ?? -1, stdout: ran.stdout, stderr: ran.stderr }
      },
      read: async () => null,
      list: async () => [],
      mtime: async () => 0,
    }
    const moveDash = () => {
      git(tree, ['checkout', '-q', 'intent/dash'])
      commit({ 'Move/Modes.cpp': 'case MOVE_Dash: return PhysDash(dt, Iter, Speed);\n' }, 'dash again')
      git(tree, ['push', '-q', origin, 'HEAD:refs/heads/intent/dash'])
    }
    return { work, repo, calls: () => calls, push: moveDash }
  }
  const SIDES = [
    { key: 'dodge-cancel', branch: 'intent/dodge' },
    { key: 'nine-tail-dash', branch: 'intent/dash' },
    { key: 'mc-vault', branch: 'intent/vault' },
    { key: 'not-pushed', branch: 'intent/ghost' },
  ]

  test('a clone that knows only main fetches the intents’ branches, then finds main against dodge and dash against vault', async () => {
    const { work, repo } = make()
    expect((await readOverlaps(repo, { base: 'main', sides: SIDES, cache: EMPTY_OVERLAPS })).overlaps).toEqual([])
    expect(await fetchBranches(repo, SIDES.map(side => side.branch))).toBe('')
    const { overlaps, note } = await readOverlaps(repo, { base: 'main', sides: SIDES, cache: EMPTY_OVERLAPS })
    fs.rmSync(work, { recursive: true, force: true })
    expect(note).toBe('')
    expect(overlaps.map(one => [one.key, one.files, one.count])).toEqual([
      ['|dodge-cancel', ['Combat/HitStop.cpp', 'Map.umap'], 2],
      ['mc-vault|nine-tail-dash', ['Move/Modes.cpp'], 1],
    ])
    expect(overlaps[0]?.spots).toEqual([
      { path: 'Combat/HitStop.cpp', line: 3, kind: 'lines', ours: 'return FMath::Min(Budget, 0.070f);', theirs: 'return CanCancel(Dodge) ? 0.f : Budget;' },
      { path: 'Map.umap', line: 0, kind: 'binary', ours: '', theirs: '' },
    ])
    expect(overlaps[0]?.who).toBe('Lena Park')
    expect(overlaps[1]?.spots[0]).toEqual({ path: 'Move/Modes.cpp', line: 1, kind: 'lines', ours: 'case MOVE_Dash: return PhysVault(dt, Iter);', theirs: 'case MOVE_Dash: return PhysDash(dt, Iter);' })
  })

  test('A6: nothing moved, nothing merged again; a branch that moved is merged again', async () => {
    const { work, repo, calls, push } = make()
    await fetchBranches(repo, SIDES.map(side => side.branch))
    const first = await readOverlaps(repo, { base: 'main', sides: SIDES, cache: EMPTY_OVERLAPS })
    const before = calls()
    const again = await readOverlaps(repo, { base: 'main', sides: SIDES, cache: first.cache })
    expect(calls() - before).toBe(1)
    expect(again.overlaps).toEqual(first.overlaps)
    // dash moves on: its files and its merges are read again, the rest kept.
    push()
    await fetchBranches(repo, SIDES.map(side => side.branch))
    const fetched = calls()
    await readOverlaps(repo, { base: 'main', sides: SIDES, cache: again.cache })
    fs.rmSync(work, { recursive: true, force: true })
    expect(calls() - fetched > 1).toBe(true)
  })

  test('A4: before git 2.38 nothing is checked and the note says why', async () => {
    const { work, repo, calls } = make()
    const read = await readOverlaps(repo, { base: 'main', sides: SIDES, cache: { ...EMPTY_OVERLAPS, version: 'git version 2.30.1' } })
    fs.rmSync(work, { recursive: true, force: true })
    expect([read.overlaps, read.note, calls()]).toEqual([[], 'git 2.30 cannot check overlaps (needs 2.38)', 0])
  })

  test('at most SPOTS_KEPT places are kept, and the count says how many there are', async () => {
    const lines = Array.from({ length: 10 }, (_, at) => `line ${at}`)
    const conflicted = lines.flatMap((one, at) => ['<<<<<<< a', `${one} main`, '=======', `${one} dodge`, '>>>>>>> b', `gap ${at}`]).join('\n')
    expect(spotsIn('f', conflicted).length).toBe(10)
    expect(SPOTS_KEPT).toBe(6)
  })
})
