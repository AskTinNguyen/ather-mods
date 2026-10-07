// Ather Automata: the session's workers as the pane lists them, newest first. Every worker Claude
// Code lists, those another worker started included (a fix round that dispatches its own fixers);
// what Claude Code says of each (status) beside what the watch half saw (kind, model, tool calls).
// Reads only, apart from adopting a worker that started before Ather loaded.

import { kindOfAgent, modelWord, workerState } from './squad.mjs'
import { workerRecord } from './transcripts.mjs'
import { adoptWorker, workerElapsed, workerOf } from './workers.mjs'

/** @typedef {import('./transcripts.mjs').Host} Host */
/**
 * @typedef {{ id: string, title: string, kind: import('./squad.mjs').Kind, model: string, state: import('./squad.mjs').WorkerState,
 *   prop: import('./squad.mjs').Prop | null, trail: import('./squad.mjs').Prop[], origin: import('./squad.mjs').Origin,
 *   elapsed: number | null, tools: number, via: string }} Crew
 */

const IDLE_MS = 90000

/** @param {Host} host @param {string} root @param {string} session @returns {Promise<Crew[]>} */
export async function crewOf(host, root, session) {
  const now = Date.now()
  const agents = await host.agents()
  /** @param {import('claude-code').AgentInfo} agent */
  const titleOf = agent => workerOf(agent.id)?.title ?? agent.description
  /** @type {Crew[]} */
  const crew = []
  for (const agent of agents) {
    const seen = workerOf(agent.id) ?? (await adopt(host, root, session, agent, now))
    const state = workerState(agent.status)
    const isLive = state === 'running' || state === 'waiting'
    const isIdle = state === 'running' && seen !== undefined && now - seen.lastAt > IDLE_MS
    const parent = agent.parentId ? agents.find(one => one.id === agent.parentId) : undefined
    crew.push({
      id: agent.id,
      title: seen?.title ?? agent.description,
      kind: seen?.kind ?? kindOfAgent(agent.type, agent.description),
      model: modelWord(seen?.model ?? ''),
      state,
      prop: isIdle ? 'idle' : state === 'running' ? (seen?.prop ?? null) : (seen?.trail.at(-1) ?? null),
      trail: seen?.trail ?? [],
      origin: seen?.origin ?? 'unknown',
      elapsed: seen ? workerElapsed(seen, isLive, now) : null,
      tools: seen?.tools ?? 0,
      via: agent.parentId ? (parent ? titleOf(parent) : 'another worker') : '',
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
