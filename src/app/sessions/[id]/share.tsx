import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getWorkoutSession, type WorkoutSessionDetail } from '../../../lib/api';
import { useTransmuteStyles, useTransmuteTheme } from '../../../theme/transmute-theme';

type SetRecord = WorkoutSessionDetail['sets'][number];

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function formatSet(set: SetRecord, unit: WorkoutSessionDetail['session']['weightUnit']) {
  const weight = set.weight === null ? '' : ` @ ${set.weight} ${unit}`;
  return `${set.reps} reps${weight}`;
}

function summarizeSets(sets: SetRecord[], unit: WorkoutSessionDetail['session']['weightUnit']) {
  const working = sets.filter((set) => !set.isWarmup);
  const warmups = sets.filter((set) => set.isWarmup);
  const summarize = (items: SetRecord[]) => {
    const runs: { label: string; count: number }[] = [];
    for (const set of items) {
      const label = formatSet(set, unit);
      const previous = runs.at(-1);
      if (previous?.label === label) previous.count += 1;
      else runs.push({ label, count: 1 });
    }
    return runs.map(({ label, count }) => count === 1 ? label : `${count} × ${label}`).join(' · ');
  };

  if (!working.length && !warmups.length) return 'No sets recorded';
  if (!warmups.length) return summarize(working);
  if (!working.length) return `Warm-up · ${summarize(warmups)}`;
  return `${summarize(working)}\nWarm-up · ${summarize(warmups)}`;
}

export default function WorkoutShareScreen() {
  const styles = useTransmuteStyles(baseStyles);
  const { palette } = useTransmuteTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { height, width } = useWindowDimensions();
  const [detail, setDetail] = useState<WorkoutSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void getWorkoutSession(id)
      .then((next) => {
        if (!active) return;
        setDetail(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the workout record.');
      });
    return () => { active = false; };
  }, [id]);

  const movements = useMemo(() => {
    if (!detail) return [];
    return detail.exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      summary: summarizeSets(
        detail.sets
          .filter((set) => set.exerciseId === exercise.id)
          .sort((a, b) => a.setOrder - b.setOrder),
        detail.session.weightUnit,
      ),
    }));
  }, [detail]);

  const totalWeight = useMemo(() => {
    if (!detail) return 0;
    return detail.sets.reduce((total, set) => {
      if (set.weight === null) return total;
      const weight = typeof set.weight === 'number' ? set.weight : Number(set.weight);
      return Number.isFinite(weight) ? total + weight * set.reps : total;
    }, 0);
  }, [detail]);

  const formattedTotalWeight = useMemo(() => {
    if (!detail) return '';
    const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(totalWeight);
    return `${value} ${detail.session.weightUnit}`;
  }, [detail, totalWeight]);

  const columns = width >= 680 || movements.length > 5 ? 2 : 1;
  const dense = movements.length > 8 || (detail?.sets.length ?? 0) > 16 || height < 720;
  const titleSize = dense ? 28 : 34;
  const movementSize = dense ? 13 : 15;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {!detail && !error ? (
        <View style={styles.loading}><ActivityIndicator color={palette.oxide} /><Text style={styles.loadingText}>Preparing workout record…</Text></View>
      ) : null}
      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.backText}>Back to session</Text></Pressable>
        </View>
      ) : null}
      {detail ? (
        <View style={styles.screen}>
          <View style={styles.topline}>
            <Text style={styles.brand}>TRANSMUTE</Text>
            <Text style={styles.recordLabel}>WORKOUT RECORD</Text>
          </View>

          <View style={styles.heading}>
            <Text adjustsFontSizeToFit numberOfLines={2} style={[styles.title, { fontSize: titleSize, lineHeight: titleSize + 3 }]}>
              {detail.session.routineName ?? 'Workout plan'}
            </Text>
            <Text style={styles.day}>{detail.session.dayName ?? 'Session'} · {formatDate(detail.session.startedAt)}</Text>
          </View>

            <View style={styles.evidence}>
            <View><Text style={styles.evidenceValue}>{detail.exercises.length}</Text><Text style={styles.evidenceLabel}>MOVEMENTS</Text></View>
            <View><Text style={styles.evidenceValue}>{detail.sets.length}</Text><Text style={styles.evidenceLabel}>SETS</Text></View>
            <View><Text adjustsFontSizeToFit numberOfLines={1} style={styles.evidenceValue}>{formattedTotalWeight}</Text><Text style={styles.evidenceLabel}>TOTAL WEIGHT</Text></View>
          </View>

          <View style={styles.divider} />
          <View style={[styles.movementGrid, columns === 2 && styles.movementGridTwoColumns]}>
            {movements.map((movement, index) => (
              <View key={movement.id} style={[styles.movement, columns === 2 && styles.movementHalf]}>
                <Text style={styles.movementIndex}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={styles.movementCopy}>
                  <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.movementName, { fontSize: movementSize }]}>{movement.name}</Text>
                  <Text adjustsFontSizeToFit numberOfLines={dense ? 1 : 2} style={[styles.setSummary, dense && styles.setSummaryDense]}>{movement.summary}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerLine}>Nothing changes without an exchange.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
              <View style={styles.backButtonContent}><ArrowLeft color={palette.ink} size={16} strokeWidth={2.4} /><Text style={styles.backButtonText}>Back to session</Text></View>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 },
  loading: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  loadingText: { color: '#2C2C31', fontSize: 15 },
  errorWrap: { flex: 1, gap: 18, justifyContent: 'center', padding: 28 },
  error: { color: '#642D2A', fontSize: 16, fontWeight: '800', lineHeight: 24 },
  backText: { color: '#642D2A', fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' },
  screen: { flex: 1, justifyContent: 'space-between', padding: 20 },
  topline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { color: '#101015', fontSize: 13, fontWeight: '900', letterSpacing: 2.4 },
  recordLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  heading: { marginTop: 24 },
  title: { color: '#101015', fontWeight: '900', letterSpacing: -1.8 },
  day: { color: '#642D2A', fontSize: 14, fontWeight: '700', marginTop: 8 },
  evidence: { borderColor: '#D4C9B9', borderWidth: 1, flexDirection: 'row', justifyContent: 'space-around', marginTop: 20, paddingVertical: 10 },
  evidenceValue: { color: '#101015', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  evidenceLabel: { color: '#655D57', fontFamily: 'Courier', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 2, textAlign: 'center' },
  divider: { backgroundColor: '#101015', height: 2, marginTop: 18 },
  movementGrid: { flex: 1, justifyContent: 'center', marginTop: 6 },
  movementGridTwoColumns: { alignContent: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  movement: { borderBottomColor: '#D4C9B9', borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 8 },
  movementHalf: { flexBasis: '50%', paddingRight: 10 },
  movementIndex: { color: '#A95B5B', fontFamily: 'Courier', fontSize: 11, fontWeight: '800', paddingTop: 2 },
  movementCopy: { flex: 1 },
  movementName: { color: '#101015', fontWeight: '900', letterSpacing: -0.4 },
  setSummary: { color: '#2C2C31', fontSize: 12, lineHeight: 17, marginTop: 2 },
  setSummaryDense: { fontSize: 10, lineHeight: 13 },
  footer: { alignItems: 'center', gap: 12, marginTop: 12 },
  footerLine: { color: '#655D57', fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
  backButton: { borderColor: '#101015', borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9 },
  backButtonContent: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  backButtonText: { color: '#101015', fontSize: 12, fontWeight: '800' },
});
