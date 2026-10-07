import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { weekBuild, weekLatest, weekPublish, weekSchedule, type WeekSummary } from "../shared/contracts";
import { Avatar } from "./Avatar";
import { Button, CountUp, FadeIn, FillBar, type Kit, Row, SectionLabel, useKit } from "./ui";

const KEY = ["week-calendar", "latest"];
const pct = (value: number | null | undefined) => (typeof value === "number" ? `${Math.round(value * 100)}%` : "—");
const hours = (value: number) => `${value.toFixed(1)} h`;
// Waiting on a person past this many hours a week is worth a second look.
const WAITING_WARN_HOURS = 10;

type Confirm = "publish" | "unschedule" | null;

export function WeekSurface({ theme, layout }: PluginSurfaceProps) {
  const kit = useKit(theme, layout.compact);
  const { s, c, compact } = kit;
  const toast = useToast();
  const queryClient = useQueryClient();
  const latestRpc = useRpc(weekLatest);
  const buildRpc = useRpc(weekBuild);
  const publishRpc = useRpc(weekPublish);
  const scheduleRpc = useRpc(weekSchedule);
  const latest = useQuery({ queryKey: KEY, queryFn: () => latestRpc({}) });
  const [log, setLog] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const fail = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    setLog(text);
    toast.error(text.split("\n")[0] ?? text);
  };

  const build = useMutation({
    mutationFn: () => buildRpc({ weekOffset: 0 }),
    onSuccess: ({ summary, log: text }) => {
      setLog(text);
      if (summary) toast.show(`Built ${summary.isoWeek}`, { variant: "success" });
      else toast.error("The build failed: see the log.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: (dryRun: boolean) => publishRpc({ weekOffset: 0, dryRun }),
    onSuccess: ({ ok, log: text }, dryRun) => {
      setLog(text);
      if (ok) toast.show(dryRun ? "Dry run finished: nothing was pushed." : "Report published.", { variant: "success" });
      else toast.error("Publishing failed: see the log.");
    },
    onError: fail,
  });
  const schedule = useMutation({
    mutationFn: (remove: boolean) => scheduleRpc({ remove }),
    onSuccess: ({ ok, log: text }, remove) => {
      setLog(text);
      if (ok) toast.show(remove ? "Weekly job removed." : "Weekly job scheduled: Mondays 06:00.", { variant: "success" });
      else toast.error("Scheduling failed: see the log.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: fail,
  });
  const busy = build.isPending || publish.isPending || schedule.isPending;
  const summary: WeekSummary | null | undefined = latest.data?.summary;
  const isScheduled = latest.data?.scheduled === true;
  const builtAt = latest.data?.builtAt ? new Date(latest.data.builtAt).toLocaleString() : "";

  const actions = (
    <View style={[s.buttons, { marginTop: compact ? 20 : 16 }]}>
      <Button kit={kit} variant="primary" icon="Hammer" label={build.isPending ? "Building…" : "Build this week"} full={compact} disabled={busy} onPress={() => build.mutate()} />
      <Button kit={kit} icon="FlaskConical" label="Publish (dry run)" full={compact} disabled={busy || !summary} onPress={() => publish.mutate(true)} />
      <Button kit={kit} icon="Upload" label="Publish…" full={compact} disabled={busy || !summary} onPress={() => setConfirm("publish")} />
      {isScheduled ? (
        <Button kit={kit} variant="ghost" danger icon="CalendarX" label="Remove weekly job" full={compact} disabled={busy} onPress={() => setConfirm("unschedule")} />
      ) : (
        <Button kit={kit} icon="CalendarClock" label="Schedule weekly job" full={compact} disabled={busy} onPress={() => schedule.mutate(false)} />
      )}
    </View>
  );

  return (
    <ScrollView style={s.screen}>
      <View style={s.content}>
      <Text style={s.brand} accessibilityLabel="Week calendar">
        WEEK CALENDAR
      </Text>
      <Text style={s.title}>{summary ? summary.isoWeek : "This week"}</Text>
      <View style={{ marginTop: 4, gap: 2 }}>
        {summary ? (
          <>
            <Text style={s.hint}>{`${summary.week.start} – ${summary.week.end} · ${summary.machine}`}</Text>
            <Text style={s.hint}>{`Built ${builtAt}${isScheduled ? " · weekly job on" : ""}`}</Text>
          </>
        ) : (
          <Text style={s.hint}>{latest.isLoading ? "Loading…" : "Not built yet this week. Build it to see the figures."}</Text>
        )}
      </View>

      {!compact || !summary ? actions : null}

      {summary ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: compact ? 16 : 24 }}>
            <Stat kit={kit} label="PRs merged" value={`${summary.prsMerged.length}`} amount={summary.prsMerged.length} format={(n) => `${Math.round(n)}`} sub={`${summary.prsAuthored ?? 0} yours`} />
            <Stat kit={kit} delay={60} label="Productive" value={pct(summary.productiveUtilization)} amount={typeof summary.productiveUtilization === "number" ? summary.productiveUtilization * 100 : undefined} format={(n) => `${Math.round(n)}%`} sub={hours(summary.hours.productive)} bar={summary.productiveUtilization ?? null} />
            <Stat kit={kit} delay={120} label="Agent busy" value={hours(summary.hours.busy)} amount={summary.hours.busy} format={hours} sub={`of ${hours(summary.hours.available)}`} />
            <Stat
              kit={kit}
              delay={180}
              label="Waiting on you"
              value={hours(summary.hours.waitingOnPerson)}
              amount={summary.hours.waitingOnPerson}
              format={hours}
              sub={`idle ${hours(summary.hours.idle)}`}
              tint={summary.hours.waitingOnPerson > WAITING_WARN_HOURS ? c.statusWarning : undefined}
            />
          </View>
          {compact ? actions : null}

          <View style={s.section}>
            <SectionLabel kit={kit} text="Projects" />
            {summary.projects.slice(0, 5).map((one, index) => (
              <Row key={one.project} kit={kit} index={index} title={one.project} hint={`${one.sessions} sessions`} trailing={hours(one.hours)} />
            ))}
          </View>

          {summary.prsMerged.length > 0 ? (
            <View style={s.section}>
              <SectionLabel kit={kit} text="PRs merged" count={summary.prsMerged.length} />
              {summary.prsMerged.slice(0, 10).map((one, index) => (
                <FadeIn key={`${one.repo}#${one.number}`} delay={Math.min(index, 10) * 30}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: compact ? 8 : 6, paddingHorizontal: 8 }}>
                    {/* The author's face; an accent ring marks your own PRs. */}
                    <Avatar login={one.author} size={24} ring={one.yours ? c.accent : c.border} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.rowTitle} numberOfLines={2}>
                        {one.title}
                      </Text>
                      <Text style={s.hint}>{`${one.repo}#${one.number}${one.author ? ` · ${one.author}` : ""}${one.yours ? " · yours" : ""}`}</Text>
                    </View>
                  </View>
                </FadeIn>
              ))}
            </View>
          ) : null}

          {summary.noCommit.length > 0 ? (
            <View style={s.section}>
              <SectionLabel kit={kit} text="No-commit sessions" count={summary.noCommit.length} />
              {summary.noCommit.slice(0, 8).map((one, index) => (
                <Row key={one.sessionId} kit={kit} index={index} title={one.title ?? one.sessionId.slice(0, 8)} hint={one.project ?? undefined} trailing={`${Math.round(one.minutes)} min`} />
              ))}
            </View>
          ) : null}

          {summary.excluded.length > 0 ? (
            <View style={s.section}>
              <SectionLabel kit={kit} text="Excluded" count={summary.excluded.length} />
              {summary.excluded.slice(0, 6).map((one, index) => (
                <Row key={one.sessionId} kit={kit} index={index} quiet icon="EyeOff" iconColor={c.foregroundMuted} title={one.title ?? one.sessionId.slice(0, 8)} hint={one.reason ?? undefined} />
              ))}
            </View>
          ) : null}

          <View style={[s.section, { gap: 4 }]}>
            <Text style={s.hint}>{`Calendar: ${summary.html.replace(/week-[^\\/]+\.html$/, "latest.html")}`}</Text>
            <Text style={s.hint}>For the three-line summary and the weekly survey, type /weekly in an agent.</Text>
          </View>
        </>
      ) : null}

      {log ? (
        <View style={s.section}>
          <SectionLabel kit={kit} text="Log">
            <View style={{ flex: 1 }} />
            <Button
              kit={kit}
              variant="ghost"
              icon="Copy"
              accessibilityLabel="Copy the log"
              onPress={() =>
                void copyText(log).then(
                  () => toast.show("Log copied."),
                  () => toast.error("Could not copy the log."),
                )
              }
            />
          </SectionLabel>
          <View style={{ backgroundColor: c.surface1, borderRadius: 8, maxHeight: 240 }}>
            <ScrollView contentContainerStyle={{ padding: 10 }} nestedScrollEnabled>
              <Text selectable style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 16, fontFamily: kit.mono }}>
                {log}
              </Text>
            </ScrollView>
          </View>
        </View>
      ) : null}

      <Modal
        title={confirm === "unschedule" ? "Remove the weekly job?" : "Publish this week's report?"}
        icon={<Icon name={confirm === "unschedule" ? "CalendarX" : "Upload"} size={18} color={c.foreground} />}
        open={confirm !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirm(null);
        }}
      >
        <Modal.Content>
          <Text style={s.body}>
            {confirm === "unschedule"
              ? "This PC stops building and publishing last week's report every Monday. You can schedule it again at any time."
              : "This pushes this PC's weekly report (session titles, prompts and commits, with secrets redacted) to the team's agent-reports repo."}
          </Text>
          <View style={[s.buttons, { justifyContent: compact ? "flex-start" : "flex-end" }]}>
            <Button kit={kit} variant="ghost" label="Cancel" full={compact} onPress={() => setConfirm(null)} />
            <Button
              kit={kit}
              variant="primary"
              icon={confirm === "unschedule" ? "CalendarX" : "Upload"}
              label={confirm === "unschedule" ? "Remove" : "Publish"}
              full={compact}
              onPress={() => {
                const what = confirm;
                setConfirm(null);
                if (what === "publish") publish.mutate(false);
                if (what === "unschedule") schedule.mutate(true);
              }}
            />
          </View>
        </Modal.Content>
      </Modal>
      </View>
    </ScrollView>
  );
}

function Stat({ kit, label, value, sub, bar, tint, delay = 0, amount, format }: { kit: Kit; label: string; value: string; sub: string; bar?: number | null; tint?: string; delay?: number; amount?: number; format?: (n: number) => string }) {
  const { c, compact } = kit;
  return (
    <FadeIn delay={delay} style={{ flexBasis: "45%", flexGrow: 1 }}>
    <View
      accessibilityLabel={`${label}: ${value}, ${sub}`}
      style={{ flexGrow: 1, padding: 12, gap: 4, backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: 10 }}
    >
      {/* The figure counts up when shown; the spoken label always has the final value. */}
      {typeof amount === "number" && format ? (
        <CountUp value={amount} format={format} style={{ color: tint ?? c.foreground, fontSize: compact ? 24 : 28, lineHeight: compact ? 30 : 34, fontWeight: "700", fontVariant: ["tabular-nums"] }} />
      ) : (
        <Text style={{ color: tint ?? c.foreground, fontSize: compact ? 24 : 28, lineHeight: compact ? 30 : 34, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
      )}
      {typeof bar === "number" ? (
        <FillBar kit={kit} fraction={bar} />
      ) : null}
      <Text style={{ color: c.foregroundMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{sub}</Text>
    </View>
    </FadeIn>
  );
}
