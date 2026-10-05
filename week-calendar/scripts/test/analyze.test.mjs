// Tests for log parsing, attribution and machine hours, against generated logs and a real
// temporary git repository. Run: node --test scripts/test
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadConfig } from '../lib/config.mjs'
import { readSessions, parseGitOps, isTypedPrompt } from '../lib/logs.mjs'
import { createGit, parseRemote } from '../lib/git.mjs'
import { analyze } from '../lib/analyze.mjs'
import { weekRange, isoWeekLabel, mergeIntervals, subtract, complement } from '../lib/util.mjs'

const MIN = 60 * 1000
const noGitHub = { mergedPrs: () => [], prCommits: () => [], save() {}, stats: () => ({ enabled: false, calls: 0, errors: 0 }) }

// ---------- fixture helpers ----------
function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'))
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'proj'), { recursive: true })
  return home
}
const sh = (cwd, args, env = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function makeRepo(home, name = 'repo') {
  const dir = path.join(home, name)
  fs.mkdirSync(dir)
  sh(dir, ['init', '-q', '-b', 'main'])
  sh(dir, ['config', 'user.email', 'me@example.com'])
  sh(dir, ['config', 'user.name', 'Me'])
  return dir
}
function commitAt(dir, ms, msg, email = 'me@example.com') {
  const date = `@${Math.floor(ms / 1000)} +0000`
  sh(dir, ['-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', msg], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date })
  return sh(dir, ['rev-parse', 'HEAD'])
}

// A session log writer: user/assistant records, git tool calls and their results.
function sessionLog(home, id, cwd) {
  const lines = []
  let n = 0
  const base = { sessionId: id, cwd, isSidechain: false }
  const api = {
    typed(t, text) { lines.push({ ...base, type: 'user', timestamp: new Date(t).toISOString(), origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: text } }); return api },
    scheduled(t, text = 'scheduled run') { lines.push({ ...base, type: 'user', timestamp: new Date(t).toISOString(), isMeta: true, turnOrigin: 'scheduled', promptSource: 'system', message: { role: 'user', content: text } }); return api },
    assistant(t, model = 'claude-test') { lines.push({ ...base, type: 'assistant', timestamp: new Date(t).toISOString(), message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }] } }); return api },
    bash(t, tEnd, command, output = '', isError = false) {
      const tid = `toolu_${id}_${n++}`
      lines.push({ ...base, type: 'assistant', timestamp: new Date(t).toISOString(), message: { role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id: tid, name: 'Bash', input: { command } }] } })
      lines.push({ ...base, type: 'user', timestamp: new Date(tEnd).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: output, is_error: isError }] } })
      return api
    },
    title(text) { lines.push({ type: 'ai-title', aiTitle: text, sessionId: id }); return api },
    write() { fs.writeFileSync(path.join(home, '.claude', 'projects', 'proj', `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n') },
  }
  return api
}

function run(home, nowIso, extra = []) {
  const cfg = loadConfig(['--home', home, '--no-github', '--now', nowIso, '--ignore', '__none__', ...extra], {})
  const range = weekRange(cfg.now, 'monday', 0)
  const sessions = readSessions(cfg.projectsDir, range.start - 28 * 24 * 60 * MIN)
  return analyze({ cfg, sessions, git: createGit(), gh: noGitHub, range, lookbackStart: range.start - 28 * 24 * 60 * MIN, now: cfg.now })
}

// Wednesday 2026-09-30 10:00 local, inside the week of Mon 2026-09-28.
const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime()
const NOW = new Date(2026, 9, 4, 23, 0, 0).toISOString()

// ---------- unit ----------
test('git operations are read from shell commands', () => {
  assert.deepEqual(parseGitOps('git -C E:/S2_ commit -F msg.txt 2>&1 | tail -3').ops, [{ op: 'commit', dir: path.normalize('E:/S2_') }])
  assert.deepEqual(parseGitOps('cd /tmp/x && git add . && git commit -m "a" && git push').ops.map(o => o.op), ['commit', 'push'])
  assert.equal(parseGitOps('git log --grep commit'), null)
  assert.equal(parseGitOps('echo "git commit"'), null)
})

test('remotes: hosted URLs parse, local paths do not', () => {
  assert.deepEqual(parseRemote('https://github.com/SipherXYZ/S2.git'), { host: 'github.com', slug: 'sipherxyz/s2', display: 'SipherXYZ/S2' })
  assert.equal(parseRemote('git@github.com:owner/repo.git').slug, 'owner/repo')
  assert.equal(parseRemote('C:\\repos\\remote.git'), null)
  assert.equal(parseRemote('/srv/git/remote.git'), null)
})

test('typed prompts exclude engine-generated text', () => {
  assert.equal(isTypedPrompt({ type: 'user', origin: { kind: 'human' }, message: { content: 'fix the build' } }), true)
  assert.equal(isTypedPrompt({ type: 'user', origin: { kind: 'human' }, message: { content: '<scheduled-task name="x">run</scheduled-task>' } }), false)
  assert.equal(isTypedPrompt({ type: 'user', isMeta: true, message: { content: 'x' } }), false)
})

test('interval helpers', () => {
  assert.deepEqual(mergeIntervals([[5, 8], [1, 3], [2, 4]]), [[1, 4], [5, 8]])
  assert.deepEqual(subtract([[0, 10]], [[2, 3], [5, 6]]), [[0, 2], [3, 5], [6, 10]])
  assert.deepEqual(complement([[2, 3]], 0, 5), [[0, 2], [3, 5]])
  assert.equal(isoWeekLabel(new Date(2026, 8, 28).getTime()), '2026-W40')
  assert.equal(isoWeekLabel(new Date(2027, 0, 1).getTime()), '2026-W53')
})

// ---------- attribution ----------
test('parallel sessions in one repo: each commit goes to the session whose git call made it', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  const cA = commitAt(repo, T0 + 10 * MIN + 1000, 'A work')
  const cB = commitAt(repo, T0 + 11 * MIN + 1000, 'B work')
  sessionLog(home, 'sess-a', repo).typed(T0, 'do A').assistant(T0 + MIN)
    .bash(T0 + 10 * MIN, T0 + 10 * MIN + 3000, `git -C ${repo} commit -qm "A work" | tail -1`).assistant(T0 + 12 * MIN).write()
  sessionLog(home, 'sess-b', repo).typed(T0 + 30000, 'do B').assistant(T0 + 2 * MIN)
    .bash(T0 + 11 * MIN, T0 + 11 * MIN + 3000, 'git commit -q -m "B work"').assistant(T0 + 12 * MIN).write()
  const r = run(home, NOW)
  const a = r.sessions.find(s => s.sessionId === 'sess-a'), b = r.sessions.find(s => s.sessionId === 'sess-b')
  assert.deepEqual(a.commits.map(c => c.hash), [cA])
  assert.deepEqual(b.commits.map(c => c.hash), [cB])
  assert.equal(a.commits[0].via, 'call')
})

test('a hash printed by git wins over timing', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  const c1 = commitAt(repo, T0 + 5 * MIN, 'one')
  sessionLog(home, 'sess-x', repo).typed(T0, 'go').assistant(T0 + MIN)
    .bash(T0 + 20 * MIN, T0 + 20 * MIN + 2000, 'git commit -m one', `[main ${c1.slice(0, 12)}] one\n 1 file changed`).assistant(T0 + 21 * MIN).write()
  const r = run(home, NOW)
  const s = r.sessions.find(x => x.sessionId === 'sess-x')
  assert.deepEqual(s.commits.map(c => [c.hash, c.via]), [[c1, 'output']])
})

test('commits made by a subagent count for its session', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  const c = commitAt(repo, T0 + 15 * MIN + 1000, 'sub work')
  sessionLog(home, 'sess-p', repo).typed(T0, 'delegate').assistant(T0 + MIN).write()
  const subDir = path.join(home, '.claude', 'projects', 'proj', 'sess-p', 'subagents')
  fs.mkdirSync(subDir, { recursive: true })
  const rec = (o) => JSON.stringify({ sessionId: 'sess-p', isSidechain: true, agentId: 'a1', cwd: repo, ...o })
  fs.writeFileSync(path.join(subDir, 'agent-a1.jsonl'), [
    rec({ type: 'user', timestamp: new Date(T0 + 2 * MIN).toISOString(), message: { role: 'user', content: 'task' } }),
    rec({ type: 'assistant', timestamp: new Date(T0 + 15 * MIN).toISOString(), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -qm "sub work"' } }] } }),
    rec({ type: 'user', timestamp: new Date(T0 + 15 * MIN + 3000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '' }] } }),
    rec({ type: 'assistant', timestamp: new Date(T0 + 16 * MIN).toISOString(), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'done' }] } }),
  ].join('\n'))
  const r = run(home, NOW)
  const s = r.sessions.find(x => x.sessionId === 'sess-p')
  assert.deepEqual(s.commits.map(x => x.hash), [c])
  assert.ok(s.busyHours >= 0.2, 'subagent work counts as busy time')
})

test('a worktree is the same project as its main checkout', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  commitAt(repo, T0 - 60 * MIN, 'base')
  const wt = path.join(home, 'wt')
  sh(repo, ['worktree', 'add', '-q', '-b', 'feature', wt])
  const g = createGit()
  assert.equal(g.repoOf(wt).key, g.repoOf(repo).key)
  assert.equal(g.repoOf(wt).name, 'repo')
})

// ---------- hours, productivity, outliers ----------
test('busy, waiting and blocks', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  sessionLog(home, 'sess-h', repo)
    .typed(T0, 'start').assistant(T0 + MIN)
    .bash(T0 + 2 * MIN, T0 + 5 * MIN, 'npm test').assistant(T0 + 6 * MIN)
    .typed(T0 + 60 * MIN, 'next').assistant(T0 + 61 * MIN)
    .write()
  const r = run(home, NOW)
  const s = r.sessions[0]
  assert.equal(s.busyHours, +(7 / 60).toFixed(2)) // 6 min + 1 min
  assert.equal(s.waitingHours, +(54 / 60).toFixed(2))
  assert.equal(r.blocks.length, 2, 'a 54-minute gap starts a new block')
  assert.equal(s.noCommit, true)
  assert.equal(s.productive, false)
})

test('a successful push makes a session productive; a rejected one does not', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  sessionLog(home, 'ok', repo).typed(T0, 'ship').assistant(T0 + MIN).bash(T0 + 2 * MIN, T0 + 3 * MIN, 'git push -u origin feat').assistant(T0 + 4 * MIN).write()
  sessionLog(home, 'bad', repo).typed(T0, 'ship').assistant(T0 + MIN).bash(T0 + 2 * MIN, T0 + 3 * MIN, 'git push', ' ! [rejected] main -> main (fetch first)').assistant(T0 + 4 * MIN).write()
  const r = run(home, NOW)
  assert.equal(r.sessions.find(s => s.sessionId === 'ok').productive, true)
  assert.equal(r.sessions.find(s => s.sessionId === 'bad').productive, false)
})

test('a commit on a remote-tracking branch makes its session productive', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  const bare = path.join(home, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', bare])
  sh(repo, ['remote', 'add', 'origin', bare])
  commitAt(repo, T0 + 3 * MIN + 1000, 'pushed later')
  sh(repo, ['push', '-q', 'origin', 'main'])
  sessionLog(home, 'sess-r', repo).typed(T0, 'go').assistant(T0 + MIN).bash(T0 + 3 * MIN, T0 + 3 * MIN + 3000, 'git commit -qm x').assistant(T0 + 4 * MIN).write()
  const r = run(home, NOW)
  const s = r.sessions[0]
  assert.equal(s.commits[0].pushed, true)
  assert.equal(s.productive, true)
  assert.ok(r.machineHours.productive > 0)
})

test('mostly automated long sessions are excluded; overrides win', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  const log = sessionLog(home, 'poller', repo).typed(T0, 'poll git every 20 min')
  for (let i = 0; i < 16; i++) log.scheduled(T0 + (i + 1) * 20 * MIN).assistant(T0 + (i + 1) * 20 * MIN + MIN)
  log.write()
  let r = run(home, NOW)
  const s = r.sessions[0]
  assert.equal(s.excluded, true)
  assert.match(s.excludeReason, /Mostly automated: 16 of 17 turns/)
  assert.equal(r.machineHours.busy, 0, 'excluded sessions do not count as busy')
  fs.mkdirSync(path.join(home, '.calendar'), { recursive: true })
  r = analyze({ ...ctx(home), overrides: { include: ['poller'] } })
  assert.equal(r.sessions[0].excluded, false)
})

test('ignored folders are left out', () => {
  const home = tmpHome()
  const tmpDir = path.join(home, 'AppData', 'Local', 'Temp', 'bench')
  fs.mkdirSync(tmpDir, { recursive: true })
  sessionLog(home, 'bench', tmpDir).typed(T0, 'benchmark').assistant(T0 + MIN).write()
  const r = run(home, NOW, ['--ignore', 'AppData/Local/Temp/bench'])
  assert.equal(r.sessions.length, 0)
})

function ctx(home) {
  const cfg = loadConfig(['--home', home, '--no-github', '--now', NOW, '--ignore', '__none__'], {})
  const range = weekRange(cfg.now, 'monday', 0)
  const lookbackStart = range.start - 28 * 24 * 60 * MIN
  return { cfg, sessions: readSessions(cfg.projectsDir, lookbackStart), git: createGit(), gh: noGitHub, range, lookbackStart, now: cfg.now }
}

test('a pull does not claim teammates\' commits dated inside it; its own identity\'s commits still count', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  const theirs = commitAt(repo, T0 + 10 * MIN + 30000, 'teammate work', 'mate@example.com')
  const mine = commitAt(repo, T0 + 10 * MIN + 60000, 'my merge', 'me@example.com')
  sessionLog(home, 'sess-pull', repo).typed(T0, 'sync').assistant(T0 + MIN)
    .bash(T0 + 10 * MIN, T0 + 12 * MIN, 'git pull --no-rebase').assistant(T0 + 13 * MIN).write()
  const r = run(home, NOW)
  assert.deepEqual(r.sessions[0].commits.map(c => c.hash), [mine])
  assert.ok(!r.sessions[0].commits.some(c => c.hash === theirs))
})

test('routine runs: short commitless sessions that recur, or that nobody typed in, are automated', () => {
  const home = tmpHome()
  const repo = makeRepo(home)
  for (let i = 0; i < 5; i++) {
    sessionLog(home, `butler-${i}`, repo).title(`PC1 💬🧹 Session Butler run (${i})`)
      .typed(T0 + i * 30 * MIN, 'rename sessions').assistant(T0 + i * 30 * MIN + MIN).write()
  }
  sessionLog(home, 'once', repo).title('PC1 Quick question').typed(T0 + 5 * MIN, 'what is x?').assistant(T0 + 6 * MIN).write()
  const silent = sessionLog(home, 'silent', repo).title('PC1 Nightly check').scheduled(T0 + 7 * MIN)
  silent.assistant(T0 + 8 * MIN).write()
  sessionLog(home, 'work', repo).title('PC1 Real work').typed(T0, 'build it').assistant(T0 + 20 * MIN).write()
  let r = run(home, NOW)
  const by = id => r.sessions.find(s => s.sessionId === id)
  for (let i = 0; i < 5; i++) {
    assert.equal(by(`butler-${i}`).automated, true)
    assert.match(by(`butler-${i}`).excludeReason, /recurred 5 times/)
  }
  assert.equal(by('silent').automated, true, 'nobody typed')
  assert.equal(by('once').automated, false, 'a one-off typed question is real work')
  assert.equal(by('work').excluded, false)
  assert.ok(r.machineHours.automated > 0)
  fs.mkdirSync(path.join(home, '.calendar'), { recursive: true })
  r = analyze({ ...ctx(home), overrides: { include: ['butler-0'] } })
  assert.equal(r.sessions.find(s => s.sessionId === 'butler-0').automated, false, 'include wins')
})
