import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// The daemon-side stand-ins for what Claude Code gave the original mod as `$`:
// a key-value store, files, processes, and one Io per agent for state.mjs.

export const DATA_DIR = join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "ather-automata");
export const USER_HOME = homedir().split("\\").join("/");

export const fwd = (path: string) => path.split("\\").join("/").replace(/\/+$/, "");

// ---------------------------------------------------------------- the store

// One JSON file for every agent, as Claude Code's plugin store was one per machine.
// Writes are batched; state.mjs already serializes read-modify-write.
class Store {
  private values: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | null = null;
  private readonly file = join(DATA_DIR, "store.json");

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    try {
      this.values = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
    } catch {
      this.values = {};
    }
  }

  get(key: string): unknown {
    const value = this.values[key];
    return value === undefined ? undefined : structuredClone(value);
  }

  set(key: string, value: unknown) {
    this.values[key] = structuredClone(value);
    this.schedule();
  }

  remove(key: string) {
    delete this.values[key];
    this.schedule();
  }

  keys() {
    return Object.keys(this.values);
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.values));
      renameSync(tmp, this.file);
    } catch (error) {
      console.error("[ather] store write failed:", error);
    }
  }
}

export const store = new Store();

// ---------------------------------------------------------------- files and processes

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function writeText(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export type Entry = { name: string; kind: "file" | "dir"; mtimeMs: number };

export async function list(path: string): Promise<Entry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const out: Entry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const mtimeMs = await stat(join(path, entry.name)).then(
      (s) => s.mtimeMs,
      () => 0,
    );
    out.push({ name: entry.name, kind: entry.isDirectory() ? "dir" : "file", mtimeMs });
  }
  return out;
}

export async function mtime(path: string): Promise<number> {
  return stat(path).then(
    (s) => s.mtimeMs,
    () => 0,
  );
}

export type Run = { exitCode: number; stdout: string; stderr: string };

export function run(argv: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<Run> {
  const [file, ...args] = argv;
  return new Promise((resolve) => {
    execFile(
      file ?? "",
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30000,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? Number((error as { code?: unknown }).code) : -1) : 0;
        // A process that never started (ENOENT) has no stderr: report why instead.
        resolve({ exitCode: code, stdout: String(stdout ?? ""), stderr: String(stderr || (error ? error.message : "")) });
      },
    );
  });
}

// ---------------------------------------------------------------- the checkout

const roots = new Map<string, Promise<string>>();
const users = new Map<string, Promise<string>>();

// The checkout a folder is in (its git top level), with forward slashes; the folder itself outside git.
export function rootOf(cwd: string): Promise<string> {
  const key = fwd(cwd);
  let hit = roots.get(key);
  if (!hit) {
    hit = run(["git", "rev-parse", "--show-toplevel"], { cwd, timeoutMs: 10000 }).then((r) =>
      r.exitCode === 0 && r.stdout.trim() ? fwd(r.stdout.trim()) : key,
    );
    roots.set(key, hit);
  }
  return hit;
}

export function gitUserOf(cwd: string): Promise<string> {
  const key = fwd(cwd);
  let hit = users.get(key);
  if (!hit) {
    hit = run(["git", "config", "user.name"], { cwd, timeoutMs: 10000 }).then((r) => r.stdout.trim());
    // A name that failed to read is asked again next time.
    void hit.then((name) => {
      if (name === "") users.delete(key);
    });
    users.set(key, hit);
  }
  return hit;
}

// ---------------------------------------------------------------- one agent's Io for state.mjs

export type Io = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
  read: (path: string) => Promise<string | null>;
  write: (path: string, text: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  sessionId: () => Promise<string>;
  root: () => Promise<string>;
  gitUser: () => Promise<string>;
  redraw: () => void;
  list: (path: string) => Promise<Entry[]>;
};

// An agent is a lane: its id plays the part of the Claude Code session id.
export function ioFor(agentId: string, cwd: string): Io {
  return {
    get: async (key) => store.get(key),
    set: async (key, value) => store.set(key, value),
    remove: async (key) => store.remove(key),
    keys: async () => store.keys(),
    read: readText,
    write: writeText,
    exists: async (path) => existsSync(path),
    sessionId: async () => agentId,
    root: () => rootOf(cwd),
    gitUser: () => gitUserOf(cwd),
    redraw: () => undefined,
    list,
  };
}
