// Dev only: copies the Claude Code mod's pure modules (../../ather-automata/hooks) into server/ather/,
// where the Paseo bundler can reach them. They are the same code; only the `// @ts-check` line is
// dropped (the plugin's typecheck does not check plain JS). Never edit server/ather/ by hand.
//   npm run sync          copy them
//   npm run sync:check    fail if any copy differs (dev/test-all.mjs runs this)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "../../../ather-automata/hooks");
const to = path.join(here, "ather");
// The engine-facing halves (watch.mjs, console.mjs, ather.mjs) are what this plugin replaces.
const SKIP = new Set(["ather.mjs", "watch.mjs", "console.mjs"]);
const isCheck = process.argv.includes("--check");

const files = [];
for (const dir of ["", "packs"]) {
  for (const name of fs.readdirSync(path.join(from, dir))) {
    if (name.endsWith(".mjs") && !SKIP.has(name)) files.push(path.join(dir, name));
  }
}

const drift = [];
for (const file of files) {
  // Line endings as committed, whatever the checkout's git settings did to them.
  const text = fs.readFileSync(path.join(from, file), "utf8").replace(/\r\n/g, "\n").replace(/^\/\/ @ts-check\n/, "");
  const target = path.join(to, file);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
  if (current === text) continue;
  if (isCheck) drift.push(file);
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    console.log(`synced ${file}`);
  }
}
// A module removed upstream is removed here too.
for (const dir of ["", "packs"]) {
  for (const name of fs.readdirSync(path.join(to, dir))) {
    const file = path.join(dir, name);
    if (!name.endsWith(".mjs") || files.includes(file)) continue;
    if (isCheck) drift.push(`${file} (removed upstream)`);
    else {
      fs.rmSync(path.join(to, file));
      console.log(`removed ${file}`);
    }
  }
}

if (isCheck && drift.length > 0) {
  console.error(`paseo/ather-automata/server/ather is out of step with ather-automata/hooks: ${drift.join(", ")}. Run npm run sync in paseo/ather-automata.`);
  process.exit(1);
}
console.log(isCheck ? "paseo/ather-automata: shared modules in step" : `paseo/ather-automata: ${files.length} shared modules`);
