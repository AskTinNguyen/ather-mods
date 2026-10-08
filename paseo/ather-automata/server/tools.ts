// The model's tools (status, away, profile) and held actions, as watch.mjs had them.
// The tools reach the agent through the MCP bridge (server/bridge.ts).

import { clampHours, windowEndText } from "./ather/away.mjs";
import { HELD_LABELS, HELD_NOUNS, heldKindsOf } from "./ather/guards.mjs";
import { STAGE_LABELS, currentStage, directorCalls, prStatusList } from "./ather/model.mjs";
import { untrackText } from "./ather/home.mjs";
import * as state from "./ather/state.mjs";
import { note } from "./agents";
import { readText } from "./io";
import { laneOf, laneText, peers, readIntent, readLock, type Ctx, type Pack } from "./lane";

// When Ather first saw each agent in this plugin run: a with-proof merge counts only proof seen since
// ("passed in tool output this session"). A plugin reload starts it again, which only makes the rule stricter.
const startedAt = new Map<string, number>();
export const sessionStartedAt = (agentId: string) => {
  if (!startedAt.has(agentId)) startedAt.set(agentId, Date.now());
  return startedAt.get(agentId) ?? Date.now();
};

// A held action, parked for the person's review; null when no window holds it.
export async function hold(ctx: Ctx, kind: string, command: string) {
  const held = await state.park(ctx.io as never, kind, command, Date.now());
  if (held === null) return null;
  void state.bump(ctx.io as never, "heldParked").catch(() => undefined);
  const id = (held as { parked: { id: string } }).parked.id;
  void note(ctx.agent.id, "warn", `Held ${HELD_NOUNS[kind as keyof typeof HELD_NOUNS] ?? kind} until you review the away window (${id}): ${command.slice(0, 200)}`);
  return `Held by the Ather away window until the user reviews it: ${HELD_LABELS[kind as keyof typeof HELD_LABELS] ?? kind}. Recorded as ${id}. Do not retry it; continue with other work.`;
}

// With-proof merges (D2): every rung the profile requires passed in tool output in this session.
export async function isMergeProven(ctx: Ctx, pack: Pack) {
  if (pack.mergePolicy !== "with-proof") return false;
  const io = ctx.io as never;
  const evidence = (await state.readEvidence(io, await state.evidenceScope(io), pack)) as Record<string, { state: string; at?: number }>;
  const rungs: string[] = pack.mergeRungs ?? [];
  const since = sessionStartedAt(ctx.agent.id);
  return rungs.length > 0 && rungs.every((rung) => evidence[rung]?.state === "pass" && (evidence[rung]?.at ?? 0) >= since);
}

export async function awayTool(ctx: Ctx, input: Record<string, unknown>) {
  const io = ctx.io as never;
  const action = String(input.action ?? "");
  const tz = await state.readTz(io);
  if (action === "start") {
    const { root, me, pack } = await laneOf(ctx);
    const held = Array.isArray(input.held) ? (heldKindsOf(pack) as string[]).filter((kind) => (input.held as unknown[]).includes(kind)) : undefined;
    const choice = { hours: clampHours(Number(input.hours) || 8), untilDone: input.untilDone === true, goal: typeof input.goal === "string" ? input.goal.trim() : "", held };
    const started = await state.startAway(io, choice as never, { root, me, tz, now: Date.now(), pack });
    if (started === null) return "An away window is already running or waiting for the user's review.";
    void note(ctx.agent.id, "info", `Away window running ${windowEndText(started, tz)}.`);
    return `Autonomy window open ${windowEndText(started, tz)}. Allowed without asking: ${pack.mandate.allowed}. Ledger: ${started.ledgerPath}. Held: ${started.held.map((kind: string) => HELD_LABELS[kind as keyof typeof HELD_LABELS] ?? kind).join(", ")}. Questions to the user are now recorded in the ledger instead of asked.\n\n${await laneText(ctx)}`;
  }
  if (action === "end") return (await state.endAway(io)) ? "Autonomy window ended; the user reviews it with /ather." : "No autonomy window is running.";
  if (action === "close") return (await state.closeAway(io)) ? "Autonomy window closed." : "No autonomy window to close.";
  return "Unknown action: use start, end or close.";
}

export async function profileTool(ctx: Ctx, input: Record<string, unknown>) {
  const io = ctx.io as never;
  const { root, me, pack } = await laneOf(ctx);
  const done: string[] = [];
  const role = input.role === undefined ? undefined : String(input.role).toLowerCase();
  if (role !== undefined && !pack.roles.includes(role)) return `Unknown role "${role}": use ${pack.roles.join(", ")}.`;
  const area = input.area === undefined ? undefined : pack.normalizeArea(String(input.area));
  if (area === "Unsorted") return `Unknown area "${String(input.area)}": use one of ${pack.areas.join(", ")}.`;
  if (role !== undefined || area !== undefined) {
    await state.setProfile(io, me, { role, area }, pack);
    done.push([role ? `Role set to ${role}.` : "", area ? `Area set to ${area}.` : ""].filter(Boolean).join(" "));
  }
  if (typeof input.track === "string" && input.track.trim().toLowerCase() === "none") {
    done.push(untrackText(await state.untrack(io, me)));
  } else if (typeof input.track === "string" && input.track.trim() !== "") {
    const slug = input.track.trim();
    if (!(await state.track(io, root, slug))) return `No intent named "${slug}" in docs/intent.`;
    done.push(`This session now tracks intent ${slug}.`);
  }
  return done.join(" ") || "Nothing to change: pass role, area or track.";
}

export async function statusText(ctx: Ctx) {
  const io = ctx.io as never;
  const { root, me, pack, isS2 } = await laneOf(ctx);
  if (!isS2) return JSON.stringify({ here: false, why: pack.notHere }, null, 1);
  const slug = await state.readPinned(io);
  const intent = slug ? await readIntent(ctx, slug) : undefined;
  const { role, area } = await state.readProfile(io, me, pack);
  const evidence = await state.readEvidence(io, await state.evidenceScope(io), pack);
  const away = await state.readAway(io);
  const tz = await state.readTz(io);
  const prs = await state.readPrStates(io);
  return JSON.stringify(
    {
      me,
      role,
      area,
      tracked: intent
        ? {
            slug: intent.slug,
            status: intent.status,
            stage: STAGE_LABELS[currentStage(intent, evidence, role || "engineer", prs, pack) as keyof typeof STAGE_LABELS],
            checklist: `${intent.acceptanceDone}/${intent.acceptanceTotal}`,
            prs: prStatusList(intent, prs),
            directorCalls: directorCalls(intent).map((one: { id: string; title: string }) => `${one.id}: ${one.title}`),
          }
        : null,
      evidence,
      ...(pack.lockFile ? { editorLock: (await readLock(ctx)).raw || (await readText(`${root}/${pack.lockFile}`)) } : {}),
      ...(pack.id === "unreal" ? {} : { pack: pack.id, gates: pack.gates.map((gate: { command: string; proofs: string[] }) => `${gate.command}: ${gate.proofs.join(", ")}`), mergePolicy: pack.mergePolicy }),
      peers: (await peers(ctx)).map((lane) => `${lane.intent ?? "no intent"} on ${lane.branch}`),
      away: { phase: away.phase, until: away.phase === "off" ? "" : windowEndText(away, tz), ledger: away.ledgerPath, parked: away.parked.map((one: { id: string; command: string }) => `${one.id}: ${one.command}`) },
      recurringGotchas: (await state.readRecurring(io, pack)).map((one: { title: string; count: number }) => `${one.title} (${one.count} sessions)`),
      caught: await state.readScore(io),
      lane: await laneText(ctx),
    },
    null,
    1,
  );
}

// The tools, as MCP describes them; the away tool's held kinds follow the checkout's pack.
export function toolList(pack: Pack) {
  return [
    {
      name: "status",
      description: `Ather Automata: read the live state of ${pack.statusWhat} as JSON: tracked intent, its stage (Plan, Build, Prove, Ship), director calls, evidence read from tool output, ${pack.lockFile ? "Editor owner lock" : "the gates the profile names"}, peer lanes, autonomy window (with its mandate while one runs), recurring traps. Read-only. Call it when you start work in this checkout and before any merge.`,
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "away",
      description:
        'Ather Automata: open, end or close an autonomy window. Open one (action "start") only when the user has said in their own words that they are going away and granting autonomy, for example "I am going to sleep for 8 hours, you have full autonomy". While it runs, questions to the user are written to a decision ledger instead of asked, and held actions are refused and parked for the user\'s review. "end" finishes it early; "close" closes the review.',
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "end", "close"] },
          hours: { type: "number", description: "Window length in hours (0.25 to 16). Default 8. Ignored with untilDone." },
          untilDone: { type: "boolean", description: 'No fixed end: the window runs until the goal is done (call this tool with action "end" then), capped at 24 hours.' },
          goal: { type: "string", description: "What to pursue while the user is away, in their words." },
          held: { type: "array", items: { type: "string", enum: heldKindsOf(pack) }, description: `Actions to refuse and park. Default: ${pack.held.defaults.join(", ")}.` },
        },
        required: ["action"],
      },
    },
    {
      name: "profile",
      description:
        "Ather Automata: record the user's role and area when they state them, and which intent this session tracks when they choose one, for example during the Ather tour. The role shapes the next step Ather suggests and what Prove asks for; the area orders the intents Ather offers.",
      inputSchema: {
        type: "object",
        properties: {
          role: { type: "string", enum: [...pack.roles] },
          ...(pack.areas.length > 0 ? { area: { type: "string", enum: [...pack.areas] } } : { area: { type: "string" } }),
          track: { type: "string", description: 'The folder name of an intent under docs/intent for this session to track, or "none" to stop tracking.' },
        },
      },
    },
  ];
}

export async function callTool(ctx: Ctx, name: string, input: Record<string, unknown>) {
  if (name === "status") return statusText(ctx);
  if (name === "away") return awayTool(ctx, input);
  if (name === "profile") return profileTool(ctx, input);
  throw new Error(`Unknown tool ${name}`);
}
