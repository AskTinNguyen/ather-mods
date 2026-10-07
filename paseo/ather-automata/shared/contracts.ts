import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// What the panel draws for one agent. The home model is built on the daemon by the
// original Ather logic (server/ather/home.mjs) and shipped as plain JSON.

const row = z.object({
  id: z.string(),
  label: z.string(),
  hint: z.string().optional(),
  detail: z.string().optional(),
  kind: z.string().optional(),
  // A row the person must finish before it goes to the session (Next with isDraft).
  draft: z.string().optional(),
});

export const homeView = z.object({
  // False outside a repository that runs intents: `notHere` says why.
  isHere: z.boolean(),
  notHere: z.string(),
  title: z.string(),
  stage: z.string(),
  progress: z.string(),
  stages: z.array(z.object({ label: z.string(), state: z.enum(["done", "now", "todo"]) })),
  proof: z.string(),
  // "Also tracked in 1 other session · active 3m ago"; '' when no other session tracks it.
  heldBy: z.string(),
  sentence: z.string(),
  lock: z.string(),
  role: z.string(),
  week: z.string(),
  done: z.number(),
  total: z.number(),
  away: z.object({
    phase: z.enum(["off", "running", "review"]),
    until: z.string(),
    ledger: z.string(),
    parked: z.array(z.string()),
  }),
  items: z.array(row),
  next: row.nullable(),
  work: z.array(row),
  actions: z.array(row),
  skills: z.array(row.extend({ group: z.string() })),
  create: z.array(z.object({ group: z.string(), items: z.array(row) })),
  changes: z.array(z.object({ kind: z.enum(["done", "yours", "changed"]), time: z.string(), text: z.string() })),
  offerAway: z.boolean(),
  awayChoices: z.array(z.object({ id: z.string(), label: z.string() })),
  isNewcomer: z.boolean(),
  sent: z.array(z.string()),
  // The GitHub account gh is signed in as ('' when unknown), for the avatar in the header.
  githubLogin: z.string(),
  // The worker squad: what each worker is, what it is doing, and what it did.
  crew: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.string(),
      kindWord: z.string(),
      prop: z.string().nullable(),
      propWord: z.string(),
      model: z.string(),
      state: z.enum(["running", "done", "failed", "waiting"]),
      props: z.array(z.string()),
      // How much it did and how long it took (ms since epoch; 0 when unknown).
      toolCalls: z.number(),
      startedAt: z.number(),
      endedAt: z.number(),
      // What came of it: the first sentence of its report.
      outcome: z.string(),
      source: z.enum(["worker", "agent"]),
    }),
  ),
  // An intent opened to look at (rows and matching words open it; looking never tracks), or null.
  intentView: z
    .object({
      slug: z.string(),
      goal: z.string(),
      stage: z.string(),
      progress: z.string(),
      owner: z.string(),
      proof: z.string(),
      heldBy: z.string(),
      // Whether this agent tracks it: Stop tracking instead of Work on this here.
      isHere: z.boolean(),
      next: z.string(),
      today: z.array(z.object({ kind: z.enum(["done", "yours", "changed"]), time: z.string(), text: z.string() })),
    })
    .nullable(),
  // The last reply to a command or action, so the panel can show it.
  message: z.string(),
});
export type HomeView = z.infer<typeof homeView>;

export const atherHome = defineRpc({
  name: "ather.home",
  input: z.object({ agentId: z.string(), cwd: z.string(), refresh: z.boolean().optional() }),
  output: homeView,
});

export const atherAct = defineRpc({
  name: "ather.act",
  input: z.object({
    agentId: z.string(),
    cwd: z.string(),
    // item: something that needs you; next; work: an intent or issue; action/skill/create: quick actions;
    // all: every open item at once; away: a preset ("tonight", "8h", "until done", "stop"); draft: edited text to send.
    kind: z.enum(["item", "next", "work", "action", "skill", "create", "all", "away", "draft", "view", "back", "track", "untrack"]),
    id: z.string(),
    text: z.string().optional(),
  }),
  output: z.object({ message: z.string() }),
});

export const atherCommand = defineRpc({
  name: "ather.command",
  input: z.object({ agentId: z.string(), cwd: z.string(), command: z.enum(["ather", "away"]), args: z.string() }),
  output: z.object({ message: z.string() }),
});

// One line per agent for the composer pill; agents with nothing to say are left out.
export const atherBands = defineRpc({
  name: "ather.bands",
  input: z.object({ agents: z.array(z.object({ agentId: z.string(), cwd: z.string() })) }),
  output: z.object({ bands: z.record(z.string(), z.object({ label: z.string(), urgent: z.boolean(), kind: z.enum(["away", "review", "tour", "needs", "stage"]) })) }),
});

// Pictures the app cannot draw itself (no SVG in plugins): the Ather mark, worker avatars and
// props, and GitHub avatars. Keys: "logo:dark", "avatar:<kind>:<prop>", "prop:<prop>", "github:<login>".
export const atherArt = defineRpc({
  name: "ather.art",
  input: z.object({ key: z.string().max(80) }),
  output: z.object({ uri: z.string().nullable() }),
});
