import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { type HomeView } from "../shared/contracts";
import { Art } from "./art";
import { Bob, FadeIn, type Kit, Pulse, SectionLabel } from "./ui";

// The workers, as crew.mjs crewTree lays them out on the daemon: the live ones under the heading ("Workers · Running
// 2"), each with the workers it started beneath it, then the last three finished with theirs.
export function CrewSection({ kit, view, now, isLightTheme }: { kit: Kit; view: HomeView; now: number; isLightTheme: boolean }) {
  const { s } = kit;
  const workers = new Map(view.crew.map((one) => [one.id, one]));
  const lines = (list: HomeView["crewTree"]["live"]) =>
    list.map((line, index) => <CrewLine key={line.id} kit={kit} line={line} one={workers.get(line.id)} index={index} now={now} isLightTheme={isLightTheme} />);
  const doneRoots = view.crewTree.done.filter((line) => line.depth === 0 && line.fold === 0).length;
  return (
    <>
      {view.crewTree.live.length > 0 ? (
        <FadeIn delay={60} style={s.section}>
          <SectionLabel kit={kit} text={view.crewTree.heading} />
          {lines(view.crewTree.live)}
        </FadeIn>
      ) : null}
      {view.crewTree.done.length > 0 ? (
        <FadeIn delay={90} style={s.section}>
          <SectionLabel kit={kit} text={`Done ${doneRoots}`} />
          {lines(view.crewTree.done)}
        </FadeIn>
      ) : null}
    </>
  );
}

// The kinds' own colours (squad.mjs), for the kind word beside each avatar on dark themes.
const KIND_COLOURS: Record<string, string> = { editor: "#f08a3c", builder: "#2f8cf0", tester: "#2fbfa8", scout: "#c9b3ee", reviewer: "#f2d27a", general: "#ec5fa4" };

// 3:21, or 1:02:09 past an hour.
function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// One line of the workers tree: a worker indented under the one that started it ("started by …" when that one
// is not right above), or a parent's finished workers past the first few, as "+N finished".
function CrewLine({ kit, line, one, index, now, isLightTheme }: { kit: Kit; line: HomeView["crewTree"]["live"][number]; one: HomeView["crew"][number] | undefined; index: number; now: number; isLightTheme: boolean }) {
  const { s } = kit;
  const indent = { marginLeft: Math.min(line.depth, 4) * 20 };
  if (line.fold > 0) return <Text style={[s.hint, indent, { paddingVertical: 6, paddingHorizontal: 8 }]}>{`+${line.fold} finished`}</Text>;
  if (!one) return null;
  return (
    <View style={indent}>
      {line.via ? <Text style={[s.hint, { paddingHorizontal: 8, paddingTop: 6, fontSize: 12 }]}>{`started by ${line.via}`}</Text> : null}
      <CrewRow kit={kit} one={one} index={index} now={now} isLightTheme={isLightTheme} />
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

