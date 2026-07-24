import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from '../components/alchemy-svg';
import { signIn } from '../lib/api';
import { useAuthRouteGuard } from '../hooks/use-auth-route-guard';

const ouroboros = require('../../assets/transmute/ouroboros.svg');

export default function SignInScreen() {
  const isCheckingSession = useAuthRouteGuard();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const attemptSignIn = async () => {
    if (!username.trim() || !password) {
      setNotice('Enter your username and password.');
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      await signIn({ username, password });
      router.replace('/dashboard');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  if (isCheckingSession) return <View style={styles.loadingScreen} />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <AlchemySvg source={ouroboros} width={500} height={500} style={styles.backgroundMark} />
        <View style={styles.header}>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/')} style={styles.wordmark}>
            <AlchemySvg source={ouroboros} width={38} height={38} />
            <Text style={styles.wordmarkText}>TRANSMUTE</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-up')}>
            <Text style={styles.headerLink}>Register</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.eyebrow}>RETURN TO THE WORK</Text>
          <Text style={styles.title}>Sign in.</Text>
          <Text style={styles.description}>Pick up where you left off and keep building the record.</Text>

          <View style={styles.form}>
            <View>
              <Text style={styles.label}>Username</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="username"
                onChangeText={setUsername}
                placeholder="Your username"
                placeholderTextColor="rgba(34, 35, 40, 0.55)"
                style={styles.input}
                value={username}
              />
            </View>
            <View>
              <Text style={styles.label}>Password</Text>
              <TextInput
                autoComplete="current-password"
                onChangeText={setPassword}
                placeholder="Your password"
                placeholderTextColor="rgba(34, 35, 40, 0.55)"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>
            <Pressable accessibilityRole="button" disabled={loading} onPress={attemptSignIn} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, loading && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
            </Pressable>
            {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { backgroundColor: '#F4EFE7', flex: 1 },
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 },
  container: { flex: 1, maxWidth: 680, overflow: 'hidden', paddingBottom: 20, paddingHorizontal: 24, paddingTop: 10, width: '100%', alignSelf: 'center' },
  backgroundMark: { opacity: 0.12, position: 'absolute', right: -210, top: -105, transform: [{ rotate: '11deg' }] },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 },
  headerLink: { color: '#101015', fontSize: 14, fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' },
  content: { marginTop: 'auto', maxWidth: 560, paddingBottom: 8, paddingTop: 128 },
  eyebrow: { color: '#642D2A', fontFamily: 'Courier', fontSize: 12, letterSpacing: 1.5 },
  title: { color: '#101015', fontSize: 54, fontWeight: '900', letterSpacing: -3, lineHeight: 52, marginTop: 16 },
  description: { color: '#222328', fontSize: 17, fontWeight: '500', lineHeight: 27, marginTop: 18 },
  form: { gap: 24, marginTop: 40 },
  label: { color: '#222328', fontSize: 14, fontWeight: '800' },
  input: { borderBottomColor: '#667798', borderBottomWidth: 1, color: '#101015', fontSize: 17, fontWeight: '500', paddingBottom: 12, paddingTop: 11 },
  button: { alignItems: 'center', backgroundColor: '#101015', justifyContent: 'center', marginTop: 7, minHeight: 58 },
  buttonPressed: { backgroundColor: '#642D2A' },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#F4EFE7', fontSize: 16, fontWeight: '800' },
  notice: { borderLeftColor: '#A95B5B', borderLeftWidth: 2, color: '#642D2A', fontSize: 14, fontWeight: '700', lineHeight: 21, paddingLeft: 10 },
});
