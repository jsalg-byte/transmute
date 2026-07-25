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

export type AdminUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  ipAddresses: {
    id: string;
    ipAddress: string;
    firstSeenAt: string;
    lastSeenAt: string;
    hitCount: number;
  }[];
};

export type TransmuteRecord = {
  user: MobileUser;
  isAdmin: boolean;
  dashboard: {
    activeSession: { id: string; routine_name: string | null; day_name: string | null; started_at: string } | null;
    nextSession: {
      routineId: string | null;
      routineName: string | null;
      dayId: string;
      dayName: string;
      exerciseCount: number;
    } | null;
  };
  workoutPlans: {
    id: string;
    name: string;
    description: string | null;
    isPreset: boolean;
    createdAt: string;
    days: {
      id: string;
      name: string;
      sortOrder: number;
      exerciseCount: number;
      exercises: {
        id: string;
        exerciseId: string;
        name: string;
        category: string;
        muscleGroup: string | null;
        sortOrder: number;
        targetSets: number | null;
        targetReps: number | null;
        targetWeight: string | null;
      }[];
    }[];
  }[];
  exercises: {
    id: string;
    name: string;
    category: string;
    muscle_group: string | null;
    demoUrl: string | null;
    demoSourceName: string | null;
  }[];
  sessions: { id: string; status: string; started_at: string; ended_at: string | null; routine_name: string | null; day_name: string | null; set_count: number }[];
  nutrition: {
    foods: {
      id: string;
      name: string;
      barcode_upc: string | null;
      calories_kcal: number;
      protein_g: string;
      carbs_g: string;
      fat_g: string;
      serving_size_g: string | null;
    }[];
    meals: {
      id: string;
      name: string;
      meal_type: string;
      quantity: string;
      consumed_at: string;
      calories_kcal: number;
      imageUrl: string | null;
    }[];
  };
  fasting: { active: { id: string; started_at: string; note: string | null } | null; logs: { id: string; started_at: string; ended_at: string; duration_minutes: number; note: string | null }[] };
  progress: {
    id: string;
    captured_at: string;
    note: string | null;
    mime_type: string;
    imageUrl: string | null;
  }[];
  friends: {
    incoming: { id: string; status: string; userId: string; username: string; name: string | null }[];
    outgoing: { id: string; status: string; userId: string; username: string; name: string | null }[];
    activity: {
      id: string;
      userId: string;
      username: string;
      name: string | null;
      startedAt: string;
      status: string;
      routineName: string | null;
      dayName: string | null;
      setCount: number;
    }[];
  };
  settings: { weight_unit: string; active_routine_id: string | null; theme_overrides: Record<string, unknown> };
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

async function authenticatedRequest<T>(path: string, init: RequestInit = {}) {
  const session = await resumeSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');
  return request<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${session.accessToken}`, ...init.headers },
  });
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

/**
 * Restores a persisted sign-in for a cold start. Access tokens are short-lived;
 * when one has expired, exchange the stored refresh token before routing into
 * the authenticated record.
 */
export async function resumeSession() {
  const session = await readSession();
  if (!session) return null;

  // The original response only contains a duration, so it cannot reliably be
  // reconstructed after an app restart. Verify the access token first and
  // refresh only if the server rejects it.
  try {
    await request<{ user: MobileUser }>('/v1/me', {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    return session;
  } catch {
    try {
      const refreshed = await request<MobileSession>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      await saveSession(refreshed);
      return refreshed;
    } catch {
      await clearSession();
      return null;
    }
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

export async function getRecord() {
  const session = await readSession();
  if (!session) throw new Error('No mobile session is available.');
  return request<TransmuteRecord>('/v1/record', { headers: { authorization: `Bearer ${session.accessToken}` } });
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

export async function createWorkoutPlan(payload: { name: string; description?: string }) {
  return authenticatedRequest<{ plan: TransmuteRecord['workoutPlans'][number] }>('/v1/plans', {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function updateWorkoutPlan(planId: string, payload: { name: string }) {
  return authenticatedRequest(`/v1/plans/${planId}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

export async function deleteWorkoutPlan(planId: string) {
  return authenticatedRequest(`/v1/plans/${planId}`, { method: 'DELETE' });
}

export async function addWorkoutPlanDay(planId: string, payload: { dayName: string }) {
  return authenticatedRequest<{ day: TransmuteRecord['workoutPlans'][number]['days'][number] }>(`/v1/plans/${planId}/days`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function updateWorkoutPlanDay(dayId: string, payload: { dayName: string }) {
  return authenticatedRequest(`/v1/plan-days/${dayId}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

export async function deleteWorkoutPlanDay(dayId: string) {
  return authenticatedRequest(`/v1/plan-days/${dayId}`, { method: 'DELETE' });
}

export async function createExercise(payload: { name: string; category?: 'strength' | 'cardio' | 'mobility'; muscleGroup?: string }) {
  return authenticatedRequest<{ exercise: { id: string; name: string; category: string; muscleGroup: string | null } }>('/v1/exercises', {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function updateExerciseDemo(exerciseId: string, payload: { demoUrl: string; sourceName?: string }) {
  return authenticatedRequest<{ demo: { exerciseId: string; demoUrl: string; sourceName: string | null } }>(`/v1/exercises/${exerciseId}/demo`, {
    method: 'PUT', body: JSON.stringify(payload),
  });
}

export async function addExerciseToWorkoutPlanDay(dayId: string, payload: { exerciseId: string; targetSets?: number; targetReps?: number; targetWeight?: number }) {
  return authenticatedRequest(`/v1/plan-days/${dayId}/exercises`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function removeExerciseFromWorkoutPlanDay(entryId: string) {
  return authenticatedRequest(`/v1/plan-day-exercises/${entryId}`, { method: 'DELETE' });
}

export async function reorderExerciseInWorkoutPlanDay(entryId: string, direction: 'up' | 'down') {
  return authenticatedRequest(`/v1/plan-day-exercises/${entryId}/reorder`, {
    method: 'POST', body: JSON.stringify({ direction }),
  });
}

export async function setActiveWorkoutPlan(routineId: string) {
  return authenticatedRequest<{ activeRoutineId: string }>('/v1/preferences/active-plan', {
    method: 'PUT', body: JSON.stringify({ routineId }),
  });
}

export async function startWorkoutSession(payload: { routineDayId: string; startedAtDate?: string }) {
  return authenticatedRequest<{ session: { id: string; startedAt: string } }>('/v1/sessions', {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export type WorkoutSessionDetail = {
  session: { id: string; status: string; startedAt: string; endedAt: string | null; routineName: string | null; dayName: string | null; weightUnit: 'kg' | 'lbs' };
  exercises: { id: string; name: string; category: string; muscleGroup: string | null; targetReps: number | null; targetWeight: string | null }[];
  libraryExercises: { id: string; name: string; category: string; muscleGroup: string | null }[];
  sets: { id: string; exerciseId: string; setOrder: number; reps: number; weight: string | number | null; isWarmup: boolean; createdAt: string }[];
};

export type SharedWorkoutSession = {
  owner: { id: string; username: string; name: string | null };
  session: { id: string; status: string; startedAt: string; endedAt: string | null; routineName: string | null; dayName: string | null; weightUnit: 'kg' | 'lbs' };
  sets: { id: string; order: number; reps: number; weight: string | number | null; isWarmup: boolean; exerciseName: string }[];
};

export async function getWorkoutSession(sessionId: string) {
  return authenticatedRequest<WorkoutSessionDetail>(`/v1/sessions/${sessionId}`);
}

export async function getSharedWorkoutSession(sessionId: string) {
  return authenticatedRequest<SharedWorkoutSession>(`/v1/sessions/${sessionId}/share`);
}

export async function addExerciseToWorkoutSession(sessionId: string, payload: { exerciseId: string; targetReps?: number; targetWeight?: number }) {
  return authenticatedRequest(`/v1/sessions/${sessionId}/exercises`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export async function addWorkoutSet(sessionId: string, payload: { exerciseId: string; reps: number; weight?: number; isWarmup?: boolean }) {
  return authenticatedRequest<{
    set: { id: string; exerciseId: string; setOrder: number; reps: number; weight: number | null; isWarmup: boolean; createdAt: string };
    personalRecord: {
      exerciseName: string;
      kind: 'estimated_1rm' | 'reps';
      current: { reps: number; weight: string | null };
      previous: { reps: number; weight: string | null };
    } | null;
  }>(`/v1/sessions/${sessionId}/sets`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateWorkoutSet(setId: string, payload: { exerciseId: string; reps: number; weight?: number; isWarmup?: boolean }) {
  return authenticatedRequest(`/v1/sets/${setId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function deleteWorkoutSet(setId: string) {
  return authenticatedRequest(`/v1/sets/${setId}`, { method: 'DELETE' });
}

export async function completeWorkoutSession(sessionId: string) {
  return authenticatedRequest(`/v1/sessions/${sessionId}/complete`, { method: 'POST' });
}

export async function deleteWorkoutSession(sessionId: string) {
  return authenticatedRequest(`/v1/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function createFood(payload: { name: string; caloriesKcal: number; proteinG?: number; carbsG?: number; fatG?: number; servingSizeG?: number; barcodeUpc?: string }) {
  return authenticatedRequest('/v1/foods', { method: 'POST', body: JSON.stringify(payload) });
}

export type BarcodeLookup = {
  found: boolean;
  source: 'local' | 'openfoodfacts' | 'none';
  food?: {
    id: string | null;
    name: string;
    barcodeUpc: string | null;
    servingSizeG: number;
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
};

export type ParsedNutritionLabel = {
  name: string | null;
  servingSizeText: string | null;
  servingSizeG: number | null;
  servingsPerContainer: number | null;
  caloriesKcal: number | null;
  fatG: number | null;
  carbsG: number | null;
  proteinG: number | null;
  parseConfidence: number;
  rawText: string;
};

export async function lookupBarcode(code: string) {
  return authenticatedRequest<BarcodeLookup>(`/v1/barcodes/${encodeURIComponent(code)}`);
}

export async function parseNutritionLabel(imageBase64: string) {
  return authenticatedRequest<{ ok: true; parsed: ParsedNutritionLabel }>('/v1/nutrition-label/parse', {
    method: 'POST',
    body: JSON.stringify({ imageBase64 }),
  });
}

export async function createMealLog(payload: {
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  consumedAt?: string;
  items: { foodId: string; grams: number }[];
}) {
  return authenticatedRequest<{ meals: { id: string; consumedAt: string }[] }>('/v1/meals', { method: 'POST', body: JSON.stringify(payload) });
}

export async function uploadMealPhoto(mealId: string, payload: {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number | null;
}) {
  const source = await fetch(payload.uri);
  if (!source.ok) throw new Error('Unable to read the selected meal photo.');
  const image = await source.blob();
  const mimeType = payload.mimeType || image.type || 'image/jpeg';
  const sizeBytes = payload.sizeBytes ?? image.size;
  if (!sizeBytes || sizeBytes > 20 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 20 MB.');
  }

  const { url, key } = await authenticatedRequest<{ url: string; key: string }>(`/v1/meals/${mealId}/photo/presign`, {
    method: 'POST',
    body: JSON.stringify({ fileName: payload.fileName, contentType: mimeType }),
  });
  const upload = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: image,
  });
  if (!upload.ok) throw new Error('The meal photo could not be uploaded.');

  return authenticatedRequest<{ id: string }>(`/v1/meals/${mealId}/photo`, {
    method: 'POST',
    body: JSON.stringify({ objectKey: key, mimeType, sizeBytes }),
  });
}

export async function updateFasting(payload: { action: 'start' | 'end'; note?: string }) {
  return authenticatedRequest('/v1/fasting', { method: 'POST', body: JSON.stringify(payload) });
}

export async function sendFriendRequest(username: string) {
  return authenticatedRequest('/v1/friends', { method: 'POST', body: JSON.stringify({ username }) });
}

export async function acceptFriendRequest(requestId: string) {
  return authenticatedRequest(`/v1/friends/${requestId}/accept`, { method: 'POST' });
}

export async function rejectFriendRequest(requestId: string) {
  return authenticatedRequest(`/v1/friends/${requestId}/reject`, { method: 'POST' });
}

export async function removeFriend(userId: string) {
  return authenticatedRequest(`/v1/friends/${userId}`, { method: 'DELETE' });
}

export async function updateWeightUnit(weightUnit: 'kg' | 'lbs') {
  return authenticatedRequest('/v1/preferences/weight-unit', { method: 'PUT', body: JSON.stringify({ weightUnit }) });
}

export async function getAdminUsers() {
  return authenticatedRequest<{ users: AdminUser[] }>('/v1/admin/users');
}

export async function createAdminUser(payload: { username: string; name?: string; email?: string; password: string }) {
  return authenticatedRequest<{ user: AdminUser }>('/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminUser(userId: string, payload: { username: string; name?: string; email?: string; password?: string }) {
  return authenticatedRequest<{ user: AdminUser }>(`/v1/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteAdminUser(userId: string) {
  return authenticatedRequest(`/v1/admin/users/${userId}`, { method: 'DELETE' });
}

export async function uploadProgressPhoto(payload: {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number | null;
  capturedAt: string;
  note?: string;
}) {
  const source = await fetch(payload.uri);
  if (!source.ok) throw new Error('Unable to read the selected progress photo.');
  const image = await source.blob();
  const mimeType = payload.mimeType || image.type || 'image/jpeg';
  const sizeBytes = payload.sizeBytes ?? image.size;
  if (!sizeBytes || sizeBytes > 20 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 20 MB.');
  }

  const { url, key } = await authenticatedRequest<{ url: string; key: string }>('/v1/progress/presign', {
    method: 'POST',
    body: JSON.stringify({ fileName: payload.fileName, contentType: mimeType }),
  });
  const upload = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: image,
  });
  if (!upload.ok) throw new Error('The progress photo could not be uploaded.');

  return authenticatedRequest<{ id: string }>('/v1/progress', {
    method: 'POST',
    body: JSON.stringify({
      objectKey: key,
      mimeType,
      sizeBytes,
      capturedAt: payload.capturedAt,
      note: payload.note?.trim() || undefined,
    }),
  });
}

export async function deleteProgressPhoto(progressId: string) {
  return authenticatedRequest(`/v1/progress/${progressId}`, { method: 'DELETE' });
}

export async function updateProgressPhoto(progressId: string, payload: { capturedAt: string }) {
  return authenticatedRequest<{ progress: { id: string; capturedAt: string } }>(`/v1/progress/${progressId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
