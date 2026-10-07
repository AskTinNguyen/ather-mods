import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { atherAct, atherHome, type HomeView } from "../shared/contracts";
import { Art } from "./art";
import { Beacon, Bob, Button, FadeIn, FillBar, GrowLine, isLight, type Kit, Pop, Pulse, Row, SectionLabel, useKit } from "./ui";

type ActKind = "item" | "next" | "work" | "action" | "skill" | "create" | "all" | "away" | "draft" | "view" | "back" | "track" | "untrack";

const REFRESH_MS = 5000;
const DONE_SHOWN = 3;
const CHANGE_ICONS = { done: "Check", yours: "Diamond", changed: "Pencil" } as const;

// The Ather pane for one agent: where the work is, what needs you, Next, other work, away.
export function AtherPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const kit = useKit(theme, layout.compact);
  const { s, c } = kit;
  const toast = useToast();
  const agent = useAgent(agentId, (one) => ({ cwd: one.cwd, title: one.title }));
  const cwd = agent?.cwd ?? "";
  const agentTitle = agent?.title || `Agent ${agentId.slice(0, 8)}`;
  // The checkout's folder name, e.g. "s2_new" from E:\s2_new.
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const home = useRpc(atherHome);
  const actRpc = useRpc(atherAct);
  const queryClient = useQueryClient();
  const key = ["ather", "home", agentId];
  const query = useQuery({ queryKey: key, queryFn: () => home({ agentId, cwd }), enabled: cwd !== "", refetchInterval: REFRESH_MS });
  const action = useMutation({
    mutationFn: (input: { kind: ActKind; id: string; text?: string }) => actRpc({ agentId, cwd, ...input }),
    onSuccess: ({ message }) => {
      if (message) toast.show(message, { variant: "success" });
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const refresh = useMutation({
    mutationFn: () => home({ agentId, cwd, refresh: true }),
    onSuccess: (view) => queryClient.setQueryData(key, view),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [goal, setGoal] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [isDraftFocused, setDraftFocused] = useState(false);

  const view = query.data;
  // Ticks once a second while a worker runs, for its running time.
  const now = useNow((view?.crew ?? []).some((one) => one.state === "running"));
  if (!view || !view.isHere) {
    return (
      <View style={[s.screen, s.content]}>
        <Text style={s.brand}>ATHER AUTOMATA</Text>
        <Text style={s.title}>Ather</Text>
        <Text style={[s.hint, { marginTop: 8 }]}>
          {view ? view.notHere : query.error ? `Ather could not load: ${(query.error as Error).message ?? String(query.error)}` : "Loading…"}
        </Text>
      </View>
    );
  }

  const busy = action.isPending;
  const run = (kind: ActKind, id: string, text?: string) => {
    if (!busy) action.mutate({ kind, id, text });
  };
  const isSent = (id: string) => view.sent.includes(id);
  const toggle = (name: string) => setOpen((prev) => ({ ...prev, [name]: !prev[name] }));
  const more = (name: string, total: number, shown: number) =>
    total > shown ? (
      <View style={{ alignItems: "flex-start" as const }}>
        <Button kit={kit} variant="ghost" icon={open[name] ? "ChevronUp" : "ChevronDown"} label={open[name] ? "Fewer" : `More (${total - shown})`} onPress={() => toggle(name)} />
      </View>
    ) : null;

  const next = view.next;
  const live = view.crew.filter((one) => one.state === "running" || one.state === "waiting");
  const ended = view.crew.filter((one) => one.state === "done" || one.state === "failed");
  const meta = [view.role, view.lock, view.week].filter(Boolean).join(" · ");
  const open_ = view.items.filter((one) => one.kind !== "away-end" && !isSent(one.id));

  if (view.intentView) {
    return <IntentScreen kit={kit} intent={view.intentView} busy={busy} run={run} />;
  }

  return (
    <ScrollView style={s.screen}>
      <View style={s.content}>
      {/* Masthead */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <Pop>
          <Art artKey={isLight(theme) ? "logo:light" : "logo:dark"} size={{ width: layout.compact ? 40 : 48, height: layout.compact ? 34 : 40 }} label="Ather" style={{ marginTop: 2 }} />
        </Pop>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.brand} accessibilityLabel="Ather Automata">
            ATHER AUTOMATA
          </Text>
          <Text style={s.title}>{view.title}</Text>
          {/* Which agent and checkout this pane speaks for. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
            <Icon name="Bot" size={12} color={c.foregroundMuted} />
            <Text style={[s.hint, { flexShrink: 1 }]} numberOfLines={1}>
              {[agentTitle, folder].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>
        {view.githubLogin ? (
          <FadeIn style={{ marginTop: 4 }}>
            <Art artKey={`github:${view.githubLogin}`} size={28} round label={`Signed in to GitHub as ${view.githubLogin}`} style={{ borderWidth: 1, borderColor: c.border }} />
          </FadeIn>
        ) : null}
        <Button
          kit={kit}
          variant="ghost"
          icon="RefreshCw"
          accessibilityLabel={refresh.isPending ? "Refreshing" : "Refresh"}
          disabled={refresh.isPending}
          spinning={refresh.isPending}
          onPress={() => refresh.mutate()}
        />
      </View>

      {view.stages.length > 0 ? (
        <FadeIn>
          <StageTrack kit={kit} stages={view.stages} />
        </FadeIn>
      ) : view.stage ? (
        <View style={{ alignSelf: "flex-start", marginTop: 10, backgroundColor: c.surface1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8 }}>
          <Text style={{ color: c.accent, fontSize: 12, fontWeight: "700" }}>{view.stage}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 12, gap: 6 }}>
        {[view.progress, view.sentence].filter(Boolean).length > 0 ? <Text style={s.body}>{[view.progress, view.sentence].filter(Boolean).join(" · ")}</Text> : null}
        {view.proof ? <Proof kit={kit} proof={view.proof} /> : null}
        {meta ? <Text style={s.hint}>{meta}</Text> : null}
        {view.heldBy ? (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Icon name="Users" size={14} color={c.statusWarning} />
            <Text style={[s.hint, { color: c.statusWarning, flex: 1 }]}>{view.heldBy}</Text>
          </View>
        ) : null}
        {view.message ? (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <View style={{ marginTop: 2 }}>
              <Icon name="MessageSquare" size={14} color={c.foregroundMuted} />
            </View>
            <Text style={[s.hint, { flex: 1 }]}>{view.message}</Text>
          </View>
        ) : null}
      </View>

      {view.away.phase === "running" ? (
        <FadeIn delay={0} style={[s.card, { marginTop: layout.compact ? 20 : 28 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Beacon size={16} color={c.accent} stroke={1.5} maxScale={2.6} duration={5200}>
              <Icon name="Moon" size={16} color={c.accent} />
            </Beacon>
            <Text style={s.label}>{`AWAY · ${view.away.until.toUpperCase()}`}</Text>
          </View>
          <Text style={s.hint}>{`Merges and other held actions wait for you. Questions go to ${view.away.ledger}.`}</Text>
          {view.away.parked.map((one) => (
            <View key={one} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <View style={{ marginTop: 3 }}>
                <Icon name="Lock" size={12} color={c.foregroundMuted} />
              </View>
              <Text style={[s.hint, { flex: 1 }]}>{one}</Text>
            </View>
          ))}
          <View style={s.buttons}>
            <Button kit={kit} variant="primary" icon="Sun" label="I'm back: end and review" disabled={busy} full={layout.compact} onPress={() => run("away", "back")} />
          </View>
        </FadeIn>
      ) : null}

      {view.items.length > 0 ? (
        <FadeIn delay={40} style={s.section}>
          <SectionLabel kit={kit} text="Needs you" count={open_.length || undefined} />
          {view.items.map((one, index) => (
            <Row
              key={one.id}
              kit={kit}
              index={index}
              pulse={!isSent(one.id)}
              icon={isSent(one.id) ? "Check" : "Diamond"}
              iconColor={isSent(one.id) ? c.foregroundMuted : c.accent}
              quiet={isSent(one.id)}
              title={one.label}
              hint={one.hint}
              detail={one.detail}
              accessibilityLabel={isSent(one.id) ? `${one.label}, sent` : one.label}
              disabled={busy}
              onPress={() => run("item", one.id)}
            />
          ))}
          {open_.length > 1 ? (
            <View style={[s.buttons, { marginTop: 6 }]}>
              <Button kit={kit} icon="ListChecks" label={`Go through all ${open_.length}, one at a time`} full={layout.compact} disabled={busy} onPress={() => run("all", "all")} />
            </View>
          ) : null}
        </FadeIn>
      ) : null}

      {next ? (
        <FadeIn delay={80} style={s.section}>
          <SectionLabel kit={kit} text="Next" />
          <View style={[s.card, { borderColor: c.accent, padding: next.draft !== undefined ? 12 : 4 }]}>
            {next.draft !== undefined ? (
              <>
                <Text style={s.rowTitle}>{next.label}</Text>
                {next.hint ? <Text style={s.hint}>{next.hint}</Text> : null}
                <TextInput
                  multiline
                  accessibilityLabel="Message to finish before sending"
                  placeholder="Finish the message, then send it"
                  value={draft ?? next.draft}
                  onChangeText={setDraft}
                  onFocus={() => setDraftFocused(true)}
                  onBlur={() => setDraftFocused(false)}
                  placeholderTextColor={c.foregroundMuted}
                  style={{
                    minHeight: 90,
                    color: c.foreground,
                    backgroundColor: c.surface2,
                    borderColor: isDraftFocused ? c.accent : c.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    lineHeight: 20,
                    textAlignVertical: "top",
                  }}
                />
                <View style={s.buttons}>
                  <Button kit={kit} variant="primary" icon="Send" label="Send to the agent" full={layout.compact} disabled={busy} onPress={() => run("draft", next.id, draft ?? next.draft)} />
                </View>
              </>
            ) : (
              <Row
                kit={kit}
                icon={isSent(next.id) ? "Check" : "ArrowRight"}
                iconColor={isSent(next.id) ? c.foregroundMuted : c.accent}
                quiet={isSent(next.id)}
                title={next.label}
                hint={next.hint}
                accessibilityLabel={isSent(next.id) ? `${next.label}, sent` : next.label}
                disabled={busy}
                onPress={() => run("next", next.id)}
              />
            )}
          </View>
        </FadeIn>
      ) : null}

      {view.stages.length > 0 || view.crew.length > 0 ? <SummaryStrip kit={kit} view={view} /> : null}

      {live.length > 0 ? (
        <FadeIn delay={60} style={s.section}>
          <SectionLabel kit={kit} text={`Workers · running ${live.filter((one) => one.state === "running").length}`} />
          {live.map((one, index) => (
            <CrewRow key={one.id} kit={kit} one={one} index={index} now={now} isLightTheme={isLight(theme)} />
          ))}
        </FadeIn>
      ) : null}

      {ended.length > 0 ? (
        <FadeIn delay={90} style={s.section}>
          <SectionLabel kit={kit} text={`Done ${ended.length}`}>
            <View style={{ flex: 1 }} />
            {ended.length > DONE_SHOWN ? (
              <Button kit={kit} variant="ghost" icon={open.done ? "ChevronUp" : "ChevronDown"} label={open.done ? "fold" : `all ${ended.length}`} onPress={() => toggle("done")} />
            ) : null}
          </SectionLabel>
          {(open.done ? ended : ended.slice(0, DONE_SHOWN)).map((one, index) => (
            <CrewRow key={one.id} kit={kit} one={one} index={index} now={now} isLightTheme={isLight(theme)} />
          ))}
        </FadeIn>
      ) : null}

      {view.changes.length > 0 ? (
        <FadeIn delay={120} style={s.section}>
          <SectionLabel kit={kit} text="Today in the intent" />
          {view.changes.map((one, index) => (
            <FadeIn key={`${index}-${one.time}`} delay={Math.min(index, 10) * 30}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4, paddingHorizontal: 8 }}>
              <View style={{ marginTop: 3 }}>
                <Icon name={CHANGE_ICONS[one.kind]} size={12} color={one.kind === "done" ? c.statusSuccess : one.kind === "yours" ? c.accent : c.foregroundMuted} />
              </View>
              <Text style={[s.body, { flex: 1, fontSize: 13, lineHeight: 18 }]}>{one.text}</Text>
              <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{one.time}</Text>
            </View>
            </FadeIn>
          ))}
        </FadeIn>
      ) : null}

      {view.work.length > 0 ? (
        <FadeIn delay={160} style={s.section}>
          <SectionLabel kit={kit} text={view.title === "Ather" ? "Pick something" : "Other work"} />
          {(open.work ? view.work : view.work.slice(0, 5)).map((one, index) => (
            <Row key={one.id} kit={kit} index={index} title={one.label} hint={one.hint} quiet={isSent(one.id)} disabled={busy} onPress={() => run("work", one.id)} />
          ))}
          {more("work", view.work.length, 5)}
        </FadeIn>
      ) : null}

      <FadeIn delay={200} style={s.section}>
        <SectionLabel kit={kit} text="Start" />
        <View style={s.buttons}>
          {view.actions.map((one, index) => (
            <Button key={one.id} kit={kit} variant={index === 0 ? "primary" : "secondary"} icon="Plus" label={one.label.replace(/^[＋+]\s*/, "")} disabled={busy} onPress={() => run("action", one.id)} />
          ))}
          {view.skills.length > 0 ? <Button kit={kit} icon={open.skills ? "ChevronDown" : "WandSparkles"} label="Skills" onPress={() => toggle("skills")} /> : null}
          {view.create.length > 0 ? <Button kit={kit} icon={open.create ? "ChevronDown" : "Sparkles"} label="Create" onPress={() => toggle("create")} /> : null}
        </View>
        {open.skills ? (
          <View style={{ marginTop: 8 }}>
            {view.skills.map((one, index) => (
              <Row key={one.id} kit={kit} index={index} title={one.label} hint={[one.group, one.hint].filter(Boolean).join(" · ")} disabled={busy} onPress={() => run("skill", one.id)} />
            ))}
          </View>
        ) : null}
        {open.create
          ? view.create.map((group) => {
              const name = `create:${group.group}`;
              return (
                <View key={group.group}>
                  <Text style={[s.subLabel, { paddingHorizontal: 8 }]}>{group.group.toUpperCase()}</Text>
                  {(open[name] ? group.items : group.items.slice(0, 3)).map((one, index) => (
                    <Row key={one.id} kit={kit} index={index} title={one.label} hint={one.hint} disabled={busy} onPress={() => run("create", one.id)} />
                  ))}
                  {more(name, group.items.length, 3)}
                </View>
              );
            })
          : null}
      </FadeIn>

      {view.away.phase === "off" ? (
        <FadeIn delay={240} style={s.section}>
          <SectionLabel kit={kit} text={view.offerAway ? "Heading off?" : "Away"} />
          <Text style={[s.hint, { paddingHorizontal: 2 }]}>
            The agent keeps working. It may push branches and open PRs; nothing merges until you are back, and every decision is written down for you.
          </Text>
          <TextInput
            accessibilityLabel="Goal while you are away"
            placeholder="Goal (optional)"
            value={goal}
            onChangeText={setGoal}
            placeholderTextColor={c.foregroundMuted}
            style={{ height: 40, marginTop: 8, color: c.foreground, backgroundColor: c.surface2, borderColor: c.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, fontSize: 14 }}
          />
          <View style={[s.buttons, { marginTop: 8 }]}>
            {view.awayChoices.map((one, index) => (
              <Button
                key={one.id}
                kit={kit}
                variant={index === 0 ? "primary" : "secondary"}
                icon={index === 0 ? "Moon" : "Clock"}
                label={one.label}
                full={layout.compact && view.awayChoices.length > 2}
                disabled={busy}
                onPress={() => run("away", one.id, goal)}
              />
            ))}
          </View>
        </FadeIn>
      ) : null}
      </View>
    </ScrollView>
  );
}

// Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○, drawn: filled for done, a ring for now, an outline for to do.
function StageTrack({ kit, stages }: { kit: Kit; stages: HomeView["stages"] }) {
  const { c, compact } = kit;
  const spoken = stages.map((one) => `${one.label} ${one.state === "done" ? "done" : one.state === "now" ? "current" : "to do"}`).join(", ");
  return (
    // Fixed-width nodes keep each label centred under its circle; the connectors share what is left.
    <View accessibilityRole="progressbar" accessibilityLabel={spoken} style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 16, marginLeft: compact ? -14 : -18, width: "100%", maxWidth: 480 }}>
      {stages.map((one, index) => {
        const circle =
          one.state === "done" ? (
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
              <Icon name="Check" size={12} color={c.accentForeground} />
            </View>
          ) : one.state === "now" ? (
            // The ring and the dot are placed by coordinates, not by flex centring: 20 across, the dot 8, so 6 in.
            <Beacon size={20} color={c.accent} count={2} duration={5200} maxScale={3}>
              <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.accent }} />
              <View style={{ position: "absolute", top: 6, left: 6, width: 8, height: 8 }}>
                <Pulse>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
                </Pulse>
              </View>
            </Beacon>
          ) : (
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: c.border }} />
          );
        const connectorLit = index > 0 && stages[index - 1]?.state === "done";
        return [
          index > 0 ? <GrowLine key={`line-${one.label}`} kit={kit} lit={connectorLit} delay={index * 140 - 70} /> : null,
          <View key={one.label} style={{ width: compact ? 48 : 56, alignItems: "center", gap: 6 }}>
            <Pop delay={index * 140}>{circle}</Pop>
            <Text
              numberOfLines={1}
              style={{ fontSize: compact ? 11 : 12, color: one.state === "todo" ? c.foregroundMuted : c.foreground, fontWeight: one.state === "now" ? "700" : "500" }}
            >
              {one.label}
            </Text>
          </View>,
        ];
      })}
    </View>
  );
}

// "build ✓ · tests ✗" as chips: a pass or fail icon and the word.
function Proof({ kit, proof }: { kit: Kit; proof: string }) {
  const { c, s } = kit;
  const pieces = proof
    .split(" · ")
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => ({ word: piece.replace(/\s*[✓✗]$/, ""), state: piece.endsWith("✓") ? "pass" : piece.endsWith("✗") ? "fail" : "none" }));
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }} accessibilityLabel={`Proof: ${pieces.map((one) => `${one.word} ${one.state === "pass" ? "passed" : one.state === "fail" ? "failed" : ""}`).join(", ")}`}>
      <Text style={s.hint}>Proof</Text>
      {pieces.map((one) => (
        <View key={one.word} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.surface1, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8 }}>
          <Icon name={one.state === "pass" ? "CircleCheck" : one.state === "fail" ? "CircleX" : "Circle"} size={12} color={one.state === "pass" ? c.statusSuccess : one.state === "fail" ? c.statusDanger : c.foregroundMuted} />
          <Text style={{ color: c.foreground, fontSize: 12 }}>{one.word}</Text>
        </View>
      ))}
    </View>
  );
}

// The kinds' own colours (squad.mjs), for the kind word beside each avatar on dark themes.
const KIND_COLOURS: Record<string, string> = { editor: "#f08a3c", builder: "#2f8cf0", tester: "#2fbfa8", scout: "#c9b3ee", reviewer: "#f2d27a", general: "#ec5fa4" };

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// 3:21, or 1:02:09 past an hour.
function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Checklist, workers, decisions: the three numbers that say how the work stands.
function SummaryStrip({ kit, view }: { kit: Kit; view: HomeView }) {
  const { c, compact } = kit;
  const running = view.crew.filter((one) => one.state === "running").length;
  const decisions = view.items.filter((one) => one.kind === "call").length;
  const tile = (key: string, label: string, body: ReactNode, highlight = false, delay = 0) => (
    <FadeIn key={key} delay={delay} style={{ flexBasis: compact ? "30%" : "28%", flexGrow: 1 }}>
      <View style={{ padding: 12, gap: 6, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: highlight ? c.accent : c.border, minHeight: 78 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
        {body}
      </View>
    </FadeIn>
  );
  const big = (value: string, word: string, tone?: string) => (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
      <Text style={{ color: tone ?? c.foreground, fontSize: compact ? 22 : 26, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{value}</Text>
      {word ? <Text style={{ color: tone ?? c.foregroundMuted, fontSize: 13, fontWeight: "600" }}>{word}</Text> : null}
    </View>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: compact ? 16 : 20 }}>
      {tile(
        "checklist",
        "Checklist",
        <>
          {big(view.total > 0 ? `${view.done}/${view.total}` : "—", "")}
          {view.total > 0 ? <FillBar kit={kit} fraction={view.done / view.total} /> : null}
        </>,
      )}
      {tile("workers", "Workers", big(String(running), "running"), false, 50)}
      {tile("decisions", "Decisions", big(String(decisions), "waiting", decisions > 0 ? c.accent : undefined), decisions > 0, 100)}
    </View>
  );
}

// One worker, as the original drew it: its avatar (a body for its kind, holding what it is doing)
// in a ring for its state, floating while it runs; what it is, on which model, doing what; how long
// and how many tool calls. A finished one shows its steps and what came of it.
function CrewRow({ kit, one, index, now, isLightTheme }: { kit: Kit; one: HomeView["crew"][number]; index: number; now: number; isLightTheme: boolean }) {
  const { c, s } = kit;
  const isEnded = one.state === "done" || one.state === "failed";
  const ring = one.state === "running" ? c.accent : one.state === "done" ? c.statusSuccess : one.state === "failed" ? c.statusDanger : c.statusWarning;
  const kindColour = isLightTheme ? c.foreground : (KIND_COLOURS[one.kind] ?? c.foreground);
  const doing = isEnded ? one.outcome || one.propWord : one.propWord;
  const calls = one.toolCalls > 0 ? `${one.toolCalls} tool call${one.toolCalls === 1 ? "" : "s"}` : "";
  const timing =
    one.state === "running" && one.startedAt
      ? `running ${clock(now - one.startedAt)}`
      : one.state === "waiting" && one.endedAt
        ? `quiet for ${clock(now - one.endedAt)}`
        : one.state === "done" && one.startedAt
          ? `took ${clock(one.endedAt - one.startedAt)}`
          : one.state === "failed" && one.startedAt
            ? `stopped at ${clock(one.endedAt - one.startedAt)}`
            : "";
  const stats = [timing, calls, one.source === "agent" ? "Paseo agent" : ""].filter(Boolean).join(" · ");
  const mark = one.state === "done" ? "Check" : one.state === "failed" ? "X" : null;
  const held = one.prop ?? (isEnded ? (one.props[one.props.length - 1] ?? "none") : "none");
  return (
    <FadeIn delay={Math.min(index, 10) * 40}>
      <View
        accessibilityLabel={`${one.title}: ${one.kindWord}${one.model ? ` on ${one.model}` : ""}, ${doing}. ${stats}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: c.border }}
      >
        <Bob active={one.state === "running"}>
          <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: ring, alignItems: "center", justifyContent: "center" }}>
            <Art artKey={`avatar:${one.kind}:${held}`} size={38} round />
          </View>
        </Bob>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[s.rowTitle, { fontSize: 15 }, isEnded ? { color: c.foregroundMuted } : null]} numberOfLines={1}>
            {one.title}
          </Text>
          <Text style={s.hint} numberOfLines={2}>
            <Text style={{ color: kindColour, fontWeight: "700" }}>{one.kindWord}</Text>
            {one.model ? <Text style={{ color: c.foreground }}>{` ${one.model}`}</Text> : null}
            {` · ${doing}`}
          </Text>
          {isEnded && (one.props.length > 0 || stats) ? (
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
              {one.props.map((prop, at) => [
                at > 0 ? <Icon key={`arrow-${at}`} name="ArrowRight" size={10} color={c.foregroundMuted} /> : null,
                <Art key={`${prop}-${at}`} artKey={`prop:${prop}`} size={18} label={prop} />,
              ])}
              {mark ? <Icon name={mark} size={13} color={ring} /> : null}
              {stats ? <Text style={[s.hint, { fontSize: 12 }]}>{`${one.props.length > 0 || mark ? " · " : ""}${stats}`}</Text> : null}
            </View>
          ) : stats ? (
            <Text style={[s.hint, { fontSize: 12, fontVariant: ["tabular-nums"] }]}>{stats}</Text>
          ) : null}
        </View>
        {mark ? (
          <Icon name={mark} size={16} color={ring} />
        ) : (
          <Pulse>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ring }} />
          </Pulse>
        )}
      </View>
    </FadeIn>
  );
}

// An intent opened to look at: where it stands, its proof (by session), who else tracks it, and today's
// lines. Looking never tracks it; Work on this here does, and the tracked one offers Stop tracking.
function IntentScreen({ kit, intent, busy, run }: { kit: Kit; intent: NonNullable<HomeView["intentView"]>; busy: boolean; run: (kind: ActKind, id: string) => void }) {
  const { s, c, compact } = kit;
  return (
    <ScrollView style={s.screen}>
      <View style={s.content}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button kit={kit} variant="ghost" icon="ArrowLeft" accessibilityLabel="Back" onPress={() => run("back", "")} />
          <Text style={s.brand}>INTENT</Text>
        </View>
        <FadeIn>
          <Text style={[s.title, { marginTop: 8 }]}>{intent.slug}</Text>
          <Text style={[s.hint, { marginTop: 4 }]}>{[intent.stage, intent.progress, intent.owner].filter(Boolean).join(" · ")}</Text>
          {intent.goal ? <Text style={[s.body, { marginTop: 10 }]}>{intent.goal}</Text> : null}
          {intent.proof ? <Text style={[s.hint, { marginTop: 8 }]}>{`Proof: ${intent.proof}`}</Text> : null}
          {intent.heldBy ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 }}>
              <Icon name="Users" size={14} color={c.statusWarning} />
              <Text style={[s.hint, { color: c.statusWarning, flex: 1 }]}>{intent.heldBy}</Text>
            </View>
          ) : null}
        </FadeIn>

        <FadeIn delay={60} style={[s.buttons, { marginTop: 16 }]}>
          {intent.isHere ? (
            <Button kit={kit} icon="CircleStop" label="Stop tracking" full={compact} disabled={busy} onPress={() => run("untrack", "")} />
          ) : (
            <Button kit={kit} variant="primary" icon="Play" label="Work on this here" full={compact} disabled={busy} onPress={() => run("track", intent.slug)} />
          )}
        </FadeIn>
        {!intent.isHere ? (
          <Text style={[s.hint, { marginTop: 8 }]}>This agent gets its next step, its proof counts for the intent, and other sessions see you on it. /ather untrack undoes it.</Text>
        ) : null}

        {intent.isHere && intent.next ? (
          <FadeIn delay={90} style={s.section}>
            <SectionLabel kit={kit} text="Next" />
            <View style={[s.card, { borderColor: c.accent }]}>
              <Text style={s.rowTitle}>{intent.next}</Text>
            </View>
          </FadeIn>
        ) : null}

        <FadeIn delay={120} style={s.section}>
          <SectionLabel kit={kit} text="Today" />
          {intent.today.length === 0 ? (
            <Text style={[s.hint, { paddingHorizontal: 8 }]}>Nothing recorded yet today.</Text>
          ) : (
            intent.today.map((one, index) => (
              <FadeIn key={`${index}-${one.time}`} delay={Math.min(index, 10) * 30}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4, paddingHorizontal: 8 }}>
                  <View style={{ marginTop: 3 }}>
                    <Icon name={CHANGE_ICONS[one.kind]} size={12} color={one.kind === "done" ? c.statusSuccess : one.kind === "yours" ? c.accent : c.foregroundMuted} />
                  </View>
                  <Text style={[s.body, { flex: 1, fontSize: 13, lineHeight: 18 }]}>{one.text}</Text>
                  <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{one.time}</Text>
                </View>
              </FadeIn>
            ))
          )}
        </FadeIn>
      </View>
    </ScrollView>
  );
}
