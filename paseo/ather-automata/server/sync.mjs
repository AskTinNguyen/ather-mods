// Dev only: copies the Claude Code mod's pure modules (../../ather-automata/hooks) into server/ather/,
// where the Paseo bundler can reach them. They are the same code; only the `// @ts-check` line is
// dropped (the plugin's typecheck does not check plain JS). Never edit server/ather/ by hand.
// It also gives package.json the mod's version, so the plugin's version names the release it matches.
//   npm run sync          copy them, take the version
//   npm run sync:check    fail if any copy or the version differs (dev/test-all.mjs runs this)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockVersions } from "../../../dev/branch.mjs";
import { mirror } from "../../../dev/mirror.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "../../../ather-automata/hooks");
const to = path.join(here, "ather");
// The engine-facing halves (watch.mjs, console.mjs, ather.mjs) are what this plugin replaces.
const SKIP = new Set(["ather.mjs", "watch.mjs", "console.mjs"]);
const isCheck = process.argv.includes("--check");

const files = [];
for (const dir of ["", "packs"]) {
  for (const name of fs.readdirSync(path.join(from, dir))) {
    if (name.endsWith(".mjs") && !SKIP.has(name)) files.push(path.posix.join(dir, name));
  }
}

// Line endings as committed, whatever the checkout's git settings did to them; only the `// @ts-check` line is dropped.
// A module removed upstream is removed here too.
const drift = mirror({ from, to, files, isCheck, transform: (text) => text.replace(/^\/\/ @ts-check\n/, "") });

// The plugin's version is the mod's: package.json carries the ather-automata release its copies match
// (paseo-plugin.json is strict and has no version field).
const modVersion = JSON.parse(fs.readFileSync(path.resolve(from, "../.claude-plugin/plugin.json"), "utf8")).version;
// package.json and its lockfile both carry it; each is written back as npm writes it (two spaces, a final newline).
const versioned = [
  { name: "package.json", versions: (json) => [json.version], set: (json) => void (json.version = modVersion) },
  { name: "package-lock.json", versions: lockVersions, set: (json) => void (json.version = json.packages[""].version = modVersion) },
];
for (const { name, versions, set } of versioned) {
  const file = path.resolve(here, "..", name);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const was = versions(json);
  if (was.every((one) => one === modVersion)) continue;
  if (isCheck) drift.push(`${name} version ${was.join("/")} (the mod is ${modVersion})`);
  else {
    set(json);
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`${name}: version ${was.join("/")} -> ${modVersion}`);
  }
}

if (isCheck && drift.length > 0) {
  console.error(`paseo/ather-automata is out of step with ather-automata: ${drift.join(", ")}. Run npm run sync in paseo/ather-automata.`);
  process.exit(1);
}
console.log(isCheck ? "paseo/ather-automata: shared modules in step" : `paseo/ather-automata: ${files.length} shared modules`);
