import type { PluginServerContext } from "@getpaseo/plugin/server";
import { weekAvatar, weekBuild, weekLatest, weekPublish, weekRule, weekSchedule } from "./shared/contracts";
import { calendarSettings, type CalendarSettings } from "./shared/settings";
import { avatar, build, install, isScheduled, latest, publish, ruleText, schedule } from "./server/calendar";

// week-calendar for Paseo: the original's scripts, installed to ~/.calendar/bin with the
// plugin's settings in ~/.calendar/config.json, run from the Week calendar screen or by an agent (/weekly).

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(calendarSettings);
  const apply = (values: CalendarSettings) => install(values).catch((error: unknown) => console.error("[week-calendar] install failed:", error));
  void settings
    .read()
    .then((state) => (state.status === "ready" ? apply(state.values as CalendarSettings) : console.error("[week-calendar] settings invalid:", state.error)))
    .catch((error: unknown) => console.error("[week-calendar] settings read failed:", error));
  const stopSettings = settings.subscribe((state) => {
    if (state.status === "ready") void apply(state.values as CalendarSettings);
  });

  server.handle(weekBuild, ({ weekOffset }) => build(weekOffset));
  server.handle(weekLatest, async () => ({ ...(await latest()), scheduled: await isScheduled() }));
  server.handle(weekPublish, ({ weekOffset, dryRun }) => publish(weekOffset, dryRun));
  server.handle(weekSchedule, ({ remove }) => schedule(remove));
  server.handle(weekRule, () => ({ text: ruleText() }));
  server.handle(weekAvatar, async ({ login }) => ({ uri: await avatar(login) }));

  console.log("[week-calendar] ready");
  return () => {
    stopSettings();
  };
}
