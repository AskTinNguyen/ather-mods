import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { type ActKind, type HomeView } from "../shared/contracts";
import { Button, CHANGE_ICONS, FadeIn, type Kit, SectionLabel, WhoLine } from "./ui";

// An intent opened to look at: where it stands, its proof (by session), who else tracks it, and today's
// lines. Looking never tracks it; Work on this here does, and the tracked one offers Stop tracking.
export function IntentScreen({ kit, who, intent, busy, run }: { kit: Kit; who: string; intent: NonNullable<HomeView["intentView"]>; busy: boolean; run: (kind: ActKind, id: string) => void }) {
  const { s, c, compact } = kit;
  return (
    <ScrollView style={s.screen}>
      <View style={s.content}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button kit={kit} variant="ghost" icon="ArrowLeft" accessibilityLabel="Back" onPress={() => run("back", "")} />
          <Text style={s.brand}>INTENT</Text>
        </View>
        <WhoLine kit={kit} who={who} />
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
