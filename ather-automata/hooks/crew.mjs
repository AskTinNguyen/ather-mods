// @ts-check
// Ather Automata: the session's workers as the pane lists them, newest first. Every worker Claude
// Code lists, those another worker started included (a fix round that dispatches its own fixers);
// what Claude Code says of each (status) beside what the watch half saw (kind, model, tool calls,
// the calls in flight). Then the tree the pane draws: each worker under the one that started it.
// Reads only, apart from adopting a worker that started before Ather loaded.

import { askingIn, callsIn, isInFlight, isSilent, longShell, waitWords } from './inflight.mjs'
import { isLive, kindOfAgent, modelWord, workerState } from './squad.mjs'
import { workerRecord } from './transcripts.mjs'
import { adoptWorker, workerElapsed, workerOf } from './workers.mjs'

/** @typedef {import('./transcripts.mjs').Host} Host */
/**
 * `parentId`: the worker that started it ('' for the main loop). `via`: who started it, as a row says it
 * when that worker is not drawn above it. `wait`, `stuck`: its amber lines (inflight.mjs waitWords), or ''.
 * @typedef {{ id: string, title: string, kind: import('./squad.mjs').Kind, model: string, state: import('./squad.mjs').WorkerState,
 *   prop: import('./squad.mjs').Prop | null, trail: import('./squad.mjs').Prop[], origin: import('./squad.mjs').Origin,
 *   elapsed: number | null, tools: number, via: string, parentId: string, wait: string, stuck: string }} Crew
 */
/**
 * What a pack offers the waiting line: its lock file, and the line it reads from it for a command that names it.
 * @typedef {{ lockFile?: string | null, lockLine?: (command: string, raw: string) => string }} CrewPack
 */

const IDLE_MS = 90000

/**
 * `root`, `pack`: the session's own checkout. `where`: the checkout a shell command runs in, when the session
 * works with several (without it, every command is the session's own checkout's).
 * @param {Host} host @param {string} root @param {string} session @param {CrewPack} [pack]
 * @param {(command: string) => Promise<{ root: string, pack: CrewPack }>} [where] @returns {Promise<Crew[]>}
 */
export async function crewOf(host, root, session, pack = {}, where = async () => ({ root, pack })) {
  const now = Date.now()
  const agents = await host.agents()
  /** @param {string} id */
  const titleOf = id => workerOf(id)?.title ?? agents.find(one => one.id === id)?.description ?? 'a worker'
  // A long shell call's lock line is read in the checkout the call runs in, with that checkout's pack: each
  // lock file once, and only when such a call is in flight and the pack reads a line from it.
  /** @type {Map<string, string | null>} */
  const lockFiles = new Map()
  /** @type {Map<string, string>} */
  const lockLines = new Map()
  for (const agent of agents) {
    const command = longShell(callsIn(agent.id), now)?.command
    if (!command || lockLines.has(command)) continue
    const at = await where(command)
    if (!at.pack.lockLine || !at.pack.lockFile) continue
    const path = `${at.root}/${at.pack.lockFile}`
    if (!lockFiles.has(path)) lockFiles.set(path, await host.read(path))
    const raw = lockFiles.get(path) ?? null
    if (raw !== null) lockLines.set(command, at.pack.lockLine(command, raw))
  }
  /** @param {string} command */
  const lockOf = command => lockLines.get(command) ?? ''
  /** @type {Crew[]} */
  const crew = []
  for (const agent of agents) {
    const seen = workerOf(agent.id) ?? (await adopt(host, root, session, agent, now))
    const state = workerState(agent.status)
    const isLiveNow = isLive(state)
    // Quiet is computed silence only: a call waiting on permission says so in its ⏳ line instead.
    const isIdle = state === 'running' && seen !== undefined && askingIn(agent.id).length === 0 && isSilent({ isInFlight: isInFlight(agent.id), lastAt: seen.lastAt, now, quietMs: IDLE_MS })
    const parent = agent.parentId ? agents.find(one => one.id === agent.parentId) : undefined
    // A worker found later with no call seen has no in-flight facts: nothing is said rather than something wrong.
    const hasHistory = seen !== undefined && (seen.origin === 'seen' || seen.tools > 0)
    const words = isLiveNow && hasHistory ? waitWords(callsIn(agent.id), now, titleOf, lockOf) : { wait: '', stuck: '' }
    crew.push({
      id: agent.id,
      title: seen?.title ?? agent.description,
      kind: seen?.kind ?? kindOfAgent(agent.type, agent.description),
      model: modelWord(seen?.model ?? ''),
      state,
      prop: isIdle ? 'idle' : state === 'running' ? (seen?.prop ?? null) : (seen?.trail.at(-1) ?? null),
      trail: seen?.trail ?? [],
      origin: seen?.origin ?? 'unknown',
      elapsed: seen ? workerElapsed(seen, isLiveNow, now) : null,
      tools: seen?.tools ?? 0,
      via: agent.parentId ? (parent ? `${titleOf(parent.id)}${isLive(workerState(parent.status)) ? '' : ' (finished)'}` : 'another worker') : '',
      parentId: agent.parentId ?? '',
      wait: words.wait,
      stuck: words.stuck,
    })
  }
  return crew.reverse()
}

// A worker Ather did not see start: adopted from Claude Code's record of it, when there is one.
/** @param {Host} host @param {string} root @param {string} session @param {import('claude-code').AgentInfo} agent @param {number} now */
async function adopt(host, root, session, agent, now) {
  const found = await workerRecord(host, root, session, agent.id)
  if (found) adoptWorker({ id: agent.id, type: agent.type, description: agent.description, model: found.model, startedAt: found.startedAt, now })
  return workerOf(agent.id)
}

// ---------------------------------------------------------------- the tree the pane draws

/**
 * One line of the workers list: a worker at its depth (`via` cleared when the one that started it is drawn
 * right above), or a parent's finished workers past the first few, folded into "+N finished".
 * @typedef {{ kind: 'worker', one: Crew, depth: number } | { kind: 'fold', key: string, depth: number, count: number }} CrewLine
 */

/**
 * The workers as two lists of lines: the live ones (running or queued), each with the workers it started
 * beneath it, then the last few finished ones with theirs. A parent's finished workers past `fold` fold
 * to "+N finished"; a worker whose parent is not drawn above it is a root and keeps "started by".
 * @param {readonly Crew[]} crew newest first @param {{ doneShown?: number, fold?: number }} [limits]
 * @returns {{ live: CrewLine[], done: CrewLine[], running: number, queued: number, waitingOn: number }}
 */
export const crewTree = (crew, { doneShown = 3, fold = 3 } = {}) => {
  /** @param {string} id */
  const childrenOf = id => crew.filter(one => one.parentId === id)
  /** @type {Set<string>} drawn, or counted in a fold */
  const placed = new Set()
  /** @param {Crew} one @param {number} depth @param {boolean} isUnder @param {CrewLine[]} out */
  const draw = (one, depth, isUnder, out) => {
    if (placed.has(one.id)) return
    placed.add(one.id)
    out.push({ kind: 'worker', one: isUnder ? { ...one, via: '' } : one, depth })
    const kids = childrenOf(one.id).filter(kid => !placed.has(kid.id))
    const done = kids.filter(kid => !isLive(kid.state))
    for (const kid of kids.filter(each => isLive(each.state))) draw(kid, depth + 1, true, out)
    for (const kid of done.slice(0, fold)) draw(kid, depth + 1, true, out)
    const folded = done.slice(fold)
    for (const kid of folded) placed.add(kid.id)
    if (folded.length > 0) out.push({ kind: 'fold', key: `${one.id}-finished`, depth: depth + 1, count: folded.length })
  }
  // The topmost live worker in a live worker's line of parents (a cycle is cut).
  /** @param {Crew} one */
  const topLive = one => {
    let top = one
    const visited = new Set([one.id])
    for (let up = crew.find(each => each.id === one.parentId); up && !visited.has(up.id); up = crew.find(each => each.id === up?.parentId)) {
      visited.add(up.id)
      if (isLive(up.state)) top = up
    }
    return top
  }
  /** @type {CrewLine[]} */
  const live = []
  for (const one of crew.filter(each => isLive(each.state))) {
    draw(topLive(one), 0, false, live)
    // Folded away under a finished worker drawn in the tree: it is live, so it is drawn as a root.
    draw(one, 0, false, live)
  }
  /** @type {CrewLine[]} */
  const done = []
  const rest = crew.filter(one => !placed.has(one.id))
  for (const one of rest.filter(each => !rest.some(other => other.id === each.parentId)).slice(0, doneShown)) draw(one, 0, false, done)
  return {
    live,
    done,
    running: crew.filter(one => one.state === 'running').length,
    queued: crew.filter(one => one.state === 'waiting').length,
    waitingOn: crew.filter(one => one.wait !== '').length,
  }
}

// "Workers · Running 2 · Waiting on 1": waiting on, the workers with a ⏳ line; queued and waiting on only when some are.
/** @param {{ running: number, queued: number, waitingOn: number }} counts */
export const crewHeading = ({ running, queued, waitingOn }) => ['Workers', `Running ${running}`, ...(queued > 0 ? [`Queued ${queued}`] : []), ...(waitingOn > 0 ? [`Waiting on ${waitingOn}`] : [])].join(' · ')
