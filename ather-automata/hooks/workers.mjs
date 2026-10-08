// @ts-check
// Ather Automata: the background workers this session dispatched, as the watch half sees them
// (spawned with this brief and model, called these tools) for the console half to draw. Held in
// memory for the session: workers do not outlive it. Pure: no `$`.

import { classifyWorker, kindOfAgent, propForTool } from './squad.mjs'

/** @typedef {import('./squad.mjs').Kind} Kind */
/** @typedef {import('./squad.mjs').Prop} Prop */
/**
 * `origin`: 'seen' when Ather saw it dispatched (its tool calls are all counted), 'adopted' when it
 * was found running after Ather loaded (start and model from Claude Code's record; calls before then uncounted).
 * `endedAt`: when its latest turn ended; a worker resumed afterwards is running again by its status.
 * `lastAt`, `lastTool`: when it was last heard from (a call's start or end) and its latest call: the one clock
 * the pane and the quiet-worker toast read.
 * @typedef {{ id: string, title: string, kind: Kind, model: string, origin: Exclude<import('./squad.mjs').Origin, 'unknown'>, startedAt: number, lastAt: number,
 *   tools: number, lastTool: string, prop: Prop | null, trail: Prop[], endedAt?: number }} Worker
 */

/** @type {Map<string, Worker>} */
const known = new Map()
const MOST = 40
const TRAIL = 6

export const resetWorkers = () => known.clear()

/** @param {Worker} worker */
const remember = worker => {
  known.set(worker.id, worker)
  // A long session keeps the most recent workers only.
  while (known.size > MOST) known.delete(/** @type {string} */ (known.keys().next().value))
}

// The kind is fixed here, from the dispatch: a worker never changes body while it runs.
/** @param {{ agentId: string, subagentType: string, prompt: string, description: string, model: string, at: number }} spawn */
export const recordSpawn = spawn =>
  remember({ id: spawn.agentId, title: spawn.description || spawn.subagentType, kind: classifyWorker(spawn), model: spawn.model, origin: 'seen', startedAt: spawn.at, lastAt: spawn.at, tools: 0, lastTool: '', prop: null, trail: [] })

// A worker found running after Ather loaded: its kind from its description, its start from
// Claude Code's record. Nothing seen of it yet is not idleness, so it was last heard from now.
/** @param {{ id: string, type: string, description: string, model: string, startedAt: number, now: number }} found */
export const adoptWorker = found =>
  remember({ id: found.id, title: found.description || found.type, kind: kindOfAgent(found.type, found.description), model: found.model, origin: 'adopted', startedAt: found.startedAt, lastAt: found.now, tools: 0, lastTool: '', prop: null, trail: [] })

// One tool call inside a worker's loop: what it is doing now, and the step in its trail.
/** @param {string} agentId @param {string} tool @param {Record<string, unknown>} input @param {number} at */
export const recordTool = (agentId, tool, input, at) => {
  const worker = known.get(agentId)
  if (!worker) return
  worker.tools += 1
  worker.lastAt = at
  worker.lastTool = tool
  const prop = propForTool(tool, input)
  if (!prop) return
  worker.prop = prop
  // The trail is the work done: a question to the person is not a step of it.
  if (prop !== 'idle' && prop !== 'asking' && worker.trail.at(-1) !== prop) worker.trail = [...worker.trail, prop].slice(-TRAIL)
}

// One of its calls settled (it ran, was refused or threw): heard from now, so a long call's end
// starts the quiet clock, not its start.
/** @param {string} agentId @param {number} at */
export const recordHeard = (agentId, at) => {
  const worker = known.get(agentId)
  if (worker) worker.lastAt = Math.max(worker.lastAt, at)
}

// A worker's turn ended (its answer): the end of its clock, until it is resumed.
/** @param {string} agentId @param {number} at */
export const recordEnd = (agentId, at) => {
  const worker = known.get(agentId)
  if (worker) worker.endedAt = at
}

// How long it has run: to now while it runs, to its last turn's end once finished; null for one
// that finished without Ather seeing its turn end (before Ather loaded): its time is not known.
/** @param {Worker} worker @param {boolean} isLive @param {number} now @returns {number | null} */
export const workerElapsed = (worker, isLive, now) =>
  isLive ? now - worker.startedAt : worker.endedAt === undefined ? null : worker.endedAt - worker.startedAt

/** @param {string} agentId */
export const workerOf = agentId => known.get(agentId)
