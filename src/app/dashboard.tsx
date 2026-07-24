import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from '../components/alchemy-svg';
import { getCurrentUser, signOut, type MobileUser } from '../lib/api';

const ouroboros = require('../../assets/transmute/ouroboros.svg');

export default function DashboardScreen() {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to read your record.');
      });
  }, []);

  const leave = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.wordmark}>
            <AlchemySvg source={ouroboros} width={38} height={38} />
            <Text style={styles.wordmarkText}>TRANSMUTE</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={leave}><Text style={styles.signOut}>Sign out</Text></Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.eyebrow}>THE WORKBENCH</Text>
          {user ? (
            <>
              <Text style={styles.title}>Welcome back,{'\n'}{user.name}.</Text>
              <Text style={styles.description}>Your mobile session is connected to the deployed Transmute record.</Text>
            </>
          ) : error ? (
            <>
              <Text style={styles.title}>The record is unavailable.</Text>
              <Text style={styles.description}>{error}</Text>
            </>
          ) : (
            <View style={styles.loading}><ActivityIndicator color="#642D2A" /><Text style={styles.description}>Reading your record…</Text></View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 },
  container: { flex: 1, maxWidth: 680, paddingHorizontal: 24, paddingTop: 10, width: '100%', alignSelf: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 },
  signOut: { color: '#101015', fontSize: 14, fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' },
  content: { marginTop: 'auto', paddingBottom: 80 },
  eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5 },
  title: { color: '#101015', fontSize: 52, fontWeight: '900', letterSpacing: -3, lineHeight: 50, marginTop: 16 },
  description: { color: '#222328', fontSize: 17, fontWeight: '500', lineHeight: 27, marginTop: 18, maxWidth: 500 },
  loading: { alignItems: 'flex-start', gap: 4, marginTop: 10 },
});
