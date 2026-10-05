// Settings: command-line flags over ~/.calendar/config.json (written by the plugin from its
// userConfig) over defaults. Paths can be redirected for tests.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const gitUserName = () => {
  try { return execFileSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

// "owner/name" is a GitHub shorthand; anything else (https, ssh, a local path) is used as given.
export const repoUrl = v => {
  const s = String(v || '').trim()
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? `https://github.com/${s.replace(/\.git$/, '')}.git` : s
}

const list = v => (Array.isArray(v) ? v : String(v ?? '').split(','))
  .map(s => String(s).trim()).filter(Boolean)

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv)
  const home = args.home || env.WEEK_CALENDAR_HOME || os.homedir()
  const outDir = args['out-dir'] || path.join(home, '.calendar')
  // The calendar style last given as flags (prefs.json) under the plugin's settings (config.json).
  let file = {}
  try { file = JSON.parse(fs.readFileSync(path.join(outDir, 'prefs.json'), 'utf8')) } catch {}
  try { file = { ...file, ...JSON.parse(fs.readFileSync(args.config || path.join(outDir, 'config.json'), 'utf8')) } } catch {}
  const pick = (flag, key, dflt) => args[flag] ?? file[key] ?? dflt

  const accent = String(pick('accent', 'accent', '#7c5cff'))
  const cfg = {
    args,
    home,
    outDir,
    projectsDir: args['projects-dir'] || path.join(home, '.claude', 'projects'),
    now: args.now ? new Date(args.now) : new Date(),
    prefs: {
      theme: pick('theme', 'theme', 'dark') === 'light' ? 'light' : 'dark',
      accent: /^#?[0-9a-f]{6}$/i.test(accent) ? '#' + accent.replace('#', '') : '#7c5cff',
      colorBy: pick('color-by', 'colorBy', 'project') === 'task' ? 'task' : 'project',
      weekStart: pick('week-start', 'weekStart', 'monday') === 'sunday' ? 'sunday' : 'monday',
    },
    weekOffset: parseInt(args['week-offset'] ?? '0', 10) || 0,
    machine: String(pick('machine', 'machineName', '') || env.COMPUTERNAME || os.hostname()),
    operator: String(pick('operator', 'operator', '') || gitUserName() || env.USERNAME || env.USER || ''),
    availableHoursPerWeek: Number(pick('available-hours', 'availableHoursPerWeek', 168)) || 168,
    ignoreFolders: list(pick('ignore', 'ignoreFolders', ['AppData\\Local\\Temp', 'AppData/Local/Temp', '/tmp/'])),
    gitEmails: list(pick('git-emails', 'gitEmails', [])).map(s => s.toLowerCase()),
    reportsRepoUrl: repoUrl(pick('reports-repo-url', 'reportsRepoUrl', 'https://github.com/AskTinNguyen/agent-reports.git')),
    githubLogin: String(pick('github-login', 'githubLogin', '') || '').trim(),
    reportsRepoPath: String(pick('reports-repo-path', 'reportsRepoPath', '') || path.join(outDir, 'agent-reports')),
    github: !args['no-github'] && file.github !== false,
    autoExclude: !args['no-auto-exclude'],
    titlesFile: args.titles || path.join(outDir, 'titles.json'),
    excludeFile: args['exclude-file'] || path.join(outDir, 'excluded.json'),
  }
  return cfg
}

export const isIgnored = (cwd, cfg) => {
  const c = String(cwd || '').toLowerCase().replace(/\//g, '\\')
  return cfg.ignoreFolders.some(p => c.includes(p.toLowerCase().replace(/\//g, '\\')))
}
