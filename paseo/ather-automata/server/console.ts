// Ather Automata, the visible half (console.mjs), behind the Paseo panel, pill and commands.
// The home model comes from the original home.mjs; picking something hands it to the agent
// as a message. Where the original asked a question dialog, the panel lists the choices.

import { AWAY_PRESETS, isStopWord, parseAwayArgs, windowEndText } from "./ather/away.mjs";
import { NEW_INTENT_PROMPT, askPrompt, batchPrompt, buildHome, heldByLine, parseWeek, proofLine, skillFolder, untrackText } from "./ather/home.mjs";
import { issuePrompt, parseIssues } from "./ather/issues.mjs";
import { parsePrState, prsToRead } from "./ather/prs.mjs";
import { STAGE_LABELS, clockText, closestWord, currentStage, localMinutes, parseIntent, searchIntents, sessionTitle } from "./ather/model.mjs";
import * as state from "./ather/state.mjs";
import type { HomeView } from "../shared/contracts";
import { knownAgents, note, send } from "./agents";
import { governedRoot } from "./agentConfig";
import { USER_HOME, list, mtime, readText, run } from "./io";
import { ctxOf, laneOf, peers, readLock, type Ctx, type Pack } from "./lane";
import { crewOf, githubLogin } from "./squad";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const VIEW_TTL_MS = 15000;
const INTENTS_TTL_MS = 60000;
const ISSUES_EVERY_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- what each checkout and agent keeps

type RootCache = { at: number; intents: Any[]; skills: { name: string; description: string }[]; reading: Promise<void> | null };
const roots = new Map<string, RootCache>();
// Items handed to each agent, shown as sent instead of offered twice.
const sentBy = new Map<string, Set<string>>();
// The last reply to a command or action, per agent, for the panel.
const messages = new Map<string, { text: string; at: number }>();
// The reply stays on the panel briefly; the toast already said it.
const MESSAGE_MS = 2 * 60 * 1000;
// The intent whose view is open on each agent's pane ('' or none: the home view). Looking never tracks (0.1.2).
const viewing = new Map<string, string>();
// The assigned issue whose card is open on each agent's pane (0: none). Looking never starts anything.
const viewingIssue = new Map<string, number>();
// When each person's GitHub issues were last read.
const issuesAt = new Map<string, number>();
let prsReading = false;
const views = new Map<string, { version: number; at: number; model: Any }>();

const sentOf = (agentId: string) => {
  let set = sentBy.get(agentId);
  if (!set) sentBy.set(agentId, (set = new Set()));
  return set;
};
const stale = (agentId: string) => views.delete(agentId);

// ---------------------------------------------------------------- reading the checkout

async function readIntents(root: string, pinned: string | null, pack: Pack) {
  const read: Any[] = [];
  for (const entry of await list(`${root}/docs/intent`).catch(() => [])) {
    if (entry.kind !== "dir") continue;
    const dir = `${root}/docs/intent/${entry.name}`;
    const prompt = await readText(`${dir}/prompt.md`);
    if (prompt === null) continue;
    const isOpen = !/^\s*-\s*Status:\s*completed/im.test(prompt);
    const isPinned = entry.name === pinned;
    const stats = await Promise.all(["prompt.md", "progress.md", "log.md"].map((name) => mtime(`${dir}/${name}`)));
    read.push(
      parseIntent(
        {
          slug: entry.name,
          prompt,
          findings: isOpen ? ((await readText(`${dir}/findings.md`)) ?? "") : "",
          progress: isOpen || isPinned ? ((await readText(`${dir}/progress.md`)) ?? "") : "",
          files: isPinned ? (await list(dir).catch(() => [])).map((one) => one.name) : [],
          hasDebrief: isPinned && (await readText(`${root}/${pack.debriefPath(entry.name)}`)) !== null,
          mtimeMs: Math.max(...stats),
        },
        pack,
      ),
    );
  }
  return read.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function readSkills(root: string, pack: Pack) {
  const found: { name: string; description: string }[] = [];
  const names = new Set<string>([
    ...pack.skillGroups.flatMap((one: Any) => one.names),
    ...pack.createGroups.flatMap((one: Any) => one.items.filter((item: Any) => !item.isGlobal).map((item: Any) => item.name)),
  ]);
  for (const name of names) {
    const text = await readText(`${root}/${skillFolder(name)}/SKILL.md`);
    if (text === null) continue;
    const description = (/^description:\s*(.+)$/m.exec(text)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    found.push({ name, description: /^(.+?[.!?])(\s|$)/.exec(description)?.[1] ?? description });
  }
  return found;
}

// Intents and skills for a checkout, read again at most once a minute (or when asked).
async function refreshRoot(ctx: Ctx, force = false) {
  const { root, pack } = await laneOf(ctx);
  const cache = roots.get(root) ?? { at: 0, intents: [], skills: [], reading: null };
  roots.set(root, cache);
  if (!force && Date.now() - cache.at < INTENTS_TTL_MS) return cache;
  if (!cache.reading) {
    cache.reading = (async () => {
      const pinned = await state.readPinned(ctx.io as never);
      cache.intents = await readIntents(root, pinned, pack);
      cache.skills = await readSkills(root, pack);
      cache.at = Date.now();
      for (const agent of knownAgents()) stale(agent.id);
    })().finally(() => {
      cache.reading = null;
    });
  }
  await cache.reading;
  void refreshPrs(ctx, cache.intents).catch(() => undefined);
  return cache;
}

// Whether the PRs of intents with every item met are merged, read with gh. Never writes to GitHub.
async function refreshPrs(ctx: Ctx, intents: Any[]) {
  if (prsReading) return;
  prsReading = true;
  try {
    const { root } = await laneOf(ctx);
    const read: Record<string, string> = {};
    for (const number of prsToRead(intents, await state.readPrRecords(ctx.io as never), Date.now())) {
      const result = await run(["gh", "pr", "view", String(number), "--json", "state,mergedAt"], { cwd: root, timeoutMs: 30000 });
      read[number] = (result.exitCode === 0 ? parsePrState(result.stdout) : null) ?? "UNREAD";
    }
    await state.setPrStates(ctx.io as never, read as never, Date.now());
  } finally {
    prsReading = false;
  }
}

// The GitHub issues assigned to the person, read with gh; '' when it worked, else why not.
async function refreshIssues(ctx: Ctx, force = false): Promise<string> {
  const { root, me } = await laneOf(ctx);
  if (!force && Date.now() - (issuesAt.get(me) ?? 0) < ISSUES_EVERY_MS) return "";
  issuesAt.set(me, Date.now());
  const result = await run(["gh", "issue", "list", "--assignee", "@me", "--state", "open", "--limit", "30", "--json", "number,title,url,labels,updatedAt"], { cwd: root, timeoutMs: 30000 });
  if (result.exitCode !== 0) {
    // Signed out: the last list may be stale, so none is shown.
    if (/auth login|not logged in|authentication/i.test(result.stderr)) await state.setIssues(ctx.io as never, me, []);
    return (result.stderr || `gh exited with ${result.exitCode}`).trim().slice(0, 300);
  }
  await state.setIssues(ctx.io as never, me, parseIssues(result.stdout));
  return "";
}

// A session as people know it, from the first 8 hex of its id: a Paseo agent's title, else the title
// Claude Code recorded for a session on this checkout; '' when neither is known.
const names = new Map<string, { name: string; at: number }>();
async function sessionNameOf(root: string, prefix: string) {
  const agent = knownAgents().find((one) => one.id.startsWith(prefix));
  if (agent?.title) return agent.title;
  const hit = names.get(prefix);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.name;
  const config = (process.env.CLAUDE_CONFIG_DIR || `${USER_HOME}/.claude`).split("\\").join("/");
  const dir = `${config}/projects/${root.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const file = (await list(dir).catch(() => [])).find((entry) => entry.kind === "file" && entry.name.startsWith(prefix) && entry.name.endsWith(".jsonl"));
  const text = file ? ((await readText(`${dir}/${file.name}`)) ?? "") : "";
  const name = file ? sessionTitle((text.match(/"(customTitle|aiTitle)":"[^"]*"/g) ?? []).join("\n")) : "";
  names.set(prefix, { name, at: Date.now() });
  return name;
}

// A held lock that names a session shows that session's name.
async function namedLock(root: string, lock: Any) {
  if (lock.state !== "held" || !lock.session) return lock;
  const name = await sessionNameOf(root, lock.session).catch(() => "");
  return { ...lock, holder: name ? `"${name}"` : `session ${lock.session}` };
}

// An intent's proof, each record another session wrote named by that session (0.1.2: proof by session).
async function proofOf(ctx: Ctx, slug: string) {
  const io = ctx.io as never;
  const { root, pack } = await laneOf(ctx);
  const mine = state.shortSession(ctx.agent.id);
  const evidence = (await state.readEvidence(io, slug || ctx.agent.id, pack)) as Record<string, { by?: string }>;
  const others = [...new Set(Object.values(evidence).map((rung) => rung?.by ?? "").filter((by) => by !== "" && by !== mine))];
  const named = Object.fromEntries(await Promise.all(others.map(async (by) => [by, await sessionNameOf(root, by).catch(() => "")])));
  return proofLine(evidence as never, pack, mine, named) as string;
}

// ---------------------------------------------------------------- the model

async function model(ctx: Ctx, force = false) {
  const version = state.stateVersion();
  const hit = views.get(ctx.agent.id);
  if (!force && hit && hit.version === version && Date.now() - hit.at < VIEW_TTL_MS) return hit.model;
  const io = ctx.io as never;
  const { root, me, pack } = await laneOf(ctx);
  const cache = await refreshRoot(ctx, force);
  void refreshIssues(ctx).catch(() => undefined);
  const tz = await state.readTz(io);
  const now = Date.now();
  const away = await state.readAway(io);
  const profile = await state.readProfile(io, me, pack);
  const workers = knownAgents().filter((agent) => agent.parentAgentId === ctx.agent.id).length;
  const built = buildHome({
    intents: cache.intents,
    pinned: await state.readPinned(io),
    me,
    ...profile,
    evidence: await state.readEvidence(io, await state.evidenceScope(io), pack),
    away,
    ledger: away.phase === "off" ? "" : ((await readText(away.ledgerPath)) ?? ""),
    lost: await state.readLost(io),
    lock: await namedLock(root, await readLock(ctx)),
    recurring: await state.readRecurring(io, pack),
    issues: await state.readIssues(io, me),
    prs: await state.readPrStates(io),
    week: parseWeek(await readText(`${USER_HOME}/.calendar/latest.json`), now),
    last: await state.readLast(io, me),
    sent: [...sentOf(ctx.agent.id)],
    skills: cache.skills,
    workers,
    now,
    tz,
    pack,
  } as Any);
  views.set(ctx.agent.id, { version, at: now, model: built });
  return built;
}

const workTitle = (one: Any) => (one.kind === "intent" ? one.slug : one.label);
const workDetail = (one: Any) => {
  const detail = one.kind === "intent" ? String(one.hint).replace(`${one.slug} · `, "") : one.hint;
  // A teammate's intent names its owner at the end of the line; the owner is sent on its own (drawn as a name chip).
  return one.kind === "intent" && !one.isMine && one.owner ? String(detail).replace(` · ${one.owner}`, "") : detail;
};

export async function homeView(agentId: string, cwd: string, force = false): Promise<HomeView> {
  const ctx = ctxOf((knownAgents().find((one) => one.id === agentId) ?? { id: agentId, cwd, provider: "", workspaceId: null, parentAgentId: null, title: null }));
  const empty: HomeView = {
    isHere: false,
    notHere: "",
    title: "Ather",
    stage: "",
    progress: "",
    stages: [],
    proof: "",
    heldBy: "",
    sentence: "",
    lock: "",
    role: "",
    week: "",
    done: 0,
    total: 0,
    away: { phase: "off", until: "", ledger: "", parked: [] },
    items: [],
    next: null,
    work: [],
    actions: [],
    skills: [],
    create: [],
    changes: [],
    offerAway: false,
    awayChoices: AWAY_CHOICES,
    isNewcomer: false,
    sent: [],
    githubLogin: "",
    crew: [],
    intentView: null,
    issueView: null,
    message: Date.now() - (messages.get(agentId)?.at ?? 0) < MESSAGE_MS ? (messages.get(agentId)?.text ?? "") : "",
  };
  const lane = (await governedRoot(cwd)) ? await laneOf(ctx) : null;
  if (!lane?.isS2) return { ...empty, notHere: lane?.pack.notHere ?? "Ather Automata works in checkouts that run intents (a docs/intent folder); none here." };
  const io = ctx.io as never;
  const built = await model(ctx, force);
  const tz = await state.readTz(io);
  const away = await state.readAway(io);
  const slug = await state.readPinned(io);
  const now = Date.now();
  const changes = slug ? ((await state.readChanges(io, slug, now - localMinutes(now, tz) * 60000)) as Any[]) : [];
  const next = built.next;
  const intentsBySlug = new Map<string, Any>(((await refreshRoot(ctx)).intents as Any[]).map((one) => [one.slug, one]));
  const ledger = away.ledgerPath && away.ledgerPath.startsWith(lane.root) ? away.ledgerPath.slice(lane.root.length + 1) : away.ledgerPath;
  return {
    ...empty,
    isHere: true,
    title: built.header.title,
    stage: built.header.stage,
    progress: built.header.progress,
    stages: built.header.stages,
    proof: slug ? await proofOf(ctx, slug) : built.header.proof,
    heldBy: slug ? heldByLine(await peers(ctx), slug, now) : "",
    sentence: built.header.sentence,
    lock: built.header.lock,
    role: built.header.role,
    week: built.header.week,
    done: built.header.done,
    total: built.header.total,
    away: { phase: away.phase, until: away.phase === "off" ? "" : windowEndText(away, tz), ledger, parked: away.parked.map((one: Any) => `${one.id}: ${one.command}`) },
    items: built.items.map((one: Any) => ({ id: one.id, label: one.title || one.label, hint: one.label, detail: one.detail, kind: one.kind })),
    next: next
      ? { id: next.id, label: next.label, hint: next.hint, ...(next.isDraft ? { draft: next.prompt } : {}), kind: next.isTour ? "tour" : next.work ? "work" : next.action ?? "step" }
      : null,
    // Other work: never the intent already tracked, nor the one Next already offers.
    work: built.work
      .filter((one: Any) => one !== next?.work && !(one.kind === "intent" && one.slug === slug))
      .slice(0, 300)
      .map((one: Any) => ({
        id: one.id,
        label: workTitle(one),
        hint: workDetail(one),
        kind: one.kind,
        group: one.kind === "issue" ? ("issues" as const) : one.isMine ? ("mine" as const) : ("others" as const),
        owner: one.kind === "intent" && !one.isMine ? String(one.owner ?? "") : "",
        updatedAt: one.kind === "issue" ? Number(one.issue.updatedAt) || 0 : Number(intentsBySlug.get(one.slug)?.mtimeMs) || 0,
      })),
    actions: built.actions.filter((one: Any) => one.prompt).map((one: Any) => ({ id: one.id, label: one.label })),
    skills: built.skills.map((one: Any) => ({ id: one.id, label: one.name, hint: one.description, group: one.group })),
    create: built.create.map((group: Any) => ({ group: group.group, items: group.items.map((item: Any) => ({ id: item.id, label: item.verb, hint: item.description || item.name })) })),
    changes: changes.slice(0, 12).map((one) => ({ kind: one.kind, time: clockText(one.at, tz), text: one.text })),
    offerAway: built.offerAway,
    isNewcomer: built.isNewcomer,
    sent: [...sentOf(agentId)],
    githubLogin: await githubLogin().catch(() => ""),
    crew: await crewOf(agentId).catch(() => []),
    intentView: await intentViewOf(ctx, built, slug),
    issueView: await issueViewOf(ctx),
  };
}

// The open intent's view: where it stands, its proof by session, who else tracks it, today's lines.
// Working on it here is its own press (Work on this here); the tracked one offers Stop tracking.
async function intentViewOf(ctx: Ctx, built: Any, pinned: string | null): Promise<HomeView["intentView"]> {
  const slug = viewing.get(ctx.agent.id) ?? "";
  if (!slug) return null;
  const io = ctx.io as never;
  const { me, pack } = await laneOf(ctx);
  const cache = await refreshRoot(ctx);
  const intent = cache.intents.find((one: Any) => one.slug === slug);
  if (!intent) {
    viewing.delete(ctx.agent.id);
    return null;
  }
  const tz = await state.readTz(io);
  const now = Date.now();
  const { role } = await state.readProfile(io, me, pack);
  const evidence = await state.readEvidence(io, slug, pack);
  const stage = STAGE_LABELS[currentStage(intent, evidence, role, await state.readPrStates(io), pack) as keyof typeof STAGE_LABELS];
  const today = (await state.readChanges(io, slug, now - localMinutes(now, tz) * 60000)) as Any[];
  const isHere = slug === pinned;
  return {
    slug,
    goal: String(intent.goal ?? ""),
    stage,
    progress: intent.acceptanceTotal > 0 ? `${intent.acceptanceDone} of ${intent.acceptanceTotal} done` : "no checklist yet",
    owner: String(intent.owner ?? ""),
    proof: await proofOf(ctx, slug),
    heldBy: heldByLine(await peers(ctx), slug, now),
    isHere,
    next: isHere && built.next ? String(built.next.label) : "",
    today: today.slice(0, 8).map((one) => ({ kind: one.kind, time: clockText(one.at, tz), text: one.text })),
  };
}

// The composer pill: what needs the person, a running window, or nothing.
export type Band = { label: string; urgent: boolean; kind: "away" | "review" | "tour" | "needs" | "stage" };

export async function bandOf(agentId: string, cwd: string): Promise<Band | null> {
  if (!(await governedRoot(cwd))) return null;
  const ctx = ctxOf(knownAgents().find((one) => one.id === agentId) ?? { id: agentId, cwd, provider: "", workspaceId: null, parentAgentId: null, title: null });
  if (!(await laneOf(ctx)).isS2) return null;
  const built = await model(ctx);
  const { header } = built;
  if (header.stage === "Away") return { label: `Away ${header.progress}`, urgent: false, kind: "away" };
  if (built.open.some((one: Any) => one.kind === "review")) return { label: "Review away window", urgent: true, kind: "review" };
  if (built.isNewcomer) return { label: "New here? Tour", urgent: false, kind: "tour" };
  if (built.open.length > 0) return { label: `${built.open.length} need${built.open.length === 1 ? "s" : ""} you`, urgent: true, kind: "needs" };
  return { label: header.stage ? `${header.title} · ${header.stage}` : "Ather", urgent: false, kind: "stage" };
}

// ---------------------------------------------------------------- handing things to the agent

// The one way things go to the agent: shown as sent at once, `onDelivered` once it has the
// message, offered again if delivery fails.
async function handOff(ctx: Ctx, ids: readonly string[], text: string, onDelivered?: () => Promise<unknown>, onFailed?: () => Promise<unknown>) {
  const sent = sentOf(ctx.agent.id);
  for (const id of ids) sent.add(id);
  stale(ctx.agent.id);
  try {
    await send(ctx.agent.id, text);
    await onDelivered?.();
  } catch (error) {
    for (const id of ids) sent.delete(id);
    await onFailed?.();
    stale(ctx.agent.id);
    throw new Error(`Could not send to the agent: ${String(error)}`);
  }
}

async function actItem(ctx: Ctx, one: Any): Promise<string> {
  const io = ctx.io as never;
  if (one.kind === "away-end") return comeBack(ctx);
  if (one.kind === "review") {
    // The review is the person walking through the window: holds end as it is handed over.
    const saved = await state.readAway(io);
    await state.closeAway(io);
    await handOff(ctx, [one.id], one.prompt, undefined, () => state.restoreAway(io, saved));
    return "Sent the review to the agent.";
  }
  await handOff(ctx, [one.id], one.prompt, () => state.settleItem(io, one));
  return "Sent to the agent.";
}

// "I'm back": ends the window and hands its review to the agent in one step.
async function comeBack(ctx: Ctx) {
  await state.endAway(ctx.io as never);
  stale(ctx.agent.id);
  const review = (await model(ctx, true)).open.find((one: Any) => one.kind === "review");
  return review ? actItem(ctx, review) : "No away window is running.";
}

async function startWork(ctx: Ctx, work: Any): Promise<string> {
  if (work.kind === "intent") return track(ctx, work.slug);
  await handOff(ctx, [work.id], work.prompt);
  return `Sent issue #${work.issue.number} to the agent: it checks for overlapping work first, then drafts the intent with you.`;
}

async function doNext(ctx: Ctx, next: Any): Promise<string> {
  const { me, pack } = await laneOf(ctx);
  if (next.isTour) {
    await handOff(ctx, ["next:tour"], pack.prompts.tour, () => state.setProfile(ctx.io as never, me, { tourDone: true }));
    return "Starting the Ather tour.";
  }
  if (next.work) return startWork(ctx, next.work);
  if (next.action === "checked") return atherCommand(ctx, "checked");
  await handOff(ctx, [next.id], next.prompt);
  return "Sent to the agent.";
}

async function startIssue(ctx: Ctx, number: number, confirm: boolean) {
  const { me } = await laneOf(ctx);
  const assigned = ((await state.readIssues(ctx.io as never, me)) as Any[]).find((one) => one.number === number);
  const issue = assigned ?? { number, title: "", name: "", url: "", labels: [], updatedAt: 0, area: "Unsorted", isUrgent: false };
  // Not assigned to the person: the agent confirms with them first.
  const prompt = assigned || !confirm ? issuePrompt(issue, me) : `Issue #${number} is not assigned to me. Ask me to confirm before starting it; then: ${issuePrompt(issue, me)}`;
  await handOff(ctx, [`issue:${number}`], prompt);
  return assigned || !confirm
    ? `Sent issue #${number} to the agent: it checks for overlapping work first, then drafts the intent with you.`
    : `Sent issue #${number} to the agent; it confirms with you first, since it is not assigned to you.`;
}

// Opens an intent's view on the pane; never tracks it.
function view(ctx: Ctx, slug: string) {
  viewingIssue.delete(ctx.agent.id);
  viewing.set(ctx.agent.id, slug);
  stale(ctx.agent.id);
  return `${slug} is open in the Ather panel: Work on this here tracks it.`;
}

// The open issue's card: what the panel needs to draw it. The issue comes from the list gh gave, never from a
// new request; null when none is open or it has left the list.
async function issueViewOf(ctx: Ctx): Promise<HomeView["issueView"]> {
  const number = viewingIssue.get(ctx.agent.id);
  if (!number) return null;
  const { me } = await laneOf(ctx);
  const issue = ((await state.readIssues(ctx.io as never, me)) as Any[]).find((one) => one.number === number);
  if (!issue) {
    viewingIssue.delete(ctx.agent.id);
    return null;
  }
  return {
    number: Number(issue.number),
    title: String(issue.title ?? ""),
    name: String(issue.name ?? ""),
    url: String(issue.url ?? ""),
    labels: (issue.labels as unknown[]).map(String),
    area: String(issue.area ?? "Unsorted"),
    isUrgent: issue.isUrgent === true,
    updatedAt: Number(issue.updatedAt) || 0,
    sent: sentOf(ctx.agent.id).has(`issue:${number}`),
  };
}

// Opens an issue's card on the pane; sends nothing to the agent.
function viewIssue(ctx: Ctx, number: number) {
  viewing.delete(ctx.agent.id);
  viewingIssue.set(ctx.agent.id, number);
  stale(ctx.agent.id);
  return `Issue #${number} is open in the Ather panel: Start an intent sends it to the agent.`;
}

// Words that match one intent show it and never track it; several are listed; none is said.
async function lookUp(ctx: Ctx, text: string) {
  const { intents } = await refreshRoot(ctx);
  const matches = searchIntents(intents, text) as Any[];
  const [only] = matches;
  if (matches.length === 1 && only) return view(ctx, only.slug);
  return matches.length > 1 ? `${matches.length} intents match "${text}": ${matches.slice(0, 8).map((one) => one.slug).join(", ")}.` : `No open intent matches "${text}".`;
}

// /ather intent <name> and /ather pick <name>: an exact folder name tracks it; words show the one it matches.
async function pickIntent(ctx: Ctx, text: string) {
  const { intents } = await refreshRoot(ctx);
  return intents.some((one: Any) => one.slug === text) ? track(ctx, text) : lookUp(ctx, text);
}

// Stops tracking this agent's intent: /ather untrack, and Stop tracking in the intent view.
async function untrackHere(ctx: Ctx) {
  const { me } = await laneOf(ctx);
  const outcome = await state.untrack(ctx.io as never, me);
  if (outcome.result === "untracked") await refreshRoot(ctx, true);
  return untrackText(outcome) as string;
}

// Tracks an intent by its folder name: the deliberate act (Work on this here, Next, /ather intent <name>).
async function track(ctx: Ctx, text: string) {
  const { root, me } = await laneOf(ctx);
  const { intents } = await refreshRoot(ctx);
  const matches = searchIntents(intents, text) as Any[];
  const slug = intents.some((one: Any) => one.slug === text) ? text : matches.length === 1 && matches[0] ? matches[0].slug : null;
  if (slug === null) return matches.length > 1 ? `${matches.length} intents match "${text}": ${matches.slice(0, 8).map((one) => one.slug).join(", ")}.` : `No open intent matches "${text}".`;
  if (!(await state.track(ctx.io as never, root, slug, { me }))) return `No intent named "${slug}" in docs/intent.`;
  await refreshRoot(ctx, true);
  return `Now tracking ${slug}.`;
}

async function startAway(ctx: Ctx, choice: { hours: number; untilDone: boolean; goal?: string }) {
  const io = ctx.io as never;
  const { root, me, pack } = await laneOf(ctx);
  const tz = await state.readTz(io);
  const away = await state.startAway(io, { ...choice, goal: choice.goal ?? "" } as never, { root, me, tz, now: Date.now(), pack });
  if (away === null) return "An away window is already running or waiting for your review: the Ather panel shows it.";
  const ledger = away.ledgerPath.startsWith(root) ? away.ledgerPath.slice(root.length + 1) : away.ledgerPath;
  await handOff(
    ctx,
    ["away-start"],
    `I am away ${windowEndText(away, tz)}. Goal: ${choice.goal || "continue the active work"}. Work through it without waiting for me and record every decision you take for me in ${ledger}. Call mcp__ather-automata__status now for the window's mandate (what is allowed and what is held).`,
  );
  return `Away ${windowEndText(away, tz)}${choice.goal ? ` (goal: ${choice.goal})` : ""}. ${pack.mandate.away}`;
}

// Text typed after /ather: an issue, an intent, or a question for the agent.
async function typed(ctx: Ctx, text: string) {
  const { pack } = await laneOf(ctx);
  if (/^tours?$/i.test(text.trim())) return atherCommand(ctx, "tour");
  const number = /^#(\d+)$|^(\d{3,7})$/.exec(text.trim());
  if (number) return startIssue(ctx, Number(number[1] ?? number[2]), true);
  const { intents } = await refreshRoot(ctx);
  if (searchIntents(intents, text).length > 0) return lookUp(ctx, text);
  const question = /^(help|\?)$/i.test(text.trim()) ? "What can Ather do for me?" : text;
  await send(ctx.agent.id, askPrompt(question, pack));
  return "Sent your question to the agent.";
}

// What /ather understands after its name; a typo of one of these is read as it.
const COMMAND_WORDS = ["tour", "skip", "pick", "issues", "issue", "intent", "role", "checked", "untrack"];

async function atherCommand(ctx: Ctx, args: string): Promise<string> {
  const io = ctx.io as never;
  const { me, pack } = await laneOf(ctx);
  const word = args.split(/\s+/)[0]?.toLowerCase() ?? "";
  const rest = args.slice(word.length).trim();
  if (word === "tour" || word === "tours") return doNext(ctx, { isTour: true });
  if (word === "skip") {
    await state.setProfile(io, me, { tourDone: true });
    return `Tour skipped (/ather tour brings it back). ${pack.roleHelp}`;
  }
  if (word === "untrack" && rest === "") return untrackHere(ctx);
  if ((word === "intent" || word === "pick") && rest) return pickIntent(ctx, rest);
  if ((word === "issue" || word === "issues") && /^#?\d+$/.test(rest)) return startIssue(ctx, Number(rest.replace("#", "")), true);
  if (word === "role") {
    const role = pack.parseRole(rest);
    if (!role) return pack.roleHelp;
    await state.setProfile(io, me, { role }, pack);
    return `Your role is ${pack.roleLabels[role] ?? role}. It shapes the next step and what Prove asks for.`;
  }
  if (word === "checked") {
    const own = pack.ownCheck;
    if (!own) return "Nothing to record by hand here: Ather reads every proof from tool output.";
    await state.setRung(io, await state.evidenceScope(io), own.rung, { state: "pass", detail: own.detail });
    return own.reply;
  }
  if (word === "issues") {
    const failure = await refreshIssues(ctx, true).catch((error) => String(error));
    if (failure) return `Could not read your GitHub issues: ${failure}`;
    const count = ((await state.readIssues(io, me)) as Any[]).length;
    return count === 0 ? "No open GitHub issues are assigned to you." : `${count} open GitHub issue${count === 1 ? "" : "s"} assigned to you: they are under Work in the Ather panel.`;
  }
  if (word === "pick") return "Your intents and issues are under Work in the Ather panel.";
  const { intents } = await refreshRoot(ctx);
  const meant = rest === "" ? closestWord(word, COMMAND_WORDS) : null;
  if (meant && searchIntents(intents, word).length === 0) return `Did you mean /ather ${meant}?`;
  if (word !== "") return typed(ctx, args);
  return "";
}

async function awayCommand(ctx: Ctx, args: string): Promise<string> {
  const io = ctx.io as never;
  const away = await state.readAway(io);
  if (isStopWord(args)) {
    if (await state.endAway(io)) return "Away window ended; held actions stay held until you review it in the Ather panel.";
    return away.phase === "review" ? "The away window has ended; review it in the Ather panel." : "No away window is running.";
  }
  if (away.phase === "running") return `An away window is running ${windowEndText(away, await state.readTz(io))}. /away end ends it.`;
  if (away.phase === "review") return "The last away window waits for your review in the Ather panel.";
  if (args.trim() === "") return "Heading off? Pick how long under Away in the Ather panel, or type /away 8h, /away tonight, /away until 9am or /away until done, then the goal.";
  const parsed = parseAwayArgs(args, localMinutes(Date.now(), await state.readTz(io)));
  return parsed ? startAway(ctx, parsed) : `Not started: "${args}" is not a length. Try /away 8h, /away until 9am or /away until done, then the goal.`;
}

// ---------------------------------------------------------------- the RPC entry points

function remember(ctx: Ctx, message: string) {
  if (message) messages.set(ctx.agent.id, { text: message, at: Date.now() });
  stale(ctx.agent.id);
  return message;
}

async function governed(agentId: string, cwd: string): Promise<Ctx> {
  if (!(await governedRoot(cwd))) throw new Error("Ather Automata works in checkouts that run intents (a docs/intent folder); none here.");
  const ctx = ctxOf(knownAgents().find((one) => one.id === agentId) ?? { id: agentId, cwd, provider: "", workspaceId: null, parentAgentId: null, title: null });
  if (!(await laneOf(ctx)).isS2) throw new Error((await laneOf(ctx)).pack.notHere);
  return ctx;
}

export async function runCommand(agentId: string, cwd: string, command: "ather" | "away", args: string) {
  const ctx = await governed(agentId, cwd);
  const message = command === "away" ? await awayCommand(ctx, args.trim()) : await atherCommand(ctx, args.trim());
  if (message) void note(agentId, "info", message);
  return remember(ctx, message);
}

export async function act(agentId: string, cwd: string, kind: string, id: string, text?: string) {
  const ctx = await governed(agentId, cwd);
  const built = await model(ctx);
  let message = "";
  if (kind === "item") {
    const one = built.items.find((item: Any) => item.id === id);
    if (!one) throw new Error("That item is no longer waiting.");
    message = await actItem(ctx, one);
  } else if (kind === "all") {
    const open = built.open.filter((one: Any) => one.kind !== "away-end");
    if (open.length === 0) throw new Error("Nothing is waiting on you.");
    await handOff(ctx, open.map((one: Any) => one.id), batchPrompt(open), async () => {
      for (const one of open) await state.settleItem(ctx.io as never, one);
    });
    message = `Sent ${open.length} things to the agent; it takes you through them one at a time.`;
  } else if (kind === "next") {
    if (!built.next || built.next.id !== id) throw new Error("Next has changed; look again.");
    message = await doNext(ctx, built.next);
  } else if (kind === "work") {
    const one = built.work.find((item: Any) => item.id === id);
    if (!one) throw new Error("That work is no longer listed.");
    message = one.kind === "intent" ? view(ctx, one.slug) : viewIssue(ctx, one.issue.number);
  } else if (kind === "start") {
    // The one press that hands an issue to the agent: from the issue's card.
    const one = built.work.find((item: Any) => item.id === id);
    if (!one || one.kind !== "issue") throw new Error("That issue is no longer listed.");
    message = await startWork(ctx, one);
  } else if (kind === "view") {
    message = view(ctx, id);
  } else if (kind === "back") {
    viewing.delete(ctx.agent.id);
    viewingIssue.delete(ctx.agent.id);
    stale(ctx.agent.id);
  } else if (kind === "track") {
    message = await track(ctx, id);
  } else if (kind === "untrack") {
    message = await untrackHere(ctx);
  } else if (kind === "action") {
    if (id !== "action:new-intent") throw new Error(`Unknown action ${id}.`);
    await handOff(ctx, [id], NEW_INTENT_PROMPT);
    message = "Sent to the agent: it interviews you first.";
  } else if (kind === "skill") {
    const one = built.skills.find((item: Any) => item.id === id);
    if (!one) throw new Error("That skill is not in this checkout.");
    await handOff(ctx, [id], one.prompt);
    message = `Sent ${one.name} to the agent.`;
  } else if (kind === "create") {
    const one = built.create.flatMap((group: Any) => group.items).find((item: Any) => item.id === id);
    if (!one) throw new Error("That is not in this checkout.");
    await handOff(ctx, [id], one.prompt);
    message = `Sent to the agent: ${one.verb}.`;
  } else if (kind === "away") {
    if (id === "stop") message = await awayCommand(ctx, "stop");
    else if (id === "back") message = await comeBack(ctx);
    else {
      const preset = AWAY_PRESETS[Number(id)];
      if (!preset) throw new Error(`Unknown away preset ${id}.`);
      message = await startAway(ctx, { ...preset.choice, goal: text ?? "" });
    }
  } else if (kind === "draft") {
    if (!text?.trim()) throw new Error("Nothing to send.");
    await handOff(ctx, [id], text.trim());
    message = "Sent to the agent.";
  }
  return remember(ctx, message);
}

export const AWAY_CHOICES = AWAY_PRESETS.map((preset: Any, index: number) => ({ id: String(index), label: preset.label }));
