// Turns parsed sessions into the week's picture: blocks, commit attribution, push and PR status,
// and machine hours (busy, productive, waiting on a person, automated, idle).

import path from 'node:path'
import { HOUR, DAY, mergeIntervals, totalMs, clip, complement, subtract, hours } from './util.mjs'
import { isIgnored } from './config.mjs'

export const GAP_MS = 30 * 60 * 1000        // a new block starts after a gap longer than this
const BUSY_GAP_CAP = 90 * 60 * 1000         // one tool or model step counts as busy for at most this long
const WAIT_CAP = 8 * HOUR                   // waiting on a person counts for at most this long
const COMMIT_SLACK_BEFORE = 2000
const COMMIT_SLACK_AFTER = 3000
const UNFINISHED_CALL_MS = 10 * 60 * 1000   // a git call with no recorded result: look this far ahead
const OUTLIER_MIN_MS = 4 * HOUR
const OUTLIER_AUTO_SHARE = 0.8
const OUTLIER_MIN_AUTO_TURNS = 10
const ROUTINE_MAX_MS = 3 * 60 * 1000        // a commitless run this short is automated when it recurs or nobody typed
const ROUTINE_MIN_REPEATS = 5
const COMMIT_OPS = new Set(['commit', 'rebase', 'cherry-pick', 'merge', 'pull', 'revert', 'am'])

const TASK_TYPES = [
  ['Bug fix', /\b(fix|bug|crash|error|broken|fail(s|ing|ed)?|issue|regression|debug|not working|wrong)\b/i],
  ['Review', /\b(review|audit|status check|check (the|my)|look over|pr #?\d+|pull request)\b/i],
  ['Refactor', /\b(refactor|clean ?up|rename|simplif|restructure|migrat|reorganiz)/i],
  ['Docs', /\b(docs?|document|readme|write[- ]?up|report|notes?|explain(er)?)\b/i],
  ['Setup / config', /\b(install|set ?up|setup|config|configure|settings?|permission|environment|env var|path)\b/i],
  ['Build / test', /\b(build|compile|test|ci|deploy|release|benchmark)\b/i],
  ['Feature', /\b(add|implement|create|build me|make|new|support|feature|generate)\b/i],
  ['Research / Q&A', /(\?\s*$|^(what|why|how|where|which|can|does|is|are)\b)/i],
]
export const taskTypeOf = text => (TASK_TYPES.find(([, re]) => re.test(text || '')) || ['Other'])[0]

// Busy = every gap between consecutive records of one stream, unless the later record starts a
// turn (then the agent was idle, waiting for whatever started it).
function busyIntervals(s) {
  const out = []
  const streams = [s.main, ...s.streams.values()]
  for (const st of streams) {
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i]
      if (!b.start && b.t - a.t <= BUSY_GAP_CAP) out.push([a.t, b.t])
    }
  }
  return mergeIntervals(out)
}

// Waiting on a person = from the record before a typed prompt to that prompt.
function waitingIntervals(s) {
  const out = []
  const typed = new Set(s.typedTurns)
  for (let i = 1; i < s.main.length; i++) {
    const b = s.main[i]
    if (b.start && typed.has(b.t) && b.t - s.main[i - 1].t <= WAIT_CAP) out.push([s.main[i - 1].t, b.t])
  }
  return mergeIntervals(out)
}

// A title reduced to what repeats between runs of one routine: no status icons, no machine word,
// no parenthesised detail. `machineWord` is the first word most titles share, when there is one.
export function routineKey(title, machineWord = '') {
  let t = String(title || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()
  if (machineWord && t.startsWith(machineWord + ' ')) t = t.slice(machineWord.length + 1)
  return t
}

export function analyze({ cfg, sessions, git, gh, range, lookbackStart, now, overrides = {}, savedTitles = {}, snapshotCommits = [], survey = {}, githubLogin = null }) {
  const R0 = range.start, R1 = range.end
  const elapsedEnd = Math.min(now.getTime(), R1)
  const forceExclude = new Set(overrides.exclude || []), forceInclude = new Set(overrides.include || [])

  // ---------- per-session basics ----------
  const all = []
  for (const s of sessions.values()) {
    if (!s.main.length) continue
    const cwdCount = new Map()
    for (const e of s.main) if (e.cwd) cwdCount.set(e.cwd, (cwdCount.get(e.cwd) || 0) + 1)
    const mainCwd = [...cwdCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!mainCwd || isIgnored(mainCwd, cfg)) continue
    if (!s.main.some(e => e.model)) continue
    const repo = git.repoOf(mainCwd)
    all.push({
      s, mainCwd, repo,
      busy: busyIntervals(s),
      waiting: waitingIntervals(s),
      firstT: s.main[0].t,
      lastT: s.main.at(-1).t,
    })
  }

  // ---------- commit attribution: each commit-producing git call claims the commits made while it ran ----------
  const claims = new Map() // repoKey|hash -> { session, repo, commit, via }
  const idsOf = repo => new Set([...repo.emails, ...cfg.gitEmails])
  const knownRepos = () => git.repos()
  const commitsWindow = [lookbackStart - DAY, R1 + DAY]
  for (const a of all) {
    for (const call of a.s.gitCalls) {
      if (!call.ops.some(op => COMMIT_OPS.has(op))) continue
      const lo = call.tUse - COMMIT_SLACK_BEFORE
      const hi = (call.tEnd ?? call.tUse + UNFINISHED_CALL_MS) + COMMIT_SLACK_AFTER
      const candidates = [...new Set([...call.dirs, call.cwd, a.mainCwd].map(d => git.repoOf(d)).filter(Boolean))]
      // By timing alone, only commits by this PC's identities: a pull, merge or rebase also brings
      // in teammates' commits whose dates fall inside the call.
      const tryRepos = list => {
        let found = 0
        for (const repo of list) {
          for (const c of git.commitsOf(repo, ...commitsWindow)) {
            const byHash = call.hashes.some(h => c.hash.startsWith(h))
            if (!byHash && (c.t < lo || c.t > hi || !idsOf(repo).has(c.email))) continue
            const k = `${repo.key}|${c.hash}`
            const prev = claims.get(k)
            if (!prev || (byHash && prev.via !== 'output')) claims.set(k, { session: a, repo, commit: c, via: byHash ? 'output' : 'call' })
            found++
          }
        }
        return found
      }
      if (!tryRepos(candidates)) tryRepos(knownRepos().filter(r => !candidates.includes(r)))
    }
  }

  // Unclaimed commits by a known identity, inside exactly one session's activity in that repo.
  const inRange = all.filter(a => a.lastT >= R0 && a.firstT < R1)
  for (const a of inRange) {
    const iv = []
    for (let i = 1; i < a.s.main.length; i++) if (a.s.main[i].t - a.s.main[i - 1].t <= GAP_MS) iv.push([a.s.main[i - 1].t, a.s.main[i].t])
    a.activity = mergeIntervals(iv)
  }
  for (const repo of new Set(inRange.map(a => a.repo).filter(Boolean))) {
    const ids = idsOf(repo)
    const repoSessions = inRange.filter(a => a.repo === repo)
    for (const c of git.commitsOf(repo, ...commitsWindow)) {
      if (claims.has(`${repo.key}|${c.hash}`) || !ids.has(c.email)) continue
      const hits = repoSessions.filter(a => a.activity.some(([x, y]) => c.t >= x && c.t <= y + COMMIT_SLACK_AFTER))
      if (hits.length === 1) claims.set(`${repo.key}|${c.hash}`, { session: hits[0], repo, commit: c, via: 'window' })
    }
  }

  const claimsBySession = new Map()
  for (const cl of claims.values()) {
    if (!claimsBySession.has(cl.session)) claimsBySession.set(cl.session, [])
    claimsBySession.get(cl.session).push(cl)
  }

  // ---------- push status: local remote-tracking refs (a push from this PC updates them) ----------
  const pushedCache = new Map()
  const isPushed = cl => {
    const k = `${cl.repo.key}|${cl.commit.hash}`
    if (!pushedCache.has(k)) pushedCache.set(k, git.onRemoteBranch(cl.repo, cl.commit.hash, commitsWindow[0]))
    return pushedCache.get(k)
  }

  // ---------- PRs merged in range: per GitHub repo, the merged PRs' commits matched to claimed commits ----------
  const prs = new Map() // repo#number -> { pr, sessions:Set(sessionId), commits:Set(hash) }
  const claimsByHash = new Map()
  for (const cl of claims.values()) claimsByHash.set(cl.commit.hash, cl)
  const snapshotByHash = new Map(snapshotCommits.map(sc => [sc.hash, sc]))
  const slugs = new Set([...claims.values()].map(cl => cl.repo.github).filter(Boolean))
  for (const sc of snapshotCommits) if (sc.repo && sc.repo.includes('/') && !sc.repo.includes('.')) slugs.add(sc.repo)
  for (const slug of slugs) {
    for (const pr of gh.mergedPrs(slug, R0, R1) || []) {
      for (const sha of gh.prCommits(slug, pr.number, true) || []) {
        const cl = claimsByHash.get(sha), sc = snapshotByHash.get(sha)
        if (!cl && !sc) continue
        const k = `${slug}#${pr.number}`
        if (!prs.has(k)) prs.set(k, { pr, sessions: new Set(), commits: new Set() })
        const e = prs.get(k)
        e.commits.add(sha)
        const sid = cl ? cl.session.s.id : sc.sessionId
        if (sid) e.sessions.add(sid)
      }
    }
  }

  // ---------- sessions of this range ----------
  const projectName = (repo, cwd) => repo ? repo.name : path.basename(cwd || 'unknown')
  const titleOf = s => s.customTitle || s.aiTitle || savedTitles[s.id] || null
  const firstWords = new Map()
  for (const a of inRange) {
    const w = routineKey(titleOf(a.s)).split(' ')[0]
    if (w) firstWords.set(w, (firstWords.get(w) || 0) + 1)
  }
  const [topWord, topCount] = [...firstWords.entries()].sort((x, y) => y[1] - x[1])[0] || ['', 0]
  const machineWord = topCount > inRange.length / 2 ? topWord : ''
  const repeats = new Map()
  for (const a of inRange) {
    const k = routineKey(titleOf(a.s), machineWord)
    if (k) repeats.set(k, (repeats.get(k) || 0) + 1)
  }
  const sessionsOut = []
  const blocks = []
  for (const a of inRange) {
    const s = a.s
    const evs = [...s.main.map(e => ({ t: e.t, cwd: e.cwd, model: e.model })),
      ...[...s.streams.values()].flat().map(e => ({ t: e.t }))].filter(e => e.t >= R0 && e.t < R1).sort((x, y) => x.t - y.t)
    if (!evs.some(e => e.model)) continue
    const busy = clip(a.busy, R0, R1)
    const waiting = clip(a.waiting, R0, R1)
    const myClaims = (claimsBySession.get(a) || []).filter(cl => cl.commit.t >= R0 - DAY && cl.commit.t < R1 + DAY)
    const pushCalls = s.gitCalls.filter(c => c.ops.includes('push') && c.ok && c.tUse >= R0 && c.tUse < R1)
    const pushedCommits = myClaims.filter(cl => isPushed(cl))
    const productive = pushCalls.length > 0 || pushedCommits.length > 0
    const typed = s.typedTurns.filter(t => t >= R0 && t < R1).length
    const autoTurns = s.autoTurns.filter(x => x.t >= R0 && x.t < R1)
    const auto = autoTurns.length
    const kinds = [...new Set(autoTurns.map(x => x.kind))].join(', ')
    const firstPrompt = s.prompts[0]?.text || ''
    const title = titleOf(s)

    // blocks: runs of activity split at gaps over 30 minutes
    const runs = []
    let cur = null
    for (const e of evs) {
      if (!cur || e.t - cur.end > GAP_MS) runs.push((cur = { start: e.t, end: e.t, events: [] }))
      cur.end = e.t
      cur.events.push(e)
    }
    const activeMs = runs.reduce((n, r) => n + Math.max(r.end - r.start, 60000), 0)
    const turns = typed + auto
    const mostlyAuto = activeMs >= OUTLIER_MIN_MS && auto >= OUTLIER_MIN_AUTO_TURNS && auto / Math.max(1, turns) >= OUTLIER_AUTO_SHARE
    // Routine runs (schedulers, butlers, loops): short, commitless, and recurring or untyped.
    const repeat = repeats.get(routineKey(title, machineWord)) || 0
    const routine = myClaims.length === 0 && activeMs <= ROUTINE_MAX_MS && (repeat >= ROUTINE_MIN_REPEATS || typed === 0)
    let excluded = false, excludeReason = null, automated = false
    if (forceExclude.has(s.id)) { excluded = true; excludeReason = 'Excluded by you' }
    else if (cfg.autoExclude && !forceInclude.has(s.id) && mostlyAuto) {
      excluded = automated = true
      excludeReason = `Mostly automated: ${auto} of ${turns} turns (${kinds}) over ${(activeMs / HOUR).toFixed(1)} h`
    } else if (cfg.autoExclude && !forceInclude.has(s.id) && routine) {
      excluded = automated = true
      excludeReason = repeat >= ROUTINE_MIN_REPEATS ? `Automated: a short run that recurred ${repeat} times` : 'Automated: a short run nobody typed in'
    }

    const sessionBlocks = runs.map(run => {
      const cwdCount = new Map(), modelCount = new Map()
      for (const e of run.events) {
        if (e.cwd) cwdCount.set(e.cwd, (cwdCount.get(e.cwd) || 0) + 1)
        if (e.model) modelCount.set(e.model, (modelCount.get(e.model) || 0) + 1)
      }
      const cwd = [...cwdCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || a.mainCwd
      const repo = git.repoOf(cwd) || a.repo
      const end = Math.max(run.end, run.start + 60000)
      const bc = myClaims.filter(cl => cl.commit.t >= run.start - COMMIT_SLACK_BEFORE && cl.commit.t <= end + COMMIT_SLACK_AFTER)
        .sort((x, y) => x.commit.t - y.commit.t)
      const blockPrompt = s.prompts.find(p => p.t >= run.start - 1000 && p.t <= run.end)?.text
      return {
        id: `${s.id}:${run.start}`,
        sessionId: s.id,
        project: projectName(repo, cwd),
        projectKey: repo ? repo.key : path.resolve(cwd || 'unknown').toLowerCase(),
        cwd,
        isGitRepo: !!repo,
        start: run.start,
        end,
        models: [...modelCount.entries()].sort((x, y) => y[1] - x[1]).map(([m]) => m),
        title,
        needsTitle: !title,
        firstMessage: blockPrompt || firstPrompt,
        sessionFirstMessage: firstPrompt,
        taskType: taskTypeOf(blockPrompt || firstPrompt),
        commits: bc.map(cl => ({ short: cl.commit.hash.slice(0, 8), hash: cl.commit.hash, t: cl.commit.t, subject: cl.commit.subject, files: cl.commit.files, via: cl.via, pushed: isPushed(cl) })),
        files: [...new Set(bc.flatMap(cl => cl.commit.files))].sort(),
      }
    })

    const anyGit = sessionBlocks.some(b => b.isGitRepo)
    const noCommit = anyGit && myClaims.length === 0
    for (const b of sessionBlocks) Object.assign(b, { noCommit, excluded, excludeReason, automated, productive })
    blocks.push(...sessionBlocks)
    sessionsOut.push({
      sessionId: s.id,
      title,
      needsTitle: !title,
      firstMessage: firstPrompt,
      project: sessionBlocks[0].project,
      projectKey: sessionBlocks[0].projectKey,
      repo: a.repo?.github || a.repo?.key || null,
      cwd: a.mainCwd,
      start: sessionBlocks[0].start,
      end: sessionBlocks.at(-1).end,
      isGitRepo: anyGit,
      commitCount: myClaims.length,
      pushedCommitCount: pushedCommits.length,
      pushes: pushCalls.length,
      productive,
      noCommit,
      noCommitReason: survey.noCommitReasons?.[s.id] || null,
      excluded,
      excludeReason,
      automated,
      humanTurns: typed,
      autoTurns: auto,
      models: [...new Set(sessionBlocks.flatMap(b => b.models))],
      costUsd: +s.costUsd.toFixed(2),
      linesAdded: s.linesAdded,
      linesRemoved: s.linesRemoved,
      minutes: Math.round(activeMs / 60000),
      busyHours: hours(totalMs(busy)),
      waitingHours: hours(totalMs(subtract(waiting, busy))),
      commits: myClaims.map(cl => ({ repo: cl.repo.github || cl.repo.key, hash: cl.commit.hash, t: cl.commit.t, subject: cl.commit.subject, via: cl.via, pushed: isPushed(cl) })),
      _busy: busy, _waiting: waiting,
    })
  }

  // ---------- machine hours ----------
  const counted = sessionsOut.filter(x => !x.excluded)
  const busyAll = mergeIntervals(clip(counted.flatMap(x => x._busy), R0, elapsedEnd))
  const productiveAll = mergeIntervals(clip(counted.filter(x => x.productive).flatMap(x => x._busy), R0, elapsedEnd))
  const waitingAll = subtract(clip(counted.flatMap(x => x._waiting), R0, elapsedEnd), busyAll)
  const automatedAll = subtract(clip(sessionsOut.filter(x => x.excluded).flatMap(x => x._busy), R0, elapsedEnd), busyAll)
  const elapsedMs = Math.max(0, elapsedEnd - R0)
  const availableHours = cfg.availableHoursPerWeek * (elapsedMs / (7 * DAY))
  const idleGaps = complement([...busyAll, ...waitingAll], R0, elapsedEnd)
    .sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 5)
    .map(([s0, e0]) => ({ start: s0, end: e0, hours: hours(e0 - s0) }))
  const busyH = totalMs(busyAll) / HOUR
  const machineHours = {
    available: +availableHours.toFixed(2),
    busy: +busyH.toFixed(2),
    productive: hours(totalMs(productiveAll)),
    waitingOnPerson: hours(totalMs(waitingAll)),
    automated: hours(totalMs(automatedAll)),
    idle: +Math.max(0, availableHours - busyH - totalMs(waitingAll) / HOUR).toFixed(2),
    utilization: availableHours ? +(busyH / availableHours).toFixed(3) : 0,
    productiveUtilization: availableHours ? +(totalMs(productiveAll) / HOUR / availableHours).toFixed(3) : 0,
    idleGaps,
  }

  // ---------- PRs merged in range ----------
  const busyBySession = new Map(all.map(a => [a.s.id, a]))
  const merged = [...prs.values()].filter(e => e.pr.mergedAt && Date.parse(e.pr.mergedAt) >= R0 && Date.parse(e.pr.mergedAt) < R1)
  // A session that fed several PRs shares its busy time and cost between them instead of giving each all of it.
  const prsPerSession = new Map()
  for (const e of merged) for (const id of e.sessions) prsPerSession.set(id, (prsPerSession.get(id) || 0) + 1)
  const login = githubLogin ? String(githubLogin).toLowerCase() : null
  const prsMerged = merged
    .map(e => {
      const ss = [...e.sessions].map(id => busyBySession.get(id)).filter(Boolean)
      const first = ss.length ? Math.min(...ss.map(a => a.firstT)) : null
      const agentMs = ss.reduce((n, a) => n + totalMs(a.busy) / prsPerSession.get(a.s.id), 0)
      return {
        repo: e.pr.repo, number: e.pr.number, title: e.pr.title, url: e.pr.url, author: e.pr.author,
        yours: login ? String(e.pr.author || '').toLowerCase() === login : null,
        mergedAt: e.pr.mergedAt, createdAt: e.pr.createdAt, headRef: e.pr.headRef,
        sessions: [...e.sessions], commits: [...e.commits],
        agentHours: hours(agentMs),
        costUsd: +ss.reduce((n, a) => n + a.s.costUsd / prsPerSession.get(a.s.id), 0).toFixed(2),
        leadTimeHours: first ? hours(Date.parse(e.pr.mergedAt) - first) : null,
      }
    })
    .sort((x, y) => Date.parse(y.mergedAt) - Date.parse(x.mergedAt))
  const prsOpen = []

  // ---------- project totals (session time, parallel sessions once) ----------
  const byProject = new Map()
  for (const b of blocks.filter(b => !b.excluded)) {
    if (!byProject.has(b.project)) byProject.set(b.project, [])
    byProject.get(b.project).push([b.start, b.end])
  }
  const totals = [...byProject.entries()]
    .map(([project, iv]) => ({ project, hours: totalMs(iv) / HOUR, sessions: new Set(blocks.filter(b => b.project === project && !b.excluded).map(b => b.sessionId)).size }))
    .sort((x, y) => y.hours - x.hours)
  const totalHours = totalMs(blocks.filter(b => !b.excluded).map(b => [b.start, b.end])) / HOUR

  const gitSessions = counted.filter(x => x.isGitRepo)
  const metrics = {
    prsMerged: prsMerged.length,
    prsAuthored: login ? prsMerged.filter(p => p.yours).length : null,
    productiveUtilization: machineHours.productiveUtilization,
    utilization: machineHours.utilization,
    agentHoursPerMergedPr: prsMerged.length ? +(machineHours.busy / prsMerged.length).toFixed(2) : null,
    costUsd: +counted.reduce((n, x) => n + x.costUsd, 0).toFixed(2),
    costPerMergedPr: prsMerged.length ? +(counted.reduce((n, x) => n + x.costUsd, 0) / prsMerged.length).toFixed(2) : null,
    medianLeadTimeHours: median(prsMerged.map(p => p.leadTimeHours).filter(v => v != null)),
    noCommitRate: gitSessions.length ? +(gitSessions.filter(x => x.noCommit).length / gitSessions.length).toFixed(3) : null,
    typedPromptsPerBusyHour: machineHours.busy ? +(counted.reduce((n, x) => n + x.humanTurns, 0) / machineHours.busy).toFixed(2) : null,
    sessions: counted.length,
    productiveSessions: counted.filter(x => x.productive).length,
    commits: counted.reduce((n, x) => n + x.commitCount, 0),
    commitsByAttribution: countBy(counted.flatMap(x => x.commits), c => c.via),
  }

  for (const x of sessionsOut) { delete x._busy; delete x._waiting }
  return { githubLogin: login, blocks: blocks.sort((x, y) => x.start - y.start), sessions: sessionsOut.sort((x, y) => x.start - y.start), totals, totalHours, machineHours, metrics, prsMerged, prsOpen }
}

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2)
}
const countBy = (xs, f) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {})
