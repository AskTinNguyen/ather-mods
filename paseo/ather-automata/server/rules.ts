// Which commands Claude must ask about in a checkout Ather watches. Paseo plugins have no hook
// before a tool call, but a Claude "ask" rule fires even in bypass mode and reaches the plugin as a
// permission request. Ather answers those itself (server/watch.ts): held while away, allowed otherwise.

import { bareCommand, segments } from "./ather/shell.mjs";
import type { Pack } from "./lane";

const COMMON = ["git push", "git merge", "git pull", "gh pr merge", "gh api"];

// No Unreal Editor rules: s2-ue-orchestrator already makes Editor launches and kills ask and answers
// them through its lease. Ather only refuses those (an `editor-restart` hold) when a window holds them,
// and never allows them, so it cannot take an answer that belongs to the Editor queue.

const WEB_TOOLS = [
  "vercel",
  "wrangler",
  "netlify",
  "firebase",
  "fly",
  "flyctl",
  "drizzle-kit",
  "prisma",
  "knex",
  "sequelize",
  "sequelize-cli",
  "typeorm",
  "supabase",
  "terraform",
  "tofu",
  "pulumi",
];
const WEB = [
  ...WEB_TOOLS,
  ...WEB_TOOLS.flatMap((tool) => [`npx ${tool}`, `pnpm exec ${tool}`, `pnpm dlx ${tool}`, `bunx ${tool}`, `yarn ${tool}`]),
  "npm publish",
  "pnpm publish",
  "yarn publish",
  "yarn npm publish",
  "bun publish",
  "gh secret",
  "gh variable",
];

// The command prefixes Ather asks about for a pack. `npm run <script>` is added for scripts that hold.
export function heldPrefixes(pack: Pack): string[] {
  const out = [...COMMON];
  if (pack.id === "web") {
    out.push(...WEB);
    const allKinds = ["merge", "push-main", ...pack.held.kinds];
    for (const [name, body] of Object.entries((pack.scripts ?? {}) as Record<string, string>)) {
      const holds = segments(String(body)).some((part: string) => pack.heldSegment(part, allKinds, { scripts: pack.scripts }) !== null || /\bgit\s+push\b/i.test(part));
      if (holds) out.push(`npm run ${name}`, `pnpm run ${name}`, `pnpm ${name}`, `yarn ${name}`, `bun run ${name}`);
    }
  }
  return [...new Set(out)];
}

export function askRules(prefixes: readonly string[], gateBriefs: boolean): string[] {
  const rules = prefixes.flatMap((prefix) => [`Bash(${prefix}:*)`, `PowerShell(${prefix}:*)`]);
  // The worker brief gate reads each Agent call's brief before it runs.
  if (gateBriefs) rules.push("Agent", "Task");
  return rules;
}

// Whether a command asked only because of Ather's rules: one of its segments starts with a held prefix.
export function isOurs(command: string, prefixes: readonly string[]) {
  const lower = prefixes.map((one) => one.toLowerCase());
  const starts = (text: string) => lower.some((prefix) => text === prefix || text.startsWith(`${prefix} `));
  // `npx prisma` matches as typed and as the bare `prisma`.
  return (segments(command) as string[]).some((segment) => starts(segment.trim().toLowerCase()) || starts(String(bareCommand(segment)).trim().toLowerCase()));
}
