// A142 (rev 46): the real half of the merge script's proof. The test runner has no file system, processes or git, so this
// runs with node on real temporary repositories (tests/rev46.test.ts checks A5R's side). Run from the repository root:
//   node --experimental-strip-types a5r/tests/merge-script-smoke.mjs
// Each case builds a small repo in a temp folder whose path holds a space and an `&`: a lane branch checked out and a
// `refs/remotes/origin/main` that moved on; a `*.up` filter (smudge: upper case) stands for LFS. A5R's script for it is
// written by mergescript.ts and started by the worker's own command through PowerShell. Cases: a clean merge; conflicts
// resolved by the holder's rules; A145 (rev 47): a path both sides deleted that merge-ort pairs with a new file of main (clean
// with rename detection off), the same in a criss-cross (two merge bases), a both-changed path merged into HEAD's blob,
// modify/delete resolved by theirs, by ours, and refused with no rule, a real rename on main not carried; an unresolved
// conflict (text, and a .uasset with no rule); dirty and untracked-in-the-way paths; a split index refused; a refused index rename retried then installed; the script killed between update-ref and
// the install (what it leaves, the wait command's ending line); a rename refused for good, rolled back. A failed case must leave
// HEAD, the branch, the index (byte for byte) and the working tree exactly as before.
// Exit 0: every case as expected (or not on Windows: skipped, said); else each failure is printed, exit 1.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LOCK_MARK, MERGE_BODY, MERGE_END, NO_RESULT, mergeOutcome, mergeScriptText, mergeStartCommand, mergeWaitCommand, syncMergeLog, syncMergeScript } from '../hooks/mergescript.ts'

if (process.platform !== 'win32') {
  console.log('skipped: the merge script runs only on Windows')
  process.exit(0)
}

const body = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', MERGE_BODY), 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a5r merge smoke '))
const failures = []
const times = []
let killed = '(not run)'
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
  // The lock marker the script writes is the one A5R reads (mergescript.ts LOCK_MARK: the mover and diedNote).
  expect('the script writes the marker LOCK_MARK reads', body.includes('$marker = "A5R sync merge $SyncId pid $PID"') && LOCK_MARK.exec('A5R sync merge sync-x pid 4242')?.[1] === '4242')
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
  // A145, the 2026-11-09 shape: both sides delete the same lab map, and main adds an unrelated file with the same bytes, so
  // merge-ort pairs the deletion with it ("CONFLICT (rename/delete)") whatever -X no-renames says (MEASURED, git 2.45.1).
  // Path by path it is no conflict: the map stays deleted, main's file is added, no rule needed.
  {
    const map = Buffer.from('LABMAP\u0000\u0001\u0002 the same bytes in a new name, one two three four five six\n', 'latin1')
    const dir = repo('both deleted', {
      base: d => {
        put(d, 'Content/Maps/L_Lab.umap', map)
        put(d, 'k.txt', 'k\n')
      },
      theirs: d => {
        fs.rmSync(path.join(d, 'Content/Maps/L_Lab.umap'))
        put(d, 'Content/Ene/Twinblades_Dead.uasset', map)
      },
      ours: d => {
        fs.rmSync(path.join(d, 'Content/Maps/L_Lab.umap'))
        put(d, 'k.txt', 'k from the lane\n')
      },
    })
    const ort = spawnSync('git', ['-C', dir, 'merge-tree', '--write-tree', '-X', 'no-renames', 'HEAD', 'origin/main'], { encoding: 'utf8' }).stdout ?? ''
    expect(`both deleted: merge-tree itself still pairs them (else this case proves nothing): ${ort}`, ort.includes('CONFLICT (rename/delete)'))
    const r = merge(dir, 's-bothdel')
    expect(`both deleted: merged with no rule: ${r.line}`, r.line.includes('A5R merge merged') && !r.line.includes('resolved:'))
    expect('both deleted: the map stays deleted, main\'s file is added', !fs.existsSync(path.join(dir, 'Content/Maps/L_Lab.umap')) && fs.readFileSync(path.join(dir, 'Content/Ene/Twinblades_Dead.uasset')).equals(map) && read(dir, 'k.txt') === 'k from the lane\n')
    expect(`both deleted: the log says merge-tree's pairing was set aside: ${r.log.slice(-600)}`, r.log.includes('renames off: Content/Ene/Twinblades_Dead.uasset is no conflict path by path'))
    expect(`both deleted: tree clean: ${git(dir, 'status', '--porcelain')}`, git(dir, 'status', '--porcelain') === '')
  }
  // A145, several merge bases (a criss-cross): read-tree takes them all, so the path merge-tree pairs as rename/delete is
  // decided by itself there too: clean with no rule.
  {
    const map = Buffer.from('LABMAP\u0000\u0001\u0002 criss-cross bytes, one two three four five six seven\n', 'latin1')
    const dir = repo('criss cross', {
      base: d => {
        put(d, 'Content/Maps/L_Lab.umap', map)
        put(d, 'k.txt', 'k\n')
      },
      theirs: d => put(d, 's.txt', 's\n'),
      ours: d => put(d, 'l.txt', 'l\n'),
    })
    const s1 = git(dir, 'rev-parse', 'origin/main')
    const l1 = git(dir, 'rev-parse', 'HEAD')
    git(dir, 'checkout', '-q', '-b', 'side', s1)
    git(dir, 'merge', '-q', '--no-edit', '--no-ff', l1)
    fs.rmSync(path.join(dir, 'Content/Maps/L_Lab.umap'))
    put(dir, 'Content/Ene/Twinblades_Dead.uasset', map)
    git(dir, 'update-ref', 'refs/remotes/origin/main', commitAll(dir, 'theirs again'))
    git(dir, 'checkout', '-q', 'lane')
    git(dir, 'merge', '-q', '--no-edit', '--no-ff', s1)
    fs.rmSync(path.join(dir, 'Content/Maps/L_Lab.umap'))
    commitAll(dir, 'ours again')
    git(dir, 'branch', '-q', '-D', 'side')
    expect('criss-cross: two merge bases', git(dir, 'merge-base', '--all', 'HEAD', 'origin/main').split('\n').length === 2)
    const r = merge(dir, 's-cc')
    expect(`criss-cross: merged with no rule: ${r.line}`, r.line.includes('A5R merge merged') && !r.line.includes('resolved:') && r.log.includes('2 merge base(s)') && r.log.includes('renames off: Content/Ene/Twinblades_Dead.uasset is no conflict path by path'))
    expect(`criss-cross: main's file added, the map gone, tree clean: ${git(dir, 'status', '--porcelain')}`, fs.readFileSync(path.join(dir, 'Content/Ene/Twinblades_Dead.uasset')).equals(map) && !fs.existsSync(path.join(dir, 'Content/Maps/L_Lab.umap')) && git(dir, 'status', '--porcelain') === '')
  }
  // Every merge base counts (mutation S1): each side's first merge deleted a path the other base still has, and the lane
  // adds both back. Against both bases main never touched them, so they are the lane's; against either base alone one of
  // them is a modify/delete.
  {
    const dir = repo('criss cross readd', {
      base: d => {
        put(d, 'Content/z.uasset', Buffer.from([0, 1]))
        put(d, 'Content/w.uasset', Buffer.from([0, 2]))
      },
      theirs: d => fs.rmSync(path.join(d, 'Content/z.uasset')),
      ours: d => fs.rmSync(path.join(d, 'Content/w.uasset')),
    })
    const s1 = git(dir, 'rev-parse', 'origin/main')
    const l1 = git(dir, 'rev-parse', 'HEAD')
    git(dir, 'checkout', '-q', '-b', 'side', s1)
    git(dir, 'merge', '-q', '--no-edit', '--no-ff', l1)
    put(dir, 's.txt', 's\n')
    git(dir, 'update-ref', 'refs/remotes/origin/main', commitAll(dir, 'theirs again'))
    git(dir, 'checkout', '-q', 'lane')
    git(dir, 'merge', '-q', '--no-edit', '--no-ff', s1)
    put(dir, 'Content/z.uasset', Buffer.from([0, 7]))
    put(dir, 'Content/w.uasset', Buffer.from([0, 8]))
    commitAll(dir, 'ours again')
    git(dir, 'branch', '-q', '-D', 'side')
    const r = merge(dir, 's-ccreadd')
    expect(`criss-cross re-added: merged with no rule: ${r.line}`, r.line.includes('A5R merge merged') && fs.readFileSync(path.join(dir, 'Content/z.uasset')).equals(Buffer.from([0, 7])) && fs.readFileSync(path.join(dir, 'Content/w.uasset')).equals(Buffer.from([0, 8])) && git(dir, 'status', '--porcelain') === '')
  }
  // Review: a path both sides changed that merge-tree merges into HEAD's own blob (main's change is already in it): taken
  // as HEAD's, no conflict.
  {
    const dir = repo('subset', {
      base: d => {
        put(d, 'Source/s.cpp', 'a\nb\nc\n')
        put(d, 'Source/m.cpp', 'one\ntwo\nthree\nfour\nfive\n')
      },
      theirs: d => {
        put(d, 'Source/s.cpp', 'a\nB\nc\n')
        put(d, 'Source/m.cpp', 'ONE\ntwo\nthree\nfour\nfive\n')
      },
      ours: d => {
        put(d, 'Source/s.cpp', 'a\nB\nc\nd\n')
        put(d, 'Source/m.cpp', 'one\ntwo\nthree\nfour\nFIVE\n')
      },
    })
    const r = merge(dir, 's-subset')
    expect(`subset: merged: ${r.line}`, r.line.includes('A5R merge merged') && read(dir, 'Source/s.cpp') === 'a\nB\nc\nd\n' && git(dir, 'status', '--porcelain') === '')
    expect('subset: a path both sides changed apart is merge-tree\'s content merge', read(dir, 'Source/m.cpp') === 'ONE\ntwo\nthree\nfour\nFIVE\n')
  }
  // A145: a delete kind resolved by a rule. Main deletes a .uasset the lane changed (modify/delete).
  const modDel = {
    base: d => put(d, 'Content/m.uasset', Buffer.from([0, 1, 2])),
    theirs: d => fs.rmSync(path.join(d, 'Content/m.uasset')),
    ours: d => put(d, 'Content/m.uasset', Buffer.from([0, 7, 7])),
  }
  {
    const dir = repo('moddel theirs', modDel)
    const r = merge(dir, 's-mdtheirs', [{ side: 'theirs', pattern: 'Content/**' }])
    expect(`modify/delete, theirs: merged: ${r.line}`, r.line.includes('A5R merge merged') && r.line.includes('Content/m.uasset (theirs, rule: theirs Content/**)'))
    expect(`modify/delete, theirs: main's deletion, tree clean: ${git(dir, 'status', '--porcelain')}`, !fs.existsSync(path.join(dir, 'Content/m.uasset')) && git(dir, 'ls-tree', 'HEAD', 'Content/m.uasset') === '' && git(dir, 'status', '--porcelain') === '')
  }
  {
    const dir = repo('moddel ours', modDel)
    const r = merge(dir, 's-mdours', [{ side: 'ours', pattern: 'Content/*.uasset' }])
    expect(`modify/delete, ours: merged: ${r.line}`, r.line.includes('A5R merge merged') && r.line.includes('Content/m.uasset (ours, rule: ours Content/*.uasset)'))
    expect(`modify/delete, ours: HEAD's file kept, tree clean: ${git(dir, 'status', '--porcelain')}`, fs.readFileSync(path.join(dir, 'Content/m.uasset')).equals(Buffer.from([0, 7, 7])) && git(dir, 'status', '--porcelain') === '')
  }
  {
    const dir = repo('moddel none', modDel)
    const before = snapshot(dir)
    const r = merge(dir, 's-mdnone', [{ side: 'theirs', pattern: 'Docs/**' }])
    expect(`modify/delete, no rule: refused: ${r.line}`, r.line.includes('A5R merge refused conflict: 1 conflicted path(s)') && r.line.includes('Content/m.uasset (no rule matches: modify/delete)') && r.line.includes('HEAD, index and working tree are as before'))
    expect('modify/delete, no rule: HEAD, index and tree exactly as before', snapshot(dir) === before)
  }
  // A145: a real rename on main is not carried either: main moves a file the lane edited, so the old path is modify/delete
  // (refused with no rule, where merge-ort alone would have moved the lane's edit into main's new name).
  {
    const lines = Array.from({ length: 40 }, (_, n) => `line ${n}`)
    const dir = repo('renamed', {
      base: d => put(d, 'Source/old.cpp', `${lines.join('\n')}\n`),
      theirs: d => {
        fs.rmSync(path.join(d, 'Source/old.cpp'))
        put(d, 'Source/new.cpp', `${lines.join('\n')}\n`)
      },
      ours: d => put(d, 'Source/old.cpp', `${lines.map(l => (l === 'line 20' ? 'line 20, the lane' : l)).join('\n')}\n`),
    })
    const before = snapshot(dir)
    const r = merge(dir, 's-renamed')
    expect(`renamed: refused, the old path a modify/delete: ${r.line}`, r.line.includes('A5R merge refused conflict: 1 conflicted path(s)') && r.line.includes('Source/old.cpp (no rule matches: modify/delete)'))
    expect('renamed: HEAD, index and tree exactly as before', snapshot(dir) === before)
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
    expect(`conflict: refused with both paths: ${r.line}`, r.line.includes('A5R merge refused conflict: 2 conflicted path(s)') && r.line.includes('u.txt (no rule matches: contents)') && r.line.includes('Content/y.uasset (no rule matches: binary, contents)'))
    expect('conflict: HEAD, index and tree exactly as before', snapshot(dir) === before)
    const refusal = mergeOutcome(r.log, false) // what the holder's A5R copies into orchestrate.log as rule=sync-merge
    expect(`conflict: the refusal read back with the git processes: ${JSON.stringify(refusal)}`, refusal.kind === 'refused' && refusal.note.startsWith('A5R merge refused conflict:') && Array.isArray(refusal.procs) && r.log.includes('rule=sync-merge git processes: '))
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
  // Fable 4: the script killed between update-ref and the index install (its rename refused, then the process killed). What
  // it leaves, and what the worker's wait command and A5R read from it.
  {
    const dir = repo('killed', clean)
    const old = git(dir, 'rev-parse', 'HEAD')
    const indexBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, '.git', 'index'))).digest('hex')
    const held = holdIndex(dir, 60)
    await held.ready
    const script = syncMergeScript(dir, 's-killed')
    const log = syncMergeLog(dir, 's-killed')
    fs.writeFileSync(script, mergeScriptText(body, { checkout: dir, syncId: 's-killed', rules: [], renameWaitSec: 120 }))
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore' })
    for (let n = 0; n < 300 && !(fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('index rename refused')); n += 1) await sleep(100)
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    await new Promise(r => child.on('exit', r))
    const text = fs.readFileSync(log, 'utf8')
    const said = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(mergeWaitCommand(script, log), 'utf16le').toString('base64')], { encoding: 'utf8', stdio: 'pipe' })
    const lock = path.join(dir, '.git', 'index.lock')
    const head = git(dir, 'rev-parse', 'HEAD')
    expect(`killed: no result line in its log: ${text.slice(-300)}`, !MERGE_END.test(text) && mergeOutcome(text, false).kind === 'died')
    expect(`killed: the wait command ends the worker with one line: ${said.slice(-200)}`, said.trim().endsWith(NO_RESULT))
    expect('killed: the branch moved to the merge (HEAD^1 the old HEAD)', head !== old && git(dir, 'rev-parse', 'HEAD^1') === old)
    expect('killed: the real index is the old one, byte for byte', crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, '.git', 'index'))).digest('hex') === indexBefore)
    expect('killed: its index.lock is left, holding its copy of the new index', fs.existsSync(lock) && !LOCK_MARK.test(fs.readFileSync(lock, 'latin1').slice(0, 64)))
    killed = `HEAD ${head.slice(0, 12)} (the merge; HEAD^1 ${old.slice(0, 12)}), .git/index the old one, .git/index.lock left (${fs.statSync(lock).size} bytes, the new index copy), the merged files written in the tree, .git/a5r-merge-s-killed left; the wait command printed "${NO_RESULT}"`
    await held.done
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
console.log(`merge script smoke: ${failures.length ? `${failures.length} failed checks` : 'clean, rules, both deleted (renames off), criss-cross clean, a both-changed path merged into the lane blob, modify/delete by theirs, by ours and refused, a real rename not carried, conflict, dirty, split index, stat-only, rename retry, killed mid-install and rollback all as expected'} (paths with a space and &; ${times.join(', ')})`)
console.log(`killed between update-ref and the index install leaves: ${killed}`)
for (const f of failures) console.log(`FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
