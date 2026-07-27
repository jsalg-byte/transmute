import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { TransmuteThemeProvider, useTransmuteTheme } from '../theme/transmute-theme';

function RootNavigator() {
  const { mode, theme } = useTransmuteTheme();
  const currentThemeKey = `theme-${theme}-${mode}`;
  const [stackThemeKey, setStackThemeKey] = useState(currentThemeKey);

  useEffect(() => {
    if (stackThemeKey === currentThemeKey) return;
    const timeout = setTimeout(() => setStackThemeKey(currentThemeKey), 270);
    return () => clearTimeout(timeout);
  }, [currentThemeKey, stackThemeKey]);

  return (
    <>
      <Head>
        <title>TRANSMUTE</title>
        <meta name="application-name" content="TRANSMUTE" />
      </Head>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack key={stackThemeKey} screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="first-login" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="workout-plans" />
        <Stack.Screen name="exercises" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="sessions/[id]" />
        <Stack.Screen name="sessions/[id]/share" />
        <Stack.Screen name="shared-sessions/[id]" />
        <Stack.Screen name="nutrition" />
        <Stack.Screen name="fasting" />
        <Stack.Screen name="progress" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="admin" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return <TransmuteThemeProvider><RootNavigator /></TransmuteThemeProvider>;
}
