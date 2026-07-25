import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="first-login" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="workout-plans" />
        <Stack.Screen name="exercises" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="sessions/[id]" />
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
