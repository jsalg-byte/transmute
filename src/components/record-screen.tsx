import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from './alchemy-svg';
import { addWorkoutPlanDay, createFood, createMealLog, createWorkoutPlan, deleteWorkoutSession, getRecord, setActiveWorkoutPlan, signOut, startWorkoutSession, updateFasting, type TransmuteRecord } from '../lib/api';

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
  const refresh = async () => {
    try {
      setError(null);
      setRecord(await getRecord());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load your record.');
    }
  };
  const content = record ? <AreaContent area={area} record={record} refresh={refresh} /> : null;
  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><View style={styles.wrap}>
    <View style={styles.header}><Pressable accessibilityLabel="Go to dashboard" accessibilityRole="link" onPress={() => router.replace('/dashboard')} style={styles.wordmark}><AlchemySvg source={ouroboros} width={38} height={38} /><Text style={styles.wordmarkText}>TRANSMUTE</Text></Pressable><Pressable accessibilityRole="button" onPress={leave}><Text style={styles.signOut}>Sign out</Text></Pressable></View>
    <View accessibilityRole="tablist" style={styles.nav}>{nav.filter(([key]) => key !== 'admin' || record?.isAdmin).map(([key, name]) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: key === area }} key={key} onPress={() => router.replace(`/${key}`)} style={styles.navButton}><Text style={[styles.navItem, key === area && styles.navActive]}>{name}</Text></Pressable>)}</View>
    <ScrollView contentContainerStyle={styles.content}>{error ? <><Text style={styles.title}>The record is unavailable.</Text><Text style={styles.body}>{error}</Text></> : !record ? <View style={styles.loading}><ActivityIndicator color="#642D2A" /><Text style={styles.body}>Reading your record…</Text></View> : content}</ScrollView>
  </View></SafeAreaView>;
}

function AreaContent({ area, record: r, refresh }: { area: Area; record: TransmuteRecord; refresh: () => Promise<void> }) {
  if (area === 'dashboard') return <><Text style={styles.eyebrow}>THE WORKBENCH</Text><Text style={styles.title}>Welcome back, {r.user.name}.</Text><Text style={styles.body}>{r.dashboard.activeSession ? `Active: ${r.dashboard.activeSession.routine_name ?? 'workout'} — ${r.dashboard.activeSession.day_name ?? 'today'}.` : 'Your training record is ready for the next input.'}</Text><View style={styles.grid}><Card title={`${r.workoutPlans.length} plans`} meta="Workout plans" /><Card title={`${r.sessions.length} sessions`} meta="Training record" /><Card title={`${r.nutrition.meals.length} meals`} meta="Nutrition log" /><Card title={`${r.progress.length} check-ins`} meta="Progress record" /></View></>;
  if (area === 'workout-plans') return <WorkoutPlansContent record={r} refresh={refresh} />;
  if (area === 'exercises') return <List title="Exercise library" intro="Your shared library and saved movement record." items={r.exercises} render={(x) => <Card title={x.name} meta={`${label(x.category)}${x.muscle_group ? ` · ${x.muscle_group}` : ''}`} />} />;
  if (area === 'sessions') return <SessionsContent record={r} refresh={refresh} />;
  if (area === 'nutrition') return <NutritionContent record={r} refresh={refresh} />;
  if (area === 'fasting') return <FastingContent record={r} refresh={refresh} />;
  if (area === 'progress') return <List title="Progress" intro="Keep the evidence that proves the exchange." items={r.progress} render={(x) => <Card title={date(x.captured_at)} meta={x.note ?? 'Progress photo'} />} />;
  if (area === 'friends') return <><Text style={styles.eyebrow}>THE CIRCLE</Text><Text style={styles.title}>Friends</Text><Text style={styles.body}>Incoming requests</Text>{r.friends.incoming.map((x) => <Card key={x.id} title={x.name ?? x.username} meta={label(x.status)} />)}<Text style={[styles.body, styles.section]}>Outgoing requests</Text>{r.friends.outgoing.map((x) => <Card key={x.id} title={x.name ?? x.username} meta={label(x.status)} />)}</>;
  if (area === 'settings') return <><Text style={styles.eyebrow}>THE SETTINGS</Text><Text style={styles.title}>Your preferences</Text><Card title={`Weight unit: ${r.settings.weight_unit}`} meta={r.settings.active_routine_id ? 'An active plan is selected.' : 'No active plan selected.'} /></>;
  return <><Text style={styles.eyebrow}>THE ADMINISTRATION</Text><Text style={styles.title}>Admin</Text><Text style={styles.body}>Administrative controls remain protected to the verified Transmute administrator.</Text></>;
}

function WorkoutPlansContent({ record, refresh }: { record: TransmuteRecord; refresh: () => Promise<void> }) {
  const [planName, setPlanName] = useState('');
  const [description, setDescription] = useState('');
  const [dayNames, setDayNames] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activePlanId = record.settings.active_routine_id;

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Unable to save your plan.');
    } finally {
      setSaving(false);
    }
  };

  return <><Text style={styles.eyebrow}>THE PROGRAM</Text><Text style={styles.title}>Workout plans</Text><Text style={styles.body}>Build the work before you perform it.</Text>
    <View style={styles.formCard}>
      <Text style={styles.cardTitle}>Create a plan</Text>
      <TextInput value={planName} onChangeText={setPlanName} placeholder="Plan name" placeholderTextColor="#655D57" style={styles.input} returnKeyType="next" />
      <TextInput value={description} onChangeText={setDescription} placeholder="Description (optional)" placeholderTextColor="#655D57" style={styles.input} onSubmitEditing={() => void run(async () => { const name = planName.trim(); if (name.length < 2) throw new Error('Enter a plan name with at least 2 characters.'); await createWorkoutPlan({ name, description: description.trim() || undefined }); setPlanName(''); setDescription(''); }, 'Workout plan created.')} returnKeyType="done" />
      <Pressable disabled={saving} onPress={() => void run(async () => { const name = planName.trim(); if (name.length < 2) throw new Error('Enter a plan name with at least 2 characters.'); await createWorkoutPlan({ name, description: description.trim() || undefined }); setPlanName(''); setDescription(''); }, 'Workout plan created.')} style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed, saving && styles.buttonDisabled]}><Text style={styles.actionButtonText}>Create plan</Text></Pressable>
    </View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {record.workoutPlans.length ? record.workoutPlans.map((plan) => <View key={plan.id} style={[styles.planCard, activePlanId === plan.id && styles.activePlanCard]}><View style={styles.planHeading}><View><Text style={styles.cardTitle}>{plan.name}</Text>{plan.description ? <Text style={styles.cardMeta}>{plan.description}</Text> : null}</View><Pressable disabled={saving || activePlanId === plan.id} onPress={() => void run(() => setActiveWorkoutPlan(plan.id), 'Active workout plan updated.')}><Text style={styles.inlineAction}>{activePlanId === plan.id ? 'Active' : 'Set active'}</Text></Pressable></View>{plan.days.length ? plan.days.sort((a, b) => a.sortOrder - b.sortOrder).map((day) => <View key={day.id} style={styles.dayRow}><Text style={styles.dayName}>{day.name}</Text><Text style={styles.dayMeta}>{day.exerciseCount} exercises</Text></View>) : <Text style={styles.cardMeta}>No days in this plan yet.</Text>}<View style={styles.addDayRow}><TextInput value={dayNames[plan.id] ?? ''} onChangeText={(value) => setDayNames((current) => ({ ...current, [plan.id]: value }))} placeholder="New day name" placeholderTextColor="#655D57" style={[styles.input, styles.dayInput]} onSubmitEditing={() => void run(async () => { const dayName = (dayNames[plan.id] ?? '').trim(); if (dayName.length < 2) throw new Error('Enter a day name with at least 2 characters.'); await addWorkoutPlanDay(plan.id, { dayName }); setDayNames((current) => ({ ...current, [plan.id]: '' })); }, 'Workout day added.')} returnKeyType="done" /><Pressable disabled={saving} onPress={() => void run(async () => { const dayName = (dayNames[plan.id] ?? '').trim(); if (dayName.length < 2) throw new Error('Enter a day name with at least 2 characters.'); await addWorkoutPlanDay(plan.id, { dayName }); setDayNames((current) => ({ ...current, [plan.id]: '' })); }, 'Workout day added.')}><Text style={styles.inlineAction}>Add day</Text></Pressable></View></View>) : <Card title="No workout plans yet" meta="Your first plan will appear here." />}</>;
}

function SessionsContent({ record, refresh }: { record: TransmuteRecord; refresh: () => Promise<void> }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activePlan = record.workoutPlans.find((plan) => plan.id === record.settings.active_routine_id) ?? null;

  const start = async (routineDayId: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const { session } = await startWorkoutSession({ routineDayId });
      router.push(`/sessions/${session.id}`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Unable to start the session.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (sessionId: string) => {
    setSaving(true);
    setNotice(null);
    try {
      await deleteWorkoutSession(sessionId);
      await refresh();
      setNotice('Session removed.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Unable to remove the session.');
    } finally {
      setSaving(false);
    }
  };

  return <><Text style={styles.eyebrow}>THE TRAINING LOG</Text><Text style={styles.title}>Sessions</Text><Text style={styles.body}>Choose an active plan, open a session, and let each set become part of the record.</Text>
    <View style={styles.formCard}><Text style={styles.cardTitle}>Start a session</Text>{!activePlan ? <Text style={styles.cardMeta}>Choose an active workout plan in Workout plans first.</Text> : activePlan.days.length === 0 ? <Text style={styles.cardMeta}>This plan has no days yet.</Text> : activePlan.days.sort((a, b) => a.sortOrder - b.sortOrder).map((day) => <Pressable accessibilityRole="button" disabled={saving} key={day.id} onPress={() => void start(day.id)} style={({ pressed }) => [styles.dayAction, pressed && styles.buttonPressed, saving && styles.buttonDisabled]}><Text style={styles.dayActionText}>{day.name}</Text><Text style={styles.dayActionMeta}>{day.exerciseCount} exercises · Start</Text></Pressable>)}</View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    <Text style={[styles.eyebrow, styles.section]}>RECENT SESSIONS</Text>{record.sessions.length ? record.sessions.map((session) => <View key={session.id} style={styles.card}><Pressable accessibilityRole="link" onPress={() => router.push(`/sessions/${session.id}`)}><Text style={styles.cardTitle}>{session.routine_name ?? 'Workout plan'} · {session.day_name ?? 'Day'}</Text><Text style={styles.cardMeta}>{label(session.status)} · {session.set_count} sets · {date(session.started_at)}</Text></Pressable><Pressable disabled={saving} onPress={() => void remove(session.id)}><Text style={styles.inlineAction}>Remove</Text></Pressable></View>) : <Card title="No sessions yet" meta="Start a day from your active workout plan." />}</>;
}

function NutritionContent({ record, refresh }: { record: TransmuteRecord; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [foodId, setFoodId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('snack');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const run = async (operation: () => Promise<unknown>, success: string) => { setSaving(true); setNotice(null); try { await operation(); await refresh(); setNotice(success); } catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Unable to save nutrition.'); } finally { setSaving(false); } };
  return <><Text style={styles.eyebrow}>THE FUEL</Text><Text style={styles.title}>Nutrition</Text><Text style={styles.body}>Build a food library, then log each meal as an input.</Text>
    <View style={styles.formCard}><Text style={styles.cardTitle}>Create food</Text><TextInput value={name} onChangeText={setName} placeholder="Food name" placeholderTextColor="#655D57" style={styles.input} returnKeyType="next" /><TextInput value={calories} onChangeText={setCalories} keyboardType="number-pad" placeholder="Calories per serving" placeholderTextColor="#655D57" style={styles.input} returnKeyType="next" /><View style={styles.macroRow}><TextInput value={protein} onChangeText={setProtein} keyboardType="decimal-pad" placeholder="Protein g" placeholderTextColor="#655D57" style={[styles.input, styles.macroInput]} /><TextInput value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" placeholder="Carbs g" placeholderTextColor="#655D57" style={[styles.input, styles.macroInput]} /><TextInput value={fat} onChangeText={setFat} keyboardType="decimal-pad" placeholder="Fat g" placeholderTextColor="#655D57" style={[styles.input, styles.macroInput]} /></View><Pressable disabled={saving} onPress={() => void run(async () => { const caloriesKcal = Number(calories); if (name.trim().length < 2 || !Number.isInteger(caloriesKcal) || caloriesKcal < 0) throw new Error('Enter a food name and whole calories.'); await createFood({ name: name.trim(), caloriesKcal, proteinG: protein.trim() ? Number(protein) : undefined, carbsG: carbs.trim() ? Number(carbs) : undefined, fatG: fat.trim() ? Number(fat) : undefined }); setName(''); setCalories(''); setProtein(''); setCarbs(''); setFat(''); }, 'Food added to your library.')} style={[styles.actionButton, saving && styles.buttonDisabled]}><Text style={styles.actionButtonText}>Save food</Text></Pressable></View>
    <View style={styles.formCard}><Text style={styles.cardTitle}>Log a meal</Text><View style={styles.exercisePicker}>{record.nutrition.foods.map((food) => <Pressable key={food.id} onPress={() => setFoodId(food.id)} style={[styles.exerciseOption, food.id === foodId && styles.exerciseOptionActive]}><Text style={[styles.exerciseOptionText, food.id === foodId && styles.exerciseOptionTextActive]}>{food.name}</Text></Pressable>)}</View><TextInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="Servings" placeholderTextColor="#655D57" style={styles.input} /><View style={styles.exercisePicker}>{(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => <Pressable key={type} onPress={() => setMealType(type)} style={[styles.exerciseOption, type === mealType && styles.exerciseOptionActive]}><Text style={[styles.exerciseOptionText, type === mealType && styles.exerciseOptionTextActive]}>{type}</Text></Pressable>)}</View><Pressable disabled={saving || !foodId} onPress={() => void run(async () => { const parsedQuantity = Number(quantity); if (!foodId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) throw new Error('Choose a food and enter a valid quantity.'); await createMealLog({ foodId, quantity: parsedQuantity, mealType }); setQuantity('1'); }, 'Meal logged.')} style={[styles.actionButton, (saving || !foodId) && styles.buttonDisabled]}><Text style={styles.actionButtonText}>Log meal</Text></Pressable></View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}<Text style={[styles.eyebrow, styles.section]}>RECENT MEALS</Text>{record.nutrition.meals.length ? record.nutrition.meals.map((meal) => <Card key={meal.id} title={meal.name} meta={`${label(meal.meal_type)} · ${meal.calories_kcal} kcal · ${date(meal.consumed_at)}`} />) : <Card title="No meals logged yet" meta="Choose a food above to add your first meal." />}</>;
}

function FastingContent({ record, refresh }: { record: TransmuteRecord; refresh: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toggle = async () => { setSaving(true); setNotice(null); try { await updateFasting({ action: record.fasting.active ? 'end' : 'start', note: note.trim() || undefined }); setNote(''); await refresh(); setNotice(record.fasting.active ? 'Fast ended and saved.' : 'Fast started.'); } catch (reason) { setNotice(reason instanceof Error ? reason.message : 'Unable to update the fast.'); } finally { setSaving(false); } };
  return <><Text style={styles.eyebrow}>THE INTERVAL</Text><Text style={styles.title}>Fasting</Text><Text style={styles.body}>{record.fasting.active ? `Active since ${date(record.fasting.active.started_at)}.` : 'No active fast.'}</Text><View style={styles.formCard}><Text style={styles.cardTitle}>{record.fasting.active ? 'End active fast' : 'Start a fast'}</Text><TextInput value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor="#655D57" style={styles.input} onSubmitEditing={() => void toggle()} returnKeyType="done" /><Pressable disabled={saving} onPress={() => void toggle()} style={[styles.actionButton, saving && styles.buttonDisabled]}><Text style={styles.actionButtonText}>{record.fasting.active ? 'End fast' : 'Start fast'}</Text></Pressable></View>{notice ? <Text style={styles.notice}>{notice}</Text> : null}<Text style={[styles.eyebrow, styles.section]}>FAST HISTORY</Text>{record.fasting.logs.length ? record.fasting.logs.map((fast) => <Card key={fast.id} title={`${fast.duration_minutes} minutes`} meta={`${date(fast.ended_at)}${fast.note ? ` · ${fast.note}` : ''}`} />) : <Card title="No fasting history" meta="Completed fasts will appear here." />}</>;
}

function List<T extends { id: string }>({ title, intro, items, render }: { title: string; intro: string; items: T[]; render: (item: T) => ReactNode }) { return <><Text style={styles.eyebrow}>THE RECORD</Text><Text style={styles.title}>{title}</Text><Text style={styles.body}>{intro}</Text>{items.length ? items.map((item) => <View key={item.id}>{render(item)}</View>) : <Card title="Nothing recorded yet" meta="Your first entry will appear here." />}</>; }

const styles = StyleSheet.create({ safeArea: { backgroundColor: '#F4EFE7', flex: 1 }, wrap: { flex: 1, maxWidth: 1120, width: '100%', alignSelf: 'center', paddingHorizontal: 24 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }, wordmark: { alignItems: 'center', flexDirection: 'row', gap: 10 }, wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 }, signOut: { color: '#101015', fontSize: 14, fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' }, nav: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, borderTopColor: '#D4C9B9', borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18, paddingVertical: 12 }, navButton: { paddingHorizontal: 2, paddingVertical: 5 }, navItem: { color: '#5F5752', fontSize: 14, fontWeight: '700' }, navActive: { color: '#101015', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' }, content: { paddingBottom: 56, maxWidth: 760 }, eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5, marginTop: 18 }, title: { color: '#101015', fontSize: 42, fontWeight: '900', letterSpacing: -2.2, lineHeight: 44, marginTop: 12 }, body: { color: '#2C2C31', fontSize: 17, lineHeight: 27, marginTop: 14 }, loading: { alignItems: 'flex-start', gap: 8, marginTop: 100 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 22 }, card: { borderColor: '#D4C9B9', borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 16, backgroundColor: '#FBF7F0', minWidth: 220 }, formCard: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, gap: 12, marginTop: 22, padding: 16 }, planCard: { borderColor: '#101015', borderRadius: 12, borderWidth: 1, marginTop: 16, padding: 18, backgroundColor: '#FBF7F0' }, activePlanCard: { borderColor: '#642D2A', borderWidth: 2 }, planHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, justifyContent: 'space-between' }, input: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 16, paddingBottom: 9, paddingTop: 8 }, macroRow: { flexDirection: 'row', gap: 10 }, macroInput: { flex: 1 }, exercisePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, exerciseOption: { borderColor: '#D4C9B9', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }, exerciseOptionActive: { backgroundColor: '#101015', borderColor: '#101015' }, exerciseOptionText: { color: '#101015', fontSize: 13, fontWeight: '700' }, exerciseOptionTextActive: { color: '#F4EFE7' }, actionButton: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', minHeight: 46, paddingHorizontal: 16 }, actionButtonText: { color: '#F4EFE7', fontSize: 14, fontWeight: '800' }, dayAction: { borderColor: '#D4C9B9', borderTopWidth: 1, paddingVertical: 12 }, dayActionText: { color: '#101015', fontSize: 16, fontWeight: '800' }, dayActionMeta: { color: '#655D57', fontSize: 13, marginTop: 3 }, buttonPressed: { backgroundColor: '#642D2A' }, buttonDisabled: { opacity: 0.55 }, notice: { color: '#642D2A', fontSize: 14, fontWeight: '700', lineHeight: 21, marginTop: 12 }, inlineAction: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline', textDecorationColor: '#A95B5B' }, addDayRow: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 16 }, dayInput: { flex: 1 }, dayRow: { borderTopColor: '#D4C9B9', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 12 }, dayName: { color: '#101015', fontSize: 16, fontWeight: '700' }, dayMeta: { color: '#655D57', fontSize: 14 }, cardTitle: { color: '#101015', fontSize: 18, fontWeight: '800' }, cardMeta: { color: '#655D57', fontSize: 14, lineHeight: 21, marginTop: 5 }, section: { marginTop: 22 } });
