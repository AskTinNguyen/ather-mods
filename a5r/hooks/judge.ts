// A65: the advisory judge. When a lease is past its end, or its holder (of the Editor or of the sync) has run no turn
// for 10 minutes while holding, one judging agent per incident reads the facts and the tail of the holder's own
// transcript and says what the holder is doing. It acts on nothing. Pure: no `$`; register.ts gathers the facts,
// spawns the agent and shows the verdict.

export type Verdict = 'working' | 'waiting-on-Hai' | 'stuck-or-crashed' | 'unsure'
export const VERDICTS: readonly Verdict[] = ['working', 'waiting-on-Hai', 'stuck-or-crashed', 'unsure']

/** One event of a transcript record (Claude Code's `<session id>.jsonl`): who, when, its text, the tools it called,
 * and the tool results it carries. */
export type TranscriptEvent = { at: number | null; role: 'user' | 'assistant' | 'other'; text: string; tools: { id: string; name: string }[]; results: string[] }

type Part = { type?: string; text?: string; id?: string; name?: string; tool_use_id?: string; content?: unknown }

/** The last `max` events of a transcript's text (lines that are not JSON are skipped). */
export const parseTail = (text: string, max = 200): TranscriptEvent[] => {
  const out: TranscriptEvent[] = []
  for (const line of text.split(/\r?\n/).slice(-max)) {
    if (!line.trim()) continue
    let v: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } }
    try {
      v = JSON.parse(line) as typeof v
    } catch {
      continue
    }
    const role = v.type === 'assistant' || v.message?.role === 'assistant' ? 'assistant' : v.type === 'user' || v.message?.role === 'user' ? 'user' : 'other'
    const content = v.message?.content
    const parts: Part[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Part[]) : []
    const at = v.timestamp ? Date.parse(v.timestamp) : NaN
    out.push({
      at: Number.isFinite(at) ? at : null,
      role,
      text: parts.filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text ?? '').join(' ').replace(/\s+/g, ' ').trim(),
      tools: parts.filter(p => p.type === 'tool_use').map(p => ({ id: String(p.id ?? ''), name: String(p.name ?? '') })),
      results: parts.filter(p => p.type === 'tool_result').map(p => String(p.tool_use_id ?? '')),
    })
  }
  return out
}

/** The events as short lines for the judge's prompt: time, who, the first words, the tools called. */
export const digestOf = (events: readonly TranscriptEvent[], max = 40): string =>
  events
    .filter(e => e.role !== 'other' && (e.text || e.tools.length || e.results.length))
    .slice(-max)
    .map(e => {
      const t = e.at ? new Date(e.at).toISOString().slice(11, 16) : '--:--'
      const what = e.results.length && !e.text ? `[tool result ×${e.results.length}]` : e.text.slice(0, 200)
      return `${t} ${e.role}: ${what}${e.tools.length ? ` [calls: ${e.tools.map(x => x.name).join(', ')}]` : ''}`
    })
    .join('\n')

/** What the judge is told about one incident. */
export type JudgeFacts = {
  now: number
  kind: 'editor' | 'sync'
  lane: string
  id8: string
  session: string
  since: number
  end: number | null
  why: string
  liveness: 'alive' | 'gone' | 'unknown'
  lastTurnAt: number | null
  agents: number | null
  procs: readonly string[]
  hasEditor: boolean
  hasBuild: boolean
  transcript: string
}

const minAgo = (now: number, at: number | null): string => (at === null ? 'unknown' : `${Math.max(0, Math.round((now - at) / 60_000))} min ago`)

/** A first reading of the facts and the transcript, by rule: the judge confirms or corrects it, and it stands in when
 * no judge could run. Gone with nothing running → stuck or crashed; an open question → waiting on Hai; a running
 * Editor, build or tool, or recent activity → working; long silent → stuck; else unsure. */
export const hintOf = (f: JudgeFacts, events: readonly TranscriptEvent[]): { verdict: Verdict; evidence: string[] } => {
  const last = [...events].reverse().find(e => e.role !== 'other' && (e.text || e.tools.length || e.results.length))
  const lastAt = [...events].reverse().find(e => e.at !== null)?.at ?? null
  const answered = new Set(events.flatMap(e => e.results))
  const open = events.flatMap(e => e.tools).filter(t => t.id && !answered.has(t.id))
  if (f.liveness === 'gone' && !f.hasEditor && !f.hasBuild) return { verdict: 'stuck-or-crashed', evidence: [`the session is gone (no a5r heartbeat, no live Ather lane); last transcript event ${minAgo(f.now, lastAt)}`, 'no Unreal Editor or build process runs'] }
  const ask = open.find(t => t.name === 'AskUserQuestion')
  if (ask) return { verdict: 'waiting-on-Hai', evidence: ['an AskUserQuestion is open (no answer in the transcript)', `last transcript event ${minAgo(f.now, lastAt)}`] }
  if (last && last.role === 'assistant' && !last.tools.length && /\?\s*$/.test(last.text)) return { verdict: 'waiting-on-Hai', evidence: [`its last message asks: "${last.text.slice(-140)}"`, `${minAgo(f.now, lastAt)}`] }
  const running = open.filter(t => t.name !== 'AskUserQuestion')
  if (f.hasEditor || f.hasBuild || running.length > 0 || (lastAt !== null && f.now - lastAt < 10 * 60_000))
    return { verdict: 'working', evidence: [f.hasBuild ? 'a build process runs' : f.hasEditor ? 'an Unreal Editor runs' : running.length ? `a tool is still running: ${running.map(t => t.name).join(', ')}` : `transcript active ${minAgo(f.now, lastAt)}`, `last transcript event ${minAgo(f.now, lastAt)}`] }
  if (lastAt !== null && f.now - lastAt >= 30 * 60_000) return { verdict: 'stuck-or-crashed', evidence: [`no transcript event for ${minAgo(f.now, lastAt).replace(' ago', '')}`, 'nothing runs and no question is open'] }
  return { verdict: 'unsure', evidence: [lastAt === null ? 'no readable transcript' : `last transcript event ${minAgo(f.now, lastAt)}`] }
}

/** A65: the judge's system prompt: read-only, one verdict in a fixed form. */
export const JUDGE_SYSTEM = [
  'You are the A5R advisory judge for Hai\'s shared Unreal checkout. One session holds a coordination lease (the Editor or the sync) and looks stalled.',
  'Decide what that session is doing from the facts and its transcript. You change nothing: no edits, no messages to the session, no lock or file writes. Read only.',
  'You may Read or Grep the transcript file named in the facts for more context (its end matters most).',
  'Verdicts: working (a build, a test, an Editor or a tool making progress), waiting-on-Hai (its last message asks Hai something, or a question is open), stuck-or-crashed (no progress and nothing running, or the session is gone), unsure.',
  'Answer in exactly this form and nothing else:',
  'VERDICT: <working | waiting-on-Hai | stuck-or-crashed | unsure>',
  'EVIDENCE:',
  '- <one line each, at most three, quoting the transcript or the facts>',
  'RECOMMENDATION: <one line for Hai: what he could do, or that nothing is needed>',
].join('\n')

/** A65: the judge's task: the incident's facts, the rule's first reading, and the transcript digest. */
export const judgePrompt = (f: JudgeFacts, hint: { verdict: Verdict; evidence: string[] }, digest: string): string =>
  [
    `Incident: ${f.why}.`,
    `Holder: ${f.lane || 'unknown lane'} (session ${f.session || f.id8}), holding the ${f.kind === 'editor' ? 'Editor' : 'sync'} since ${new Date(f.since).toISOString()}${f.end ? `, lease end ${new Date(f.end).toISOString()}` : ''}.`,
    `Its session: ${f.liveness}; last turn ${minAgo(f.now, f.lastTurnAt)}; background agents running: ${f.agents ?? 'unknown'}.`,
    `Processes on the machine now: ${f.procs.length ? [...f.procs].sort().join(', ') : 'none of the watched ones'} (Unreal Editor running: ${f.hasEditor ? 'yes' : 'no'}; build or game running: ${f.hasBuild ? 'yes' : 'no'}).`,
    `Transcript file: ${f.transcript || 'not found'}.`,
    `A rule's first reading: ${hint.verdict} (${hint.evidence.join('; ')}). Confirm or correct it.`,
    '',
    'The transcript\'s last events (time UTC, who, first words, tools called):',
    digest || '(no readable events)',
  ].join('\n')

/** A65: the judge's answer read back, or null when it is not in the form. */
export const parseVerdict = (answer: string): { verdict: Verdict; evidence: string[]; recommendation: string } | null => {
  const v = /VERDICT:\s*(working|waiting-on-Hai|stuck-or-crashed|unsure)/i.exec(answer)
  if (!v) return null
  const verdict = VERDICTS.find(x => x.toLowerCase() === (v[1] ?? '').toLowerCase()) ?? 'unsure'
  const ev = /EVIDENCE:\s*([\s\S]*?)(?:RECOMMENDATION:|$)/i.exec(answer)?.[1] ?? ''
  const evidence = ev.split(/\r?\n/).map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean).slice(0, 3)
  const recommendation = (/RECOMMENDATION:\s*(.+)/i.exec(answer)?.[1] ?? '').trim()
  return { verdict, evidence, recommendation }
}

/** A65: what each verdict recommends when the judge gave none (or did not run). */
export const defaultRecommendation = (v: Verdict): string =>
  v === 'working' ? 'nothing: let it finish' : v === 'waiting-on-Hai' ? 'answer it in that session' : v === 'stuck-or-crashed' ? 'look at that session; release its lease if it is really gone' : 'look at that session when you can'

/** A65: one verdict as kept in Saved/A5R/verdicts.json and shown on the Orchestrate card. */
export type VerdictRow = { at: number; id8: string; lane: string; kind: 'editor' | 'sync'; verdict: Verdict; evidence: string; recommendation: string; by: string; source: 'judge' | 'rule' }
