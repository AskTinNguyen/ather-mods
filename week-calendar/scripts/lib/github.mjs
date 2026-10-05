// Read-only GitHub lookups through the gh CLI: the PRs merged in a week, and each PR's commits.
// Cached in ~/.calendar/cache/github.json: a merged PR's commits never change, and a finished
// week's search never re-runs; the current week's search re-runs after an hour.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const RECHECK_MS = 60 * 60 * 1000

export function createGitHub(cfg) {
  const file = path.join(cfg.outDir, 'cache', 'github.json')
  let cache = { merged: {}, prCommits: {} }
  try { cache = { merged: {}, prCommits: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch {}
  let enabled = cfg.github
  let calls = 0, errors = 0
  const now = Date.now()

  if (enabled) {
    try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore', timeout: 20000 }) } catch { enabled = false }
  }

  function api(argv) {
    calls++
    try {
      const out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', ...argv],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 64 << 20 })
      return JSON.parse(out)
    } catch {
      errors++
      return null
    }
  }

  // PRs merged into `slug` in [start, end); null when GitHub could not be asked.
  function mergedPrs(slug, start, end) {
    const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const k = `${slug}|${iso(start)}|${iso(end)}`
    const hit = cache.merged[k]
    if (hit && (hit.final || now - hit.at < RECHECK_MS)) return hit.prs
    if (!enabled) return hit ? hit.prs : null
    const prs = []
    for (let page = 1; page <= 10; page++) {
      const body = api(['-X', 'GET', 'search/issues', '-f', `q=repo:${slug} is:pr is:merged merged:${iso(start)}..${iso(end - 1000)}`, '-f', 'per_page=100', '-f', `page=${page}`])
      if (!body) return hit ? hit.prs : null
      for (const it of body.items || []) {
        prs.push({
          repo: slug, number: it.number, title: it.title, url: it.html_url, state: 'closed',
          author: it.user?.login || null, createdAt: it.created_at, mergedAt: it.pull_request?.merged_at || it.closed_at,
          headRef: null,
        })
      }
      if (!body.items || body.items.length < 100) break
    }
    cache.merged[k] = { prs, at: now, final: now > end + 6 * RECHECK_MS }
    return prs
  }

  // Commit hashes of one PR (up to 250); null when GitHub could not be asked.
  function prCommits(slug, number, settled) {
    const k = `${slug}#${number}`
    const hit = cache.prCommits[k]
    if (hit && (hit.settled || now - hit.at < RECHECK_MS)) return hit.shas
    if (!enabled) return hit ? hit.shas : null
    const body = api([`repos/${slug}/pulls/${number}/commits?per_page=100`, '--paginate', '--slurp'])
    if (!Array.isArray(body)) return hit ? hit.shas : null
    const shas = body.flat().map(c => c.sha)
    cache.prCommits[k] = { shas, at: now, settled: !!settled }
    return shas
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(cache))
    } catch {}
  }

  return { mergedPrs, prCommits, save, stats: () => ({ enabled, calls, errors }) }
}
