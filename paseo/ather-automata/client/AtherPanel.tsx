import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ActKind, atherAct, atherHome, type HomeView } from "../shared/contracts";
import { Art } from "./art";
import { CrewSection } from "./CrewSection";
import { IntentScreen } from "./IntentScreen";
import { IssueScreen } from "./IssueScreen";
import { NeedsYou } from "./NeedsYou";
import { WorkSection } from "./WorkSection";
import { Beacon, Button, ChangeLine, FadeIn, FillBar, GrowLine, isLight, type Kit, NextRow, Pop, Pulse, Row, SectionLabel, useKit, WhoLine } from "./ui";


const REFRESH_MS = 5000;

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
  const who = [agentTitle, folder].filter(Boolean).join(" · ");
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
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)) });
  const refresh = useMutation({
    mutationFn: () => home({ agentId, cwd, refresh: true }),
    onSuccess: (view) => queryClient.setQueryData(key, view),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)) });
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
  // A search is no press: it goes even while one is in flight, keeps the rows enabled and says nothing.
  const search = (text: string) =>
    void actRpc({ agentId, cwd, kind: "find", id: "", text })
      .then(() => queryClient.invalidateQueries({ queryKey: key }))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
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
  const meta = [view.role, view.lock, view.week].filter(Boolean).join(" · ");

  if (view.intentView) {
    return <IntentScreen kit={kit} who={who} intent={view.intentView} busy={busy} isSent={isSent} run={run} />;
  }
  if (view.issueView) {
    return <IssueScreen kit={kit} who={who} issue={view.issueView} busy={busy} run={run} now={now} />;
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
          <WhoLine kit={kit} who={who} />
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
        {/* How fresh the team's intents are; pressing it fetches origin now (the header's Refresh does too). */}
        {view.sync ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${view.sync.replace(" ↻", "")}. Sync now`} disabled={refresh.isPending} onPress={() => refresh.mutate()} style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
            <Text style={s.hint}>{view.sync}</Text>
          </Pressable>
        ) : null}
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

      {view.needs.blocks.length > 0 || view.needs.folded.length > 0 ? <NeedsYou kit={kit} needs={view.needs} busy={busy} isSent={isSent} run={run} /> : null}

      {/* Your own intents that want a press: every item met, or parked with no reason. A press opens the intent. */}
      {view.attention.length > 0 ? (
        <FadeIn delay={60} style={s.section}>
          <SectionLabel kit={kit} text="Needs attention" count={view.attention.length} />
          {view.attention.map((one, index) => (
            <Row key={one.id} kit={kit} index={index} icon={one.kind === "close" ? "CircleCheck" : "Pause"} iconColor={c.accent} title={`${one.title} · ${one.ask}`} disabled={busy} onPress={() => run("view", one.slug)} />
          ))}
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
                    textAlignVertical: "top" }}
                />
                <View style={s.buttons}>
                  <Button kit={kit} variant="primary" icon="Send" label="Send to the agent" full={layout.compact} disabled={busy} onPress={() => run("draft", next.id, draft ?? next.draft)} />
                </View>
              </>
            ) : (
              <NextRow kit={kit} step={next} isSent={isSent(next.id)} busy={busy} onPress={() => run("next", next.id)} />
            )}
          </View>
        </FadeIn>
      ) : null}

      {view.stages.length > 0 || view.crew.length > 0 ? <SummaryStrip kit={kit} view={view} /> : null}

      <CrewSection kit={kit} view={view} now={now} isLightTheme={isLight(theme)} />

      {view.changes.length > 0 ? (
        <FadeIn delay={120} style={s.section}>
          <SectionLabel kit={kit} text="Today in the intent" />
          {view.changes.map((one, index) => (
            <ChangeLine key={`${index}-${one.time}`} kit={kit} one={one} index={index} />
          ))}
        </FadeIn>
      ) : null}

      {view.workList.total > 0 ? <WorkSection kit={kit} view={view} busy={busy} isSent={isSent} run={run} search={search} light={isLight(theme)} /> : null}

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
            <Beacon size={20} color={c.accent} count={1} duration={5200} maxScale={3}>
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

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// Checklist, workers, decisions: the three numbers that say how the work stands.
function SummaryStrip({ kit, view }: { kit: Kit; view: HomeView }) {
  const { c, compact } = kit;
  const running = view.crew.filter((one) => one.state === "running").length;
  const decisions = view.needs.decisions;
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
