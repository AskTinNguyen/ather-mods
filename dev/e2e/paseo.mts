// End-to-end run of the Paseo plugin's server (paseo/ather-automata/server) over a real git checkout: what the
// panel and the composer pill are given, through the same calls the daemon makes (homeView, act, runCommand,
// bandOf). Needs paseo/ather-automata's npm install; Paseo itself is not needed. Run from paseo/ather-automata:
// `node --import ./server/test-resolve.mjs --experimental-strip-types ../../dev/e2e/paseo.mts [report.md]`.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { checks, join, runArgs, sandbox, until } from "./harness.mjs";

const { report: REPORT } = runArgs();
const BASE = sandbox("ather-paseo-");
const { expect, finish } = checks();
// The plugin keeps its store under PASEO_HOME, read when its modules load: set first.
process.env.PASEO_HOME = join(BASE, "paseo-home");
const { act, bandOf, homeView, runCommand } = await import("../../paseo/ather-automata/server/console.ts");

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const FEAT = "# Scale\n\n- Rev: 1\n- Status: active\n- Area: Web\n- Owner: Tin Nguyen\n- Branch: `feat/x`\n\n## Acceptance\n\n- [x] A1: scale reads from config.\n- [ ] A2: scale shows in the HUD.\n";

// A checkout on feat/x with a commit of its own; a teammate then changes the same line on main.
const origin = join(BASE, "origin.git");
const tree = join(BASE, "web");
git(BASE, "init", "-q", "--bare", origin);
git(BASE, "init", "-q", tree);
git(tree, "config", "user.name", "Tin Nguyen");
git(tree, "config", "user.email", "tin@example.com");
fs.mkdirSync(join(tree, "docs/intent/feat-x"), { recursive: true });
fs.mkdirSync(join(tree, "src"), { recursive: true });
fs.writeFileSync(join(tree, "docs/intent/feat-x/prompt.md"), FEAT);
fs.writeFileSync(join(tree, "src/a.js"), "export const scale = 1\n");
git(tree, "add", "-A");
git(tree, "commit", "-q", "-m", "start");
git(tree, "remote", "add", "origin", origin);
git(tree, "push", "-q", "origin", "main");
git(tree, "checkout", "-q", "-b", "feat/x");
fs.writeFileSync(join(tree, "src/a.js"), "export const scale = 2\n");
git(tree, "commit", "-q", "-am", "scale up");
const other = join(BASE, "other");
git(BASE, "clone", "-q", origin, other);
fs.writeFileSync(join(other, "src/a.js"), "export const scale = 0.5\n");
git(other, "-c", "user.name=Lena Park", "-c", "user.email=lena@example.com", "commit", "-q", "-am", "scale down");
git(other, "push", "-q", "origin", "main");

const AGENT = "paseo-agent-0001";
const view = () => homeView(AGENT, tree, true);
const items = async () => (await view()).needs.blocks.flatMap((block) => block.items);

const tracked = await runCommand(AGENT, tree, "ather", "intent feat-x");
expect("the agent tracks feat-x", /feat-x/.test(tracked), tracked);
const found = await until(async () => (await items()).some((one) => one.kind === "collide"));
const collide = (await items()).find((one) => one.kind === "collide");
expect("after the fetch, Needs you has the collision: the branch, the press, who changed the lines and where", found && collide?.label === "feat/x no longer merges cleanly into origin/main" && collide?.hint === "Bring origin/main into feat/x" && /▲ 1 overlap: origin\/main changed these lines .*\(Lena Park\)\. src\/a\.js:1/.test(collide?.detail ?? ""), collide);
const warned = await view();
expect("the merge line says it in warning", warned.merge.text === "▲ 1 overlap with origin/main · see Needs you" && warned.merge.isWarn, warned.merge);
const urgent = await bandOf(AGENT, tree);
expect("the composer pill says something needs you", urgent?.urgent === true && urgent.label === "1 needs you", urgent);

// Simple and Advanced (simple-view), the choice kept for the person.
const simpleSaid = await runCommand(AGENT, tree, "ather", "simple");
const simple = await view();
expect("/ather simple: the panel shows the title, status, Needs you, Needs attention, Next and the toggle", /\/ather advanced/.test(simpleSaid) && simple.shows.join(" ") === "title status needs attention next view" && simple.viewToggle === "Advanced view", [simpleSaid, simple.shows, simple.viewToggle]);
const pressed = await act(AGENT, tree, "pane", "");
const advanced = await view();
expect("the toggle brings every part back", /\/ather simple/.test(pressed) && advanced.shows.includes("merge") && advanced.shows.includes("crew") && advanced.viewToggle === "Simple view", [pressed, advanced.shows]);

// The agent brings main in: the next read finds nothing to bring, says it merges cleanly, and the pill is the stage.
try {
  git(tree, "merge", "-q", "origin/main");
} catch {
  fs.writeFileSync(join(tree, "src/a.js"), "export const scale = 1\n");
  git(tree, "commit", "-q", "-am", "merge main");
}
const clean = await until(async () => /^Merges cleanly into origin\/main · checked (just now|\dm ago)$/.test((await view()).merge.text));
expect("once main is merged in, the merge line says it merges cleanly", clean, (await view()).merge);
expect("… and Needs you no longer has it", !(await items()).some((one) => one.kind === "collide"), await items());
const pill = await bandOf(AGENT, tree);
expect("with nothing needing you, the composer pill is the tracked intent's stage", pill?.urgent === false && pill.label === "● Build 1/2 · feat-x", pill);

fs.rmSync(BASE, { recursive: true, force: true });
finish({ title: "Ather Automata for Paseo: the server over a real checkout", report: REPORT });
