import type { PaseoApi } from "@getpaseo/client";
import type { PluginHookAgent } from "@getpaseo/plugin/server";
import { NOTE_KIND, NOTE_VERSION, type Note } from "../shared/timeline";

// The agents Ather has seen, and the Paseo API to reach them. Every hook and RPC
// context hands over a PaseoApi; the latest is kept for the timers.

export type AgentInfo = {
  id: string;
  cwd: string;
  provider: string;
  workspaceId: string | null;
  parentAgentId: string | null;
  title: string | null;
};

let api: PaseoApi | null = null;
const known = new Map<string, AgentInfo>();
// Prompts Ather itself sent: the turn they start is not the person typing.
const ownSends = new Map<string, number>();
// When the person last started a turn, per agent (the original's lastPersonAt).
const personAt = new Map<string, number>();
// When each agent last took a prompt or ran a tool: its heartbeat's lastActiveAt.
const activeAt = new Map<string, number>();

export function markAgentActive(agentId: string) {
  activeAt.set(agentId, Date.now());
}

export function lastActiveOf(agentId: string) {
  return activeAt.get(agentId) ?? Date.now();
}

export function remember(paseo: PaseoApi) {
  api = paseo;
}

export function paseo(): PaseoApi | null {
  return api;
}

export function noteAgent(agent: PluginHookAgent) {
  known.set(agent.id, {
    id: agent.id,
    cwd: agent.cwd,
    provider: agent.provider,
    workspaceId: agent.workspaceId,
    parentAgentId: agent.parentAgentId,
    title: agent.title,
  });
}

export function forgetAgent(agentId: string) {
  known.delete(agentId);
  ownSends.delete(agentId);
  personAt.delete(agentId);
  activeAt.delete(agentId);
}

export function knownAgents(): AgentInfo[] {
  return [...known.values()];
}

// An agent by id, asking the daemon when it has not been seen since the plugin started.
export async function agentInfo(agentId: string): Promise<AgentInfo | null> {
  const hit = known.get(agentId);
  if (hit) return hit;
  const snapshot = await api?.agents.ref(agentId).refresh().catch(() => null);
  if (!snapshot) return null;
  const { agent } = snapshot;
  const info: AgentInfo = {
    id: agent.id,
    cwd: agent.cwd,
    provider: String(agent.provider),
    workspaceId: (agent as { workspaceId?: string | null }).workspaceId ?? null,
    parentAgentId: (agent as { parentAgentId?: string | null }).parentAgentId ?? null,
    title: agent.title,
  };
  known.set(agentId, info);
  return info;
}

// The agent's permission mode now: Ather answers its own ask rules only where nobody else would be asked.
export async function currentMode(agentId: string): Promise<string | null> {
  const snapshot = await api?.agents.ref(agentId).refresh().catch(() => null);
  return snapshot?.agent.currentModeId ?? null;
}

// Modes where Claude does not ask on its own: our ask rules are the only reason it asked.
export function isNonAsking(mode: string | null) {
  return mode !== null && /bypass|auto|yolo|full|dangerous/i.test(mode);
}

export async function send(agentId: string, text: string) {
  if (!api) throw new Error("Paseo is not connected to the Ather plugin yet.");
  ownSends.set(agentId, Date.now());
  await api.agents.ref(agentId).send(text);
}

export function onTurnStarted(agentId: string) {
  const own = ownSends.get(agentId) ?? 0;
  if (Date.now() - own > 15000) personAt.set(agentId, Date.now());
}

export function lastPersonAt(agentId: string) {
  return personAt.get(agentId) ?? 0;
}

let noteSeq = 0;

// A pop-up: a row in the agent's timeline.
export async function note(agentId: string, tone: Note["tone"], text: string) {
  if (!api) return;
  noteSeq += 1;
  try {
    await api.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: `note-${Date.now()}-${noteSeq}`,
      kind: NOTE_KIND,
      version: NOTE_VERSION,
      data: { tone, text: text.slice(0, 4000) },
    });
  } catch (error) {
    console.error(`[ather] note to ${agentId} failed:`, error);
  }
}
