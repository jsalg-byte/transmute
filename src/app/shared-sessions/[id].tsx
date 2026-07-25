import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSharedWorkoutSession, type SharedWorkoutSession } from '../../lib/api';

export default function SharedSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<SharedWorkoutSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let current = true;
    void getSharedWorkoutSession(id)
      .then((next) => {
        if (current) setDetail(next);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Unable to load the shared workout.');
      });
    return () => { current = false; };
  }, [id]);

  const groups = useMemo(() => {
    const map = new Map<string, SharedWorkoutSession['sets']>();
    for (const set of detail?.sets ?? []) map.set(set.exerciseName, [...(map.get(set.exerciseName) ?? []), set]);
    return Array.from(map.entries());
  }, [detail]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/friends')}>
          <Text style={styles.back}>← Friend activity</Text>
        </Pressable>
        {!detail && !error ? <View style={styles.loading}><ActivityIndicator color="#642D2A" /><Text style={styles.body}>Loading shared workout…</Text></View> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {detail ? (
          <>
            <Text style={styles.eyebrow}>PRIVATE WORKOUT RECORD</Text>
            <Text style={styles.title}>{detail.session.routineName ?? 'Workout plan'} · {detail.session.dayName ?? 'Session'}</Text>
            <Text style={styles.body}>Logged by {detail.owner.name ?? detail.owner.username} · {new Date(detail.session.startedAt).toLocaleDateString()}</Text>
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>{detail.session.status.toUpperCase()}</Text>
              <Text style={styles.statusCopy}>{detail.sets.length} {detail.sets.length === 1 ? 'set' : 'sets'} recorded</Text>
            </View>
            <Text style={styles.section}>MOVEMENTS</Text>
            {groups.length ? groups.map(([exerciseName, sets]) => (
              <View key={exerciseName} style={styles.card}>
                <Text style={styles.cardTitle}>{exerciseName}</Text>
                {sets.map((set) => (
                  <Text key={set.id} style={styles.meta}>
                    #{set.order} · {set.reps} reps{set.weight !== null ? ` · ${set.weight} ${detail.session.weightUnit}` : ''}{set.isWarmup ? ' · warm-up' : ''}
                  </Text>
                ))}
              </View>
            )) : <View style={styles.card}><Text style={styles.meta}>No sets were recorded.</Text></View>}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 },
  wrap: { alignSelf: 'center', maxWidth: 760, padding: 24, paddingBottom: 56, width: '100%' },
  back: { color: '#642D2A', fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  loading: { gap: 10, marginTop: 80 },
  eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5, marginTop: 28 },
  title: { color: '#101015', fontSize: 34, fontWeight: '900', letterSpacing: -1.8, lineHeight: 40, marginTop: 12 },
  body: { color: '#2C2C31', fontSize: 17, lineHeight: 27, marginTop: 14 },
  error: { color: '#642D2A', fontSize: 14, fontWeight: '700', lineHeight: 21, marginTop: 22 },
  statusCard: { backgroundColor: '#E8D194', borderColor: '#A95B5B', borderWidth: 1, gap: 4, marginTop: 22, padding: 16 },
  statusLabel: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
  statusCopy: { color: '#101015', fontSize: 18, fontWeight: '900' },
  section: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 30 },
  card: { backgroundColor: '#FBF7F0', borderColor: '#D4C9B9', borderWidth: 1, gap: 7, marginTop: 12, padding: 16 },
  cardTitle: { color: '#101015', fontSize: 18, fontWeight: '800' },
  meta: { color: '#655D57', fontSize: 14, lineHeight: 21 },
});
