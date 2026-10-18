// Times the overlap check (ather-automata/hooks/overlap.mjs) on a synthetic repository of S2's shape, since an S2
// checkout is not at hand everywhere: many files, binary assets, a long main, and many open branches. It prints one
// JSON line: the sizes, the fetch, the first check (in budgeted runs, as the board makes them) and a check with
// nothing moved. `node dev/bench/overlap.mjs [--files 30000] [--branches 40] [--commits 300] [--budget 15000]`.
import fs from 'fs'
import path from 'path'
import { execFileSync, spawnSync } from 'child_process'
import { EMPTY_OVERLAPS, fetchBranches, readOverlaps } from '../../ather-automata/hooks/overlap.mjs'
import { sandbox } from '../e2e/harness.mjs'

// `--name <number>`, else the fallback.
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? Number(process.argv[at + 1]) || fallback : fallback
}
const FILES = arg('files', 30000)
const BRANCHES = arg('branches', 40)
const COMMITS = arg('commits', 300)
const BUDGET = arg('budget', 15000)

const work = sandbox('ather-bench-')
const env = { ...process.env, GIT_AUTHOR_NAME: 'Bench', GIT_AUTHOR_EMAIL: 'b@x', GIT_COMMITTER_NAME: 'Bench', GIT_COMMITTER_EMAIL: 'b@x' }
const git = (cwd, ...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
// The same files every run: a seeded generator.
let seed = 7
const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647)
const pick = list => list[Math.floor(random() * list.length)]

const origin = path.join(work, 'origin.git')
const tree = path.join(work, 'tree')
git(work, 'init', '-q', '--bare', origin)
git(work, 'init', '-q', tree)
const paths = Array.from({ length: FILES }, (_, at) => (at % 50 === 0 ? `Content/Maps/Area${at}.umap` : `Source/Module${at % 300}/File${at}.cpp`))
const lines = at => Array.from({ length: 40 }, (_, line) => `// ${at} line ${line}`).join('\n')
for (const [at, file] of paths.entries()) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true })
  fs.writeFileSync(path.join(tree, file), file.endsWith('.umap') ? Buffer.alloc(64 * 1024, at % 251) : `${lines(at)}\n`)
}
git(tree, 'add', '-A')
git(tree, 'commit', '-q', '-m', 'start')
// Edits a few files at one line each: text files at a line chosen by `line`, binaries whole.
const edit = (count, line, tag) => {
  for (let one = 0; one < count; one += 1) {
    const file = pick(paths)
    const full = path.join(tree, file)
    if (file.endsWith('.umap')) fs.writeFileSync(full, Buffer.alloc(64 * 1024, Math.floor(random() * 250)))
    else {
      const text = fs.readFileSync(full, 'utf8').split('\n')
      text[line] = `// ${tag}`
      fs.writeFileSync(full, text.join('\n'))
    }
  }
}
// How long a step takes, synchronous or not.
const clock = async run => {
  const start = Date.now()
  const value = await run()
  return { value, ms: Date.now() - start }
}
const built = await clock(() => {
  for (let one = 0; one < BRANCHES; one += 1) {
    git(tree, 'checkout', '-q', '-B', `intent/b${one}`, 'main')
    for (let commit = 0; commit < 3; commit += 1) {
      edit(8, 5 + commit, `b${one}-${commit}`)
      git(tree, 'commit', '-q', '-am', `b${one} ${commit}`)
    }
  }
  git(tree, 'checkout', '-q', 'main')
  for (let commit = 0; commit < COMMITS; commit += 1) {
    edit(4, 5 + (commit % 3), `main-${commit}`)
    git(tree, 'commit', '-q', '-am', `main ${commit}`)
  }
  git(tree, 'push', '-q', origin, '--all')
})
const clone = path.join(work, 'clone')
git(work, 'clone', '-q', '--single-branch', '-b', 'main', origin, clone)

let calls = 0
const repo = {
  git: async (args, { timeoutMs = 600000 } = {}) => {
    calls += 1
    const ran = spawnSync('git', args, { cwd: clone, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 28 })
    return { exitCode: ran.status ?? -1, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' }
  },
  read: async () => null,
  list: async () => [],
  mtime: async () => 0,
}
const sides = Array.from({ length: BRANCHES }, (_, one) => ({ key: `intent-${one}`, branch: `intent/b${one}` }))
const fetched = await clock(() => fetchBranches(repo, sides.map(side => side.branch)))
const runs = []
let read = { cache: EMPTY_OVERLAPS, isPartial: true, overlaps: [] }
const first = await clock(async () => {
  while (read.isPartial && runs.length < 100) {
    const one = await clock(() => readOverlaps(repo, { base: 'main', sides, cache: read.cache, budgetMs: BUDGET }))
    read = one.value
    runs.push(one.ms)
  }
})
const callsBefore = calls
const again = await clock(() => readOverlaps(repo, { base: 'main', sides, cache: read.cache, budgetMs: BUDGET }))
const size = git(clone, 'count-objects', '-vH').split('\n').find(line => line.startsWith('size-pack')) ?? ''
console.log(JSON.stringify({
  git: git(work, 'version'),
  files: FILES,
  branches: BRANCHES,
  mainCommits: COMMITS,
  pack: size.replace('size-pack: ', ''),
  buildMs: built.ms,
  fetchMs: fetched.ms,
  firstCheckMs: first.ms,
  runs: runs.length,
  slowestRunMs: Math.max(...runs),
  overlaps: read.overlaps.length,
  againMs: again.ms,
  againGitCalls: calls - callsBefore,
}))
fs.rmSync(work, { recursive: true, force: true })
