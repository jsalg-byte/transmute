import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addExerciseToWorkoutSession, addWorkoutSet, completeWorkoutSession, deleteWorkoutSet, getWorkoutSession, updateWorkoutSet, type WorkoutSessionDetail } from '../../lib/api';
import { getStoredSession, setStoredSession } from '../../lib/session-store';

const REST_TIMER_PREFIX = 'transmute.rest-timer';
const DEFAULT_REST_SECONDS = 60;
const REST_PRESETS = [60, 120, 300];

type StoredRestTimer = {
  durationSeconds: number;
  remainingSeconds: number;
  endAt: number | null;
};

function normalizeRestSeconds(value: number) {
  return Math.max(10, Math.min(600, Math.round(value)));
}

function formatRestClock(value: number) {
  const minutes = Math.floor(Math.max(0, value) / 60).toString().padStart(2, '0');
  const seconds = Math.max(0, value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<WorkoutSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState('');
  const [libraryExerciseId, setLibraryExerciseId] = useState('');
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [warmup, setWarmup] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editExerciseId, setEditExerciseId] = useState('');
  const [editReps, setEditReps] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editWarmup, setEditWarmup] = useState(false);
  const [personalRecord, setPersonalRecord] = useState<{
    exerciseName: string;
    kind: 'estimated_1rm' | 'reps';
    current: { reps: number; weight: string | null };
    previous: { reps: number; weight: string | null };
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [restDuration, setRestDuration] = useState(DEFAULT_REST_SECONDS);
  const [restRemaining, setRestRemaining] = useState(DEFAULT_REST_SECONDS);
  const [restEndAt, setRestEndAt] = useState<number | null>(null);
  const [restHydrated, setRestHydrated] = useState(false);

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

  useEffect(() => {
    if (!id) return;
    let current = true;
    void getStoredSession(`${REST_TIMER_PREFIX}:${id}`).then((raw) => {
      if (!current) return;
      try {
        const stored = raw ? JSON.parse(raw) as StoredRestTimer : null;
        if (!stored || !Number.isFinite(stored.durationSeconds) || !Number.isFinite(stored.remainingSeconds)) {
          setRestDuration(DEFAULT_REST_SECONDS);
          setRestRemaining(DEFAULT_REST_SECONDS);
          setRestEndAt(null);
          return;
        }
        const duration = normalizeRestSeconds(stored.durationSeconds);
        const remaining = stored.endAt
          ? Math.max(0, Math.ceil((stored.endAt - Date.now()) / 1000))
          : Math.max(0, Math.round(stored.remainingSeconds));
        setRestDuration(duration);
        setRestRemaining(remaining);
        setRestEndAt(remaining > 0 && stored.endAt ? stored.endAt : null);
      } finally {
        if (current) setRestHydrated(true);
      }
    });
    return () => { current = false; };
  }, [id]);

  useEffect(() => {
    if (!id || !restHydrated) return;
    void setStoredSession(`${REST_TIMER_PREFIX}:${id}`, JSON.stringify({
      durationSeconds: restDuration,
      remainingSeconds: restRemaining,
      endAt: restEndAt,
    } satisfies StoredRestTimer));
  }, [id, restDuration, restRemaining, restEndAt, restHydrated]);

  useEffect(() => {
    if (!restEndAt) return;
    const interval = setInterval(() => {
      const next = Math.max(0, Math.ceil((restEndAt - Date.now()) / 1000));
      setRestRemaining(next);
      if (next <= 0) setRestEndAt(null);
    }, 250);
    return () => clearInterval(interval);
  }, [restEndAt]);

  const selectedExercise = useMemo(() => detail?.exercises.find((exercise) => exercise.id === exerciseId) ?? null, [detail, exerciseId]);
  const setsByExercise = useMemo(() => {
    const groups = new Map<string, WorkoutSessionDetail['sets']>();
    for (const set of detail?.sets ?? []) groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]);
    return groups;
  }, [detail]);
  const completedEvidence = useMemo(() => {
    if (!detail || detail.session.status !== 'completed') return null;
    const workingSets = detail.sets.filter((set) => !set.isWarmup);
    const repsLogged = workingSets.reduce((total, set) => total + set.reps, 0);
    const durationMs = detail.session.endedAt
      ? Math.max(0, new Date(detail.session.endedAt).getTime() - new Date(detail.session.startedAt).getTime())
      : 0;
    const durationMinutes = Math.max(1, Math.round(durationMs / 60_000));
    return { durationMinutes, repsLogged, workingSetCount: workingSets.length };
  }, [detail]);
  const workoutJsonExport = useMemo(() => {
    if (!detail || detail.session.status !== 'completed') return null;
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      workout: {
        routine: detail.session.routineName ?? 'Workout plan',
        day: detail.session.dayName ?? 'Session',
        startedAt: detail.session.startedAt,
        endedAt: detail.session.endedAt,
        exercises: detail.exercises.map((exercise) => ({
          name: exercise.name,
          category: exercise.category,
          muscleGroup: exercise.muscleGroup,
          sets: (setsByExercise.get(exercise.id) ?? []).map((set) => ({
            order: set.setOrder,
            reps: set.reps,
            weight: set.weight,
            isWarmup: set.isWarmup,
          })),
        })),
      },
    }, null, 2);
  }, [detail, setsByExercise]);
  const weightUnit = detail?.session.weightUnit ?? 'lbs';

  const logSet = async () => {
    const parsedReps = Number(reps);
    const parsedWeight = weight.trim() ? Number(weight) : undefined;
    if (!id || !exerciseId || !Number.isInteger(parsedReps) || parsedReps < 1 || (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0))) {
      setError('Choose an exercise and enter valid reps and weight.');
      return;
    }
    setSaving(true);
    try {
      const result = await addWorkoutSet(id, { exerciseId, reps: parsedReps, weight: parsedWeight, isWarmup: warmup });
      setPersonalRecord(result.personalRecord);
      setReps('');
      setWeight('');
      setWarmup(false);
      const duration = normalizeRestSeconds(restDuration);
      setRestDuration(duration);
      setRestRemaining(duration);
      setRestEndAt(Date.now() + duration * 1000);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to log the set.');
    } finally {
      setSaving(false);
    }
  };

  const chooseRestPreset = (seconds: number) => {
    const duration = normalizeRestSeconds(seconds);
    setRestDuration(duration);
    setRestRemaining(duration);
    setRestEndAt(null);
  };

  const toggleRestTimer = () => {
    if (restEndAt) {
      setRestRemaining(Math.max(0, Math.ceil((restEndAt - Date.now()) / 1000)));
      setRestEndAt(null);
      return;
    }
    const seconds = restRemaining > 0 ? restRemaining : restDuration;
    setRestRemaining(seconds);
    setRestEndAt(Date.now() + seconds * 1000);
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

  const addExercise = async () => {
    if (!id || !libraryExerciseId) {
      setError('Choose an exercise from the library.');
      return;
    }
    setSaving(true);
    try {
      await addExerciseToWorkoutSession(id, { exerciseId: libraryExerciseId });
      setExerciseId(libraryExerciseId);
      setLibraryExerciseId('');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to add the exercise.');
    } finally {
      setSaving(false);
    }
  };

  const beginEditingSet = (set: WorkoutSessionDetail['sets'][number]) => {
    setEditingSetId(set.id);
    setEditExerciseId(set.exerciseId);
    setEditReps(String(set.reps));
    setEditWeight(set.weight === null ? '' : String(set.weight));
    setEditWarmup(set.isWarmup);
  };

  const saveSet = async () => {
    const parsedReps = Number(editReps);
    const parsedWeight = editWeight.trim() ? Number(editWeight) : undefined;
    if (!editingSetId || !editExerciseId || !Number.isInteger(parsedReps) || parsedReps < 1 || (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0))) {
      setError('Enter valid set details.');
      return;
    }
    setSaving(true);
    try {
      await updateWorkoutSet(editingSetId, { exerciseId: editExerciseId, reps: parsedReps, weight: parsedWeight, isWarmup: editWarmup });
      setEditingSetId(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the set.');
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

  const shareWorkout = async () => {
    if (!detail) return;
    const title = `${detail.session.routineName ?? 'Workout plan'} · ${detail.session.dayName ?? 'Session'}`;
    const movementSummary = detail.exercises
      .map((exercise) => {
        const sets = setsByExercise.get(exercise.id) ?? [];
        if (!sets.length) return null;
        return `${exercise.name}: ${sets.map((set) => `${set.reps} reps${set.weight !== null ? ` @ ${set.weight}` : ''}`).join(', ')}`;
      })
      .filter((value): value is string => Boolean(value));
    try {
      await Share.share({
        title,
        message: `Transmute workout record\n${title}\n${detail.sets.length} ${detail.sets.length === 1 ? 'set' : 'sets'} logged${movementSummary.length ? `\n\n${movementSummary.join('\n')}` : ''}`,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to share this workout.');
    }
  };

  const shareWorkoutJson = async () => {
    if (!workoutJsonExport) return;
    try {
      await Share.share({
        title: 'Transmute workout JSON',
        message: workoutJsonExport,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to share the workout JSON.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sessions')}>
          <Text style={styles.back}>← Sessions</Text>
        </Pressable>
        {!detail && !error ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#642D2A" />
            <Text style={styles.body}>Loading session…</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {detail ? (
          <>
            <Text style={styles.eyebrow}>
              {detail.session.status === 'active' ? 'ACTIVE SESSION' : 'SESSION RECORD'}
            </Text>
            <Text style={styles.title}>
              {detail.session.routineName ?? 'Workout plan'} · {detail.session.dayName ?? 'Day'}
            </Text>
            <Text style={styles.body}>
              {detail.session.status === 'active'
                ? 'Log each completed set while the work is fresh.'
                : 'This session has been completed.'}
            </Text>
            {completedEvidence ? (
              <View style={styles.completedEvidence}>
                <Text style={styles.completedEvidenceLabel}>WORK RECORDED</Text>
                <Text style={styles.completedEvidenceTitle}>
                  {completedEvidence.workingSetCount} {completedEvidence.workingSetCount === 1 ? 'working set' : 'working sets'} · {completedEvidence.repsLogged} reps
                </Text>
                <Text style={styles.completedEvidenceCopy}>
              {completedEvidence.durationMinutes} {completedEvidence.durationMinutes === 1 ? 'minute' : 'minutes'} of recorded effort. Weight entries use {weightUnit}. Keep the evidence and build on it.
                </Text>
              </View>
            ) : null}
            {personalRecord ? (
              <View style={styles.personalRecord}>
                <Text style={styles.personalRecordLabel}>PERSONAL RECORD</Text>
                <Text style={styles.personalRecordTitle}>{personalRecord.exerciseName}</Text>
                <Text style={styles.personalRecordCopy}>
                  {personalRecord.kind === 'estimated_1rm' ? 'Estimated 1RM improved' : 'Rep record improved'} from {personalRecord.previous.reps} reps{personalRecord.previous.weight ? ` @ ${personalRecord.previous.weight}` : ''} to {personalRecord.current.reps} reps{personalRecord.current.weight ? ` @ ${personalRecord.current.weight}` : ''}.
                </Text>
              </View>
            ) : null}
            {detail.session.status === 'active' ? (
              <View style={styles.formCard}>
                <Text style={styles.cardTitle}>Log a set</Text>
                <View style={styles.exercisePicker}>
                  {detail.exercises.map((exercise) => (
                    <Pressable
                      key={exercise.id}
                      onPress={() => setExerciseId(exercise.id)}
                      style={[styles.exerciseOption, exercise.id === exerciseId && styles.exerciseOptionActive]}
                    >
                      <Text style={[styles.exerciseOptionText, exercise.id === exerciseId && styles.exerciseOptionTextActive]}>
                        {exercise.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {detail.exercises.length ? (
                  <>
                    <TextInput
                      value={reps}
                      onChangeText={setReps}
                      keyboardType="number-pad"
                      placeholder={selectedExercise?.targetReps ? `Reps (target ${selectedExercise.targetReps})` : 'Reps'}
                      placeholderTextColor="#655D57"
                      style={styles.input}
                      returnKeyType="next"
                    />
                    <TextInput
                      value={weight}
                      onChangeText={setWeight}
                      keyboardType="decimal-pad"
                      placeholder={selectedExercise?.targetWeight ? `Weight in ${weightUnit} (target ${selectedExercise.targetWeight})` : `Weight in ${weightUnit} (optional)`}
                      placeholderTextColor="#655D57"
                      style={styles.input}
                      onSubmitEditing={() => void logSet()}
                      returnKeyType="done"
                    />
                    <Pressable onPress={() => setWarmup((current) => !current)} style={styles.warmup}>
                      <Text style={styles.meta}>{warmup ? 'Warm-up set' : 'Working set'} · change</Text>
                    </Pressable>
                    <Pressable disabled={saving} onPress={() => void logSet()} style={[styles.button, saving && styles.buttonDisabled]}>
                      <Text style={styles.buttonText}>Log set</Text>
                    </Pressable>
                    <View style={styles.restTimer}>
                      <View>
                        <Text style={styles.restTimerLabel}>REST TIMER</Text>
                        <Text style={styles.restTimerClock}>{formatRestClock(restRemaining)}</Text>
                      </View>
                      <View style={styles.restTimerActions}>
                        {REST_PRESETS.map((seconds) => (
                          <Pressable key={seconds} onPress={() => chooseRestPreset(seconds)}>
                            <Text style={styles.addMovement}>{seconds / 60} min</Text>
                          </Pressable>
                        ))}
                        <Pressable onPress={toggleRestTimer}>
                          <Text style={styles.addMovement}>{restEndAt ? 'Pause' : restRemaining === 0 ? 'Restart' : 'Start'}</Text>
                        </Pressable>
                        <Pressable onPress={() => {
                          setRestRemaining(restDuration);
                          setRestEndAt(null);
                        }}>
                          <Text style={styles.remove}>Reset</Text>
                        </Pressable>
                      </View>
                    </View>
                  </>
                ) : (
                  <Text style={styles.meta}>Add an exercise from the library below.</Text>
                )}
                <Text style={styles.sectionLabel}>ADD A MOVEMENT</Text>
                <View style={styles.exercisePicker}>
                  {detail.libraryExercises.map((exercise) => (
                    <Pressable
                      key={exercise.id}
                      onPress={() => setLibraryExerciseId(exercise.id)}
                      style={[styles.exerciseOption, exercise.id === libraryExerciseId && styles.exerciseOptionActive]}
                    >
                      <Text style={[styles.exerciseOptionText, exercise.id === libraryExerciseId && styles.exerciseOptionTextActive]}>
                        {exercise.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable disabled={saving || !libraryExerciseId} onPress={() => void addExercise()}>
                  <Text style={styles.addMovement}>Add selected movement</Text>
                </Pressable>
              </View>
            ) : null}
            <Text style={styles.sectionLabel}>LOGGED SETS</Text>
            {detail.exercises.map((exercise) => (
              <View key={exercise.id} style={styles.card}>
                <Text style={styles.cardTitle}>{exercise.name}</Text>
                {(setsByExercise.get(exercise.id) ?? []).length ? (
                  (setsByExercise.get(exercise.id) ?? []).map((set) => (
                    <View key={set.id} style={styles.setRow}>
                      {editingSetId === set.id ? (
                        <View style={styles.editSetForm}>
                          <View style={styles.exercisePicker}>
                            {detail.exercises.map((choice) => (
                              <Pressable
                                key={choice.id}
                                onPress={() => setEditExerciseId(choice.id)}
                                style={[styles.exerciseOption, choice.id === editExerciseId && styles.exerciseOptionActive]}
                              >
                                <Text style={[styles.exerciseOptionText, choice.id === editExerciseId && styles.exerciseOptionTextActive]}>
                                  {choice.name}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          <TextInput value={editReps} onChangeText={setEditReps} keyboardType="number-pad" placeholder="Reps" placeholderTextColor="#655D57" style={styles.input} />
                          <TextInput value={editWeight} onChangeText={setEditWeight} keyboardType="decimal-pad" placeholder={`Weight in ${weightUnit} (optional)`} placeholderTextColor="#655D57" style={styles.input} />
                          <Pressable onPress={() => setEditWarmup((current) => !current)}>
                            <Text style={styles.meta}>{editWarmup ? 'Warm-up set' : 'Working set'} · change</Text>
                          </Pressable>
                          <View style={styles.editActions}>
                            <Pressable disabled={saving} onPress={() => void saveSet()}><Text style={styles.addMovement}>Save set</Text></Pressable>
                            <Pressable disabled={saving} onPress={() => setEditingSetId(null)}><Text style={styles.remove}>Cancel</Text></Pressable>
                          </View>
                        </View>
                      ) : (
                        <>
                          <Text style={styles.meta}>#{set.setOrder} · {set.reps} reps{set.weight !== null ? ` · ${set.weight} ${weightUnit}` : ''}{set.isWarmup ? ' · warm-up' : ''}</Text>
                          {detail.session.status === 'active' ? (
                            <View style={styles.editActions}>
                              <Pressable disabled={saving} onPress={() => beginEditingSet(set)}><Text style={styles.addMovement}>Edit</Text></Pressable>
                              <Pressable disabled={saving} onPress={() => void removeSet(set.id)}><Text style={styles.remove}>Remove</Text></Pressable>
                            </View>
                          ) : null}
                        </>
                      )}
                    </View>
                  ))
                ) : (
                  <Text style={styles.meta}>No sets logged.</Text>
                )}
              </View>
            ))}
            {detail.session.status === 'active' ? (
              <Pressable disabled={saving} onPress={() => void complete()} style={[styles.button, styles.completeButton, saving && styles.buttonDisabled]}>
                <Text style={styles.buttonText}>Complete session</Text>
              </Pressable>
            ) : (
              <View style={styles.completedActions}>
                <Pressable accessibilityRole="button" onPress={() => void shareWorkout()} style={styles.outlineButton}>
                  <Text style={styles.outlineButtonText}>Share workout</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void shareWorkoutJson()} style={styles.outlineButton}>
                  <Text style={styles.outlineButtonText}>Share workout JSON</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 }, wrap: { alignSelf: 'center', maxWidth: 760, padding: 24, paddingBottom: 56, width: '100%' }, back: { color: '#642D2A', fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' }, loading: { gap: 10, marginTop: 80 }, eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5, marginTop: 28 }, title: { color: '#101015', fontSize: 38, fontWeight: '900', letterSpacing: -2, lineHeight: 42, marginTop: 12 }, body: { color: '#2C2C31', fontSize: 17, lineHeight: 27, marginTop: 14 }, error: { color: '#642D2A', fontSize: 14, fontWeight: '700', lineHeight: 21, marginTop: 22 }, formCard: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, gap: 12, marginTop: 26, padding: 16 }, personalRecord: { backgroundColor: '#E8D194', borderColor: '#642D2A', borderWidth: 1, gap: 4, marginTop: 20, padding: 14 }, personalRecordLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }, personalRecordTitle: { color: '#101015', fontSize: 19, fontWeight: '900' }, personalRecordCopy: { color: '#2C2C31', fontSize: 14, lineHeight: 21 }, completedEvidence: { backgroundColor: '#E8D194', borderColor: '#A95B5B', borderWidth: 1, gap: 4, marginTop: 20, padding: 16 }, completedEvidenceLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }, completedEvidenceTitle: { color: '#101015', fontSize: 20, fontWeight: '900' }, completedEvidenceCopy: { color: '#2C2C31', fontSize: 14, lineHeight: 21 }, card: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, marginTop: 12, padding: 16 }, cardTitle: { color: '#101015', fontSize: 18, fontWeight: '800' }, exercisePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, exerciseOption: { borderColor: '#D4C9B9', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }, exerciseOptionActive: { backgroundColor: '#101015', borderColor: '#101015' }, exerciseOptionText: { color: '#101015', fontSize: 13, fontWeight: '700' }, exerciseOptionTextActive: { color: '#F4EFE7' }, input: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 16, paddingBottom: 9, paddingTop: 8 }, warmup: { alignSelf: 'flex-start' }, meta: { color: '#655D57', fontSize: 14, lineHeight: 21 }, button: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', minHeight: 50, paddingHorizontal: 16 }, outlineButton: { alignItems: 'center', borderColor: '#101015', borderWidth: 1, justifyContent: 'center', minHeight: 50, paddingHorizontal: 16 }, completeButton: { marginTop: 22 }, completedActions: { gap: 10, marginTop: 22 }, buttonText: { color: '#F4EFE7', fontSize: 15, fontWeight: '800' }, outlineButtonText: { color: '#101015', fontSize: 15, fontWeight: '800' }, buttonDisabled: { opacity: 0.55 }, restTimer: { borderTopColor: '#D4C9B9', borderTopWidth: 1, gap: 8, marginTop: 8, paddingTop: 14 }, restTimerLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, restTimerClock: { color: '#101015', fontSize: 28, fontVariant: ['tabular-nums'], fontWeight: '900', marginTop: 2 }, restTimerActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, sectionLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginTop: 30 }, setRow: { borderTopColor: '#D4C9B9', borderTopWidth: 1, marginTop: 10, paddingTop: 10 }, editSetForm: { gap: 10, width: '100%' }, editActions: { alignItems: 'center', flexDirection: 'row', gap: 14, justifyContent: 'flex-end', marginTop: 8 }, addMovement: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' }, remove: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
});
