// The worker squad (console.mjs crewOf), from Paseo: the Claude workers an agent dispatched, read
// from Claude Code's own transcripts (server/transcripts.ts), and the Paseo agents it started. Each
// gets the original kind, prop and trail from server/ather/squad.mjs; the app draws avatar, ring and motion.

import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

type AgentTimelineItem = PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];
import { KINDS, PROP_WORDS, classifyWorker, propForTool, workerState } from "./ather/squad.mjs";
import { knownAgents, paseo } from "./agents";
import { ART } from "./art.generated";
import { run } from "./io";
import { workersOf, type WorkerRecord } from "./transcripts";

export type Crew = {
  id: string;
  title: string;
  kind: string;
  kindWord: string;
  model: string;
  prop: string | null;
  propWord: string;
  state: "running" | "done" | "failed" | "waiting";
  props: string[];
  toolCalls: number;
  startedAt: number;
  endedAt: number;
  outcome: string;
  source: "worker" | "agent";
};

// Finished workers kept for the Done list (the panel shows three and folds the rest).
const DONE_KEPT = 8;
const CACHE_MS = 4000;
const cache = new Map<string, { at: number; crew: Crew[] }>();

type SubAgent = { type: "sub_agent"; subAgentType?: string; description?: string; log: string; actions?: { toolName: string }[] };

const kindWord = (kind: string) => (KINDS[kind as keyof typeof KINDS] ?? KINDS.general).word;
const propWord = (prop: string | null, state: Crew["state"]) =>
  prop && state === "running" ? PROP_WORDS[prop as keyof typeof PROP_WORDS] : state === "running" ? "starting" : state === "waiting" ? "quiet, possibly waiting on a prompt" : state === "done" ? "finished" : "stopped";

function fromRecord(one: WorkerRecord): Crew {
  return { ...one, kindWord: kindWord(one.kind), prop: one.state === "running" ? one.prop : null, propWord: propWord(one.prop, one.state), source: "worker" };
}

// Without a transcript (another provider, or one not written yet): what Paseo's timeline says.
function fromTimeline(item: { callId: string; status: string }, detail: SubAgent): Crew {
  const state = workerState(item.status) as Crew["state"];
  const props: string[] = [];
  for (const action of detail.actions ?? []) {
    const prop = propForTool(action.toolName, {}) as string | null;
    if (prop && props[props.length - 1] !== prop) props.push(prop);
  }
  const kind = classifyWorker({ subagentType: detail.subAgentType ?? "", prompt: detail.log.slice(0, 4000), description: detail.description ?? "" }) as string;
  const prop = state === "running" ? (props[props.length - 1] ?? null) : null;
  return { id: item.callId, title: detail.description || kindWord(kind), kind, kindWord: kindWord(kind), model: "", prop, propWord: propWord(prop, state), state, props: props.slice(-6), toolCalls: detail.actions?.length ?? 0, startedAt: 0, endedAt: 0, outcome: "", source: "worker" };
}

export async function crewOf(agentId: string): Promise<Crew[]> {
  const hit = cache.get(agentId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.crew;
  const api = paseo();
  const crew: Crew[] = [];
  if (api) {
    const snapshot = await api.agents.ref(agentId).refresh().catch(() => null);
    const agent = snapshot?.agent;
    const session = agent && String(agent.provider).startsWith("claude") ? agent.persistence?.sessionId : undefined;
    const records = agent && session ? await workersOf(agent.cwd, session).catch(() => []) : [];
    crew.push(...records.map(fromRecord));
    const known = new Set(records.map((one) => one.toolUseId).filter(Boolean));
    // Workers the transcripts do not have yet (just dispatched) or at all (other providers).
    const page = await api.agents
      .ref(agentId)
      .timeline.refetch({ direction: "tail", limit: 300, projection: "projected" })
      .catch(() => null);
    for (const entry of page?.entries ?? []) {
      const item = entry.item as AgentTimelineItem;
      if (item.type !== "tool_call" || item.detail.type !== "sub_agent" || known.has(item.callId)) continue;
      const detail = item.detail as SubAgent;
      // Only real worker dispatches, which carry a worker type or a description. Paseo files the
      // session's background shell tasks as sub-agents too (named Task, with only a [Bash] log),
      // and those can stay running after they end.
      if (!detail.subAgentType && !detail.description?.trim()) continue;
      // A dispatch whose transcript exists under another id is already listed.
      if (records.some((one) => one.title === detail.description)) continue;
      crew.push(fromTimeline(item, detail));
    }
    // Paseo agents this agent started (paseo run / create_agent from inside it).
    for (const child of knownAgents().filter((one) => one.parentAgentId === agentId)) {
      const childSnapshot = await api.agents.ref(child.id).refresh().catch(() => null);
      if (!childSnapshot || childSnapshot.agent.archivedAt) continue;
      const status = childSnapshot.agent.status === "running" ? "running" : childSnapshot.agent.status === "error" ? "failed" : childSnapshot.agent.status === "idle" ? "done" : "waiting";
      const kind = classifyWorker({ subagentType: "", prompt: "", description: child.title ?? "" }) as string;
      const created = Date.parse(childSnapshot.agent.createdAt) || 0;
      const updated = Date.parse(childSnapshot.agent.updatedAt) || 0;
      crew.push({ id: child.id, title: child.title || kindWord(kind), kind, kindWord: kindWord(kind), model: childSnapshot.agent.model ? (String(childSnapshot.agent.model).match(/opus|sonnet|haiku|fable/i)?.[0] ?? "") : "", prop: null, propWord: status === "running" ? "working" : propWord(null, status), state: status, props: [], toolCalls: 0, startedAt: created, endedAt: updated, outcome: "", source: "agent" });
    }
  }
  // Everyone still working, newest first, then the last few that finished.
  const live = crew.filter((one) => one.state === "running" || one.state === "waiting").sort((a, b) => b.startedAt - a.startedAt);
  const ended = crew.filter((one) => one.state === "done" || one.state === "failed").sort((a, b) => b.endedAt - a.endedAt).slice(0, DONE_KEPT);
  const shown = [...live, ...ended];
  cache.set(agentId, { at: Date.now(), crew: shown });
  return shown;
}

// ---------------------------------------------------------------- images

const PNG = "data:image/png;base64,";
const avatars = new Map<string, Promise<string | null>>();
let login: Promise<string> | null = null;

// The GitHub account gh is signed in as, read once.
export function githubLogin(): Promise<string> {
  if (!login) {
    login = run(["gh", "api", "user", "--jq", ".login"], { timeoutMs: 20000 }).then((r) => (r.exitCode === 0 ? r.stdout.trim() : ""));
    void login.then((name) => {
      if (!name) login = null;
    });
  }
  return login;
}

// A GitHub avatar, fetched by the daemon and kept for the plugin's lifetime, so phones and
// restrictive web views never load it from GitHub themselves.
function githubAvatar(name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(name)) return Promise.resolve(null);
  let hit = avatars.get(name);
  if (!hit) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    hit = fetch(`https://github.com/${name}.png?size=96`, { signal: abort.signal })
      .then(async (res) => (res.ok ? `data:${res.headers.get("content-type") ?? "image/png"};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}` : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    void hit.then((uri) => {
      if (uri === null) avatars.delete(name);
    });
    avatars.set(name, hit);
  }
  return hit;
}

// "logo:dark", "avatar:builder:editing", "prop:reading", "github:octocat" → a data URI.
export async function artFor(key: string): Promise<string | null> {
  const [kind, a = "", b = ""] = key.split(":");
  if (kind === "logo") return ART.logo[a === "light" ? "light" : "dark"] ? PNG + ART.logo[a === "light" ? "light" : "dark"] : null;
  if (kind === "avatar") {
    const art = ART.avatars[`${a}:${b || "none"}`] ?? ART.avatars[`${a}:none`] ?? ART.avatars["general:none"];
    return art ? PNG + art : null;
  }
  if (kind === "prop") return ART.props[a] ? PNG + ART.props[a] : null;
  if (kind === "github") return githubAvatar(a);
  return null;
}
