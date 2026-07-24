import * as SecureStore from 'expo-secure-store';

export async function getStoredSession(key: string) {
  return SecureStore.getItemAsync(key);
}

export async function setStoredSession(key: string, value: string) {
  await SecureStore.setItemAsync(key, value);
}

export async function removeStoredSession(key: string) {
  await SecureStore.deleteItemAsync(key);
}
