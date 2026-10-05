// Tests for secret redaction, PR crediting and the publish flow (against a local bare repo).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { redact } from '../lib/secrets.mjs'
import { loadConfig } from '../lib/config.mjs'
import { readSessions } from '../lib/logs.mjs'
import { createGit } from '../lib/git.mjs'
import { analyze } from '../lib/analyze.mjs'
import { buildReport, writeSnapshot, snapshotCommits } from '../lib/report.mjs'
import { weekRange } from '../lib/util.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIN = 60000
const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime()
const NOW = new Date(2026, 9, 4, 23, 0, 0).toISOString()
const sh = (cwd, args, env = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()

test('secrets are redacted in every string, ordinary text is not', () => {
  const { value, counts } = redact({
    a: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 here',
    b: ['token=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'],
    c: { d: 'password: hunter2secret', e: 'fix the montage data model' },
  })
  assert.match(value.a, /\[REDACTED:anthropic-key\]/)
  assert.doesNotMatch(value.a, /sk-ant/)
  assert.doesNotMatch(value.b[0], /ghp_/)
  assert.equal(value.c.d, 'password: [REDACTED:password]')
  assert.equal(value.c.e, 'fix the montage data model')
  assert.ok(counts['anthropic-key'] === 1 && counts.password === 1)
})

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-pub-'))
  const repo = path.join(home, 'repo')
  fs.mkdirSync(repo)
  sh(repo, ['init', '-q', '-b', 'main'])
  sh(repo, ['config', 'user.email', 'me@example.com'])
  sh(repo, ['config', 'user.name', 'Me'])
  const date = `@${Math.floor((T0 + 5 * MIN + 1000) / 1000)} +0000`
  sh(repo, ['commit', '-q', '--allow-empty', '-m', 'feature work'], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date })
  const hash = sh(repo, ['rev-parse', 'HEAD'])
  const proj = path.join(home, '.claude', 'projects', 'p')
  fs.mkdirSync(proj, { recursive: true })
  const L = (o) => JSON.stringify({ sessionId: 'sess-1', cwd: repo, ...o })
  fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), [
    L({ type: 'user', timestamp: new Date(T0).toISOString(), origin: { kind: 'human' }, message: { role: 'user', content: 'build the feature, key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' } }),
    L({ type: 'assistant', timestamp: new Date(T0 + 5 * MIN).toISOString(), message: { role: 'assistant', model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -qm "feature work"' } }] } }),
    L({ type: 'user', timestamp: new Date(T0 + 5 * MIN + 3000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '' }] } }),
    L({ type: 'assistant', timestamp: new Date(T0 + 6 * MIN).toISOString(), message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'done' }] } }),
  ].join('\n'))
  return { home, repo, hash }
}

test('a merged PR is credited when it carries a commit this machine made', () => {
  const { home, repo, hash } = fixture()
  const git = createGit()
  // The repo has no hosted remote, so pretend GitHub knows it as acme/game.
  const real = git.repoOf
  git.repoOf = d => { const r = real(d); if (r) r.github = 'acme/game'; return r }
  const gh = {
    mergedPrs: (slug) => slug === 'acme/game' ? [{ repo: slug, number: 7, title: 'Feature', url: 'u', state: 'closed', author: 'agent-bot', createdAt: new Date(T0).toISOString(), mergedAt: new Date(T0 + 60 * MIN).toISOString() }] : [],
    prCommits: (slug, n) => n === 7 ? ['0000000000000000000000000000000000000000', hash] : [],
    save() {}, stats: () => ({ enabled: true, calls: 0, errors: 0 }),
  }
  const cfg = loadConfig(['--home', home, '--now', NOW, '--ignore', '__none__', '--machine', 'PC-TEST'], {})
  const range = weekRange(cfg.now, 'monday', 0)
  const lookbackStart = range.start - 28 * 24 * 60 * MIN
  const a = analyze({ cfg, sessions: readSessions(cfg.projectsDir, lookbackStart), git, gh, range, lookbackStart, now: cfg.now })
  assert.equal(a.prsMerged.length, 1)
  assert.deepEqual(a.prsMerged[0].sessions, ['sess-1'])
  assert.equal(a.prsMerged[0].leadTimeHours, 1)
  assert.equal(a.metrics.prsMerged, 1)

  // the snapshot keeps the claimed commit for later weeks' PR checks
  const report = buildReport({ cfg, analysis: a, range, isoWeek: '2026-W40', survey: { rating: 4 }, cliVersions: ['x'], githubStats: gh.stats() })
  assert.equal(report.schema, 1)
  assert.equal(report.machine, 'PC-TEST')
  assert.equal(report.survey.rating, 4)
  writeSnapshot(cfg, '2026-W40', report)
  const later = snapshotCommits(cfg, '2026-W41')
  assert.deepEqual(later.map(c => c.hash), [hash])
})

test('publish writes the redacted report into the reports repo and pushes it', () => {
  const { home } = fixture()
  // a bare "GitHub" repo with one initial commit
  const bare = path.join(home, 'agent-reports.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const seed = path.join(home, 'seed')
  execFileSync('git', ['clone', '-q', bare, seed], { stdio: 'ignore' })
  sh(seed, ['-c', 'user.email=s@x', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', 'init'])
  sh(seed, ['push', '-q', 'origin', 'main'])

  const node = (script, args) => execFileSync(process.execPath, [path.join(here, '..', script), '--home', home, '--now', NOW, '--ignore', '__none__', '--no-github', '--machine', 'PC TEST', '--reports-repo-url', bare, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } })
  JSON.parse(node('build-calendar.mjs', ['--export']))
  const out = JSON.parse(node('publish-report.mjs', []))
  assert.equal(out.ok, true)
  assert.equal(out.pushed, true)
  assert.ok(out.redactions['anthropic-key'] >= 1)

  const check = path.join(home, 'check')
  execFileSync('git', ['clone', '-q', bare, check], { stdio: 'ignore' })
  const pushed = JSON.parse(fs.readFileSync(path.join(check, 'reports', '2026-W40', 'PC-TEST.json'), 'utf8'))
  assert.equal(pushed.machine, 'PC TEST')
  assert.equal(pushed.sessions.length, 1)
  assert.doesNotMatch(JSON.stringify(pushed), /sk-ant-api03/)

  // a second publish with nothing new changes nothing
  const again = JSON.parse(node('publish-report.mjs', []))
  assert.equal(again.changed, false)
})

test('merged PRs: yours by GitHub login, and a session that fed several PRs splits its hours between them', () => {
  const { home, repo, hash } = fixture()
  const git = createGit()
  const real = git.repoOf
  git.repoOf = d => { const r = real(d); if (r) r.github = 'acme/game'; return r }
  const pr = (number, author) => ({ repo: 'acme/game', number, title: `PR ${number}`, url: 'u', state: 'closed', author, createdAt: new Date(T0).toISOString(), mergedAt: new Date(T0 + 60 * MIN).toISOString() })
  const gh = {
    mergedPrs: slug => slug === 'acme/game' ? [pr(7, 'Me-Dev'), pr(8, 'mate')] : [],
    prCommits: () => [hash],
    save() {}, stats: () => ({ enabled: true, calls: 0, errors: 0 }),
  }
  const cfg = loadConfig(['--home', home, '--now', NOW, '--ignore', '__none__'], {})
  const range = weekRange(cfg.now, 'monday', 0)
  const lookbackStart = range.start - 28 * 24 * 60 * MIN
  const a = analyze({ cfg, sessions: readSessions(cfg.projectsDir, lookbackStart), git, gh, range, lookbackStart, now: cfg.now, githubLogin: 'me-dev' })
  const busy = a.sessions.find(s => s.sessionId === 'sess-1').busyHours
  assert.deepEqual(a.prsMerged.map(p => [p.number, p.yours]).sort(), [[7, true], [8, false]])
  assert.equal(a.metrics.prsAuthored, 1)
  for (const p of a.prsMerged) assert.ok(Math.abs(p.agentHours - busy / 2) <= 0.01, `PR ${p.number} gets half the session`)
  assert.equal(a.githubLogin, 'me-dev')
})

test('reports repo: owner/name is GitHub shorthand, and publish refuses a repo that is not a reports repo', () => {
  assert.equal(loadConfig(['--reports-repo-url', 'acme/agent-reports'], {}).reportsRepoUrl, 'https://github.com/acme/agent-reports.git')
  assert.equal(loadConfig(['--reports-repo-url', 'https://x.test/a/b.git'], {}).reportsRepoUrl, 'https://x.test/a/b.git')
  const { home } = fixture()
  let out = ''
  try {
    execFileSync(process.execPath, [path.join(here, '..', 'publish-report.mjs'), '--home', home, '--now', NOW, '--reports-repo-url', 'sipherxyz/s2'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) { out = String(err.stdout) }
  assert.match(out, /does not look like an agent-reports repo/)
  assert.ok(!fs.existsSync(path.join(home, '.calendar', 'agent-reports')), 'nothing was cloned')
})
