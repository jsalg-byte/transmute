export async function getStoredSession(key: string) {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
}

export async function setStoredSession(key: string, value: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, value);
  }
}

export async function removeStoredSession(key: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(key);
  }
}
