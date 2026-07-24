import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from './alchemy-svg';
import { getRecord, signOut, type TransmuteRecord } from '../lib/api';

const ouroboros = require('../../assets/transmute/ouroboros.svg');

const nav = [
  ['dashboard', 'Dashboard'], ['workout-plans', 'Workout plans'], ['exercises', 'Exercise library'], ['sessions', 'Sessions'], ['nutrition', 'Nutrition'], ['fasting', 'Fasting'], ['progress', 'Progress'], ['friends', 'Friend'], ['settings', 'Settings'], ['admin', 'Admin'],
] as const;

type Area = (typeof nav)[number][0];

function label(value: string | null | undefined) { return value ? value.replace(/_/g, ' ') : 'Unassigned'; }
function date(value: string) { return new Date(value).toLocaleDateString(); }
function Card({ title, meta }: { title: string; meta?: string }) { return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}</View>; }

export function RecordScreen({ area }: { area: Area }) {
  const [record, setRecord] = useState<TransmuteRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getRecord().then(setRecord).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load your record.')); }, []);
  const leave = async () => { await signOut(); router.replace('/'); };
  const content = record ? renderArea(area, record) : null;
  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><View style={styles.wrap}>
    <View style={styles.header}><Pressable accessibilityLabel="Go to dashboard" accessibilityRole="link" onPress={() => router.replace('/dashboard')} style={styles.wordmark}><AlchemySvg source={ouroboros} width={38} height={38} /><Text style={styles.wordmarkText}>TRANSMUTE</Text></Pressable><Pressable accessibilityRole="button" onPress={leave}><Text style={styles.signOut}>Sign out</Text></Pressable></View>
    <View accessibilityRole="tablist" style={styles.nav}>{nav.filter(([key]) => key !== 'admin' || record?.isAdmin).map(([key, name]) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: key === area }} key={key} onPress={() => router.replace(`/${key}`)} style={styles.navButton}><Text style={[styles.navItem, key === area && styles.navActive]}>{name}</Text></Pressable>)}</View>
    <ScrollView contentContainerStyle={styles.content}>{error ? <><Text style={styles.title}>The record is unavailable.</Text><Text style={styles.body}>{error}</Text></> : !record ? <View style={styles.loading}><ActivityIndicator color="#642D2A" /><Text style={styles.body}>Reading your record…</Text></View> : content}</ScrollView>
  </View></SafeAreaView>;
}

function renderArea(area: Area, r: TransmuteRecord): ReactNode {
  if (area === 'dashboard') return <><Text style={styles.eyebrow}>THE WORKBENCH</Text><Text style={styles.title}>Welcome back, {r.user.name}.</Text><Text style={styles.body}>{r.dashboard.activeSession ? `Active: ${r.dashboard.activeSession.routine_name ?? 'workout'} — ${r.dashboard.activeSession.day_name ?? 'today'}.` : 'Your training record is ready for the next input.'}</Text><View style={styles.grid}><Card title={`${r.workoutPlans.length} plans`} meta="Workout plans" /><Card title={`${r.sessions.length} sessions`} meta="Training record" /><Card title={`${r.nutrition.meals.length} meals`} meta="Nutrition log" /><Card title={`${r.progress.length} check-ins`} meta="Progress record" /></View></>;
  if (area === 'workout-plans') return <><Text style={styles.eyebrow}>THE PROGRAM</Text><Text style={styles.title}>Workout plans</Text><Text style={styles.body}>Build the work before you perform it.</Text>{r.workoutPlans.length ? r.workoutPlans.map((plan) => <View key={plan.id} style={styles.planCard}><Text style={styles.cardTitle}>{plan.name}</Text>{plan.description ? <Text style={styles.cardMeta}>{plan.description}</Text> : null}{plan.days.length ? plan.days.sort((a, b) => a.sortOrder - b.sortOrder).map((day) => <View key={day.id} style={styles.dayRow}><Text style={styles.dayName}>{day.name}</Text><Text style={styles.dayMeta}>{day.exerciseCount} exercises</Text></View>) : <Text style={styles.cardMeta}>No days in this plan yet.</Text>}</View>) : <Card title="No workout plans yet" meta="Your first plan will appear here." />}</>;
  if (area === 'exercises') return <List title="Exercise library" intro="Your shared library and saved movement record." items={r.exercises} render={(x) => <Card title={x.name} meta={`${label(x.category)}${x.muscle_group ? ` · ${x.muscle_group}` : ''}`} />} />;
  if (area === 'sessions') return <List title="Sessions" intro="Every completed set leaves evidence." items={r.sessions} render={(x) => <Card title={x.routine_name ?? 'Open session'} meta={`${label(x.status)} · ${x.set_count} sets · ${date(x.started_at)}`} />} />;
  if (area === 'nutrition') return <><Text style={styles.eyebrow}>THE FUEL</Text><Text style={styles.title}>Nutrition</Text><Text style={styles.body}>Food library: {r.nutrition.foods.length}. Recent meal entries:</Text>{r.nutrition.meals.map((x) => <Card key={x.id} title={x.name} meta={`${label(x.meal_type)} · ${x.calories_kcal} kcal · ${date(x.consumed_at)}`} />)}</>;
  if (area === 'fasting') return <><Text style={styles.eyebrow}>THE INTERVAL</Text><Text style={styles.title}>Fasting</Text><Text style={styles.body}>{r.fasting.active ? `Active since ${date(r.fasting.active.started_at)}.` : 'No active fast.'}</Text>{r.fasting.logs.map((x) => <Card key={x.id} title={`${x.duration_minutes} minutes`} meta={`${date(x.ended_at)}${x.note ? ` · ${x.note}` : ''}`} />)}</>;
  if (area === 'progress') return <List title="Progress" intro="Keep the evidence that proves the exchange." items={r.progress} render={(x) => <Card title={date(x.captured_at)} meta={x.note ?? 'Progress photo'} />} />;
  if (area === 'friends') return <><Text style={styles.eyebrow}>THE CIRCLE</Text><Text style={styles.title}>Friends</Text><Text style={styles.body}>Incoming requests</Text>{r.friends.incoming.map((x) => <Card key={x.id} title={x.name ?? x.username} meta={label(x.status)} />)}<Text style={[styles.body, styles.section]}>Outgoing requests</Text>{r.friends.outgoing.map((x) => <Card key={x.id} title={x.name ?? x.username} meta={label(x.status)} />)}</>;
  if (area === 'settings') return <><Text style={styles.eyebrow}>THE SETTINGS</Text><Text style={styles.title}>Your preferences</Text><Card title={`Weight unit: ${r.settings.weight_unit}`} meta={r.settings.active_routine_id ? 'An active plan is selected.' : 'No active plan selected.'} /></>;
  return <><Text style={styles.eyebrow}>THE ADMINISTRATION</Text><Text style={styles.title}>Admin</Text><Text style={styles.body}>Administrative controls remain protected to the verified Transmute administrator.</Text></>;
}

function List<T>({ title, intro, items, render }: { title: string; intro: string; items: T[]; render: (item: T) => ReactNode }) { return <><Text style={styles.eyebrow}>THE RECORD</Text><Text style={styles.title}>{title}</Text><Text style={styles.body}>{intro}</Text>{items.length ? items.map(render) : <Card title="Nothing recorded yet" meta="Your first entry will appear here." />}</>; }

const styles = StyleSheet.create({ safeArea: { backgroundColor: '#F4EFE7', flex: 1 }, wrap: { flex: 1, maxWidth: 1120, width: '100%', alignSelf: 'center', paddingHorizontal: 24 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }, wordmark: { alignItems: 'center', flexDirection: 'row', gap: 10 }, wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 }, signOut: { color: '#101015', fontSize: 14, fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' }, nav: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, borderTopColor: '#D4C9B9', borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18, paddingVertical: 12 }, navButton: { paddingHorizontal: 2, paddingVertical: 5 }, navItem: { color: '#5F5752', fontSize: 14, fontWeight: '700' }, navActive: { color: '#101015', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' }, content: { paddingBottom: 56, maxWidth: 760 }, eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5, marginTop: 18 }, title: { color: '#101015', fontSize: 42, fontWeight: '900', letterSpacing: -2.2, lineHeight: 44, marginTop: 12 }, body: { color: '#2C2C31', fontSize: 17, lineHeight: 27, marginTop: 14 }, loading: { alignItems: 'flex-start', gap: 8, marginTop: 100 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 22 }, card: { borderColor: '#D4C9B9', borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 16, backgroundColor: '#FBF7F0', minWidth: 220 }, planCard: { borderColor: '#101015', borderRadius: 12, borderWidth: 1, marginTop: 16, padding: 18, backgroundColor: '#FBF7F0' }, dayRow: { borderTopColor: '#D4C9B9', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 12 }, dayName: { color: '#101015', fontSize: 16, fontWeight: '700' }, dayMeta: { color: '#655D57', fontSize: 14 }, cardTitle: { color: '#101015', fontSize: 18, fontWeight: '800' }, cardMeta: { color: '#655D57', fontSize: 14, lineHeight: 21, marginTop: 5 }, section: { marginTop: 22 } });
