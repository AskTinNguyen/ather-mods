import { ScrollView, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { Linking, Text, View } from "react-native";
import { type ActKind, type HomeView } from "../shared/contracts";
import { Button, FadeIn, HoverCard, type Kit, WhoLine } from "./ui";

// An assigned issue opened to look at, as the Claude Code pane's issue card: Start an intent, Open on GitHub,
// Copy link. Pressing an issue row only opens this; nothing goes to the agent until Start an intent.
export function IssueScreen({ kit, who, issue, busy, run, now }: { kit: Kit; who: string; issue: NonNullable<HomeView["issueView"]>; busy: boolean; run: (kind: ActKind, id: string) => void; now: number }) {
  const { s, c, compact } = kit;
  const toast = useToast();
  // A link the app may open: https, printable characters only, of a sane length.
  const link = /^https:\/\/[\x21-\x7e]+$/.test(issue.url) && issue.url.length <= 2048 ? issue.url : "";
  const days = issue.updatedAt ? Math.floor((now - issue.updatedAt) / 86400000) : -1;
  const when = days < 0 ? "" : days >= 60 ? `${Math.floor(days / 30)} months ago` : days >= 2 ? `${days} days ago` : days === 1 ? "yesterday" : "today";
  const meta = [issue.isUrgent ? "High priority" : "", issue.area === "Unsorted" ? "" : issue.area, when ? `updated ${when}` : ""].filter(Boolean).join(" · ");
  return (
    <ScrollView style={s.screen}>
      <View style={s.content}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button kit={kit} variant="ghost" icon="ArrowLeft" accessibilityLabel="Back" onPress={() => run("back", "")} />
          <Text style={s.brand}>{`ISSUE #${issue.number}`}</Text>
        </View>
        <WhoLine kit={kit} who={who} />
        <FadeIn>
          <Text style={[s.title, { marginTop: 8 }]}>{issue.name || issue.title}</Text>
          {issue.name && issue.name !== issue.title ? <Text style={[s.hint, { marginTop: 4 }]}>{issue.title}</Text> : null}
          {meta ? <Text style={[s.hint, { marginTop: 6 }]}>{meta}</Text> : null}
          {issue.labels.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {issue.labels.slice(0, 8).map((label) => (
                <View key={label} style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
                  <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </FadeIn>

        <FadeIn delay={60}>
          <HoverCard kit={kit} style={{ marginTop: 16, gap: 12 }}>
            <Text style={s.rowTitle}>{issue.sent ? "Sent to the agent" : "Start an intent from this issue"}</Text>
            <Text style={s.hint}>
              The agent checks for overlapping work first (the issue preflight), then drafts an intent with you and shows you its prompt.md before anything is built. Ather reads your issues with gh and never writes to GitHub.
            </Text>
            <View style={s.buttons}>
              <Button kit={kit} variant="primary" icon="Play" label={issue.sent ? "Start again" : "Start an intent"} full={compact} disabled={busy} onPress={() => run("start", `issue:${issue.number}`)} />
              {link ? (
                <Button
                  kit={kit}
                  icon="ExternalLink"
                  label="Open on GitHub"
                  full={compact}
                  onPress={() => void Linking.openURL(link).catch(() => toast.error("Could not open the browser."))}
                />
              ) : null}
              {link ? (
                <Button
                  kit={kit}
                  icon="Copy"
                  label="Copy link"
                  full={compact}
                  onPress={() =>
                    void copyText(link).then(
                      () => toast.show("Issue link copied.", { variant: "success" }),
                      () => toast.error("Could not copy the link."),
                    )
                  }
                />
              ) : null}
            </View>
          </HoverCard>
        </FadeIn>
      </View>
    </ScrollView>
  );
}
