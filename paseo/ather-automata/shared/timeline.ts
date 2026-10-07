import { z } from "zod";

// Ather's pop-ups: a row in the agent's timeline (a trap with its fix, a false build pass,
// a held action, a merge that lost edits, a command's reply).
export const NOTE_KIND = "ather-note";
export const NOTE_VERSION = 1;
export const noteSchema = z.object({
  tone: z.enum(["info", "ok", "warn", "bad"]),
  text: z.string(),
});
export type Note = z.infer<typeof noteSchema>;
