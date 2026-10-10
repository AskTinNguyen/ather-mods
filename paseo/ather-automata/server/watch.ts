// Ather Automata, the silent half (watch.mjs), on Paseo's lifecycle events:
// - a permission request is where Ather holds an action while you are away, records the
//   session's questions in the ledger, and gates worker briefs (server/rules.ts makes Claude ask);
// - a finished turn's timeline is where proof, traps, merges and intent edits are read;
// - a 30-second tick keeps heartbeats and ends windows on time.

import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
type AgentTimelineItem = PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];
import { awayReason, isHolding } from "./ather/away.mjs";
import { briefIssues, explainGuard, heldShell, isMergeCommand, isSearchCommand, matchGotchas, mcpServer } from "./ather/guards.mjs";
import { andList } from "./ather/model.mjs";
import { intentChanges, intentFileOf, orchestrationFileOf } from "./ather/changes.mjs";
import * as state from "./ather/state.mjs";
import { currentMode, forgetAgent, isNonAsking, knownAgents, lastPersonAt, markAgentActive, note, noteAgent, onTurnStarted as markTurn, paseo, remember, send } from "./agents";
import { governedRoot } from "./agentConfig";
import { readText, run } from "./io";
import { branchesFor, ctxOf, heartbeat, isLaneAlive, isLaneGone, laneOf, type Ctx, type Pack } from "./lane";
import { heldPrefixes, isOurs } from "./rules";
import { settings } from "./settingsState";
import { hold, isMergeProven, sessionStartedAt } from "./tools";

type PermissionEvent = PluginLifecycleEvents["agent.permission_requested"];
type TurnEndedEvent = PluginLifecycleEvents["agent.turn_ended"];
type AgentEvent = { agent: PermissionEvent["agent"] };

// Traps already counted per agent: each counts once per session.
const seenTraps = new Map<string, Set<string>>();
// The tracked intent's files as they were when the turn started, to tell what an edit changed.
const before = new Map<string, Map<string, string>>();
// Follow-ups already sent per agent, so the same warning does not loop.
const told = new Map<string, Map<string, number>>();

async function governedCtx(event: AgentEvent): Promise<Ctx | null> {
  noteAgent(event.agent);
  // Any event for an agent is its latest activity, for its heartbeat.
  markAgentActive(event.agent.id);
  if (!(await governedRoot(event.agent.cwd))) return null;
  const ctx = ctxOf({ ...event.agent });
  sessionStartedAt(ctx.agent.id);
  return (await laneOf(ctx)).isS2 ? ctx : null;
}

function shellOf(request: PermissionEvent["request"]): string | null {
  const input = request.input as Record<string, unknown> | undefined;
  if (typeof input?.command === "string") return input.command;
  if (typeof input?.cmd === "string") return input.cmd;
  if (request.detail?.type === "shell") return request.detail.command;
  return null;
}

// ---------------------------------------------------------------- permission requests

export async function onPermission(event: PermissionEvent, context: PluginHookContext) {
  remember(context.paseo);
  const ctx = await governedCtx(event);
  if (!ctx) return;
  const { request } = event;
  const agent = context.paseo.agents.ref(event.agent.id);
  const respond = async (response: Parameters<typeof agent.respondToPermission>[0]["response"]) => {
    try {
      await agent.respondToPermission({ requestId: request.id, response });
    } catch (error) {
      // Answered by the person, or by another plugin, first.
      console.log(`[ather] ${event.agent.id}: request ${request.id} was already answered (${String(error)})`);
    }
  };
  const { pack } = await laneOf(ctx);
  const io = ctx.io as never;
  const input = (request.input ?? {}) as Record<string, unknown>;

  // From the start of an away window until its review, the session's questions go to the ledger instead of waiting.
  if (request.kind === "question") {
    const questions = Array.isArray(input.questions) ? (input.questions as { question: string; options?: { label: string }[] }[]) : [];
    if (questions.length === 0) return;
    const deferred = await state
      .deferQuestions(io, questions.map((one) => ({ question: String(one.question ?? ""), options: one.options ?? [] })), lastPersonAt(event.agent.id))
      .catch(() => null);
    if (!deferred) return;
    const { ids, away } = deferred as { ids: string[]; away: { phase: string; untilDone: boolean; wakeAt: number; ledgerPath: string } };
    void state.bump(io, "decisionsLedgered").catch(() => undefined);
    void note(event.agent.id, "info", `${ids.join(", ")} recorded for your review instead of waiting.`);
    await respond({
      behavior: "deny",
      message: `${awayReason(away, await state.readTz(io))} (Ather autonomy window). Do not wait. Take the recommended option for ${ids.join(", ")}, complete ${ids.length === 1 ? "its entry" : "their entries"} in ${away.ledgerPath} (Choice, Why, Evidence, Revert), and continue. Exception: if the question is about a destructive, production, credential, cost or CI-global action, do not take it; set the entry's Choice to "parked for the director" and move on to other work.`,
    });
    return;
  }

  // The worker brief gate: Claude asks before every Agent call because of Ather's rule.
  if (request.name === "Agent" || request.name === "Task") {
    const gate = settings().briefGate;
    if (gate === "off") return;
    const issues: string[] = briefIssues(String(input.prompt ?? ""), typeof input.subagent_type === "string" ? input.subagent_type : undefined, pack);
    const missing = andList(issues);
    const what = String(input.description ?? "worker");
    if (issues.length > 0 && gate === "enforce") {
      void note(event.agent.id, "warn", `Brief gate: refused the worker brief "${what}", missing ${missing}.`);
      await respond({ behavior: "deny", message: `Ather Automata brief gate: this worker brief is missing ${missing}. Add them (template: .agents/skills/intent/assets/worker-brief.md) and dispatch again.` });
      return;
    }
    if (issues.length > 0) {
      void note(event.agent.id, "warn", `Worker "${what}" was briefed without ${missing}. If it edits files or the Editor, message it the missing parts.`);
      void state.bump(io, "briefsFlagged").catch(() => undefined);
    }
    await respond({ behavior: "allow" });
    return;
  }

  const away = await state.readAway(io);

  // An Editor asset save through MCP while away. Ather only refuses here; other plugins answer the rest.
  if (request.name.startsWith("mcp__") && !request.name.startsWith("mcp__ather-automata__")) {
    if (isHolding(away) && pack.isAssetSave(JSON.stringify({ tool: request.name, ...input }).slice(0, 4000))) {
      const denied = await hold(ctx, "asset-save", `${request.name} ${JSON.stringify(input).slice(0, 300)}`).catch(() => null);
      if (denied) await respond({ behavior: "deny", message: denied });
    }
    return;
  }

  const command = shellOf(request);
  if (command === null) return;
  if (isHolding(away)) {
    const kind = heldShell(command, away.held, await branchesFor(ctx, command), pack, { isProven: await isMergeProven(ctx, pack) });
    if (kind) {
      const denied = await hold(ctx, kind, command).catch(() => null);
      if (denied) {
        await respond({ behavior: "deny", message: denied });
        return;
      }
    }
  }
  // Not held: a prompt that only Ather's ask rules raised is answered at once, so a bypass session keeps going.
  if (settings().holdRules && event.agent.provider.startsWith("claude") && isOurs(command, heldPrefixes(pack)) && isNonAsking(await currentMode(event.agent.id))) {
    await respond({ behavior: "allow" });
  }
}

// ---------------------------------------------------------------- turns

export async function onTurnStarted(event: PluginLifecycleEvents["agent.turn_started"], context: PluginHookContext) {
  remember(context.paseo);
  markTurn(event.agent.id);
  const ctx = await governedCtx(event);
  if (!ctx) return;
  // The tracked intent's files now, so an edit this turn can be told apart.
  const slug = await state.readPinned(ctx.io as never);
  const files = new Map<string, string>();
  if (slug) {
    const { root } = await laneOf(ctx);
    for (const name of ["prompt.md", "findings.md", "progress.md"]) files.set(`${slug}/${name}`, (await readText(`${root}/docs/intent/${slug}/${name}`)) ?? "");
  }
  before.set(event.agent.id, files);
}

// The items of the turn that just ended: everything after the last message that started it.
function thisTurn(timeline: readonly AgentTimelineItem[]) {
  let start = 0;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i]?.type === "user_message") {
      start = i + 1;
      break;
    }
  }
  return timeline.slice(start);
}

const outputOf = (item: { detail: unknown; error: unknown }) => {
  const detail = item.detail as { type: string; output?: unknown; content?: unknown };
  if (detail.type === "shell") return String(detail.output ?? "");
  if (detail.type === "unknown") return typeof detail.output === "string" ? detail.output : JSON.stringify(detail.output ?? "");
  return String(detail.content ?? "");
};

export async function onTurnEnded(event: TurnEndedEvent, context: PluginHookContext) {
  remember(context.paseo);
  const ctx = await governedCtx(event);
  if (!ctx) return;
  const agentId = event.agent.id;
  const io = ctx.io as never;
  const { root, pack } = await laneOf(ctx);
  const scope = await state.evidenceScope(io);
  const context_: string[] = [];
  const touched = new Set<string>();

  for (const item of thisTurn(event.timeline)) {
    if (item.type !== "tool_call" || (item.status !== "completed" && item.status !== "failed")) continue;
    const errorText = item.error ? String(typeof item.error === "string" ? item.error : JSON.stringify(item.error)) : "";
    // Ather refused it on purpose: nothing ran.
    if (/Held by the Ather away window|Ather Automata brief gate/.test(errorText)) continue;
    const detail = item.detail;
    try {
      if (detail.type === "shell") {
        const text = String(detail.output ?? "") || errorText;
        const isError = item.status === "failed" || (typeof detail.exitCode === "number" && detail.exitCode !== 0);
        context_.push(...(await afterShell(ctx, pack, detail.command, text, isError)));
      } else if (detail.type === "write" || detail.type === "edit") {
        // The agent's own orchestration writing an intent's prompt.md or log.md tracks it (never its
        // workers': their writes are in their own transcripts, not this timeline). Writing a new
        // prompt.md switches to that intent; an intent this agent stopped tracking stays untracked.
        const orchestrated = orchestrationFileOf(detail.filePath);
        if (orchestrated && item.status === "completed") {
          const isNewIntent = detail.type === "write" && orchestrated.file === "prompt.md";
          await state.track(io, root, orchestrated.slug, { isAuto: true, onlyIfNone: !isNewIntent }).catch(() => undefined);
        }
        const file = intentFileOf(detail.filePath);
        if (file) touched.add(`${file.slug}/${file.file}`);
      } else if (item.name.startsWith("mcp__") && !item.name.startsWith("mcp__ather-automata__")) {
        const input = JSON.stringify({ tool: item.name, ...((detail.type === "unknown" ? detail.input : {}) as object) }).slice(0, 4000);
        const kind = pack.mcpKind(input);
        if (kind) await state.noteMcp(io, scope, kind, mcpServer(item.name), item.status !== "failed");
        await noteTraps(ctx, pack, outputOf(item) || errorText);
      }
    } catch (error) {
      console.error(`[ather] ${agentId}: reading ${item.name} failed:`, error);
    }
  }

  // An edit to an intent's prompt, findings or progress: what it changed, read off the file before and after.
  const snapshot = before.get(agentId);
  for (const key of touched) {
    const [slug = "", name = ""] = key.split("/");
    const old = snapshot?.get(key);
    if (old === undefined) continue;
    const dir = `${root}/docs/intent/${slug}`;
    const after = (await readText(`${dir}/${name}`)) ?? "";
    const intent = name === "prompt.md" ? { progress: (await readText(`${dir}/progress.md`)) ?? "" } : { prompt: (await readText(`${dir}/prompt.md`)) ?? "" };
    await state.noteChanges(io, slug, intentChanges(name as never, old, after, intent), Date.now()).catch(() => undefined);
  }
  before.delete(agentId);

  await heartbeat(ctx, false).catch(() => undefined);

  // What the original added to a tool's result for the model: sent once as a follow-up.
  if (context_.length > 0 && settings().followUps && event.outcome.kind === "completed") {
    const seen = told.get(agentId) ?? new Map<string, number>();
    told.set(agentId, seen);
    const fresh = context_.filter((text) => Date.now() - (seen.get(text) ?? 0) > 30 * 60 * 1000);
    if (fresh.length > 0) {
      for (const text of fresh) seen.set(text, Date.now());
      await send(agentId, `Ather Automata, from this turn's tool output:\n${fresh.map((text) => `- ${text}`).join("\n")}`).catch((error) =>
        console.error(`[ather] ${agentId}: follow-up failed:`, error),
      );
    }
  }
}

async function afterShell(ctx: Ctx, pack: Pack, command: string, text: string, isError: boolean) {
  const io = ctx.io as never;
  const agentId = ctx.agent.id;
  const context: string[] = [];
  if (!isSearchCommand(command)) await noteTraps(ctx, pack, text);
  const guard = explainGuard(command);
  if (guard !== null && isError) void note(agentId, "warn", `Guard: ${guard}`);
  const reading = pack.readShell(command, text, { isError });
  const scope = await state.evidenceScope(io);
  for (const one of reading.rungs) await state.setRung(io, scope, one.rung, one.value, one.gates);
  context.push(...reading.context);
  for (const toast of reading.toasts) void note(agentId, "warn", String(toast.text).replace(/^Ather:\s*/, ""));
  for (const key of reading.bumps) void state.bump(io, key).catch(() => undefined);
  if (isMergeCommand(command) && !isError) {
    const lost = await auditMerge(ctx, pack).catch(() => [] as string[]);
    if (lost.length > 0) {
      await state.flagLost(io, lost);
      void state.bump(io, "lostWorkFlags").catch(() => undefined);
      void note(agentId, "bad", `The merge kept the other side of ${lost.length} binary asset(s); this branch's edits to them are gone: ${lost.join(", ")}`);
      context.push(
        `Ather Automata merge audit: these binary assets are byte-identical to the merged-in side, so every edit this branch made to them is gone: ${lost.join(", ")}. Tell the user now, itemised, and mark each as a lost optimisation or a broken feature.`,
      );
    }
  }
  return context;
}

async function noteTraps(ctx: Ctx, pack: Pack, text: string) {
  const seen = seenTraps.get(ctx.agent.id) ?? new Set<string>();
  seenTraps.set(ctx.agent.id, seen);
  const fresh = (matchGotchas(text, pack) as { id: string; title: string; fix: string }[]).filter((rule) => !seen.has(rule.id));
  if (fresh.length === 0) return;
  for (const rule of fresh) {
    seen.add(rule.id);
    void note(ctx.agent.id, "warn", `Known trap: ${rule.title}. ${rule.fix}`);
  }
  await state.countTraps(ctx.io as never, fresh);
}

// After a merge: binary assets byte-identical to the merged-in side lost this branch's edits.
async function auditMerge(ctx: Ctx, pack: Pack): Promise<string[]> {
  const { root } = await laneOf(ctx);
  const binary: RegExp | null = pack.binaryAssets;
  if (!binary) return [];
  const git = (args: string[]) => run(["git", "-C", root, ...args], { env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 30000 });
  const [, ours = "", theirs = ""] = (await git(["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(/\s+/);
  if (theirs === "") return [];
  const base = (await git(["merge-base", ours, theirs])).stdout.trim();
  if (base === "") return [];
  const touched = (await git(["diff", "--name-only", base, ours])).stdout
    .split(/\r?\n/)
    .filter((path) => binary.test(path))
    .slice(0, 300);
  if (touched.length === 0) return [];
  const blobs = async (rev: string) => {
    const map = new Map<string, string>();
    for (let i = 0; i < touched.length; i += 50) {
      for (const line of (await git(["ls-tree", rev, "--", ...touched.slice(i, i + 50)])).stdout.split(/\r?\n/)) {
        const match = /^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/.exec(line);
        if (match?.[1] && match[2]) map.set(match[2], match[1]);
      }
    }
    return map;
  };
  const [merged, mine, other] = await Promise.all([blobs("HEAD"), blobs(ours), blobs(theirs)]);
  return touched.filter((path) => merged.get(path) !== undefined && merged.get(path) === other.get(path) && merged.get(path) !== mine.get(path));
}

// ---------------------------------------------------------------- agents coming and going

// A new top-level agent picks up this person's window from an agent that has ended,
// so last night's holds and review are not lost.
export async function onCreated(event: PluginLifecycleEvents["agent.created"], context: PluginHookContext) {
  remember(context.paseo);
  const ctx = await governedCtx(event);
  if (!ctx) return;
  const { me, root } = await laneOf(ctx);
  const io = ctx.io as never;
  await state.migrateRole(io, me).catch(() => undefined);
  await heartbeat(ctx, false).catch(() => undefined);
  void state.prune(io, (sid: string) => isLaneGone(ctx, sid)).catch(() => undefined);
  if (event.agent.parentAgentId) return;
  const adopted = (await state.adoptWindow(io, { me, root, isAlive: (sid: string) => isLaneAlive(ctx, sid) }).catch(() => null)) as { isOver: boolean } | null;
  if (adopted)
    void note(
      event.agent.id,
      "info",
      adopted.isOver
        ? "Welcome back. Your away window has ended; merges stay held until you review it. Type /ather."
        : "Your away window from an earlier agent is still running. Type /ather to see it, or /away end.",
    );
  // The window came with its tracked intent: say so, and how to stop.
  if (adopted) {
    const slug = await state.readPinned(io).catch(() => null);
    if (slug) void note(event.agent.id, "info", `Still tracking ${slug} · /ather untrack`);
  }
}

export async function onGone(event: AgentEvent) {
  const ctx = await governedCtx(event).catch(() => null);
  if (ctx) await heartbeat(ctx, true).catch(() => undefined);
  seenTraps.delete(event.agent.id);
  before.delete(event.agent.id);
  told.delete(event.agent.id);
  forgetAgent(event.agent.id);
}

// Every 30 seconds: heartbeats, and the end of an autonomy window.
export async function tick() {
  const api = paseo();
  for (const agent of knownAgents()) {
    try {
      if (!(await governedRoot(agent.cwd))) continue;
      // Paseo 0.10 has no "closed" event: an agent that is gone stops its heartbeat here.
      const snapshot = api ? await api.agents.ref(agent.id).refresh().catch(() => null) : undefined;
      if (snapshot === null || (snapshot && (snapshot.agent.status === "closed" || snapshot.agent.archivedAt))) {
        await onGone({ agent: { ...agent, workspaceId: agent.workspaceId, parentAgentId: agent.parentAgentId } } as AgentEvent);
        continue;
      }
      const ctx = ctxOf(agent);
      if (!(await laneOf(ctx)).isS2) continue;
      await heartbeat(ctx, false);
      const away = await state.readAway(ctx.io as never);
      if (away.phase === "running" && Date.now() >= away.wakeAt && (await state.endAway(ctx.io as never)))
        void note(agent.id, "info", "The away window has ended; held actions stay held until you review it. Type /ather.");
    } catch (error) {
      console.error(`[ather] tick for ${agent.id} failed:`, error);
    }
  }
}

// The machine's offset from UTC in minutes, for clock times in the ledger and the pane.
export async function detectTz() {
  const offset = -new Date().getTimezoneOffset();
  const any = knownAgents()[0];
  const io = ctxOf(any ?? { id: "tz", cwd: process.cwd(), provider: "", workspaceId: null, parentAgentId: null, title: null }).io;
  await state.setTz(io as never, offset);
}
