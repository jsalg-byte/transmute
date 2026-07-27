import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, ExternalLink, Minimize2, Pencil, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MuscleHeatMap } from '../../components/muscle-heat-map';
import {
  addExerciseToWorkoutSession,
  addWorkoutSet,
  completeWorkoutSession,
  deleteWorkoutSession,
  deleteWorkoutSet,
  getCalistreeExerciseMetadata,
  getWorkoutSession,
  importCalistreeExerciseToWorkoutSession,
  searchCalistreeExercises,
  updateWorkoutSet,
  type WorkoutSessionDetail,
} from '../../lib/api';
import { getCalistreeGuide } from '../../lib/calistree-guides';
import { getStoredSession, setStoredSession } from '../../lib/session-store';

const REST_TIMER_PREFIX = 'transmute.rest-timer';
const DEFAULT_REST_SECONDS = 60;
const REST_PRESETS = [60, 120, 300];
const SHOW_WARMUP_CONTROL = false;

type StoredRestTimer = { durationSeconds: number; remainingSeconds: number; endAt: number | null };

function normalizeRestSeconds(value: number) {
  return Math.max(10, Math.min(600, Math.round(value)));
}

function formatRestClock(value: number) {
  const minutes = Math.floor(Math.max(0, value) / 60).toString().padStart(2, '0');
  const seconds = Math.max(0, value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatRestInput(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}:${remainder.toString().padStart(2, '0')}` : String(minutes);
}

function parseRestInput(value: string) {
  const input = value.trim();
  if (/^\d+$/.test(input)) return normalizeRestSeconds(Number(input) * 60);
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(input);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  return normalizeRestSeconds(minutes * 60 + seconds);
}

function parseDemoMeta(sourceName: string | null) {
  if (!sourceName) return null;
  try {
    const parsed: unknown = JSON.parse(sourceName);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as { start?: unknown; duration?: unknown; provider?: unknown };
    return {
      start: typeof value.start === 'string' || typeof value.start === 'number' ? value.start : null,
      duration: typeof value.duration === 'number' && Number.isFinite(value.duration) ? value.duration : null,
      provider: typeof value.provider === 'string' ? value.provider : null,
    };
  } catch {
    return null;
  }
}

function secondsForClipStart(value: string | number | null) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== 'string') return null;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function playbackUrl(url: string, sourceName: string | null) {
  const start = secondsForClipStart(parseDemoMeta(sourceName)?.start ?? null);
  if (start === null) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      parsed.searchParams.set(host === 'youtu.be' ? 't' : 'start', String(start));
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function demoDescription(sourceName: string | null) {
  const meta = parseDemoMeta(sourceName);
  if (meta?.start !== null && meta?.start !== undefined) {
    return `Clip begins at ${meta.start}${meta.duration ? ` · ${meta.duration}s segment` : ''}`;
  }
  if (meta?.provider) return `Streaming from ${meta.provider}`;
  return sourceName || 'Approved exercise demonstration';
}

function isDirectVideoUrl(url: string) {
  try {
    const parsed = new URL(url);
    return /\.mp4$/i.test(parsed.pathname) || parsed.hostname.endsWith('firebasestorage.googleapis.com');
  } catch {
    return false;
  }
}

function ExerciseDemoPlayer({ url, name }: { url: string; name: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });

  return <VideoView
    player={player}
    style={styles.demoVideo}
    nativeControls
    contentFit="contain"
    accessibilityLabel={`${name} movement demonstration`}
  />;
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 920;
  const [detail, setDetail] = useState<WorkoutSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState('');
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
  const [restExpanded, setRestExpanded] = useState(false);
  const [restEditing, setRestEditing] = useState(false);
  const [restInput, setRestInput] = useState(formatRestInput(DEFAULT_REST_SECONDS));
  const [restHydrated, setRestHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [demoExpanded, setDemoExpanded] = useState(false);
  const [calistreeDemo, setCalistreeDemo] = useState<{ exerciseName: string; videoUrl: string | null; sourceUrl: string | null } | null>(null);
  const selectMovement = (nextExerciseId: string) => {
    setExerciseId(nextExerciseId);
    setDemoExpanded(false);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = async () => {
    if (!id) return;
    try {
      setError(null);
      const next = await getWorkoutSession(id);
      setDetail(next);
      setExerciseId((current) => next.exercises.some((exercise) => exercise.id === current) ? current : (next.exercises[0]?.id ?? ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the session.');
    }
  };

  useEffect(() => {
    if (!id) return;
    let current = true;
    void getWorkoutSession(id)
      .then((next) => {
        if (!current) return;
        setError(null);
        setDetail(next);
        setExerciseId((selected) => next.exercises.some((exercise) => exercise.id === selected) ? selected : (next.exercises[0]?.id ?? ''));
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Unable to load the session.');
      });
    return () => { current = false; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let current = true;
    void getStoredSession(`${REST_TIMER_PREFIX}:${id}`).then((raw) => {
      if (!current) return;
      try {
        const stored = raw ? JSON.parse(raw) as StoredRestTimer : null;
        if (!stored || !Number.isFinite(stored.durationSeconds) || !Number.isFinite(stored.remainingSeconds)) return;
        const duration = normalizeRestSeconds(stored.durationSeconds);
        const remaining = stored.endAt ? Math.max(0, Math.ceil((stored.endAt - Date.now()) / 1000)) : Math.max(0, Math.round(stored.remainingSeconds));
        setRestDuration(duration);
        setRestRemaining(remaining);
        setRestEndAt(remaining > 0 && stored.endAt ? stored.endAt : null);
        setRestInput(formatRestInput(remaining > 0 ? remaining : duration));
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
  const nextMovement = useMemo(() => {
    const activeIndex = detail?.exercises.findIndex((exercise) => exercise.id === exerciseId) ?? -1;
    return activeIndex >= 0 ? detail?.exercises[activeIndex + 1] ?? null : null;
  }, [detail, exerciseId]);
  const knownCalistreeGuide = useMemo(() => selectedExercise ? getCalistreeGuide(selectedExercise.name) : null, [selectedExercise]);

  useEffect(() => {
    if (!selectedExercise || selectedExercise.demoUrl || knownCalistreeGuide) return;

    let current = true;
    void getCalistreeExerciseMetadata({ name: selectedExercise.name })
      .then(({ exercise }) => {
        if (current) setCalistreeDemo({ exerciseName: selectedExercise.name, videoUrl: exercise.videoUrl, sourceUrl: exercise.sourceUrl });
      })
      .catch(() => {
        if (current) setCalistreeDemo({ exerciseName: selectedExercise.name, videoUrl: null, sourceUrl: null });
      });
    return () => { current = false; };
  }, [knownCalistreeGuide, selectedExercise]);

  const matchingCalistreeDemo = calistreeDemo?.exerciseName === selectedExercise?.name ? calistreeDemo : null;
  const resolvedDemo = selectedExercise?.demoUrl
    ? { url: selectedExercise.demoUrl, sourceName: selectedExercise.demoSourceName, source: 'Attached demonstration' }
    : knownCalistreeGuide
      ? { url: knownCalistreeGuide.videoUrl, sourceName: 'Calistree', source: 'Calistree demonstration' }
    : matchingCalistreeDemo?.videoUrl
      ? { url: matchingCalistreeDemo.videoUrl, sourceName: 'Calistree', source: 'Calistree demonstration' }
      : null;
  const calistreeDemoChecked = Boolean(matchingCalistreeDemo);
  const setsByExercise = useMemo(() => {
    const groups = new Map<string, WorkoutSessionDetail['sets']>();
    for (const set of detail?.sets ?? []) groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]);
    return groups;
  }, [detail]);
  const previousPerformanceByExercise = useMemo(() => {
    const groups = new Map<string, WorkoutSessionDetail['previousPerformances']>();
    for (const set of detail?.previousPerformances ?? []) groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]);
    return groups;
  }, [detail]);
  const activeExercises = useMemo(() => detail?.exercises.filter((exercise) => (setsByExercise.get(exercise.id)?.length ?? 0) > 0) ?? [], [detail, setsByExercise]);
  const completedSetCount = detail?.sets.length ?? 0;
  const completedExerciseCount = activeExercises.length;
  const weightUnit = detail?.session.weightUnit ?? 'lbs';
  const totalWeight = useMemo(() => (detail?.sets ?? []).reduce((total, set) => {
    if (set.weight === null) return total;
    const weight = typeof set.weight === 'number' ? set.weight : Number(set.weight);
    return Number.isFinite(weight) ? total + weight * set.reps : total;
  }, 0), [detail]);
  const formattedTotalWeight = useMemo(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(totalWeight), [totalWeight]);
  const completedEvidence = useMemo(() => {
    if (!detail || detail.session.status !== 'completed') return null;
    const workingSets = detail.sets.filter((set) => !set.isWarmup);
    const repsLogged = workingSets.reduce((total, set) => total + set.reps, 0);
    const durationMs = detail.session.endedAt ? Math.max(0, new Date(detail.session.endedAt).getTime() - new Date(detail.session.startedAt).getTime()) : 0;
    return { repsLogged, workingSets: workingSets.length, durationMinutes: Math.max(1, Math.round(durationMs / 60_000)) };
  }, [detail]);
  const workoutJsonExport = useMemo(() => {
    if (!detail || detail.session.status !== 'completed') return null;
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      workout: {
        routine: detail.session.routineName ?? 'Workout plan', day: detail.session.dayName ?? 'Session', startedAt: detail.session.startedAt, endedAt: detail.session.endedAt,
        exercises: detail.exercises.map((exercise) => ({
          name: exercise.name, category: exercise.category, muscleGroup: exercise.muscleGroup,
          sets: (setsByExercise.get(exercise.id) ?? []).map((set) => ({ order: set.setOrder, reps: set.reps, weight: set.weight, isWarmup: set.isWarmup })),
        })),
      },
    }, null, 2);
  }, [detail, setsByExercise]);

  const logSet = async (payload: { exerciseId: string; reps: string; weight: string; repsPlaceholder: string; weightPlaceholder: string; isWarmup: boolean }) => {
    const resolvedReps = payload.reps.trim() || payload.repsPlaceholder.trim();
    const resolvedWeight = payload.weight.trim() || payload.weightPlaceholder.trim();
    const parsedReps = resolvedReps ? Number(resolvedReps) : 0;
    const parsedWeight = resolvedWeight ? Number(resolvedWeight) : undefined;
    const hasAnyLoggedValue = parsedReps > 0 || (parsedWeight !== undefined && parsedWeight > 0);

    if (!id || !payload.exerciseId) {
      const reason = new Error('Workout session is unavailable.');
      setError(reason.message);
      throw reason;
    }
    if (!hasAnyLoggedValue) {
      const reason = new Error('Enter valid reps and weight before logging the set.');
      setError(reason.message);
      throw reason;
    }
    if (!Number.isInteger(parsedReps) || parsedReps < 1) {
      const reason = new Error('Enter at least one rep before logging the set.');
      setError(reason.message);
      throw reason;
    }
    if (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0)) {
      const reason = new Error('Enter a valid weight or leave it empty.');
      setError(reason.message);
      throw reason;
    }
    setSaving(true);
    try {
      const result = await addWorkoutSet(id, { exerciseId: payload.exerciseId, reps: parsedReps, weight: parsedWeight, isWarmup: payload.isWarmup });
      setPersonalRecord(result.personalRecord);
      const duration = normalizeRestSeconds(restDuration);
      setRestDuration(duration); setRestRemaining(duration); setRestEndAt(Date.now() + duration * 1_000); setRestExpanded(true); setRestEditing(false); setRestInput(formatRestInput(duration));
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to log the set.';
      setError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  };

  const addExercise = async (nextExerciseId: string) => {
    if (!id) {
      const reason = new Error('Workout session is unavailable.');
      setError(reason.message);
      throw reason;
    }
    setSaving(true);
    try {
      await addExerciseToWorkoutSession(id, { exerciseId: nextExerciseId });
      selectMovement(nextExerciseId);
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to add the movement.';
      setError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  };

  const importCalistreeMovement = async (slug: string) => {
    if (!id) return;
    setSaving(true);
    try {
      const result = await importCalistreeExerciseToWorkoutSession(id, slug);
      selectMovement(result.exercise.id);
      await refresh();
      setToast(`${result.exercise.name} was imported from Calistree.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to import the Calistree movement.';
      setError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  };

  const beginEditingSet = (set: WorkoutSessionDetail['sets'][number]) => {
    setEditingSetId(set.id); setEditExerciseId(set.exerciseId); setEditReps(String(set.reps)); setEditWeight(set.weight === null ? '' : String(set.weight)); setEditWarmup(set.isWarmup);
  };

  const saveSet = async () => {
    const parsedReps = Number(editReps);
    const parsedWeight = editWeight.trim() ? Number(editWeight) : undefined;
    if (!editingSetId || !editExerciseId || !Number.isInteger(parsedReps) || parsedReps < 1 || (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0))) { setError('Enter valid set details.'); return; }
    setSaving(true);
    try {
      await updateWorkoutSet(editingSetId, { exerciseId: editExerciseId, reps: parsedReps, weight: parsedWeight, isWarmup: editWarmup });
      setEditingSetId(null); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update the set.');
    } finally { setSaving(false); }
  };

  const removeSet = async (setId: string) => {
    setSaving(true);
    try { await deleteWorkoutSet(setId); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove the set.');
    } finally { setSaving(false); }
  };

  const complete = async () => {
    if (!id) return;
    setSaving(true);
    try { await completeWorkoutSession(id); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete the session.');
    } finally { setSaving(false); }
  };

  const discard = async () => {
    if (!id) return;
    setSaving(true);
    try { await deleteWorkoutSession(id); setDiscardOpen(false); router.replace('/sessions');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to discard the session.');
    } finally { setSaving(false); }
  };

  const openDemo = async () => {
    if (!resolvedDemo) return;
    try { await openBrowserAsync(playbackUrl(resolvedDemo.url, resolvedDemo.sourceName));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to open the exercise demonstration.'); }
  };

  const shareWorkoutJson = async () => {
    if (!workoutJsonExport) return;
    try { await Clipboard.setStringAsync(workoutJsonExport); setToast('Workout JSON copied to clipboard.');
    } catch { setToast('Unable to copy workout JSON.'); }
  };

  const setRestPreset = (seconds: number) => {
    const duration = normalizeRestSeconds(seconds);
    setRestDuration(duration); setRestRemaining(duration); setRestEndAt(null); setRestExpanded(true); setRestEditing(false); setRestInput(formatRestInput(duration));
  };

  const startRestTimer = () => {
    if (restEndAt) return;
    const customDuration = restEditing ? parseRestInput(restInput) : null;
    const seconds = customDuration ?? (restRemaining > 0 ? restRemaining : restDuration);
    if (customDuration !== null) setRestDuration(customDuration);
    setRestRemaining(seconds); setRestEndAt(Date.now() + seconds * 1_000); setRestExpanded(true); setRestEditing(false); setRestInput(formatRestInput(seconds));
  };

  const applyCustomRestDuration = () => {
    if (restEndAt) return;
    const duration = parseRestInput(restInput);
    if (duration === null) {
      setRestInput(formatRestInput(restRemaining || restDuration));
      setRestEditing(false);
      return;
    }
    setRestDuration(duration); setRestRemaining(duration); setRestEndAt(null); setRestEditing(false); setRestInput(formatRestInput(duration));
  };

  return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.page}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sessions')} hitSlop={8} style={styles.inlineLink}><ArrowLeft color="#642D2A" size={17} strokeWidth={2.4} /><Text style={styles.back}>Sessions</Text></Pressable>
        {!detail && !error ? <View style={styles.loading}><ActivityIndicator color="#642D2A" /><Text style={styles.body}>Loading session…</Text></View> : null}
        {error ? <View style={styles.errorNotice}><Text style={styles.errorText}>{error}</Text></View> : null}
        {detail ? <>
          <View style={[styles.header, isDesktop && styles.headerDesktop]}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>{detail.session.status === 'active' ? 'THE TRAINING FLOOR' : 'SESSION RECORD'}</Text>
              <Text style={styles.title}>{detail.session.routineName ?? 'Workout plan'} · {detail.session.dayName ?? 'Day'}</Text>
              <Text style={styles.body}>{detail.session.status === 'active' ? 'Record the work as it happens. The evidence stays with you.' : 'This record is complete.'}</Text>
            </View>
            <View style={styles.summaryRail}>
              <Stat value={String(completedSetCount)} label="SETS" />
              <Stat value={String(completedExerciseCount)} label="MOVEMENTS" />
              <Stat value={formattedTotalWeight} label={`${weightUnit.toUpperCase()} TOTAL`} />
            </View>
          </View>

          {completedEvidence ? <View style={styles.evidence}><Text style={styles.evidenceLabel}>WORK RECORDED</Text><Text style={styles.evidenceTitle}>{completedEvidence.workingSets} working sets · {completedEvidence.repsLogged} reps</Text><Text style={styles.evidenceCopy}>{completedEvidence.durationMinutes} minutes of recorded effort. Weight entries use {weightUnit}.</Text></View> : null}
          {personalRecord ? <View style={styles.personalRecord}><Text style={styles.evidenceLabel}>PERSONAL RECORD</Text><Text style={styles.evidenceTitle}>{personalRecord.exerciseName}</Text><Text style={styles.evidenceCopy}>{personalRecord.kind === 'estimated_1rm' ? 'Estimated 1RM improved' : 'Rep record improved'} from {personalRecord.previous.reps} reps{personalRecord.previous.weight ? ` @ ${personalRecord.previous.weight}` : ''} to {personalRecord.current.reps} reps{personalRecord.current.weight ? ` @ ${personalRecord.current.weight}` : ''}.</Text></View> : null}

          {detail.session.status === 'active' ? <View style={[styles.workspace, isDesktop && styles.workspaceDesktop]}>
            <View style={styles.primaryColumn}>
              <Text style={styles.sectionLabel}>MOVEMENT</Text>
              <MovementTabs value={exerciseId} sessionOptions={detail.exercises} setsByExercise={setsByExercise} onChange={selectMovement} onAddMovement={() => setLibraryOpen(true)} />

              {selectedExercise ? <>
                <View style={styles.selectedMovementHeading}><Text style={styles.selectedMovementMeta}>{conciseMuscleGroup(selectedExercise.muscleGroup)}</Text></View>
                <View style={styles.trainingAid}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: demoExpanded }} accessibilityLabel={`${demoExpanded ? 'Collapse' : 'Expand'} demonstration for ${selectedExercise.name}`} onPress={() => setDemoExpanded((current) => !current)} style={[styles.demoToggle, demoExpanded && styles.demoToggleOpen]}>
                  <View style={styles.demoToggleCopy}><Text style={styles.demoToggleName}>Demo</Text><Text style={styles.demoToggleMeta}>{demoExpanded ? 'Hide demonstration and muscle emphasis' : 'Demonstration and muscle emphasis'}</Text></View>
                  {demoExpanded ? <ChevronUp color="#642D2A" size={21} strokeWidth={2.4} /> : <ChevronDown color="#642D2A" size={21} strokeWidth={2.4} />}
                </Pressable>
                {demoExpanded ? <View style={[styles.trainingAidContent, isDesktop && styles.trainingAidDesktop]}>
                  <View style={styles.demoPanel}>
                    {resolvedDemo ? <>
                      <Text style={styles.demoMeta}>{resolvedDemo.source === 'Calistree demonstration' ? 'Streaming from Calistree' : demoDescription(resolvedDemo.sourceName)}</Text>
                      {isDirectVideoUrl(resolvedDemo.url)
                        ? <ExerciseDemoPlayer url={resolvedDemo.url} name={selectedExercise.name} />
                        : <Pressable onPress={() => void openDemo()} style={styles.demoButton}><View style={styles.buttonWithIcon}><Text style={styles.demoButtonText}>Open demonstration</Text><ExternalLink color="#F4EFE7" size={15} strokeWidth={2.3} /></View></Pressable>}
                    </> : <Text style={styles.emptyCopy}>{calistreeDemoChecked ? 'No demonstration is available for this movement yet.' : 'Checking Calistree for a demonstration…'}</Text>}
                  </View>
                  <View style={[styles.heatPanel, isDesktop && styles.heatPanelDesktop]}><MuscleHeatMap muscleGroups={selectedExercise.muscleGroup} /></View>
                </View> : null}
              </View>
                <SetLedger key={`${selectedExercise.id}-${(setsByExercise.get(selectedExercise.id) ?? []).length}`} exercise={selectedExercise} sets={setsByExercise.get(selectedExercise.id) ?? []} previousSets={previousPerformanceByExercise.get(selectedExercise.id) ?? []} weightUnit={weightUnit} saving={saving} editableSetId={editingSetId} editReps={editReps} editWeight={editWeight} onLog={logSet} onEdit={beginEditingSet} onRemove={removeSet} onCancelEdit={() => setEditingSetId(null)} onSave={() => void saveSet()} onChangeReps={setEditReps} onChangeWeight={setEditWeight} />
              </> : null}
            </View>

            <View style={styles.secondaryColumn}>
              <Pressable accessibilityRole="button" accessibilityLabel={nextMovement ? `Next movement: ${nextMovement.name}` : 'No next movement'} disabled={saving || !nextMovement} onPress={() => nextMovement && selectMovement(nextMovement.id)} style={[styles.primaryButton, styles.nextMovementButton, (saving || !nextMovement) && styles.buttonDisabled]}><View style={styles.buttonWithIcon}><Text style={styles.primaryButtonText}>Next movement</Text><ChevronRight color="#F4EFE7" size={17} strokeWidth={2.7} /></View></Pressable>
              <View style={styles.logPanel}><Text style={styles.sectionLabel}>TODAY{String.fromCharCode(8217)}S EVIDENCE</Text><View style={styles.evidenceSummary}><Text style={styles.evidenceSummaryValue}>{completedSetCount}</Text><Text style={styles.evidenceSummaryLabel}>sets logged</Text><Text style={styles.evidenceSummaryValue}>{activeExercises.length}</Text><Text style={styles.evidenceSummaryLabel}>of {detail.exercises.length} movements underway</Text></View></View>
              <Pressable disabled={saving} onPress={() => void complete()} style={[styles.primaryButton, styles.completeButton, saving && styles.buttonDisabled]}><Text style={styles.primaryButtonText}>Complete session</Text></Pressable>
              <Pressable disabled={saving} onPress={() => setDiscardOpen(true)} style={styles.discardAction}><Text style={styles.discardText}>Discard session</Text></Pressable>
            </View>
          </View> : <View style={[styles.workspace, isDesktop && styles.workspaceDesktop]}>
            <View style={[styles.secondaryColumn, styles.completedLog]}><View style={styles.logPanel}><Text style={styles.sectionLabel}>SESSION EVIDENCE</Text>{activeExercises.length ? activeExercises.map((exercise) => <ExerciseLog key={exercise.id} exercise={exercise} exercises={detail.exercises} sets={setsByExercise.get(exercise.id) ?? []} weightUnit={weightUnit} canEdit={false} editableSetId={null} editExerciseId="" editReps="" editWeight="" editWarmup={false} saving={false} onEdit={() => undefined} onRemove={() => undefined} onCancelEdit={() => undefined} onSave={() => undefined} onChangeExercise={() => undefined} onChangeReps={() => undefined} onChangeWeight={() => undefined} onChangeWarmup={() => undefined} />) : <Text style={styles.emptyCopy}>No sets were recorded for this session.</Text>}</View></View>
            <View style={styles.secondaryColumn}><View style={styles.completedActions}><Pressable onPress={() => router.push(`/sessions/${id}/share`)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Share workout</Text></Pressable><Pressable onPress={() => void shareWorkoutJson()} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Copy workout JSON</Text></Pressable></View></View>
          </View>}
        </> : null}
      </View>
    </ScrollView>

    {detail?.session.status === 'active' && !libraryOpen && !discardOpen ? restEndAt || restExpanded ? <View style={[styles.restUtility, restEndAt ? styles.restUtilityActive : styles.restUtilityPaused, { right: isDesktop ? 32 : 16, bottom: isDesktop ? 28 : 18 }]}>
      {!restEndAt ? <View style={styles.restHeading}><Pressable accessibilityRole="button" accessibilityLabel="Compact timer" hitSlop={8} onPress={() => { setRestEditing(false); setRestExpanded(false); }} style={styles.restIconButton}><Minimize2 color="#642D2A" size={17} strokeWidth={2.5} /></Pressable></View> : null}
      {restEndAt ? <Text style={styles.restClock}>{formatRestClock(restRemaining)}</Text> : restEditing ? <TextInput accessibilityLabel="Custom rest duration, in minutes or minutes and seconds" keyboardType="numbers-and-punctuation" onBlur={applyCustomRestDuration} onChangeText={setRestInput} onSubmitEditing={applyCustomRestDuration} placeholder="1:00" placeholderTextColor="#81776D" returnKeyType="done" selectTextOnFocus style={styles.restClockInput} value={restInput} /> : <Pressable accessibilityRole="button" accessibilityLabel="Change timer duration" onPress={() => { setRestInput(formatRestInput(restRemaining || restDuration)); setRestEditing(true); }} style={styles.restClockButton}><Text style={[styles.restClock, styles.restPausedText]}>{formatRestClock(restRemaining)}</Text></Pressable>}
      <View style={styles.restControls}>{REST_PRESETS.map((seconds) => <Pressable key={seconds} accessibilityRole="button" accessibilityLabel={`Set timer to ${seconds / 60} minutes`} disabled={Boolean(restEndAt)} onPress={() => setRestPreset(seconds)} style={styles.restPreset}><Text style={[styles.restControlText, !restEndAt && styles.restPausedText]}>{seconds / 60}m</Text></Pressable>)}{!restEndAt ? <Pressable accessibilityRole="button" accessibilityLabel={restRemaining === 0 ? 'Restart timer' : 'Start timer'} onPress={startRestTimer} style={styles.restIconButton}><Play color="#642D2A" fill="#642D2A" size={17} strokeWidth={2.5} /></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel="Reset timer" onPress={() => { setRestRemaining(restDuration); setRestEndAt(null); setRestEditing(false); setRestInput(formatRestInput(restDuration)); }} style={styles.restIconButton}><RotateCcw color={restEndAt ? '#E8D194' : '#642D2A'} size={16} strokeWidth={2.5} /></Pressable></View>
    </View> : <View style={[styles.restCompact, { right: isDesktop ? 32 : 16, bottom: isDesktop ? 28 : 18 }]}><Pressable accessibilityRole="button" accessibilityLabel="Open timer" onPress={() => setRestExpanded(true)} style={styles.restCompactButton}><Clock color="#642D2A" size={19} strokeWidth={2.3} /></Pressable><View style={styles.restCompactDivider} /><Pressable accessibilityRole="button" accessibilityLabel="Start timer" onPress={startRestTimer} style={styles.restCompactButton}><Play color="#642D2A" fill="#642D2A" size={17} strokeWidth={2.5} /></Pressable></View> : null}
    {toast ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>{toast}</Text></View> : null}
    <MovementLibrarySheet visible={libraryOpen} libraryOptions={detail?.libraryExercises ?? []} sessionOptions={detail?.exercises ?? []} onClose={() => setLibraryOpen(false)} onAdd={addExercise} onImportCalistree={importCalistreeMovement} />
    <Modal visible={discardOpen} transparent animationType="fade" onRequestClose={() => setDiscardOpen(false)}><View style={styles.modalBackdrop}><View style={styles.modalPanel}><Text style={styles.modalEyebrow}>SESSION IN PROGRESS</Text><Text style={styles.modalTitle}>Discard session?</Text><Text style={styles.modalCopy}>This session is still in progress. Discarding it will remove its recorded work.</Text><View style={styles.modalActions}><Pressable disabled={saving} onPress={() => setDiscardOpen(false)} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Keep session</Text></Pressable><Pressable disabled={saving} onPress={() => void discard()} style={[styles.primaryButton, saving && styles.buttonDisabled]}><Text style={styles.primaryButtonText}>{saving ? 'Discarding…' : 'Discard session'}</Text></Pressable></View></View></View></Modal>
  </SafeAreaView>;
}

function Stat({ value, label, small = false }: { value: string; label: string; small?: boolean }) {
  return <View style={styles.stat}><Text style={[styles.statValue, small && styles.statValueSmall]} numberOfLines={1}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

type MovementOption = { id: string; name: string; category: string; muscleGroup: string | null };

function conciseMuscleGroup(muscleGroup: string | null) {
  if (!muscleGroup) return 'General';
  const value = muscleGroup.toLocaleLowerCase();
  const groups: string[] = [];
  if (/(deltoid|shoulder|trapezius|serratus|supraspinatus)/.test(value)) groups.push('Shoulders');
  if (/(triceps|biceps|brachialis|forearm)/.test(value)) groups.push('Arms');
  if (/(chest|pectoral)/.test(value)) groups.push('Chest');
  if (/(latissimus|rhomboid|infraspinatus|teres|upper back|lower back|erector)/.test(value)) groups.push('Back');
  if (/(quadriceps|hamstring|glute|calf|adductor|tibialis)/.test(value)) groups.push('Legs');
  if (/(abdominal|rectus|oblique)/.test(value)) groups.push('Core');
  return groups.slice(0, 2).join(' · ') || muscleGroup.split(',')[0]?.trim() || 'General';
}

function expectedWorkingSets(exercise: WorkoutSessionDetail['exercises'][number], sets: WorkoutSessionDetail['sets']) {
  const loggedWorkingSets = sets.filter((set) => !set.isWarmup).length;
  return exercise.targetSets ?? Math.max(loggedWorkingSets, 3);
}

function MovementTabs({ value, sessionOptions, setsByExercise, onChange, onAddMovement }: {
  value: string;
  sessionOptions: WorkoutSessionDetail['exercises'];
  setsByExercise: Map<string, WorkoutSessionDetail['sets']>;
  onChange: (value: string) => void;
  onAddMovement: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const tabRefs = useRef<Record<string, View | null>>({});
  const activeIndex = sessionOptions.findIndex((option) => option.id === value);
  const activeMovement = sessionOptions[activeIndex] ?? null;
  const spreadSteps = sessionOptions.length <= 8;

  useEffect(() => {
    const timer = setTimeout(() => {
      const tab = tabRefs.current[value];
      if (!tab) return;
      tab.measure((_x, _y, width, _height, pageX) => scrollRef.current?.scrollTo({ x: Math.max(0, pageX - width - 28), animated: true }));
    }, 0);
    return () => clearTimeout(timer);
  }, [value]);

  const selectAdjacent = (direction: -1 | 1) => {
    const next = sessionOptions[activeIndex + direction];
    if (next) onChange(next.id);
  };

  return <View style={styles.movementNavigator}>
    <View style={styles.movementHeadingRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous movement" disabled={activeIndex <= 0} onPress={() => selectAdjacent(-1)} hitSlop={8} style={[styles.movementDirection, activeIndex <= 0 && styles.movementDirectionDisabled]}><ChevronLeft color="#642D2A" size={22} strokeWidth={2.4} /></Pressable>
      <Text accessibilityRole="header" style={styles.selectedMovementName} numberOfLines={2}>{activeMovement?.name ?? 'Choose a movement'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next movement" disabled={activeIndex < 0 || activeIndex >= sessionOptions.length - 1} onPress={() => selectAdjacent(1)} hitSlop={8} style={[styles.movementDirection, (activeIndex < 0 || activeIndex >= sessionOptions.length - 1) && styles.movementDirectionDisabled]}><ChevronRight color="#642D2A" size={22} strokeWidth={2.4} /></Pressable>
    </View>
    <View style={styles.movementStepperFrame}><ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.movementStepper, spreadSteps && styles.movementStepperCentered]}>
      {sessionOptions.map((option) => {
        const active = option.id === value;
        const completed = (setsByExercise.get(option.id) ?? []).filter((set) => !set.isWarmup).length;
        const expected = expectedWorkingSets(option, setsByExercise.get(option.id) ?? []);
        return <View key={option.id} ref={(node) => { tabRefs.current[option.id] = node; }} collapsable={false} style={spreadSteps ? styles.movementStepWrapExpanded : undefined}>
          <Pressable accessibilityRole="tab" accessibilityLabel={`${option.name}, ${completed} of ${expected} sets`} accessibilityState={{ selected: active }} onPress={() => onChange(option.id)} style={[styles.movementStep, spreadSteps && styles.movementStepExpanded, completed >= expected && styles.movementStepComplete, active && styles.movementStepActive]} />
        </View>;
      })}
    </ScrollView></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Add a movement" onPress={onAddMovement} style={styles.addMovementAction}><Plus color="#642D2A" size={16} strokeWidth={2.5} /><Text style={styles.addMovementActionText}>Add movement</Text></Pressable>
  </View>;
}

function MovementLibrarySheet({ visible, libraryOptions, sessionOptions, onClose, onAdd, onImportCalistree }: {
  visible: boolean;
  libraryOptions: MovementOption[];
  sessionOptions: WorkoutSessionDetail['exercises'];
  onClose: () => void;
  onAdd: (exerciseId: string) => Promise<void>;
  onImportCalistree: (slug: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [calistreeSearch, setCalistreeSearch] = useState<{ query: string; results: { name: string; slug: string }[] }>({ query: '', results: [] });
  const [searchingCalistree, setSearchingCalistree] = useState(false);
  const [addingExerciseId, setAddingExerciseId] = useState<string | null>(null);
  const [importingSlug, setImportingSlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sessionIds = new Set(sessionOptions.map((option) => option.id));
  const filteredLibrary = normalizedQuery ? libraryOptions.filter((option) => option.name.toLocaleLowerCase().includes(normalizedQuery)) : libraryOptions;
  const localNames = new Set(libraryOptions.map((option) => option.name.trim().toLocaleLowerCase()));
  const calistreeResults = calistreeSearch.query === normalizedQuery ? calistreeSearch.results : [];
  const newCalistreeResults = calistreeResults.filter((result) => !localNames.has(result.name.trim().toLocaleLowerCase()));

  const closeSheet = () => { setQuery(''); setActionError(null); onClose(); };

  useEffect(() => {
    if (!visible || normalizedQuery.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      setSearchingCalistree(true);
      void searchCalistreeExercises(normalizedQuery)
        .then(({ results }) => { if (current) setCalistreeSearch({ query: normalizedQuery, results }); })
        .catch(() => { if (current) setCalistreeSearch({ query: normalizedQuery, results: [] }); })
        .finally(() => { if (current) setSearchingCalistree(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [normalizedQuery, visible]);

  const addFromLibrary = async (exerciseId: string) => {
    setAddingExerciseId(exerciseId); setActionError(null);
    try { await onAdd(exerciseId); closeSheet(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Unable to add the movement.'); }
    finally { setAddingExerciseId(null); }
  };
  const importFromCalistree = async (slug: string) => {
    setImportingSlug(slug); setActionError(null);
    try { await onImportCalistree(slug); closeSheet(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Unable to import the movement.'); }
    finally { setImportingSlug(null); }
  };

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={closeSheet}>
    <View style={styles.modalBackdrop}>
      <View style={styles.selectModalPanel}>
        <View style={styles.selectModalHeader}><View><Text style={styles.modalEyebrow}>MOVEMENT LIBRARY</Text><Text style={styles.selectModalTitle}>Add a movement</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close movement library" onPress={closeSheet} style={styles.closeSelect}><X color="#642D2A" size={19} strokeWidth={2.4} /></Pressable></View>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search movements" placeholderTextColor="#81776D" style={styles.selectSearch} />
        {actionError ? <Text accessibilityRole="alert" style={styles.movementActionError}>{actionError}</Text> : null}
        <ScrollView contentContainerStyle={styles.selectOptions} keyboardShouldPersistTaps="handled">
          {filteredLibrary.length ? filteredLibrary.map((option) => {
            const added = sessionIds.has(option.id); const adding = addingExerciseId === option.id;
            return <Pressable key={option.id} accessibilityRole="button" disabled={added || addingExerciseId !== null || importingSlug !== null} onPress={() => void addFromLibrary(option.id)} style={[styles.selectOption, added && styles.selectOptionDisabled]}><View style={styles.selectOptionCopy}><Text style={styles.selectOptionName} numberOfLines={1}>{option.name}</Text><Text style={styles.selectOptionMeta} numberOfLines={1}>{conciseMuscleGroup(option.muscleGroup)}</Text></View><Text style={[styles.selectOptionMark, added && styles.selectOptionMarkMuted]}>{adding ? 'ADDING…' : added ? 'ADDED' : 'ADD'}</Text></Pressable>;
          }) : <Text style={styles.emptyCopy}>No library movements match that search.</Text>}
          {normalizedQuery.length >= 2 ? <View style={styles.calistreeSection}>
            <Text style={styles.calistreeLabel}>IMPORT FROM CALISTREE</Text>
            {searchingCalistree ? <Text style={styles.emptyCopy}>Searching Calistree…</Text> : null}
            {!searchingCalistree && newCalistreeResults.map((result) => <Pressable key={result.slug} disabled={importingSlug !== null || addingExerciseId !== null} onPress={() => void importFromCalistree(result.slug)} style={styles.calistreeOption}><View style={styles.selectOptionCopy}><Text style={styles.selectOptionName} numberOfLines={1}>{result.name}</Text><Text style={styles.selectOptionMeta}>New to your library · Calistree</Text></View><Text style={styles.selectOptionMark}>{importingSlug === result.slug ? 'IMPORTING…' : 'IMPORT & ADD'}</Text></Pressable>)}
          </View> : null}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

type LedgerDraft = { id: string; isWarmup: boolean; reps: string; weight: string };

function formatPreviousValue(set: { reps: number; weight: string | number | null }, weightUnit: 'kg' | 'lbs') {
  return set.weight === null || set.weight === '' ? `${set.reps} reps` : `${set.weight} ${weightUnit} × ${set.reps}`;
}

function SetLedger({ exercise, sets, previousSets, weightUnit, saving, editableSetId, editReps, editWeight, onLog, onEdit, onRemove, onCancelEdit, onSave, onChangeReps, onChangeWeight }: {
  exercise: WorkoutSessionDetail['exercises'][number]; sets: WorkoutSessionDetail['sets']; previousSets: WorkoutSessionDetail['previousPerformances']; weightUnit: 'kg' | 'lbs'; saving: boolean; editableSetId: string | null; editReps: string; editWeight: string;
  onLog: (payload: { exerciseId: string; reps: string; weight: string; repsPlaceholder: string; weightPlaceholder: string; isWarmup: boolean }) => Promise<void>; onEdit: (set: WorkoutSessionDetail['sets'][number]) => void; onRemove: (setId: string) => void; onCancelEdit: () => void; onSave: () => void; onChangeReps: (value: string) => void; onChangeWeight: (value: string) => void;
}) {
  const workingSets = useMemo(() => sets.filter((set) => !set.isWarmup).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [sets]);
  const targetCount = expectedWorkingSets(exercise, sets);
  const makeDraft = (ordinal: number, isWarmup: boolean) => ({
    id: `${isWarmup ? 'warmup' : 'working'}-${ordinal}-${Math.random().toString(36).slice(2)}`,
    isWarmup,
    reps: '',
    weight: '',
  });
  const [drafts, setDrafts] = useState<LedgerDraft[]>(() => Array.from({ length: Math.max(0, targetCount - workingSets.length) }, (_item, index) => makeDraft(workingSets.length + index + 1, false)));

  const updateDraft = (id: string, field: 'reps' | 'weight', value: string) => setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [field]: value } : draft));
  const addDraft = () => setDrafts((current) => {
    const workingDrafts = current.filter((draft) => !draft.isWarmup);
    const ordinal = workingSets.length + workingDrafts.length + 1;
    return [...current, makeDraft(ordinal, false)];
  });
  const logDraft = async (draft: LedgerDraft) => {
    const ordinal = workingSets.length + drafts.filter((candidate) => !candidate.isWarmup).findIndex((candidate) => candidate.id === draft.id) + 1;
    const previous = previousSets[Math.min(ordinal - 1, Math.max(0, previousSets.length - 1))];
    const weightPlaceholder = previous?.weight !== null && previous?.weight !== undefined
      ? String(previous.weight)
      : exercise.targetWeight !== null && exercise.targetWeight !== undefined
        ? String(exercise.targetWeight)
        : '';
    const repsPlaceholder = previous ? String(previous.reps) : exercise.targetReps ? String(exercise.targetReps) : '';
    await onLog({ exerciseId: exercise.id, reps: draft.reps, weight: draft.weight, repsPlaceholder, weightPlaceholder, isWarmup: draft.isWarmup });
  };

  return <View style={styles.ledger}>
    <View style={styles.ledgerHeader}><Text style={styles.panelLabel}>SETS</Text><Text style={styles.sectionCount}>{workingSets.length}/{targetCount}</Text></View>
    {workingSets.map((set, index) => editableSetId === set.id ? <View key={set.id} style={styles.ledgerEditRow}><Text style={styles.ledgerSetNumber}>{String(index + 1).padStart(2, '0')}</Text><View style={styles.ledgerField}><TextInput accessibilityLabel={`${weightUnit} for set ${index + 1}`} value={editWeight} onChangeText={onChangeWeight} keyboardType="decimal-pad" placeholder={weightUnit} placeholderTextColor="#81776D" style={styles.ledgerInput} /></View><View style={styles.ledgerField}><TextInput accessibilityLabel={`Reps for set ${index + 1}`} value={editReps} onChangeText={onChangeReps} keyboardType="number-pad" placeholder="reps" placeholderTextColor="#81776D" style={styles.ledgerInput} /></View><View style={styles.ledgerRowActions}><Pressable disabled={saving} onPress={onSave}><Text style={styles.textActionText}>Save</Text></Pressable><Pressable disabled={saving} onPress={onCancelEdit}><Text style={styles.discardText}>Cancel</Text></Pressable></View></View> : <View key={set.id} style={styles.ledgerSavedRow}><Text style={styles.ledgerSetNumber}>{String(index + 1).padStart(2, '0')}</Text><Text style={styles.ledgerSavedValue}>{set.weight === null ? 'Bodyweight' : `${set.weight} ${weightUnit}`}</Text><Text style={styles.ledgerSavedValue}>{set.reps} reps</Text><View style={styles.ledgerRowActions}><Pressable accessibilityRole="button" accessibilityLabel={`Edit set ${index + 1}`} disabled={saving || editableSetId !== null} onPress={() => onEdit(set)} style={styles.ledgerIconAction}><Pencil color="#642D2A" size={17} strokeWidth={2.4} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${index + 1}`} disabled={saving || editableSetId !== null} onPress={() => onRemove(set.id)} style={styles.ledgerIconAction}><Trash2 color="#642D2A" size={17} strokeWidth={2.4} /></Pressable></View></View>)}
    {drafts.filter((draft) => !draft.isWarmup).map((draft, index) => {
      const ordinal = workingSets.length + index + 1;
      const previous = previousSets[Math.min(ordinal - 1, Math.max(0, previousSets.length - 1))];
      const weightPlaceholder = previous?.weight !== null && previous?.weight !== undefined
        ? String(previous.weight)
        : exercise.targetWeight !== null && exercise.targetWeight !== undefined
          ? String(exercise.targetWeight)
          : weightUnit;
      const repsPlaceholder = previous ? String(previous.reps) : exercise.targetReps ? String(exercise.targetReps) : 'reps';
      return <View key={draft.id} style={styles.ledgerDraftBlock}><View style={styles.ledgerDraftRow}><Text style={styles.ledgerSetNumber}>{String(ordinal).padStart(2, '0')}</Text><View style={styles.ledgerField}><TextInput accessibilityLabel={`${weightUnit} for set ${ordinal}`} value={draft.weight} onChangeText={(value) => updateDraft(draft.id, 'weight', value)} keyboardType="decimal-pad" placeholder={weightPlaceholder} placeholderTextColor="#81776D" style={styles.ledgerInput} /></View><View style={styles.ledgerField}><TextInput accessibilityLabel={`Reps for set ${ordinal}`} value={draft.reps} onChangeText={(value) => updateDraft(draft.id, 'reps', value)} keyboardType="number-pad" placeholder={repsPlaceholder} placeholderTextColor="#81776D" style={styles.ledgerInput} returnKeyType="done" onSubmitEditing={() => void logDraft(draft)} /></View><Pressable accessibilityRole="button" disabled={saving} onPress={() => void logDraft(draft)} style={[styles.ledgerLogButton, saving && styles.buttonDisabled]}><Text style={styles.ledgerLogButtonText}>{saving ? '…' : 'Log'}</Text></Pressable></View>{previous ? <Text style={styles.previousValue}>Last {formatPreviousValue(previous, weightUnit)}</Text> : null}</View>;
    })}
    <View style={styles.ledgerAddActions}><Pressable accessibilityRole="button" onPress={addDraft}><Text style={styles.textActionText}>+ Add set</Text></Pressable></View>
  </View>;
}

type ExerciseLogProps = {
  exercise: WorkoutSessionDetail['exercises'][number]; exercises: WorkoutSessionDetail['exercises']; sets: WorkoutSessionDetail['sets']; weightUnit: 'kg' | 'lbs'; canEdit: boolean; editableSetId: string | null; editExerciseId: string; editReps: string; editWeight: string; editWarmup: boolean; saving: boolean;
  onEdit: (set: WorkoutSessionDetail['sets'][number]) => void; onRemove: (setId: string) => void; onCancelEdit: () => void; onSave: () => void; onChangeExercise: (value: string) => void; onChangeReps: (value: string) => void; onChangeWeight: (value: string) => void; onChangeWarmup: (updater: (current: boolean) => boolean) => void;
};

function ExerciseLog(props: ExerciseLogProps) {
  const { exercise, sets, weightUnit } = props;
  return <View style={styles.exerciseLog}><View style={styles.exerciseLogHeader}><Text style={styles.exerciseLogTitle}>{exercise.name}</Text><Text style={styles.exerciseLogCount}>{sets.length} {sets.length === 1 ? 'set' : 'sets'}</Text></View>
    {sets.map((set) => props.editableSetId === set.id ? <View key={set.id} style={styles.editBlock}><Text style={styles.inputLabel}>EDIT SET #{set.setOrder}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editMovementPicker}>{props.exercises.map((choice) => <Pressable key={choice.id} onPress={() => props.onChangeExercise(choice.id)} style={[styles.editMovement, choice.id === props.editExerciseId && styles.editMovementActive]}><Text style={[styles.editMovementText, choice.id === props.editExerciseId && styles.editMovementTextActive]}>{choice.name}</Text></Pressable>)}</ScrollView><View style={styles.editInputRow}><TextInput value={props.editReps} onChangeText={props.onChangeReps} keyboardType="number-pad" placeholder="Reps" placeholderTextColor="#81776D" style={[styles.input, styles.editInput]} /><TextInput value={props.editWeight} onChangeText={props.onChangeWeight} keyboardType="decimal-pad" placeholder={`Weight (${weightUnit})`} placeholderTextColor="#81776D" style={[styles.input, styles.editInput]} /></View>{SHOW_WARMUP_CONTROL ? <Pressable onPress={() => props.onChangeWarmup((current) => !current)}><Text style={styles.textActionText}>{props.editWarmup ? 'Warm-up set' : 'Working set'} · change</Text></Pressable> : null}<View style={styles.inlineActions}><Pressable disabled={props.saving} onPress={props.onSave}><Text style={styles.textActionText}>Save</Text></Pressable><Pressable disabled={props.saving} onPress={props.onCancelEdit}><Text style={styles.discardText}>Cancel</Text></Pressable></View></View> : <View key={set.id} style={styles.setLine}><Text style={styles.setLineText}>#{set.setOrder} · {set.reps} reps{set.weight !== null ? ` · ${set.weight} ${weightUnit}` : ''}{set.isWarmup ? ' · warm-up' : ''}</Text>{!props.canEdit || props.editableSetId !== null || props.saving ? null : <View style={styles.inlineActions}><Pressable onPress={() => props.onEdit(set)}><Text style={styles.textActionText}>Edit</Text></Pressable><Pressable onPress={() => props.onRemove(set.id)}><Text style={styles.discardText}>Remove</Text></Pressable></View>}</View>)}</View>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1, position: 'relative' },
  scrollContent: { paddingBottom: 240 }, page: { alignSelf: 'center', maxWidth: 1220, padding: 24, width: '100%' },
  inlineLink: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6 }, back: { color: '#642D2A', fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' }, loading: { alignItems: 'center', gap: 10, marginTop: 88 },
  errorNotice: { borderColor: '#A95B5B', borderWidth: 1, marginTop: 20, padding: 14 }, errorText: { color: '#642D2A', fontSize: 14, fontWeight: '700', lineHeight: 21 },
  header: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, gap: 22, paddingBottom: 25, paddingTop: 28 }, headerDesktop: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' }, headerCopy: { flexShrink: 1, maxWidth: 760 },
  eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '700', letterSpacing: 1.8 }, title: { color: '#101015', fontSize: 39, fontWeight: '900', letterSpacing: -1.8, lineHeight: 43, marginTop: 10 }, body: { color: '#2C2C31', fontSize: 17, lineHeight: 26, marginTop: 12 },
  summaryRail: { borderColor: '#D4C9B9', borderWidth: 1, flexDirection: 'row' }, stat: { alignItems: 'center', borderRightColor: '#D4C9B9', borderRightWidth: 1, flex: 1, minWidth: 0, paddingHorizontal: 13, paddingVertical: 11 }, statValue: { color: '#101015', fontSize: 21, fontWeight: '900' }, statValueSmall: { fontSize: 14, marginTop: 4 }, statLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginTop: 4 },
  evidence: { backgroundColor: '#E8D194', borderColor: '#C8A850', borderWidth: 1, gap: 5, marginTop: 22, padding: 17 }, personalRecord: { backgroundColor: '#E7D9D3', borderColor: '#A95B5B', borderWidth: 1, gap: 5, marginTop: 22, padding: 17 }, evidenceLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 }, evidenceTitle: { color: '#101015', fontSize: 20, fontWeight: '900' }, evidenceCopy: { color: '#2C2C31', fontSize: 14, lineHeight: 21 },
  workspace: { gap: 22, marginTop: 28 }, workspaceDesktop: { alignItems: 'flex-start', flexDirection: 'row' }, primaryColumn: { flex: 1.2, minWidth: 0 }, secondaryColumn: { flex: 0.8, minWidth: 0 }, completedLog: { flex: 1.2 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, sectionLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '800', letterSpacing: 1.55 }, sectionCount: { color: '#655D57', fontSize: 12, fontWeight: '700' },
  movementNavigator: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, paddingBottom: 13, paddingTop: 9 }, movementHeadingRow: { alignItems: 'center', flexDirection: 'row', gap: 8 }, movementDirection: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 32 }, movementDirectionDisabled: { opacity: 0.25 }, selectedMovementName: { color: '#101015', flex: 1, fontSize: 25, fontWeight: '900', letterSpacing: -1, lineHeight: 29, textAlign: 'center' }, movementStepperFrame: { alignSelf: 'center', maxWidth: 620, width: '100%' }, movementStepper: { gap: 8, paddingBottom: 12, paddingHorizontal: 2, paddingTop: 8 }, movementStepperCentered: { justifyContent: 'center', width: '100%' }, movementStepWrapExpanded: { flex: 1 }, movementStep: { backgroundColor: '#D4C9B9', height: 4, minWidth: 30 }, movementStepExpanded: { minWidth: 0, width: '100%' }, movementStepActive: { backgroundColor: '#642D2A', height: 5 }, movementStepComplete: { backgroundColor: '#81776D' }, selectedMovementHeading: { gap: 4, marginTop: 14 }, selectedMovementMeta: { color: '#655D57', fontSize: 14, textAlign: 'center', textTransform: 'capitalize' },
  selectTrigger: { alignItems: 'center', borderColor: '#101015', borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, minHeight: 67, paddingHorizontal: 14, paddingVertical: 10 }, selectValueWrap: { flex: 1, gap: 3, minWidth: 0 }, selectLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 9, fontWeight: '800', letterSpacing: 1.15 }, selectValue: { color: '#101015', fontSize: 16, fontWeight: '800' }, selectMeta: { color: '#655D57', fontSize: 11, textTransform: 'capitalize' }, selectPlaceholder: { color: '#655D57', fontWeight: '600' }, selectChevron: { marginLeft: 15 },
  sessionMovementList: { borderColor: '#D4C9B9', borderWidth: 1, borderTopWidth: 0 }, sessionMovementLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 14, paddingTop: 13 }, sessionMovementRow: { alignItems: 'center', borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 57, paddingHorizontal: 14, paddingVertical: 9 }, sessionMovementRowCurrent: { backgroundColor: '#E7D9D3' }, sessionMovementIndex: { color: '#A95B5B', fontFamily: 'Courier', fontSize: 11, fontWeight: '800', width: 23 }, sessionMovementIndexCurrent: { color: '#642D2A' }, sessionMovementCopy: { flex: 1, minWidth: 0 }, sessionMovementName: { color: '#101015', fontSize: 14, fontWeight: '800' }, sessionMovementMeta: { color: '#655D57', fontSize: 11, marginTop: 2, textTransform: 'capitalize' }, currentMovementMark: { alignItems: 'center', backgroundColor: '#642D2A', flexDirection: 'row', gap: 3, paddingHorizontal: 6, paddingVertical: 5 }, currentMovementMarkText: { color: '#F4EFE7', fontFamily: 'Courier', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 }, addMovementAction: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 52 }, addMovementActionText: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  trainingAid: { borderColor: '#D4C9B9', borderWidth: 1, marginTop: 16 }, trainingAidContent: { gap: 0 }, trainingAidDesktop: { flexDirection: 'row' }, demoToggle: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'space-between', minHeight: 76, paddingHorizontal: 17, paddingVertical: 13 }, demoToggleOpen: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1 }, demoToggleCopy: { flex: 1, gap: 3, minWidth: 0 }, demoToggleName: { color: '#101015', fontSize: 17, fontWeight: '900' }, demoToggleMeta: { color: '#655D57', fontSize: 12, lineHeight: 17 }, demoPanel: { flex: 1, gap: 7, padding: 17 }, heatPanel: { flex: 1, padding: 14 }, heatPanelDesktop: { borderLeftColor: '#D4C9B9', borderLeftWidth: 1 }, panelLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, demoName: { color: '#101015', fontSize: 21, fontWeight: '900' }, demoMeta: { color: '#655D57', fontSize: 13, lineHeight: 19 }, demoVideo: { alignSelf: 'stretch', backgroundColor: '#101015', height: 260, marginTop: 6, width: '100%' }, demoButton: { alignSelf: 'flex-start', backgroundColor: '#642D2A', marginTop: 5, paddingHorizontal: 13, paddingVertical: 11 }, buttonWithIcon: { alignItems: 'center', flexDirection: 'row', gap: 7 }, demoButtonText: { color: '#F4EFE7', fontSize: 13, fontWeight: '800' }, emptyCopy: { color: '#655D57', fontSize: 13, lineHeight: 20 },
  logger: { borderColor: '#101015', borderWidth: 1, gap: 15, marginTop: 16, padding: 17 }, inputRow: { gap: 14 }, inputRowDesktop: { alignItems: 'flex-end', flexDirection: 'row' }, inputGroup: { flex: 1, gap: 3 }, inputLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 }, input: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 18, minHeight: 45, paddingBottom: 5, paddingTop: 7 }, warmupControl: { borderColor: '#BFB2A1', borderWidth: 1, paddingHorizontal: 13, paddingVertical: 13 }, warmupControlActive: { backgroundColor: '#E8D194', borderColor: '#C8A850' }, warmupText: { color: '#655D57', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, warmupTextActive: { color: '#101015' },
  ledger: { borderColor: '#101015', borderWidth: 1, gap: 0, marginTop: 16, maxWidth: '100%', padding: 14 }, ledgerHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 8 }, ledgerSavedRow: { alignItems: 'center', borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', minHeight: 54, paddingVertical: 7 }, ledgerEditRow: { alignItems: 'center', backgroundColor: '#FBF7F0', borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', minHeight: 60, paddingVertical: 7 }, ledgerDraftBlock: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, maxWidth: '100%', paddingVertical: 8 }, ledgerDraftRow: { alignItems: 'center', flexDirection: 'row', maxWidth: '100%', minHeight: 44 }, ledgerSetNumber: { color: '#A95B5B', fontFamily: 'Courier', fontSize: 12, fontWeight: '800', width: 30 }, ledgerField: { flex: 1, minWidth: 0, paddingHorizontal: 3 }, ledgerSavedValue: { color: '#101015', flex: 1, fontSize: 13, fontWeight: '700', minWidth: 0, paddingHorizontal: 3 }, ledgerInput: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 15, maxWidth: '100%', minHeight: 44, paddingHorizontal: 2, paddingVertical: 4, width: '100%' }, ledgerRowActions: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', marginLeft: 5, minWidth: 0, width: 68 }, ledgerLogButton: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', marginLeft: 5, minHeight: 44, paddingHorizontal: 6, width: 52 }, ledgerLogButtonText: { color: '#F4EFE7', fontSize: 11, fontWeight: '800' }, previousValue: { color: '#655D57', fontSize: 11, lineHeight: 16, marginLeft: 30, marginTop: 4 }, ledgerAddActions: { paddingTop: 14 },
  primaryButton: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', minHeight: 52, paddingHorizontal: 16 }, primaryButtonText: { color: '#F4EFE7', fontSize: 15, fontWeight: '800' }, nextMovementButton: { marginBottom: 14 }, outlineButton: { alignItems: 'center', borderColor: '#101015', borderWidth: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 16 }, outlineButtonText: { color: '#101015', fontSize: 15, fontWeight: '800' }, buttonDisabled: { opacity: 0.5 },
  textActionText: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  ledgerIconAction: { alignItems: 'center', justifyContent: 'center', minHeight: 36, minWidth: 30 },
  logPanel: { borderColor: '#D4C9B9', borderWidth: 1, padding: 17 }, evidenceSummary: { gap: 3, marginTop: 18 }, evidenceSummaryValue: { color: '#101015', fontSize: 31, fontWeight: '900', letterSpacing: -1 }, evidenceSummaryLabel: { color: '#655D57', fontSize: 13, marginBottom: 9 }, emptyState: { gap: 8, paddingVertical: 35 }, emptyStateTitle: { color: '#101015', fontSize: 18, fontWeight: '900' }, exerciseLog: { borderTopColor: '#D4C9B9', borderTopWidth: 1, gap: 6, marginTop: 15, paddingTop: 13 }, exerciseLogHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 9, justifyContent: 'space-between' }, exerciseLogTitle: { color: '#101015', flex: 1, fontSize: 16, fontWeight: '900' }, exerciseLogCount: { color: '#655D57', fontSize: 12, fontWeight: '700' }, setLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: 5 }, setLineText: { color: '#2C2C31', flex: 1, fontSize: 13, lineHeight: 20 }, inlineActions: { alignItems: 'center', flexDirection: 'row', gap: 10, marginLeft: 12 }, discardAction: { alignSelf: 'center', marginTop: 17 }, discardText: { color: '#642D2A', fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' }, completeButton: { marginTop: 16 },
  editBlock: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, gap: 10, marginTop: 7, padding: 12 }, editMovementPicker: { gap: 6, paddingRight: 12 }, editMovement: { borderColor: '#BFB2A1', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 }, editMovementActive: { backgroundColor: '#101015', borderColor: '#101015' }, editMovementText: { color: '#101015', fontSize: 11, fontWeight: '700' }, editMovementTextActive: { color: '#F4EFE7' }, editInputRow: { flexDirection: 'row', gap: 12 }, editInput: { flex: 1, fontSize: 15 }, completedActions: { gap: 10 },
  restUtility: { borderColor: '#101015', borderWidth: 1, gap: 8, minWidth: 184, padding: 10, position: 'absolute' }, restUtilityActive: { backgroundColor: '#101015' }, restUtilityPaused: { backgroundColor: '#F4EFE7' }, restHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end', minHeight: 20 }, restClockButton: { alignSelf: 'flex-start' }, restClock: { color: '#F4EFE7', fontSize: 29, fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: -1 }, restClockInput: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 29, fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: -1, minWidth: 110, paddingBottom: 2, paddingTop: 0 }, restPausedText: { color: '#101015' }, restControls: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, restPreset: { minHeight: 32, paddingHorizontal: 5, paddingVertical: 6 }, restControlText: { color: '#E8D194', fontSize: 11, fontWeight: '800', textDecorationLine: 'underline' }, restIconButton: { alignItems: 'center', justifyContent: 'center', minHeight: 32, minWidth: 32 }, restCompact: { alignItems: 'center', backgroundColor: '#F4EFE7', borderColor: '#101015', borderWidth: 1, flexDirection: 'row', padding: 3, position: 'absolute' }, restCompactButton: { alignItems: 'center', justifyContent: 'center', minHeight: 38, minWidth: 38 }, restCompactDivider: { backgroundColor: '#D4C9B9', height: 22, width: 1 },
  toast: { backgroundColor: '#101015', left: 24, paddingHorizontal: 16, paddingVertical: 13, position: 'absolute', right: 24, top: 16 }, toastText: { color: '#F4EFE7', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(16,16,21,0.58)', flex: 1, justifyContent: 'center', padding: 24 }, modalPanel: { backgroundColor: '#F4EFE7', borderColor: '#101015', borderWidth: 1, gap: 14, maxWidth: 460, padding: 22, width: '100%' }, modalEyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 }, modalTitle: { color: '#101015', fontSize: 28, fontWeight: '900', letterSpacing: -1 }, modalCopy: { color: '#2C2C31', fontSize: 15, lineHeight: 23 }, modalActions: { gap: 10, marginTop: 7 },
  selectModalPanel: { backgroundColor: '#F4EFE7', borderColor: '#101015', borderWidth: 1, maxHeight: '82%', maxWidth: 580, padding: 18, width: '100%' }, selectModalHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' }, selectModalTitle: { color: '#101015', fontSize: 23, fontWeight: '900', letterSpacing: -0.8, marginTop: 5 }, closeSelect: { borderColor: '#101015', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }, movementTabs: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', gap: 20, marginTop: 18 }, movementTab: { borderBottomColor: 'transparent', borderBottomWidth: 2, paddingBottom: 10 }, movementTabActive: { borderBottomColor: '#642D2A' }, movementTabText: { color: '#655D57', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }, movementTabTextActive: { color: '#642D2A' }, selectSearch: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 16, marginTop: 18, minHeight: 45, paddingVertical: 7 }, movementActionError: { backgroundColor: '#E7D9D3', color: '#642D2A', fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 12, padding: 10 }, selectOptions: { paddingBottom: 10, paddingTop: 12 }, selectOption: { alignItems: 'center', borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', gap: 14, justifyContent: 'space-between', paddingVertical: 13 }, selectOptionCopy: { flex: 1, minWidth: 0 }, selectOptionActive: { backgroundColor: '#101015', marginHorizontal: -8, paddingHorizontal: 8 }, selectOptionDisabled: { opacity: 0.58 }, selectOptionName: { color: '#101015', fontSize: 15, fontWeight: '800' }, selectOptionNameActive: { color: '#F4EFE7' }, selectOptionMeta: { color: '#655D57', fontSize: 12, marginTop: 3, textTransform: 'capitalize' }, selectOptionMetaActive: { color: '#E8D194' }, selectOptionMark: { color: '#642D2A', fontSize: 11, fontWeight: '800', textDecorationLine: 'underline' }, selectOptionMarkMuted: { color: '#655D57', textDecorationLine: 'none' }, selectOptionMarkActive: { color: '#F4EFE7' }, calistreeSection: { borderTopColor: '#BFB2A1', borderTopWidth: 1, gap: 6, marginTop: 14, paddingTop: 14 }, calistreeLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1.25 }, calistreeOption: { alignItems: 'center', borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', gap: 14, justifyContent: 'space-between', paddingVertical: 13 },
});
