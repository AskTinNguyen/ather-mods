import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const atherSettings = defineSettings({
  id: "ather",
  scope: "host",
  version: 1,
  schema: z.object({
    // Worker briefs that lack paths, acceptance checks or the shared-tree rule: warn adds a note,
    // enforce refuses the Agent call, off does nothing. Read-only agents (Explore, Plan) are never gated.
    briefGate: z.enum(["warn", "enforce", "off"]).default("warn"),
    // Add Claude ask rules for held commands, so holds work even in bypass mode. The plugin answers
    // those prompts itself: allowed unless an away window holds them.
    holdRules: z.boolean().default(true),
    // When a turn's tool output shows a false build pass or a merge that lost edits, tell the session at once.
    followUps: z.boolean().default(true),
  }),
});

export type AtherSettings = {
  briefGate: "warn" | "enforce" | "off";
  holdRules: boolean;
  followUps: boolean;
};

export const DEFAULT_SETTINGS: AtherSettings = { briefGate: "warn", holdRules: true, followUps: true };
