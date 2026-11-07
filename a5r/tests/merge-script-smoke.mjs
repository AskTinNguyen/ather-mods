// A142 (rev 46): the real half of the merge script's proof. The test runner has no file system, processes or git, so this
// runs with node on real temporary repositories (tests/rev46.test.ts checks A5R's side). Run from the repository root:
//   node --experimental-strip-types a5r/tests/merge-script-smoke.mjs
// Each case builds a small repo in a temp folder whose path holds a space and an `&`: a lane branch checked out and a
// `refs/remotes/origin/main` that moved on; a `*.up` filter (smudge: upper case) stands for LFS. A5R's script for it is
// written by mergescript.ts and started by the worker's own command through PowerShell. Cases: a clean merge; conflicts
// resolved by the holder's rules; an unresolved conflict (text, and a .uasset with no rule); dirty and untracked-in-the-way
// paths; a split index refused; a refused index rename retried then installed; a rename refused for good, rolled back. A failed case must leave
// HEAD, the branch, the index (byte for byte) and the working tree exactly as before.
// Exit 0: every case as expected (or not on Windows: skipped, said); else each failure is printed, exit 1.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MERGE_BODY, MERGE_END, mergeRefusal, mergeScriptText, mergeStartCommand, syncMergeLog, syncMergeScript } from '../hooks/mergescript.ts'

if (process.platform !== 'win32') {
  console.log('skipped: the merge script runs only on Windows')
  process.exit(0)
}

const body = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', MERGE_BODY), 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a5r merge smoke '))
const failures = []
const times = []
const expect = (what, ok) => ok || failures.push(what)

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const put = (dir, rel, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), data)
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
/** An index entry's stat data (ctime, mtime, size) from `ls-files --debug`, without its in-memory flags (CE_HASHED and the like vary by run). */
const statOf = (dir, rel) => git(dir, 'ls-files', '--debug', rel).replace(/\s*flags: \S+/, '')
const commitAll = (dir, msg) => {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', msg)
  return git(dir, 'rev-parse', 'HEAD')
}

/** A repo: base, then `theirs` committed on a side branch and pointed to by refs/remotes/origin/main, then `ours` on the
 * checked-out lane branch. Each side is a function of the folder. */
const repo = (name, { base, theirs, ours }) => {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'lane')
  for (const [k, v] of [['user.name', 'smoke'], ['user.email', 'smoke@example.invalid'], ['core.autocrlf', 'false'], ['filter.up.smudge', 'tr a-z A-Z'], ['filter.up.clean', 'tr A-Z a-z'], ['filter.up.required', 'true']]) git(dir, 'config', k, v)
  put(dir, '.gitattributes', '*.up filter=up\n')
  put(dir, '.gitignore', 'Saved/\n')
  base(dir)
  commitAll(dir, 'base')
  git(dir, 'checkout', '-q', '-b', 'side')
  theirs(dir)
  git(dir, 'update-ref', 'refs/remotes/origin/main', commitAll(dir, 'theirs'))
  git(dir, 'checkout', '-q', 'lane')
  ours(dir)
  commitAll(dir, 'ours')
  git(dir, 'branch', '-q', '-D', 'side')
  fs.mkdirSync(path.join(dir, 'Saved', 'A5R'), { recursive: true })
  return dir
}

/** HEAD, the branch, the index's bytes, every file outside .git and Saved (with its content), every folder, and what the
 * script must never leave behind (index.lock, MERGE_HEAD, its temporary folder). */
const snapshot = dir => {
  const files = {}
  const dirs = []
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (r === '.git' || r === 'Saved') continue
      if (e.isDirectory()) {
        dirs.push(r)
        walk(r)
      } else files[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, r))).digest('hex')
    }
  }
  walk('')
  const gitDir = path.join(dir, '.git')
  return JSON.stringify({
    head: git(dir, 'rev-parse', 'HEAD'),
    branch: git(dir, 'symbolic-ref', 'HEAD'),
    index: crypto.createHash('sha256').update(fs.readFileSync(path.join(gitDir, 'index'))).digest('hex'),
    files,
    dirs: dirs.sort(),
    left: fs.readdirSync(gitDir).filter(n => n === 'index.lock' || n === 'MERGE_HEAD' || n.startsWith('a5r-merge-')),
  })
}

/** Writes A5R's script for the repo and runs the worker's start command through PowerShell, as given; returns the
 * result line, the exit code the log reports through the line's kind, the whole log, and the time it took. */
const merge = (dir, id, rules = [], extra = {}) => {
  const script = syncMergeScript(dir, id)
  fs.writeFileSync(script, mergeScriptText(body, { checkout: dir, syncId: id, rules, ...extra }))
  const t0 = Date.now()
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(mergeStartCommand(script, syncMergeLog(dir, id)), 'utf16le').toString('base64')], { encoding: 'utf8', stdio: 'pipe', timeout: 600_000 })
  const ms = Date.now() - t0
  const log = fs.readFileSync(syncMergeLog(dir, id), 'utf8')
  const line = MERGE_END.exec(log)?.[0] ?? `(no result line; start command printed: ${out.slice(-400)})`
  times.push(`${id} ${ms} ms`)
  return { line, log, out, ms }
}

/** Another process holding .git/index open for reading (no delete sharing, as git's own readers do) for `sec` seconds;
 * resolves `ready` once the file is open (PowerShell can take seconds to start on a loaded machine) and `done` at exit. */
const holdIndex = (dir, sec) => {
  const flag = path.join(dir, 'Saved', 'held.flag')
  const ps = `$f = [IO.File]::Open('${path.join(dir, '.git', 'index').replace(/'/g, "''")}', 'Open', 'Read', 'Read'); Set-Content -LiteralPath '${flag.replace(/'/g, "''")}' x; Start-Sleep -Seconds ${sec}; $f.Close()`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' })
  const done = new Promise(r => child.on('exit', r))
  const ready = (async () => {
    for (let n = 0; n < 300 && !fs.existsSync(flag); n += 1) await sleep(100)
  })()
  return { ready, done }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const clean = {
  base: d => {
    put(d, 'a.txt', 'a\n')
    put(d, 'b.txt', 'b\n')
    put(d, 'd.txt', 'd\n')
    put(d, 'e.txt', 'e\n')
  },
  theirs: d => {
    put(d, 'b.txt', 'b from main\n')
    put(d, 'c.txt', 'c added by main\n')
    put(d, 'deep/new/x.up', 'hello lfs\n')
    fs.rmSync(path.join(d, 'd.txt'))
  },
  ours: d => put(d, 'a.txt', 'a from the lane\n'),
}

try {
  // A clean merge: only the paths the merge changes are written (smudged), the lane's dirt and untracked files stay, the
  // index keeps the stat data of unchanged files.
  {
    const dir = repo('clean o&k', clean)
    put(dir, 'e.txt', 'e, a lane\'s uncommitted edit\n')
    put(dir, 'notes.tmp', 'untracked\n')
    const old = git(dir, 'rev-parse', 'HEAD')
    const main = git(dir, 'rev-parse', 'origin/main')
    await sleep(1_100) // past the index's own second: no entry is racily clean, so its stat data is final
    const statusBefore = git(dir, 'status', '--porcelain')
    const statBefore = statOf(dir, 'a.txt')
    const r = merge(dir, 's-clean')
    const head = git(dir, 'rev-parse', 'HEAD')
    expect(`clean: merged line: ${r.line}`, r.line.includes(`A5R merge merged ${head}`))
    expect('clean: two parents, old then main', git(dir, 'rev-parse', 'HEAD^1') === old && git(dir, 'rev-parse', 'HEAD^2') === main)
    expect(`clean: the lane's dirt and untracked file stay, nothing else dirty: ${git(dir, 'status', '--porcelain')}`, git(dir, 'status', '--porcelain') === statusBefore)
    expect('clean: main\'s files written, its deletion done, LFS stand-in smudged', read(dir, 'b.txt') === 'b from main\n' && read(dir, 'c.txt') === 'c added by main\n' && !fs.existsSync(path.join(dir, 'd.txt')) && read(dir, 'deep/new/x.up') === 'HELLO LFS\n')
    expect('clean: the lane\'s edit is kept', read(dir, 'e.txt') === 'e, a lane\'s uncommitted edit\n')
    expect(`clean: an unchanged file keeps its stat data in the index: ${statOf(dir, 'a.txt')}`, statOf(dir, 'a.txt') === statBefore)
    expect('clean: nothing left behind', JSON.parse(snapshot(dir)).left.length === 0)
  }
  // Conflicts resolved by the holder's rules, a .uasset included.
  {
    const dir = repo('rules', {
      base: d => {
        put(d, 'Content/S2/x.uasset', Buffer.from([0, 1, 2, 3]))
        put(d, 't.txt', 'one\n')
      },
      theirs: d => {
        put(d, 'Content/S2/x.uasset', Buffer.from([0, 9, 9, 9]))
        put(d, 't.txt', 'main\n')
      },
      ours: d => {
        put(d, 'Content/S2/x.uasset', Buffer.from([0, 7, 7, 7]))
        put(d, 't.txt', 'lane\n')
      },
    })
    const r = merge(dir, 's-rules', [{ side: 'theirs', pattern: 'Content/**' }, { side: 'ours', pattern: 't.txt' }])
    expect(`rules: merged: ${r.line}`, r.line.includes('A5R merge merged') && r.line.includes('Content/S2/x.uasset (theirs, rule: theirs Content/**)'))
    expect('rules: the .uasset is main\'s, the text file ours', fs.readFileSync(path.join(dir, 'Content/S2/x.uasset')).equals(Buffer.from([0, 9, 9, 9])) && read(dir, 't.txt') === 'lane\n')
    expect(`rules: tree clean: ${git(dir, 'status', '--porcelain')}`, git(dir, 'status', '--porcelain') === '')
  }
  // An unresolved conflict: a text file and a .uasset no rule names; nothing written.
  {
    const dir = repo('conflict', {
      base: d => {
        put(d, 'u.txt', 'one\n')
        put(d, 'Content/y.uasset', Buffer.from([0, 1]))
        put(d, 'b.txt', 'b\n')
      },
      theirs: d => {
        put(d, 'u.txt', 'main\n')
        put(d, 'Content/y.uasset', Buffer.from([0, 2]))
        put(d, 'b.txt', 'b main\n')
      },
      ours: d => {
        put(d, 'u.txt', 'lane\n')
        put(d, 'Content/y.uasset', Buffer.from([0, 3]))
      },
    })
    const before = snapshot(dir)
    const r = merge(dir, 's-conflict', [{ side: 'ours', pattern: 'Docs/**' }])
    expect(`conflict: refused with both paths: ${r.line}`, r.line.includes('A5R merge refused conflict: 2 conflicted path(s)') && r.line.includes('u.txt (no rule matches)') && r.line.includes('Content/y.uasset (no rule matches)'))
    expect('conflict: HEAD, index and tree exactly as before', snapshot(dir) === before)
    const refusal = mergeRefusal(r.log) // what the holder's A5R copies into orchestrate.log as rule=sync-merge
    expect(`conflict: the refusal read back with the git processes: ${JSON.stringify(refusal)}`, refusal?.note.startsWith('A5R merge refused conflict:') === true && Array.isArray(refusal.procs) && r.log.includes('rule=sync-merge git processes: '))
  }
  // Dirty and untracked-in-the-way paths the merge changes: listed, nothing written.
  {
    const dir = repo('dirty', clean)
    put(dir, 'b.txt', 'b, a lane\'s uncommitted edit\n')
    put(dir, 'c.txt', 'an untracked file where main adds one\n')
    const before = snapshot(dir)
    const r = merge(dir, 's-dirty')
    expect(`dirty: refused with both paths: ${r.line}`, r.line.includes('A5R merge refused dirty: 2 path(s)') && r.line.includes('b.txt (changed in the shared checkout)') && r.line.includes('c.txt (untracked, in the way'))
    expect('dirty: HEAD, index and tree exactly as before', snapshot(dir) === before)
    expect('dirty: the git processes were logged', r.log.includes('rule=sync-merge git processes: '))
  }
  // A split index: refused up front, nothing written (the script copies .git/index alone).
  {
    const dir = repo('split', clean)
    git(dir, 'config', 'core.splitIndex', 'true')
    git(dir, 'update-index', '--split-index')
    const before = snapshot(dir)
    const r = merge(dir, 's-split')
    expect(`split index: refused: ${r.line}`, r.line.includes('A5R merge refused split-index: the checkout uses a split index') && r.line.includes('HEAD, index and working tree are as before'))
    expect('split index: HEAD, index and tree exactly as before', snapshot(dir) === before)
  }
  // A stat-only change is no dirt.
  {
    const dir = repo('statonly', clean)
    const b = path.join(dir, 'b.txt')
    fs.utimesSync(b, new Date(Date.now() + 5_000), new Date(Date.now() + 5_000))
    const r = merge(dir, 's-stat')
    expect(`stat-only: merged: ${r.line}`, r.line.includes('A5R merge merged'))
  }
  // A refused index rename, retried, then installed.
  {
    const dir = repo('retry', clean)
    const held = holdIndex(dir, 12)
    await held.ready
    const r = merge(dir, 's-retry', [], { renameWaitSec: 60 })
    await held.done
    expect(`retry: merged after refused renames: ${r.line}`, r.line.includes('A5R merge merged') && r.log.includes('index rename refused (try 1'))
    expect(`retry: index matches HEAD, tree clean: ${git(dir, 'status', '--porcelain')}`, git(dir, 'status', '--porcelain') === '' && git(dir, 'diff', '--cached', '--name-only', 'HEAD') === '')
  }
  // A rename refused for good: the branch and the tree go back, the index was never replaced.
  {
    const dir = repo('rollback', clean)
    put(dir, 'e.txt', 'e, a lane\'s uncommitted edit\n')
    const held = holdIndex(dir, 40)
    await held.ready
    const before = snapshot(dir)
    const r = merge(dir, 's-rollback', [], { renameWaitSec: 5 })
    expect(`rollback: refused index, rolled back: ${r.line}`, r.line.includes('A5R merge refused index: the rename of .git/index.lock over .git/index was refused for 5 s') && r.line.includes('HEAD, index and working tree are as before'))
    expect(`rollback: HEAD, branch, index and tree exactly as before`, snapshot(dir) === before)
    expect('rollback: the branch\'s reflog shows the move and its undo', git(dir, 'reflog', '-2', '--format=%gs', 'lane').includes('rolled back'))
    await held.done
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`merge script smoke: ${failures.length ? `${failures.length} failed checks` : 'clean, rules, conflict, dirty, split index, stat-only, rename retry and rollback all as expected'} (paths with a space and &; ${times.join(', ')})`)
for (const f of failures) console.log(`FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
