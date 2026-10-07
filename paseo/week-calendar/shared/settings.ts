import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// The original plugin's userConfig, plus the calendar style its agent kept in memory.
export const calendarSettings = defineSettings({
  id: "calendar",
  scope: "host",
  version: 1,
  schema: z.object({
    machineName: z.string().default(""),
    operator: z.string().default(""),
    availableHoursPerWeek: z.number().positive().default(168),
    reportsRepoUrl: z.string().default("https://github.com/AskTinNguyen/agent-reports.git"),
    ignoreFolders: z.string().default("AppData/Local/Temp,/tmp/"),
    githubLogin: z.string().default(""),
    gitEmails: z.string().default(""),
    theme: z.enum(["dark", "light"]).default("dark"),
    accent: z.string().default("#7c5cff"),
    colorBy: z.enum(["project", "task"]).default("project"),
    weekStart: z.enum(["monday", "sunday"]).default("monday"),
  }),
});

export type CalendarSettings = {
  machineName: string;
  operator: string;
  availableHoursPerWeek: number;
  reportsRepoUrl: string;
  ignoreFolders: string;
  githubLogin: string;
  gitEmails: string;
  theme: "dark" | "light";
  accent: string;
  colorBy: "project" | "task";
  weekStart: "monday" | "sunday";
};
