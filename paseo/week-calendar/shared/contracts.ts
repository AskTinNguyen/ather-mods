import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// What the surface shows of a week: the build script's own summary (see build-calendar.mjs).
export const weekSummary = z.object({
  isoWeek: z.string(),
  week: z.object({ start: z.string(), end: z.string() }),
  machine: z.string(),
  githubLogin: z.string().nullable().optional(),
  prsAuthored: z.number().optional(),
  prsMerged: z.array(z.object({ repo: z.string(), number: z.number(), title: z.string(), author: z.string().nullable().optional(), yours: z.boolean().optional() })),
  hours: z.object({ available: z.number(), busy: z.number(), productive: z.number(), waitingOnPerson: z.number(), automated: z.number().optional(), idle: z.number() }),
  productiveUtilization: z.number().nullable().optional(),
  projects: z.array(z.object({ project: z.string(), hours: z.number(), sessions: z.number() })),
  noCommit: z.array(z.object({ sessionId: z.string(), title: z.string().nullable().optional(), project: z.string().nullable().optional(), minutes: z.number(), end: z.string() })),
  excluded: z.array(z.object({ sessionId: z.string(), title: z.string().nullable().optional(), project: z.string().nullable().optional(), minutes: z.number(), reason: z.string().nullable().optional() })),
  untitled: z.number().optional(),
  html: z.string(),
  report: z.string().nullable(),
});
export type WeekSummary = z.infer<typeof weekSummary>;

export const weekBuild = defineRpc({
  name: "week.build",
  input: z.object({ weekOffset: z.number().int().max(0).default(0) }),
  output: z.object({ summary: weekSummary.nullable(), log: z.string() }),
});

// The last build of this week, without building again.
export const weekLatest = defineRpc({
  name: "week.latest",
  input: z.object({}),
  output: z.object({ summary: weekSummary.nullable(), builtAt: z.string().nullable(), scheduled: z.boolean() }),
});

export const weekPublish = defineRpc({
  name: "week.publish",
  input: z.object({ weekOffset: z.number().int().max(0).default(0), dryRun: z.boolean() }),
  output: z.object({ ok: z.boolean(), log: z.string() }),
});

export const weekSchedule = defineRpc({
  name: "week.schedule",
  input: z.object({ remove: z.boolean() }),
  output: z.object({ ok: z.boolean(), log: z.string() }),
});

// The weekly-report rule, for /weekly to hand to an agent.
export const weekRule = defineRpc({
  name: "week.rule",
  input: z.object({}),
  output: z.object({ text: z.string() }),
});

// A GitHub avatar, fetched by the daemon (works on phones and behind strict web views).
export const weekAvatar = defineRpc({
  name: "week.avatar",
  input: z.object({ login: z.string().max(39) }),
  output: z.object({ uri: z.string().nullable() }),
});
