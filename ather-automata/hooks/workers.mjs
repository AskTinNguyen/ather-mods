// @ts-check
// Ather Automata: the background workers this session dispatched, as the watch half sees them
// (spawned with this brief and model, called these tools) for the console half to draw. Held in
// memory for the session: workers do not outlive it. Pure: no `$`.

import { classifyWorker, propForTool } from './squad.mjs'

/** @typedef {import('./squad.mjs').Kind} Kind */
/** @typedef {import('./squad.mjs').Prop} Prop */
/**
 * @typedef {{ id: string, title: string, kind: Kind, model: string, startedAt: number, lastAt: number,
 *   tools: number, prop: Prop | null, trail: Prop[], endedAt?: number }} Worker
 */

/** @type {Map<string, Worker>} */
const known = new Map()
const MOST = 40
const TRAIL = 6

export const resetWorkers = () => known.clear()

// The kind is fixed here, from the dispatch: a worker never changes body while it runs.
/** @param {{ agentId: string, subagentType: string, prompt: string, description: string, model: string, at: number }} spawn */
export const recordSpawn = spawn => {
  known.set(spawn.agentId, {
    id: spawn.agentId,
    title: spawn.description || spawn.subagentType,
    kind: classifyWorker(spawn),
    model: spawn.model,
    startedAt: spawn.at,
    lastAt: spawn.at,
    tools: 0,
    prop: null,
    trail: [],
  })
  // A long session keeps the most recent workers only.
  while (known.size > MOST) known.delete(/** @type {string} */ (known.keys().next().value))
}

// One tool call inside a worker's loop: what it is doing now, and the step in its trail.
/** @param {string} agentId @param {string} tool @param {Record<string, unknown>} input @param {number} at */
export const recordTool = (agentId, tool, input, at) => {
  const worker = known.get(agentId)
  if (!worker) return
  worker.tools += 1
  worker.lastAt = at
  const prop = propForTool(tool, input)
  if (!prop) return
  worker.prop = prop
  if (prop !== 'idle' && worker.trail.at(-1) !== prop) worker.trail = [...worker.trail, prop].slice(-TRAIL)
}

// The first time a worker is seen finished: when it ended, for "took 6:40".
/** @param {string} agentId @param {number} at */
export const recordEnd = (agentId, at) => {
  const worker = known.get(agentId)
  if (worker && worker.endedAt === undefined) worker.endedAt = at
}

/** @param {string} agentId */
export const workerOf = agentId => known.get(agentId)
