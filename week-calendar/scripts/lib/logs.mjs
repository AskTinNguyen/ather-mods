// Reads Claude Code session logs (~/.claude/projects/**/*.jsonl, subagent logs included) into
// per-session records: activity streams, typed prompts, turn starts, git operations and cost.

import fs from 'node:fs'
import path from 'node:path'
import { normalizePath } from './util.mjs'

// git <op> as written in a shell command, with an optional -C <dir>.
const GIT_OP = /(?:^|[\s;&|(`{])git(?:\s+-C\s+("[^"]+"|'[^']+'|[^\s;&|]+))?(?:\s+-c\s+\S+)*\s+(commit|rebase|cherry-pick|merge|pull|revert|am|push)\b/g
const CD = /(?:^|[;&\n]\s*|\s)(?:cd|Set-Location|Push-Location|pushd)\s+(?:-Path\s+|-LiteralPath\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/
const HASH_LINE = /\[([^\s\]]+) (?:\(root-commit\) )?([0-9a-f]{7,40})\]/g
const PUSH_FAILED = /\brejected\b|fatal:|error: failed to push|Permission denied|could not read from remote/i
const ENGINE_TAG = /^<(scheduled-task|command-|local-command|task-notification|cross-session-message|system-reminder)/

export function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
  return ''
}

const cleanTyped = text => text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\s+/g, ' ').trim()
const hasToolResult = c => Array.isArray(c) && c.some(b => b?.type === 'tool_result')

export function isTypedPrompt(r) {
  if (r.type !== 'user' || r.isMeta || r.isSidechain) return false
  const c = r.message?.content
  if (hasToolResult(c)) return false
  const raw = textOf(c).trim()
  if (ENGINE_TAG.test(raw)) return false
  if (r.origin) return r.origin.kind === 'human'
  if (r.promptSource) return r.promptSource === 'typed'
  return !!raw && !raw.startsWith('<') && !raw.startsWith('This session is being continued')
}

// Turns that start themselves (schedules, loops, plugin or SDK drivers). Notifications of
// background work and messages from other sessions follow from work the user started.
const FOLLOW_ON = new Set(['task_notification', 'task-notification', 'notification', 'peer', 'human'])
export function automatedKind(r) {
  if (hasToolResult(r.message?.content)) return null
  const kind = r.turnOrigin || r.origin?.kind
  return kind && !FOLLOW_ON.has(kind) ? kind : null
}

export function parseGitOps(cmd) {
  const ops = []
  for (const m of String(cmd || '').matchAll(GIT_OP)) ops.push({ op: m[2], dir: m[1] ? normalizePath(m[1]) : null })
  if (!ops.length) return null
  const cd = String(cmd).match(CD)
  return { ops, cdDir: cd ? normalizePath(cd[1]) : null }
}

function* jsonlFiles(dir, sinceMs) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* jsonlFiles(p, sinceMs)
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs < sinceMs) continue } catch { continue }
      yield p
    }
  }
}

function newSession(id) {
  return {
    id, customTitle: null, aiTitle: null,
    main: [],            // { t, start, cwd, model } main-thread user/assistant records
    streams: new Map(),  // subagent id -> [{ t, start }]
    prompts: [],         // typed prompts { t, text }
    typedTurns: [], autoTurns: [], followTurns: [],
    gitCalls: [],        // { tUse, tEnd, cwd, dirs, ops, hashes, ok }
    costUsd: 0, linesAdded: 0, linesRemoved: 0,
    versions: new Set(),
  }
}

// Reads every log touched since `sinceMs`; keeps records from `sinceMs` on.
export function readSessions(projectsDir, sinceMs) {
  const sessions = new Map()
  const get = id => sessions.get(id) || sessions.set(id, newSession(id)).get(id)

  for (const file of jsonlFiles(projectsDir, sinceMs)) {
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    const isSubFile = /[\\/]subagents[\\/]/.test(file)
    const pending = new Map() // tool_use id -> git call
    for (const line of text.split('\n')) {
      if (!line) continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      const sid = r.sessionId || r.session_id
      if (!sid) continue
      if (r.type === 'custom-title' && r.customTitle) { get(sid).customTitle = r.customTitle; continue }
      if (r.type === 'ai-title' && r.aiTitle) { get(sid).aiTitle = r.aiTitle; continue }
      if (r.type === 'cost-state') {
        const s = get(sid)
        s.costUsd = Math.max(s.costUsd, Number(r.totalCostUSD) || 0)
        s.linesAdded = Math.max(s.linesAdded, Number(r.totalLinesAdded) || 0)
        s.linesRemoved = Math.max(s.linesRemoved, Number(r.totalLinesRemoved) || 0)
        continue
      }
      if ((r.type !== 'user' && r.type !== 'assistant') || !r.timestamp) continue
      const t = Date.parse(r.timestamp)
      if (!Number.isFinite(t) || t < sinceMs) continue
      const s = get(sid)
      const c = r.message?.content
      const start = r.type === 'user' && !hasToolResult(c)
      const side = isSubFile || r.isSidechain

      if (side) {
        const key = r.agentId || file
        if (!s.streams.has(key)) s.streams.set(key, [])
        s.streams.get(key).push({ t, start })
      } else {
        const model = r.type === 'assistant' ? r.message?.model : undefined
        if (r.version) s.versions.add(r.version)
        s.main.push({ t, start, cwd: r.cwd, model: model && model !== '<synthetic>' ? model : undefined })
        if (start) {
          if (isTypedPrompt(r)) {
            s.typedTurns.push(t)
            const txt = cleanTyped(textOf(c))
            if (txt) s.prompts.push({ t, text: txt })
          } else {
            const kind = automatedKind(r)
            if (kind) s.autoTurns.push({ t, kind })
            else if (!r.isMeta) s.followTurns.push(t)
          }
        }
      }

      // git operations, main thread and subagents alike
      if (!Array.isArray(c)) continue
      for (const b of c) {
        if (b?.type === 'tool_use' && (b.name === 'Bash' || b.name === 'PowerShell')) {
          const parsed = parseGitOps(b.input?.command)
          if (!parsed) continue
          const call = {
            tUse: t, tEnd: null, cwd: r.cwd ? normalizePath(r.cwd) : null,
            dirs: [...new Set([...parsed.ops.map(o => o.dir), parsed.cdDir].filter(Boolean))],
            ops: [...new Set(parsed.ops.map(o => o.op))], hashes: [], ok: null,
          }
          s.gitCalls.push(call)
          pending.set(b.id, call)
        } else if (b?.type === 'tool_result' && pending.has(b.tool_use_id)) {
          const call = pending.get(b.tool_use_id)
          pending.delete(b.tool_use_id)
          const out = typeof b.content === 'string' ? b.content : textOf(b.content)
          call.tEnd = t
          call.hashes = [...out.matchAll(HASH_LINE)].map(m => m[2])
          call.ok = !b.is_error && !PUSH_FAILED.test(out)
        }
      }
    }
  }
  for (const s of sessions.values()) {
    s.main.sort((a, b) => a.t - b.t)
    for (const st of s.streams.values()) st.sort((a, b) => a.t - b.t)
    s.prompts.sort((a, b) => a.t - b.t)
    s.typedTurns.sort((a, b) => a - b)
  }
  return sessions
}
