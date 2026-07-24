import { getStoredSession, removeStoredSession, setStoredSession } from './session-store';

const SESSION_STORAGE_KEY = 'transmute.mobile-session.v1';

export type MobileUser = {
  id: string;
  username: string;
  name: string;
};

export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: string;
  user: MobileUser;
};

type ApiErrorPayload = { error?: string };

function apiBaseUrl() {
  const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '');
  if (!value) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured.');
  }

  return value;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as T | ApiErrorPayload | null;
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    throw new Error(typeof error === 'string' ? error : 'The server could not complete that request.');
  }

  return payload as T;
}

export async function saveSession(session: MobileSession) {
  await setStoredSession(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function readSession() {
  const raw = await getStoredSession(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MobileSession;
  } catch {
    await removeStoredSession(SESSION_STORAGE_KEY);
    return null;
  }
}

export async function clearSession() {
  await removeStoredSession(SESSION_STORAGE_KEY);
}

export async function register(payload: { username: string; name?: string; password: string }) {
  const session = await request<MobileSession>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await saveSession(session);
  return session;
}

export async function signIn(payload: { username: string; password: string }) {
  const session = await request<MobileSession>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await saveSession(session);
  return session;
}

export async function getCurrentUser() {
  const session = await readSession();
  if (!session) throw new Error('No mobile session is available.');

  const result = await request<{ user: MobileUser }>('/v1/me', {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  return result.user;
}

export async function signOut() {
  const session = await readSession();
  if (session) {
    await request('/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => undefined);
  }

  await clearSession();
}
