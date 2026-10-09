// A69: the judge's exact input for past incidents, built by the code the live judge uses (hooks/judge.ts: parseTail,
// digestOf, hintOf, judgePrompt, JUDGE_SYSTEM), so the same model and prompt can be run on cases whose truth is known.
// It runs no model. Each incident's transcript is cut at the moment it is judged (only lines up to then), and its last
// 200 lines are read as the live judge reads them. What cannot be reconstructed is said to be unknown.
//
// Run from the worktree root:
//   node --experimental-strip-types a5r/tests/replay-judge.mjs [out folder]
// Writes judge-<lane>.txt per incident: the agent's type, its system prompt and its task (the spawn's prompt).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { JUDGE_SYSTEM, digestOf, hintOf, judgePrompt, parseTail } from '../hooks/judge.ts'

const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--Projects-s2'
const OUT = process.argv[2] ?? 'C:/Users/HAI~1.HUY/AppData/Local/Temp/claude/D--Projects-ather-mods/55144c82-8fe3-484b-b93c-3ba8104e813a/scratchpad'
const at = s => Date.parse(`${s}+07:00`) // local time on this machine (UTC+7)
const hhmm = ms => new Date(ms + 7 * 3600_000).toISOString().slice(11, 16)

// The past incidents (A69). lockPid: undefined = unknown, null = the lock named none. procsKnown: false where the
// machine's processes then cannot be reconstructed.
const INCIDENTS = [
  {
    lane: 'fluidninja-live2-upgrade',
    session: '10ab1488-abc4-4c42-b2dd-8a3346669973',
    since: at('2026-10-08T20:44:00'),
    end: at('2026-10-08T21:14:00'),
    now: at('2026-10-08T21:30:00'),
    lockPid: null, // MEASURED: the HELD line said pid=none
    procsKnown: true, // MEASURED: no Unreal process ran; build tools then were not recorded (taken as none)
    procs: [],
    liveness: 'unknown',
  },
  {
    lane: 'mc-dash-sprint-carry',
    session: '31f2f44b-ea9f-4e01-ac48-b40313f74be5',
    since: at('2026-10-07T15:49:00'),
    end: at('2026-10-07T17:15:00'),
    now: at('2026-10-07T17:25:00'),
    lockPid: null, // its hand-written HELD line carried no pid
    procsKnown: false,
    procs: [],
    liveness: 'unknown',
  },
  {
    lane: '1007-filler-section3',
    session: '18c625d6-c9d7-4281-b97d-99b3097293f5',
    since: at('2026-10-07T15:17:00'),
    end: at('2026-10-07T16:30:00'),
    now: at('2026-10-07T16:40:00'),
    lockPid: undefined,
    procsKnown: false,
    procs: [],
    liveness: 'unknown',
  },
]

/** The transcript as it was at `now`: every line whose timestamp is not later (lines without one ride with the last). */
const cutAt = (text, now) => {
  const keep = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let t = NaN
    try {
      t = Date.parse(JSON.parse(line).timestamp ?? '')
    } catch {
      continue
    }
    if (Number.isFinite(t) && t > now) break
    keep.push(line)
  }
  return keep.join('\n')
}

mkdirSync(OUT, { recursive: true })
for (const inc of INCIDENTS) {
  const transcript = `${RECORDS}/${inc.session}.jsonl`
  const cut = cutAt(readFileSync(transcript, 'utf8'), inc.now)
  const tail = cut.split('\n').slice(-200).join('\n') // what the live judge reads (transcriptTail: the last 200 lines)
  const events = parseTail(tail)
  // The holder's last turn, as its session file would have said it: its last own event in the transcript then.
  const lastTurnAt = [...parseTail(cut, 1_000_000)].reverse().find(e => (e.role === 'assistant' || e.role === 'user') && e.at !== null)?.at ?? null
  const facts = {
    now: inc.now,
    kind: 'editor',
    lane: inc.lane,
    id8: inc.session.slice(0, 8),
    session: inc.session,
    since: inc.since,
    end: inc.end,
    why: `the Editor lease ended ${hhmm(inc.end)} and is still held`,
    liveness: inc.liveness,
    lastTurnAt,
    agents: null, // unknown: the session files of then are gone
    procs: inc.procs,
    hasEditor: false,
    hasBuild: false,
    transcript,
    ...(inc.lockPid === undefined ? {} : { lockPid: inc.lockPid }),
    procsKnown: inc.procsKnown,
  }
  const hint = hintOf(facts, events)
  const task = judgePrompt(facts, hint, digestOf(events, 40, inc.now))
  const file = `${OUT}/judge-${inc.lane}.txt`
  writeFileSync(
    file,
    [
      `# A69 replay: ${inc.lane} (session ${inc.session}), lease ${hhmm(inc.since)}-${hhmm(inc.end)} local, judged at ${hhmm(inc.now)} local`,
      '# Agent type a5r:judge: tools Read, Grep; model haiku; maxTurns 6; omitClaudeMd; background (as register.ts registers it).',
      `# The rule's own first reading (hintOf): ${hint.verdict}`,
      '',
      '=== SYSTEM PROMPT (JUDGE_SYSTEM) ===',
      JUDGE_SYSTEM,
      '',
      '=== TASK (the spawn prompt, judgePrompt) ===',
      task,
      '',
    ].join('\n'),
  )
  console.log(`${file}: hint ${hint.verdict}; ${events.length} events in the tail; last turn ${lastTurnAt ? hhmm(lastTurnAt) : 'unknown'}`)
}
