import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { createGoal, createTrainingBlock, createWeeklyReview, getArcana, pinArcana, saveRecoveryCheckin, type ArcanaCard, type ArcanaData } from "../lib/api";
import { useTransmuteTheme } from "../theme/transmute-theme";

const today = () => new Date().toISOString().slice(0, 10);
const weekStart = () => {
  const day = new Date();
  day.setDate(day.getDate() - day.getDay());
  return day.toISOString().slice(0, 10);
};

function CardDetail({ card, data, close, reload }: { card: ArcanaCard; data: ArcanaData; close: () => void; reload: (data?: ArcanaData) => void }) {
  const { palette } = useTransmuteTheme();
  const evidence = card.stageEvidence[card.stage];
  const pin = async (slot: "past" | "present" | "becoming") => {
    reload(await pinArcana(slot, card.id));
    close();
  };
  return <Modal transparent animationType="fade" onRequestClose={close}>
    <View style={detailStyles.backdrop}>
      <View style={[detailStyles.sheet, { backgroundColor: palette.raised, borderColor: palette.divider }]}>
        <Text style={[detailStyles.overline, { color: palette.muted }]}>ARCANA {String(card.number).padStart(2, "0")}</Text>
        <Text style={[detailStyles.title, { color: palette.ink }]}>{card.name}</Text>
        <Text style={[detailStyles.copy, { color: palette.body }]}>{card.focus}</Text>
        <Text style={[detailStyles.stage, { color: palette.gold }]}>{card.stage.toUpperCase()}</Text>
        {card.earnedAt ? <Text style={[detailStyles.copy, { color: palette.muted }]}>Earned {new Date(card.earnedAt).toLocaleDateString()}</Text> : null}
        {evidence?.summary ? <Text style={[detailStyles.evidence, { color: palette.body }]}>{evidence.summary}</Text> : <Text style={[detailStyles.evidence, { color: palette.muted }]}>No qualifying evidence has been recorded yet.</Text>}
        {card.nextMilestone ? <Text style={[detailStyles.next, { color: palette.ink }]}>Next: {card.nextMilestone.description} · {card.nextMilestone.current}/{card.nextMilestone.target}</Text> : <Text style={[detailStyles.next, { color: palette.gold }]}>All four stages are earned.</Text>}
        {card.stage !== "unrevealed" ? <View style={detailStyles.pinRow}>{(["past", "present", "becoming"] as const).map((slot) => <Pressable key={slot} onPress={() => void pin(slot)} style={[detailStyles.pinButton, { borderColor: data.pins[slot] === card.id ? palette.gold : palette.divider }]}><Text style={[detailStyles.pinText, { color: palette.ink }]}>{slot}</Text></Pressable>)}</View> : null}
        <Pressable onPress={close} style={[detailStyles.close, { backgroundColor: palette.oxide }]}><Text style={[detailStyles.closeText, { color: palette.surface }]}>Close</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

export function ArcanaContent() {
  const { palette } = useTransmuteTheme();
  const [data, setData] = useState<ArcanaData | null>(null);
  const [selected, setSelected] = useState<ArcanaCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [recovery, setRecovery] = useState("3");
  const [block, setBlock] = useState("");
  const [review, setReview] = useState("");
  const [goal, setGoal] = useState("");
  const reload = (next?: ArcanaData) => {
    if (next) { setData(next); return; }
    getArcana().then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to read Arcana."));
  };
  useEffect(() => {
    let active = true;
    getArcana().then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to read Arcana."); });
    return () => { active = false; };
  }, []);
  const revealed = useMemo(() => data?.cards.filter((card) => card.stage !== "unrevealed").length ?? 0, [data]);
  const save = async (key: string, action: () => Promise<unknown>) => {
    setSaving(key); setError(null);
    try { await action(); reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save that record."); } finally { setSaving(null); }
  };
  if (!data) return <View style={arcanaStyles.loading}><ActivityIndicator color={palette.oxide} /><Text style={{ color: palette.body }}>Reading the Arcana…</Text>{error ? <Text style={{ color: palette.destructive }}>{error}</Text> : null}</View>;
  const pinned = (["past", "present", "becoming"] as const).map((slot) => ({ slot, card: data.cards.find((card) => card.id === data.pins[slot]) }));
  return <>
    <Text style={[arcanaStyles.eyebrow, { color: palette.muted }]}>PERSONAL ARCANA · RULES V{data.ruleVersion}</Text>
    <Text style={[arcanaStyles.title, { color: palette.ink }]}>A truthful record of your work.</Text>
    <Text style={[arcanaStyles.copy, { color: palette.body }]}>{revealed} of 15 cards revealed. Stages are permanent; the evidence remains attached to the work that earned it.</Text>
    <View style={arcanaStyles.spread}>{pinned.map(({ slot, card }) => <View key={slot} style={[arcanaStyles.spreadCell, { borderColor: palette.divider, backgroundColor: palette.raised }]}><Text style={[arcanaStyles.spreadLabel, { color: palette.muted }]}>{slot.toUpperCase()}</Text><Text style={[arcanaStyles.spreadName, { color: palette.ink }]}>{card?.name ?? "Unpinned"}</Text></View>)}</View>
    <View style={arcanaStyles.grid}>{data.cards.map((card) => <Pressable key={card.id} onPress={() => setSelected(card)} style={[arcanaStyles.card, { backgroundColor: palette.raised, borderColor: card.stage === "unrevealed" ? palette.divider : palette.gold }]}><Text style={[arcanaStyles.number, { color: card.stage === "unrevealed" ? palette.mutedSoft : palette.gold }]}>{String(card.number).padStart(2, "0")}</Text><Text style={[arcanaStyles.cardName, { color: palette.ink }]}>{card.stage === "unrevealed" ? "—" : card.name}</Text><Text style={[arcanaStyles.cardStage, { color: palette.muted }]}>{card.stage}</Text></Pressable>)}</View>
    <Text style={[arcanaStyles.section, { color: palette.ink }]}>Record where the work happens</Text>
    <Text style={[arcanaStyles.copy, { color: palette.body }]}>These are small journal inputs, not a competing dashboard. They make recovery, planning, reflection, and reassessment visible to the Arcana.</Text>
    <View style={[arcanaStyles.tracker, { borderColor: palette.divider, backgroundColor: palette.raised }]}>
      <Text style={[arcanaStyles.trackerTitle, { color: palette.ink }]}>Daily recovery</Text><Text style={[arcanaStyles.trackerHelp, { color: palette.muted }]}>1–5 readiness score for today.</Text>
      <TextInput value={recovery} onChangeText={setRecovery} keyboardType="number-pad" style={[arcanaStyles.input, { color: palette.ink, borderColor: palette.divider }]} />
      <Pressable onPress={() => void save("recovery", () => saveRecoveryCheckin(today(), { recoveryScore: Number(recovery) }))} style={[arcanaStyles.action, { backgroundColor: palette.oxide }]}><Text style={[arcanaStyles.actionText, { color: palette.surface }]}>{saving === "recovery" ? "Saving…" : "Save check-in"}</Text></Pressable>
    </View>
    <View style={[arcanaStyles.tracker, { borderColor: palette.divider, backgroundColor: palette.raised }]}>
      <Text style={[arcanaStyles.trackerTitle, { color: palette.ink }]}>Training block</Text><TextInput value={block} onChangeText={setBlock} placeholder="Block name" placeholderTextColor={palette.mutedSoft} style={[arcanaStyles.input, { color: palette.ink, borderColor: palette.divider }]} />
      <Pressable onPress={() => void save("block", () => createTrainingBlock({ name: block, startDate: today(), endDate: new Date(Date.now() + 27 * 864e5).toISOString().slice(0, 10), targetSessionsPerWeek: 3 }))} style={[arcanaStyles.action, { backgroundColor: palette.oxide }]}><Text style={[arcanaStyles.actionText, { color: palette.surface }]}>{saving === "block" ? "Saving…" : "Start four-week block"}</Text></Pressable>
    </View>
    <View style={[arcanaStyles.tracker, { borderColor: palette.divider, backgroundColor: palette.raised }]}>
      <Text style={[arcanaStyles.trackerTitle, { color: palette.ink }]}>Weekly review</Text><TextInput value={review} onChangeText={setReview} multiline placeholder="What did you learn?" placeholderTextColor={palette.mutedSoft} style={[arcanaStyles.input, arcanaStyles.multiline, { color: palette.ink, borderColor: palette.divider }]} />
      <Pressable onPress={() => void save("review", () => createWeeklyReview({ weekStart: weekStart(), weekEnd: today(), reflection: review }))} style={[arcanaStyles.action, { backgroundColor: palette.oxide }]}><Text style={[arcanaStyles.actionText, { color: palette.surface }]}>{saving === "review" ? "Saving…" : "Save review"}</Text></Pressable>
    </View>
    <View style={[arcanaStyles.tracker, { borderColor: palette.divider, backgroundColor: palette.raised }]}>
      <Text style={[arcanaStyles.trackerTitle, { color: palette.ink }]}>Goal and reassessment</Text><TextInput value={goal} onChangeText={setGoal} placeholder="A concrete goal" placeholderTextColor={palette.mutedSoft} style={[arcanaStyles.input, { color: palette.ink, borderColor: palette.divider }]} />
      <Pressable onPress={() => void save("goal", () => createGoal({ title: goal, category: "habit" }))} style={[arcanaStyles.action, { backgroundColor: palette.oxide }]}><Text style={[arcanaStyles.actionText, { color: palette.surface }]}>{saving === "goal" ? "Saving…" : "Add goal"}</Text></Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: palette.destructive }}>{error}</Text> : null}
    {selected ? <CardDetail card={selected} data={data} close={() => setSelected(null)} reload={reload} /> : null}
  </>;
}

const arcanaStyles = StyleSheet.create({ loading: { gap: 10, padding: 30, alignItems: "center" }, eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }, title: { fontSize: 29, fontWeight: "900", marginTop: 8 }, copy: { fontSize: 15, lineHeight: 22, marginTop: 8 }, spread: { flexDirection: "row", gap: 8, marginTop: 20 }, spreadCell: { flex: 1, borderWidth: 1, padding: 10, minHeight: 72 }, spreadLabel: { fontSize: 10, letterSpacing: 1, fontWeight: "800" }, spreadName: { fontSize: 14, fontWeight: "800", marginTop: 8 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 }, card: { width: "31%", minHeight: 112, borderWidth: 1, padding: 11, justifyContent: "space-between" }, number: { fontSize: 12, fontWeight: "900", letterSpacing: 1 }, cardName: { fontSize: 16, fontWeight: "900" }, cardStage: { fontSize: 11, textTransform: "uppercase" }, section: { fontSize: 22, fontWeight: "900", marginTop: 30 }, tracker: { borderWidth: 1, padding: 14, marginTop: 14 }, trackerTitle: { fontSize: 17, fontWeight: "900" }, trackerHelp: { fontSize: 13, marginTop: 4 }, input: { borderWidth: 1, marginTop: 10, minHeight: 42, paddingHorizontal: 10, fontSize: 15 }, multiline: { minHeight: 80, paddingTop: 10, textAlignVertical: "top" }, action: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, marginTop: 10 }, actionText: { fontSize: 13, fontWeight: "900" }, });
const detailStyles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: "#00000099", justifyContent: "flex-end" }, sheet: { borderWidth: 1, padding: 22, gap: 10 }, overline: { fontSize: 11, fontWeight: "900", letterSpacing: 1.5 }, title: { fontSize: 27, fontWeight: "900" }, copy: { fontSize: 15, lineHeight: 21 }, stage: { fontSize: 13, fontWeight: "900", letterSpacing: 1.3 }, evidence: { fontSize: 14, lineHeight: 20, marginTop: 4 }, next: { fontSize: 14, fontWeight: "800", lineHeight: 20 }, pinRow: { flexDirection: "row", gap: 8, marginTop: 4 }, pinButton: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }, pinText: { fontSize: 12, fontWeight: "900", textTransform: "capitalize" }, close: { alignItems: "center", padding: 12, marginTop: 4 }, closeText: { fontWeight: "900" }, });
