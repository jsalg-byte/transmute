import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlchemySvg } from '../components/alchemy-svg';
import { register } from '../lib/api';
import { useTransmuteStyles, useTransmuteTheme } from '../theme/transmute-theme';

const ouroboros = require('../../assets/transmute/ouroboros.svg');

export default function SignUpScreen() {
  const styles = useTransmuteStyles(baseStyles);
  const { mode, palette } = useTransmuteTheme();
  const displayNameInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const attemptRegistration = async () => {
    if (!username.trim() || password.length < 8) {
      setNotice('Choose a username and a password of at least 8 characters.');
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      await register({ username, name: name.trim() || undefined, password });
      router.replace('/first-login');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to register.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <AlchemySvg source={ouroboros} width={500} height={500} style={styles.backgroundMark} />
        <View style={styles.header}>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/')} style={styles.wordmark}>
            <AlchemySvg monochrome={mode === 'dark' ? 'light' : undefined} source={ouroboros} width={38} height={38} />
            <Text style={styles.wordmarkText}>TRANSMUTE</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-in')}>
            <Text style={styles.headerLink}>Sign in</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.eyebrow}>BEGIN THE RECORD</Text>
          <Text style={styles.title}>Create an account.</Text>
          <Text style={styles.description}>Set up your training space and start turning inputs into evidence.</Text>

          <View style={styles.form}>
            <Field label="Username" placeholder="Choose a username" placeholderTextColor={palette.mutedSoft} value={username} onChangeText={setUsername} autoComplete="username" onSubmitEditing={() => displayNameInput.current?.focus()} returnKeyType="next" />
            <Field label="Display Name (optional)" placeholder="What should we call you?" placeholderTextColor={palette.mutedSoft} value={name} onChangeText={setName} autoComplete="name" inputRef={displayNameInput} onSubmitEditing={() => passwordInput.current?.focus()} returnKeyType="next" />
            <Field label="Password" placeholder="At least 8 characters" placeholderTextColor={palette.mutedSoft} value={password} onChangeText={setPassword} autoComplete="new-password" inputRef={passwordInput} onSubmitEditing={attemptRegistration} returnKeyType="done" secureTextEntry />
            <Pressable accessibilityRole="button" disabled={loading} onPress={attemptRegistration} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, loading && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>{loading ? 'Registering…' : 'Register'}</Text>
            </Pressable>
            {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, placeholder, placeholderTextColor, value, onChangeText, autoComplete, inputRef, onSubmitEditing, returnKeyType, secureTextEntry = false }: { label: string; placeholder: string; placeholderTextColor: string; value: string; onChangeText: (value: string) => void; autoComplete: 'username' | 'name' | 'new-password'; inputRef?: React.RefObject<TextInput | null>; onSubmitEditing: () => void; returnKeyType: 'next' | 'done'; secureTextEntry?: boolean }) {
  const styles = useTransmuteStyles(baseStyles);
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput autoCapitalize="none" autoComplete={autoComplete} onChangeText={onChangeText} onSubmitEditing={onSubmitEditing} placeholder={placeholder} placeholderTextColor={placeholderTextColor} ref={inputRef} returnKeyType={returnKeyType} secureTextEntry={secureTextEntry} style={styles.input} value={value} />
    </View>
  );
}

const baseStyles = StyleSheet.create({
  safeArea: { backgroundColor: '#F4EFE7', flex: 1 },
  container: { flex: 1, maxWidth: 680, overflow: 'hidden', paddingBottom: 20, paddingHorizontal: 24, paddingTop: 10, width: '100%', alignSelf: 'center' },
  backgroundMark: { opacity: 0.12, position: 'absolute', right: -212, top: -28, transform: [{ rotate: '8deg' }] },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  wordmarkText: { color: '#101015', fontSize: 15, fontWeight: '800', letterSpacing: 2.1 },
  headerLink: { color: '#101015', fontSize: 14, fontWeight: '800', textDecorationColor: '#A95B5B', textDecorationLine: 'underline' },
  content: { marginTop: 'auto', maxWidth: 560, paddingBottom: 8, paddingTop: 112 },
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
