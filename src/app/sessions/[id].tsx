import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addWorkoutSet, completeWorkoutSession, deleteWorkoutSet, getWorkoutSession, type WorkoutSessionDetail } from '../../lib/api';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<WorkoutSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState('');
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [warmup, setWarmup] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    if (!id) return;
    try {
      setError(null);
      const next = await getWorkoutSession(id);
      setDetail(next);
      setExerciseId((current) => current || next.exercises[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the session.');
    }
  };

  useEffect(() => {
    if (!id) return;
    let isCurrent = true;
    void getWorkoutSession(id)
      .then((next) => {
        if (!isCurrent) return;
        setError(null);
        setDetail(next);
        setExerciseId((current) => current || next.exercises[0]?.id || '');
      })
      .catch((reason: unknown) => {
        if (isCurrent) setError(reason instanceof Error ? reason.message : 'Unable to load the session.');
      });
    return () => { isCurrent = false; };
  }, [id]);

  const selectedExercise = useMemo(() => detail?.exercises.find((exercise) => exercise.id === exerciseId) ?? null, [detail, exerciseId]);
  const setsByExercise = useMemo(() => {
    const groups = new Map<string, WorkoutSessionDetail['sets']>();
    for (const set of detail?.sets ?? []) groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]);
    return groups;
  }, [detail]);

  const logSet = async () => {
    const parsedReps = Number(reps);
    const parsedWeight = weight.trim() ? Number(weight) : undefined;
    if (!id || !exerciseId || !Number.isInteger(parsedReps) || parsedReps < 1 || (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0))) {
      setError('Choose an exercise and enter valid reps and weight.');
      return;
    }
    setSaving(true);
    try {
      await addWorkoutSet(id, { exerciseId, reps: parsedReps, weight: parsedWeight, isWarmup: warmup });
      setReps('');
      setWeight('');
      setWarmup(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to log the set.');
    } finally {
      setSaving(false);
    }
  };

  const removeSet = async (setId: string) => {
    setSaving(true);
    try {
      await deleteWorkoutSet(setId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove the set.');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await completeWorkoutSession(id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to complete the session.');
    } finally {
      setSaving(false);
    }
  };

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><ScrollView contentContainerStyle={styles.wrap}>
    <Pressable accessibilityRole="link" onPress={() => router.replace('/sessions')}><Text style={styles.back}>← Sessions</Text></Pressable>
    {!detail && !error ? <View style={styles.loading}><ActivityIndicator color="#642D2A" /><Text style={styles.body}>Loading session…</Text></View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {detail ? <><Text style={styles.eyebrow}>{detail.session.status === 'active' ? 'ACTIVE SESSION' : 'SESSION RECORD'}</Text><Text style={styles.title}>{detail.session.routineName ?? 'Workout plan'} · {detail.session.dayName ?? 'Day'}</Text><Text style={styles.body}>{detail.session.status === 'active' ? 'Log each completed set while the work is fresh.' : 'This session has been completed.'}</Text>
      {detail.session.status === 'active' ? <View style={styles.formCard}><Text style={styles.cardTitle}>Log a set</Text><View style={styles.exercisePicker}>{detail.exercises.map((exercise) => <Pressable key={exercise.id} onPress={() => setExerciseId(exercise.id)} style={[styles.exerciseOption, exercise.id === exerciseId && styles.exerciseOptionActive]}><Text style={[styles.exerciseOptionText, exercise.id === exerciseId && styles.exerciseOptionTextActive]}>{exercise.name}</Text></Pressable>)}</View>{!detail.exercises.length ? <Text style={styles.meta}>This day has no exercises yet. Add them in Workout plans.</Text> : <><TextInput value={reps} onChangeText={setReps} keyboardType="number-pad" placeholder={selectedExercise?.targetReps ? `Reps (target ${selectedExercise.targetReps})` : 'Reps'} placeholderTextColor="#655D57" style={styles.input} returnKeyType="next" /><TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder={selectedExercise?.targetWeight ? `Weight (target ${selectedExercise.targetWeight})` : 'Weight (optional)'} placeholderTextColor="#655D57" style={styles.input} onSubmitEditing={() => void logSet()} returnKeyType="done" /><Pressable onPress={() => setWarmup((current) => !current)} style={styles.warmup}><Text style={styles.meta}>{warmup ? 'Warm-up set' : 'Working set'} · change</Text></Pressable><Pressable disabled={saving} onPress={() => void logSet()} style={[styles.button, saving && styles.buttonDisabled]}><Text style={styles.buttonText}>Log set</Text></Pressable></>}</View> : null}
      <Text style={styles.sectionLabel}>LOGGED SETS</Text>{detail.exercises.map((exercise) => <View key={exercise.id} style={styles.card}><Text style={styles.cardTitle}>{exercise.name}</Text>{(setsByExercise.get(exercise.id) ?? []).length ? (setsByExercise.get(exercise.id) ?? []).map((set) => <View key={set.id} style={styles.setRow}><Text style={styles.meta}>#{set.setOrder} · {set.reps} reps{set.weight !== null ? ` · ${set.weight}` : ''}{set.isWarmup ? ' · warm-up' : ''}</Text>{detail.session.status === 'active' ? <Pressable disabled={saving} onPress={() => void removeSet(set.id)}><Text style={styles.remove}>Remove</Text></Pressable> : null}</View>) : <Text style={styles.meta}>No sets logged.</Text>}</View>)}
      {detail.session.status === 'active' ? <Pressable disabled={saving} onPress={() => void complete()} style={[styles.button, styles.completeButton, saving && styles.buttonDisabled]}><Text style={styles.buttonText}>Complete session</Text></Pressable> : null}</> : null}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 }, wrap: { alignSelf: 'center', maxWidth: 760, padding: 24, paddingBottom: 56, width: '100%' }, back: { color: '#642D2A', fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' }, loading: { gap: 10, marginTop: 80 }, eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5, marginTop: 28 }, title: { color: '#101015', fontSize: 38, fontWeight: '900', letterSpacing: -2, lineHeight: 42, marginTop: 12 }, body: { color: '#2C2C31', fontSize: 17, lineHeight: 27, marginTop: 14 }, error: { color: '#642D2A', fontSize: 14, fontWeight: '700', lineHeight: 21, marginTop: 22 }, formCard: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, gap: 12, marginTop: 26, padding: 16 }, card: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, marginTop: 12, padding: 16 }, cardTitle: { color: '#101015', fontSize: 18, fontWeight: '800' }, exercisePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, exerciseOption: { borderColor: '#D4C9B9', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }, exerciseOptionActive: { backgroundColor: '#101015', borderColor: '#101015' }, exerciseOptionText: { color: '#101015', fontSize: 13, fontWeight: '700' }, exerciseOptionTextActive: { color: '#F4EFE7' }, input: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 16, paddingBottom: 9, paddingTop: 8 }, warmup: { alignSelf: 'flex-start' }, meta: { color: '#655D57', fontSize: 14, lineHeight: 21 }, button: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', minHeight: 50, paddingHorizontal: 16 }, completeButton: { marginTop: 22 }, buttonText: { color: '#F4EFE7', fontSize: 15, fontWeight: '800' }, buttonDisabled: { opacity: 0.55 }, sectionLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginTop: 30 }, setRow: { alignItems: 'center', borderTopColor: '#D4C9B9', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10 }, remove: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
