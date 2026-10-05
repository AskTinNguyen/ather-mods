// Local git reads only: repo identity and commit history. Nothing here writes to a repo.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const git = (cwd, argv) =>
  execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20, timeout: 60000 })

// "https://github.com/Owner/Repo.git", "git@github.com:owner/repo" -> { host, slug }
export function parseRemote(url) {
  const u = String(url || '').trim()
  if (!/^[a-z+]+:\/\/[^/]+\.[^/]+\/|^[^@\s/]+@[^:\s]+:/i.test(u)) return null // a local path, not a hosted remote
  const m = u.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i)
  if (!m) return null
  return { host: m[1].toLowerCase(), slug: m[2].toLowerCase(), display: m[2] }
}

export function createGit() {
  const byDir = new Map()
  const byCommon = new Map()
  const commitCache = new Map()

  // A folder's repository: one identity for the main checkout and all its worktrees.
  function repoOf(dir) {
    if (!dir) return null
    if (byDir.has(dir)) return byDir.get(dir)
    let info = null
    try {
      if (fs.existsSync(dir)) {
        const [top, common] = git(dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir']).trim().split(/\r?\n/)
        const commonDir = path.resolve(common)
        info = byCommon.get(commonDir)
        if (!info) {
          let remote = null
          try { remote = parseRemote(git(top, ['config', '--get', 'remote.origin.url']).trim()) } catch {}
          const mainDir = path.basename(commonDir).toLowerCase() === '.git' ? path.dirname(commonDir) : path.resolve(top)
          const emails = new Set()
          try { emails.add(git(top, ['config', '--get', 'user.email']).trim().toLowerCase()) } catch {}
          info = {
            dir: mainDir,
            commonDir,
            key: remote ? `${remote.host}/${remote.slug}` : path.resolve(mainDir).toLowerCase(),
            name: remote ? remote.display : path.basename(mainDir),
            github: remote && remote.host === 'github.com' ? remote.slug : null,
            emails,
          }
          byCommon.set(commonDir, info)
        }
      }
    } catch {}
    byDir.set(dir, info)
    return info
  }

  // Every commit on any local ref, committed in [since, until]; { hash, t, email, name, subject, files, parents }.
  function commitsOf(repo, since, until) {
    const k = `${repo.commonDir}|${since}|${until}`
    if (commitCache.has(k)) return commitCache.get(k)
    const list = []
    try {
      const SEP = '\x1e', FS = '\x1f'
      const out = git(repo.dir, [
        'log', '--all', '--reflog', `--since=@${Math.floor(since / 1000)}`, `--until=@${Math.ceil(until / 1000)}`,
        `--pretty=format:${SEP}%H${FS}%P${FS}%ae${FS}%an${FS}%ct${FS}%s`, '--name-only',
      ])
      const seen = new Set()
      for (const chunk of out.split(SEP)) {
        if (!chunk.trim()) continue
        const [head, ...rest] = chunk.split('\n')
        const [hash, parents, email, name, ct, subject] = head.split(FS)
        if (!hash || seen.has(hash)) continue
        seen.add(hash)
        list.push({
          hash, t: Number(ct) * 1000, email: (email || '').toLowerCase(), name, subject,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          files: rest.map(s => s.trim()).filter(Boolean),
        })
      }
    } catch {}
    commitCache.set(k, list)
    return list
  }

  // Local fallback for "is this commit on a remote branch" (as of the last fetch): one log of
  // every remote-tracking ref per repo, since the window start.
  const remoteSets = new Map()
  function onRemoteBranch(repo, hash, since = 0) {
    if (!remoteSets.has(repo.commonDir)) {
      let set = new Set()
      try { set = new Set(git(repo.dir, ['log', '--remotes', `--since=@${Math.floor(since / 1000)}`, '--format=%H']).split(/\s+/).filter(Boolean)) } catch {}
      remoteSets.set(repo.commonDir, set)
    }
    return remoteSets.get(repo.commonDir).has(hash)
  }

  return { repoOf, commitsOf, onRemoteBranch, repos: () => [...byCommon.values()] }
}
