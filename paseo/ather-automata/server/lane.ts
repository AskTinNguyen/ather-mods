// What watch.mjs read about a lane, with an agent in place of the Claude Code session:
// its checkout, intents, branches, heartbeat and peers. Shared by the watch, the tools and the console.

import { gitFolders } from "./ather/guards.mjs";
import { STAGE_LABELS, currentStage, directorCalls, localMinutes, parseIntent, prStatusList } from "./ather/model.mjs";
import { isHolding, mandateText } from "./ather/away.mjs";
import { heldByLine } from "./ather/home.mjs";
import * as state from "./ather/state.mjs";
import { ioFor, list, readText, type Io } from "./io";
import { lastActiveOf, type AgentInfo } from "./agents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Pack = any;
export type Lane = { root: string; isS2: boolean; me: string; pack: Pack };

export type Ctx = { agent: AgentInfo; io: Io };

export function ctxOf(agent: AgentInfo): Ctx {
  return { agent, io: ioFor(agent.id, agent.cwd) };
}

export function laneOf(ctx: Ctx): Promise<Lane> {
  return state.lane(ctx.io as never, ctx.agent.cwd) as Promise<Lane>;
}

export async function readIntent(ctx: Ctx, slug: string) {
  const { root, pack } = await laneOf(ctx);
  const dir = `${root}/docs/intent/${slug}`;
  const prompt = await readText(`${dir}/prompt.md`);
  if (prompt === null) return undefined;
  return parseIntent(
    {
      slug,
      prompt,
      findings: (await readText(`${dir}/findings.md`)) ?? "",
      progress: (await readText(`${dir}/progress.md`)) ?? "",
      files: (await list(dir).catch(() => [])).map((entry) => entry.name),
      hasDebrief: await ctx.io.exists(`${root}/${pack.debriefPath(slug)}`),
      updatedAt: 0,
      source: "local",
      firstAuthor: "",
    },
    pack,
  );
}

// The branch checked out in a folder (null: the agent's checkout); '' when it cannot be told.
export async function readBranch(ctx: Ctx, folder: string | null = null) {
  const { root } = await laneOf(ctx);
  const base = folder === null ? root : /^([A-Za-z]:[\\/]|[\\/])/.test(folder) ? folder : `${root}/${folder}`;
  let head: string | null = null;
  // Walk up to the checkout the folder is in: `cd Plugins/X && git push` pushes the checkout's branch.
  for (let at = base.replace(/[\\/]+$/, ""), depth = 0; head === null && at !== "" && depth < 12; depth += 1) {
    head = await readText(`${at}/.git/HEAD`);
    if (head === null) {
      // A worktree: .git is a file naming its gitdir.
      const gitdir = /gitdir:\s*(.+)/.exec((await readText(`${at}/.git`)) ?? "")?.[1]?.trim();
      if (gitdir) head = await readText(`${gitdir}/HEAD`);
    }
    const parent = at.replace(/[\\/][^\\/]*$/, "");
    at = parent === at ? "" : parent;
  }
  return /ref:\s*refs\/heads\/(.+)/.exec(head ?? "")?.[1]?.trim() ?? (head ?? "").trim().slice(0, 12);
}

// The branch each git segment of a command runs on, read before the pure hold check.
export async function branchesFor(ctx: Ctx, command: string) {
  const branches = new Map<string | null, string>();
  for (const folder of gitFolders(command) as (string | null)[]) branches.set(folder, await readBranch(ctx, folder).catch(() => ""));
  return (folder: string | null) => branches.get(folder) ?? "";
}

// This agent's heartbeat through state.mjs, which keeps "last active" for one session per process:
// it is set for this agent right before the write.
export async function heartbeat(ctx: Ctx, hasEnded: boolean) {
  const { root, isS2, pack } = await laneOf(ctx);
  if (!isS2) return;
  const branch = await readBranch(ctx);
  state.markActive(lastActiveOf(ctx.agent.id));
  await state.writeHeartbeat(ctx.io as never, { root, localDir: pack.localDir, branch, hasEnded });
}

// A lane this checkout can vouch has gone: its heartbeat is here and says ended, or is stale.
export async function isLaneGone(ctx: Ctx, sid: string) {
  const { root, pack } = await laneOf(ctx);
  const lane = await state.readLane(ctx.io as never, root, pack.localDir, sid);
  return lane !== null && !state.isLaneLive(lane);
}

// Another lane is alive while its heartbeat is fresh and has not said it ended.
export async function isLaneAlive(ctx: Ctx, sid: string) {
  const { root, pack } = await laneOf(ctx);
  const lane = await state.readLane(ctx.io as never, root, pack.localDir, sid);
  return lane !== null && state.isLaneLive(lane);
}

export async function peers(ctx: Ctx) {
  const { root, pack } = await laneOf(ctx);
  return state.readPeers(ctx.io as never, root, pack.localDir) as Promise<{ intent: string | null; branch: string; updatedAt: number; lastActiveAt?: number }[]>;
}

export async function readLock(ctx: Ctx) {
  const { root, pack } = await laneOf(ctx);
  const tz = await state.readTz(ctx.io as never);
  return pack.parseLock(pack.lockFile ? await readText(`${root}/${pack.lockFile}`) : null, localMinutes(Date.now(), tz));
}

// What the session is told about its lane: the tracked intent, the Editor lock, live peers, the window's mandate.
// The original put it in every prompt; here it is the status tool's text and the away hand-over.
export async function laneText(ctx: Ctx) {
  const { me, pack } = await laneOf(ctx);
  const io = ctx.io as never;
  const lines: string[] = [];
  const live = await peers(ctx);
  const tz = await state.readTz(io);
  const slug = await state.readPinned(io);
  const intent = slug ? await readIntent(ctx, slug) : undefined;
  if (intent) {
    const { role } = await state.readProfile(io, me, pack);
    const prs = await state.readPrStates(io);
    const stage = STAGE_LABELS[currentStage(intent, await state.readEvidence(io, await state.evidenceScope(io), pack), role, prs, pack) as keyof typeof STAGE_LABELS];
    lines.push(
      `Tracked intent: ${intent.slug} (docs/intent/${intent.slug}/), status ${intent.status}, stage ${stage} (Plan, Build, Prove, Ship), checklist ${intent.acceptanceDone}/${intent.acceptanceTotal}${intent.prs.length > 0 ? `, PRs ${prStatusList(intent, prs).join(", ")}` : ""}, open director calls ${directorCalls(intent).length}.`,
    );
    const held = heldByLine(live, intent.slug, Date.now());
    if (held) lines.push(`${held}.`);
  }
  const lock = await readLock(ctx);
  if (lock.state === "held") lines.push(`Editor owner lock: held by ${lock.holder || "another lane"}${lock.until ? ` until ${lock.until}` : ""}.`);
  if (live.length > 0) lines.push(`Live peer lanes on this checkout: ${live.map((lane) => `${lane.intent ?? "no intent"} on ${lane.branch}`).join("; ")}.`);
  const away = await state.readAway(io);
  if (isHolding(away)) lines.push(mandateText(away, tz, pack));
  return lines.length > 0 ? `Ather Automata lane state (live, read-only):\n${lines.join("\n")}` : "";
}
