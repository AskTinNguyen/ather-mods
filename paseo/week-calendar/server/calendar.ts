import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CalendarSettings } from "../shared/settings";
import type { WeekSummary } from "../shared/contracts";
import { SCRIPTS } from "./scripts.generated";

// The week-calendar scripts run as they did under Claude Code: from ~/.calendar/bin, with
// ~/.calendar/config.json for settings. Only the glue around them is Paseo's.

export const VERSION = "0.3.0";
const HOME = homedir().split("\\").join("/");
export const CALENDAR = `${HOME}/.calendar`;
export const BIN = `${CALENDAR}/bin`;
const SUMMARY = `${CALENDAR}/paseo-summary.json`;
const TASK = "week-calendar weekly report";

const list = (text: string) =>
  text
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean);

async function writeIfChanged(path: string, text: string) {
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === text) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

// Settings for the scripts; empty fields keep the scripts' defaults. A stable copy of the scripts
// for the scheduled task.
export async function install(settings: CalendarSettings) {
  const config: Record<string, unknown> = {
    theme: settings.theme,
    accent: settings.accent,
    colorBy: settings.colorBy,
    weekStart: settings.weekStart,
  };
  if (settings.machineName.trim()) config.machineName = settings.machineName.trim();
  if (settings.operator.trim()) config.operator = settings.operator.trim();
  if (settings.availableHoursPerWeek > 0) config.availableHoursPerWeek = settings.availableHoursPerWeek;
  if (settings.reportsRepoUrl.trim()) config.reportsRepoUrl = settings.reportsRepoUrl.trim();
  if (settings.githubLogin.trim()) config.githubLogin = settings.githubLogin.trim();
  if (list(settings.ignoreFolders).length > 0) config.ignoreFolders = list(settings.ignoreFolders);
  if (list(settings.gitEmails).length > 0) config.gitEmails = list(settings.gitEmails);
  await writeIfChanged(`${CALENDAR}/config.json`, `${JSON.stringify(config, null, 2)}\n`);
  for (const [name, text] of Object.entries(SCRIPTS)) await writeIfChanged(`${BIN}/${name}`, text);
  await writeIfChanged(`${BIN}/version.json`, `${JSON.stringify({ version: VERSION })}\n`);
}

type Run = { code: number; stdout: string; stderr: string };

function node(script: string, args: string[], timeoutMs = 10 * 60 * 1000): Promise<Run> {
  return new Promise((resolve) => {
    execFile("node", [join(BIN, script), ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? Number((error as { code?: unknown }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error ? error.message : "")) });
    });
  });
}

const tail = (run: Run) => [run.stdout.trim().slice(-3000), run.stderr.trim().slice(-2000)].filter(Boolean).join("\n");

export async function build(weekOffset: number): Promise<{ summary: WeekSummary | null; log: string }> {
  const run = await node("build-calendar.mjs", ["--export", "--week-offset", String(weekOffset)]);
  if (run.code !== 0) return { summary: null, log: tail(run) || `build-calendar.mjs exited with ${run.code}` };
  try {
    const summary = JSON.parse(run.stdout) as WeekSummary;
    if (weekOffset === 0) await writeFile(SUMMARY, JSON.stringify({ builtAt: new Date().toISOString(), summary }));
    return { summary, log: run.stderr.trim().slice(-2000) };
  } catch (error) {
    return { summary: null, log: `The build's summary could not be read: ${String(error)}\n${tail(run)}` };
  }
}

export async function latest(): Promise<{ summary: WeekSummary | null; builtAt: string | null }> {
  try {
    const saved = JSON.parse(await readFile(SUMMARY, "utf8")) as { builtAt: string; summary: WeekSummary };
    return { summary: saved.summary, builtAt: saved.builtAt };
  } catch {
    return { summary: null, builtAt: null };
  }
}

export async function publish(weekOffset: number, dryRun: boolean) {
  const run = await node("publish-report.mjs", ["--week-offset", String(weekOffset), ...(dryRun ? ["--dry-run"] : [])]);
  return { ok: run.code === 0, log: tail(run) || (run.code === 0 ? "Published." : `publish-report.mjs exited with ${run.code}`) };
}

export async function schedule(remove: boolean) {
  const run = await node("schedule-weekly.mjs", remove ? ["--remove"] : [], 60000);
  return { ok: run.code === 0, log: tail(run) };
}

export function isScheduled(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("schtasks", ["/Query", "/TN", TASK], { windowsHide: true, timeout: 15000 }, (error) => resolve(!error));
  });
}

// The weekly-report rule the original added to "what did I do this week", for /weekly.
export function ruleText() {
  const build = `node "${BIN}/build-calendar.mjs"`;
  const publishCmd = `node "${BIN}/publish-report.mjs"`;
  return [
    "Weekly report (week-calendar plugin). Do these steps in order:",
    `1. Run ${build} --list-untitled. For each session it lists, sum up its first typed message in 3 to 5 plain words (no quotes, no trailing period) and merge them into ${CALENDAR}/titles.json, a JSON object { "<sessionId>": "<summary>" }, keeping the entries already there. Skip this if the list is empty.`,
    `2. Run ${build} --export. It prints a JSON summary; the full data is in ${CALENDAR}/latest.json (sessions, totals, metrics, machineHours, prsMerged, noCommitSessions, survey).`,
    "3. Reply with exactly 3 lines, then the calendar path on a 4th line:",
    "   Line 1: what I mainly got done this week (from merged PR titles, session titles and commit subjects), with the number of PRs I authored (metrics.prsAuthored; prsMerged entries with yours: true) and how many teammate PRs I contributed commits to.",
    "   Line 2: which project took the most time, with its hours (parallel sessions counted once, excluded sessions left out), and the productive time percent.",
    "   Line 3: which no-commit sessions to pick up first next week (most recent and longest first, by title).",
    "4. Unless latest.json survey.answered is true, ask me the weekly survey with a question dialog, one call with three questions:",
    '   rating ("5 Excellent", "4 Good", "3 Okay", "1-2 Poor"); most valuable session (the three sessions with the most busyHours, by title);',
    '   most wasted session (up to three of the longest no-commit or excluded sessions that are not automated, plus "None"). If there are no-commit sessions, a second call asks the reason for up to four of the longest: blocked, exploratory, abandoned or parked.',
    `   Then write ${CALENDAR}/survey/<survey.isoWeek>.json: { "rating": 1-5, "mostValuable": { "sessionId", "title" } or null, "mostWasted": { ... } or null, "noCommitReasons": { "<sessionId>": "blocked" | "exploratory" | "abandoned" | "parked" }, "note": null, "answeredAt": "<ISO time now>" }, keeping fields already in the file. Then run ${build} --export again and ${publishCmd}.`,
    "   If I dismiss the survey, skip it and do not publish.",
    `Write files only under ${CALENDAR}/. Run only these scripts and git read commands; never change any repository.`,
  ].join("\n");
}

const avatars = new Map<string, Promise<string | null>>();

export function avatar(login: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return Promise.resolve(null);
  let hit = avatars.get(login);
  if (!hit) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    hit = fetch(`https://github.com/${login}.png?size=64`, { signal: abort.signal })
      .then(async (res) => (res.ok ? `data:${res.headers.get("content-type") ?? "image/png"};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}` : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    void hit.then((uri) => {
      if (uri === null) avatars.delete(login);
    });
    avatars.set(login, hit);
  }
  return hit;
}
