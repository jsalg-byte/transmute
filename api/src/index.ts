import { createHash, randomBytes, randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import { compare, hash } from 'bcryptjs';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import Fastify from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import postgres from 'postgres';
import type { Worker } from 'tesseract.js';
import { z } from 'zod';

import { requestAiBarcodeLookup, requestAiFoodPhoto, requestAiNutritionLabel, requestAiWorkoutDraft } from './ai-workout.js';
import { getCalistreeCatalog, getCalistreeExerciseMetadata, searchCalistreeExercises } from './calistree.js';
import { arcanaDefinitions, evaluateArcanaForUser, recordProgressionEvent } from './arcana.js';
import { EXERCISE_RANK_RULE_VERSION, recomputeExerciseRanks, recomputeRankProjections, scoreExerciseRank } from './exercise-ranks.js';
import { awardXp, getUserProgression, REWARDS_CATALOG } from './progression.js';
import { getStreaksAndCalendar, recomputeStreaksForUser } from './calendar-streaks.js';
import { planDayExerciseUpdateSchema, workoutSetSchema } from './workout-tracking.js';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  AUTH_ISSUER: z.string().min(1).default('transmute-api'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  ADMIN_IDENTIFIERS: z.string().optional(),
  AI_WORKOUT_WORKER_URL: z.string().url().optional(),
  AI_WORKOUT_WORKER_TOKEN: z.string().min(32).optional(),
});

const env = envSchema.parse(process.env);
const jwtSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const sql = postgres(env.DATABASE_URL, { max: 10, idle_timeout: 20, connect_timeout: 10 });
const app = Fastify({ logger: true });
app.addContentTypeParser(
  /^image\/.+/i,
  { parseAs: 'buffer' },
  (_request, body, done) => done(null, body),
);
const storage = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
});

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[^\s]+$/, 'Username cannot contain spaces.')
  .transform((value) => value.toLowerCase());

const registrationSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(2).max(80).optional(),
  password: z.string().min(8).max(128),
});

const adminCreateUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).optional(),
  password: z.string().min(8).max(128),
});

const adminUpdateUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).optional(),
  password: z.string().min(8).max(128).optional(),
});

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const exerciseRankParamsSchema = z.object({ exerciseId: z.string().uuid() });
const exerciseRankQuerySchema = z.object({ q: z.string().trim().max(120).optional(), mode: z.enum(['reps', 'timed']).optional(), limit: z.coerce.number().int().min(1).max(100).default(40), offset: z.coerce.number().int().min(0).default(0) });
const trainingAnalyticsQuerySchema = z.object({
  period: z.enum(['7d', '14d', '30d']).default('14d'),
  metric: z.enum(['duration', 'volume', 'reps']).default('volume'),
});
const planIdParamsSchema = z.object({ planId: z.string().uuid() });
const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
  empty: z.boolean().optional(),
});
const planDaySchema = z.object({ dayName: z.string().trim().min(2).max(32) });
const routineShareTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{24,80}$/) });
const routineShareCreateSchema = z.object({ routineDayId: z.string().uuid() });
const routineShareListSchema = z.object({ routineDayId: z.string().uuid() });
const routineShareImportSchema = z.object({
  routineId: z.string().uuid(),
  name: z.string().trim().min(2).max(32).optional(),
});
const routineShareSnapshotSchema = z.object({
  routineName: z.string().trim().min(2).max(32),
  folderName: z.string().trim().min(2).max(80),
  ownerName: z.string().trim().min(2).max(80).nullable(),
  ownerUsername: usernameSchema,
  exercises: z.array(z.object({
    exerciseId: z.string().uuid(),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(1).max(80),
    muscleGroup: z.string().trim().min(1).max(80).nullable(),
    targetSets: z.number().int().positive().max(20),
    targetReps: z.number().int().positive().max(50),
    trackingMode: z.enum(['reps', 'timed']),
    targetDurationSeconds: z.number().int().positive().max(86_400).nullable(),
    targetWeightKg: z.number().nonnegative().max(2_000).nullable(),
  })).min(1).max(50),
}).superRefine((snapshot, context) => {
  for (const exercise of snapshot.exercises) {
    if (exercise.trackingMode === 'timed' && exercise.targetDurationSeconds == null) {
      context.addIssue({ code: 'custom', message: 'Timed exercises require a target duration.' });
    }
  }
});
const planDayExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  targetSets: z.number().int().positive().max(20).optional(),
  targetReps: z.number().int().positive().max(50).optional(),
  targetWeight: z.number().nonnegative().max(2000).optional(),
});
const planDayCalistreeImportSchema = z.object({
  slug: z.string().trim().min(2).max(180),
  targetSets: z.number().int().positive().max(20).optional(),
  targetReps: z.number().int().positive().max(50).optional(),
  targetWeight: z.number().nonnegative().max(2000).optional(),
});
const aiWorkoutPromptSchema = z.object({ prompt: z.string().trim().min(12).max(2_000) });
const aiWorkoutExerciseSchema = z.object({
  exerciseName: z.string().trim().min(2).max(120),
  targetSets: z.number().int().min(1).max(12),
  targetReps: z.number().int().min(1).max(50).optional(),
  targetWeight: z.number().nonnegative().max(2_000).optional(),
});
const aiWorkoutDraftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
  days: z.array(z.object({
    name: z.string().trim().min(2).max(32),
    exercises: z.array(aiWorkoutExerciseSchema).min(1).max(12),
  })).min(1).max(7),
});
const aiNutritionLabelSchema = z.object({
  name: z.string().trim().min(2).max(120).nullable(),
  servingSizeValue: z.number().positive().max(5_000).nullable(),
  servingSizeUnit: z.enum(['g', 'ml', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'piece', 'bottle', 'can', 'packet', 'slice', 'serving']).nullable(),
  servingSizeText: z.string().trim().min(1).max(120).nullable(),
  caloriesKcal: z.number().int().nonnegative().max(2_000).nullable(),
  proteinG: z.number().nonnegative().max(500).nullable(),
  carbsG: z.number().nonnegative().max(500).nullable(),
  fatG: z.number().nonnegative().max(500).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();
const aiBarcodeFoodSchema = z.object({
  name: z.string().trim().min(2).max(120),
  servingSizeValue: z.number().positive().max(5_000).nullable(),
  servingSizeUnit: z.enum(['g', 'ml', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'piece', 'bottle', 'can', 'packet', 'slice', 'serving']).nullable(),
  servingSizeText: z.string().trim().min(1).max(120).nullable(),
  caloriesKcal: z.number().int().nonnegative().max(2_000),
  proteinG: z.number().nonnegative().max(500),
  carbsG: z.number().nonnegative().max(500),
  fatG: z.number().nonnegative().max(500),
  confidence: z.number().min(0).max(1),
}).strict();
const aiFoodPhotoCandidateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  servingSizeValue: z.number().positive().max(5_000).nullable(),
  servingSizeUnit: z.enum(['g', 'ml', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'piece', 'bottle', 'can', 'packet', 'slice', 'serving']).nullable(),
  servingSizeText: z.string().trim().min(1).max(120).nullable(),
  caloriesKcal: z.number().int().nonnegative().max(5_000),
  proteinG: z.number().nonnegative().max(500),
  carbsG: z.number().nonnegative().max(500),
  fatG: z.number().nonnegative().max(500),
  confidence: z.number().min(0).max(1).nullable(),
  estimatedPortionGrams: z.number().positive().max(5_000).nullable(),
});
const aiFoodPhotoAnalysisSchema = z.object({
  suggestedPortionGrams: z.number().positive().max(5_000).nullable(),
  candidates: z.array(aiFoodPhotoCandidateSchema).min(1).max(5),
});
const aiWorkoutImportSchema = z.object({ plan: aiWorkoutDraftSchema });
const reorderSchema = z.object({ direction: z.enum(['up', 'down']) });
const exerciseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(['strength', 'cardio', 'mobility']).default('strength'),
  muscleGroup: z.string().trim().max(80).optional(),
});
const exerciseDemoSchema = z.object({
  demoUrl: z.string().url().refine((value) => /^https?:\/\//.test(value), 'A public http(s) URL is required.'),
  sourceName: z.string().trim().min(2).max(160).optional(),
});
const activePlanSchema = z.object({ routineId: z.string().uuid().nullable() });
const startSessionSchema = z.object({
  routineDayId: z.string().uuid(),
  startedAtDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const quickAddSchema = z.object({
  exerciseId: z.string().uuid(),
  weight: z.number().nonnegative().max(2_000).optional(),
  reps: z.number().int().positive().max(100).optional(),
  durationSeconds: z.number().int().positive().max(86_400).optional(),
}).refine(
  (value) => (value.durationSeconds != null) !== (value.reps != null),
  'Provide either reps or durationSeconds.',
);
const sessionExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  targetReps: z.number().int().positive().max(50).optional(),
  targetWeight: z.number().nonnegative().max(2000).optional(),
});
const calistreeSearchSchema = z.object({ q: z.string().trim().min(2).max(120) });
const calistreeExerciseSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), slug: z.string().trim().min(2).max(180).optional() })
  .refine((value) => Boolean(value.name || value.slug), 'An exercise name or catalog identifier is required.');
const calistreeImportSchema = z.object({ slug: z.string().trim().min(2).max(180) });
const foodSchema = z.object({
  name: z.string().trim().min(2).max(120),
  barcodeUpc: z.string().trim().regex(/^\d+$/).min(8).max(14).optional(),
  caloriesKcal: z.number().int().nonnegative().max(2000),
  servingSizeG: z.number().positive().max(5000).optional(),
  servingSizeValue: z.number().positive().max(5000).optional(),
  servingSizeUnit: z.enum(['g', 'ml', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'piece', 'bottle', 'can', 'packet', 'slice', 'serving']).optional(),
  servingSizeText: z.string().trim().min(1).max(120).optional(),
  proteinG: z.number().nonnegative().max(500).optional(),
  carbsG: z.number().nonnegative().max(500).optional(),
  fatG: z.number().nonnegative().max(500).optional(),
});
const barcodeParamsSchema = z.object({
  code: z.string().trim().regex(/^\d+$/).min(8).max(14),
});
const nutritionLabelOcrSchema = z.object({
  imageBase64: z.string().min(100).max(12_000_000),
});
const mealSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized']),
  consumedAt: z.string().datetime().optional(),
  items: z.array(z.object({
    foodId: z.string().uuid(),
    grams: z.number().positive().max(5000),
  })).min(1).max(20),
});
const mealUpdateSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized']),
  consumedAt: z.string().datetime(),
  grams: z.number().positive().max(5000),
});
const nutritionTargetInputSchema = z.object({
  caloriesTarget: z.number().int().positive().max(20000),
  proteinGTarget: z.number().nonnegative().max(1000).default(0),
  carbsGTarget: z.number().nonnegative().max(2000).default(0),
  fatGTarget: z.number().nonnegative().max(1000).default(0),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const nutritionDiaryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const recipesQuerySchema = z.object({
  query: z.string().trim().max(100).optional(),
});
const recipeLogSchema = z.object({
  portionServings: z.number().positive().max(50).default(1),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized']).default('lunch'),
  consumedAt: z.string().datetime().optional(),
});
const fastSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), note: z.string().trim().max(240).optional(), targetMinutes: z.number().int().min(1).max(60 * 24 * 7).optional() }),
  z.object({ action: z.literal('end'), note: z.string().trim().max(240).optional() }),
]);
const friendUsernameSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[^\s]+$/).transform((value) => value.toLowerCase()),
});
const weightUnitSchema = z.object({ weightUnit: z.enum(['kg', 'lbs']) });
const themePreferenceSchema = z.object({
  theme: z.enum(['transmute', 'flame-alchemist', 'hawkeye', 'automail-mechanic', 'avarice', 'scarred-man', 'armor-bound-soul']),
  mode: z.enum(['light', 'dark']),
});
const progressPresignSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(3).max(128),
});
const progressCreateSchema = z.object({
  objectKey: z.string().min(4).max(512),
  mimeType: z.string().min(3).max(128),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  capturedAt: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  note: z.string().max(400).optional(),
});
const progressProxyUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  capturedAt: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  note: z.string().max(400).optional(),
});
const progressUpdateSchema = z.object({
  capturedAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});
const mealPhotoCreateSchema = z.object({
  objectKey: z.string().min(4).max(512),
  mimeType: z.string().min(3).max(128),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
});
const recordDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recoveryCheckinSchema = z.object({
  sleepHours: z.number().min(0).max(24).optional(),
  recoveryScore: z.number().int().min(1).max(5),
  sorenessScore: z.number().int().min(1).max(5).optional(),
  stressScore: z.number().int().min(1).max(5).optional(),
  note: z.string().trim().max(500).optional(),
});
const nutritionTargetSchema = z.object({ targetMealDays: z.number().int().min(1).max(7) });
const trainingBlockSchema = z.object({
  name: z.string().trim().min(2).max(100),
  startDate: recordDateSchema,
  endDate: recordDateSchema,
  targetSessionsPerWeek: z.number().int().min(1).max(7),
  routineId: z.string().uuid().optional(),
  deloadWeek: z.number().int().min(1).max(16).optional(),
  note: z.string().trim().max(600).optional(),
}).refine((value) => value.endDate >= value.startDate, 'The block end must be after its start.');
const trainingBlockUpdateSchema = z.object({
  status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
  note: z.string().trim().max(600).optional(),
  endedReason: z.string().trim().max(600).optional(),
  replacementBlockId: z.string().uuid().nullable().optional(),
});
const scheduledBlockSessionSchema = z.object({
  scheduledFor: recordDateSchema,
  routineDayId: z.string().uuid().optional(),
  status: z.enum(['planned', 'rescheduled', 'completed', 'skipped', 'recovery']).default('planned'),
  rescheduledFromId: z.string().uuid().optional(),
  isDeload: z.boolean().optional(),
  isRecoverySession: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
const scheduledBlockSessionUpdateSchema = z.object({
  scheduledFor: recordDateSchema.optional(),
  status: z.enum(['planned', 'rescheduled', 'completed', 'skipped', 'recovery']).optional(),
  rescheduledFromId: z.string().uuid().nullable().optional(),
  completedSessionId: z.string().uuid().nullable().optional(),
  isDeload: z.boolean().optional(),
  isRecoverySession: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
const weeklyReviewSchema = z.object({
  weekStart: recordDateSchema,
  weekEnd: recordDateSchema,
  reflection: z.string().trim().min(2).max(1500),
  adjustments: z.string().trim().max(1500).optional(),
  decision: z.string().trim().max(500).optional(),
}).refine((value) => value.weekEnd >= value.weekStart, 'The review end must be after its start.');
const goalSchema = z.object({
  title: z.string().trim().min(2).max(160),
  category: z.enum(['strength', 'nutrition', 'recovery', 'body', 'habit', 'other']),
  baselineValue: z.number().finite().default(0),
  targetValue: z.number().finite().default(1),
  unit: z.string().trim().max(32).default('count'),
  targetDate: recordDateSchema.default(() => new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)),
  exerciseId: z.string().uuid().optional(),
  trackingMode: z.enum(['reps', 'timed']).optional(),
  note: z.string().trim().max(800).optional(),
});
const goalUpdateSchema = goalSchema.partial().extend({ status: z.enum(['active', 'completed', 'archived']).optional() });
const goalAssessmentSchema = z.object({ value: z.number().finite(), note: z.string().trim().min(2).max(1000), decision: z.string().trim().max(500).optional(), assessedAt: recordDateSchema.optional() });
const bodyweightMeasurementSchema = z.object({
  measuredAt: recordDateSchema,
  weightKg: z.number().finite().positive().max(1000),
  notes: z.string().trim().max(500).optional(),
});
const pinArcanaSchema = z.object({ slot: z.enum(['past', 'present', 'becoming']), cardId: z.string().min(1).max(32) });

type UserRow = {
  id: string;
  username: string;
  name: string | null;
  password_hash: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};

type ProgressPhotoRow = {
  id: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  note: string | null;
  captured_at: Date;
};

type MealPhotoRow = {
  entity_id: string;
  object_key: string;
  mime_type: string;
};

type AdminUserRow = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
};

type UserIpRow = {
  id: string;
  user_id: string;
  ip_address: string;
  first_seen_at: Date;
  last_seen_at: Date;
  hit_count: number;
};

type PersonalRecordSet = {
  reps: number;
  weight: string | null;
};

type PersonalRecord = {
  exerciseName: string;
  kind: 'estimated_1rm' | 'reps';
  current: PersonalRecordSet;
  previous: PersonalRecordSet;
};

const adminIdentifiers = new Set(
  ['mzootfb@gmail.com', 'mzootfb', ...(env.ADMIN_IDENTIFIERS ?? '').split(',')]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

function refreshTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(user: Pick<UserRow, 'id' | 'username' | 'name'>) {
  return { id: user.id, username: user.username, name: user.name ?? user.username };
}

function setWeight(set: PersonalRecordSet) {
  const value = set.weight === null ? 0 : Number(set.weight);
  return Number.isFinite(value) ? value : 0;
}

function estimatedOneRepMax(set: PersonalRecordSet) {
  return setWeight(set) * (1 + set.reps / 30);
}

function detectPersonalRecord(current: PersonalRecordSet, previousSets: PersonalRecordSet[], exerciseName: string): PersonalRecord | null {
  const weighted = setWeight(current) > 0;
  const comparable = previousSets.filter((set) => weighted ? setWeight(set) > 0 : setWeight(set) <= 0);
  if (!comparable.length) return null;
  const score = weighted ? estimatedOneRepMax : (set: PersonalRecordSet) => set.reps;
  const previous = comparable.reduce((best, set) => score(set) > score(best) ? set : best);
  if (score(current) <= score(previous)) return null;
  return { exerciseName, kind: weighted ? 'estimated_1rm' : 'reps', current, previous };
}

async function signAccessToken(user: Pick<UserRow, 'id' | 'username'>) {
  return new SignJWT({ username: user.username, token_type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(env.AUTH_ISSUER)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(jwtSecret);
}

async function createSession(user: Pick<UserRow, 'id' | 'username' | 'name'>) {
  const refreshToken = randomBytes(48).toString('base64url');
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO mobile_sessions (id, user_id, refresh_token_hash, expires_at)
    VALUES (${randomUUID()}, ${user.id}, ${refreshTokenHash(refreshToken)}, ${refreshExpiresAt})
  `;

  return {
    accessToken: await signAccessToken(user),
    refreshToken,
    accessTokenExpiresInSeconds: 15 * 60,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    user: publicUser(user),
  };
}

async function requireUserId(authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwtSecret, { issuer: env.AUTH_ISSUER });
    return payload.token_type === 'access' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

function isAdminIdentity(user: Pick<UserRow, 'username' | 'name'> & { email?: string | null }) {
  return adminIdentifiers.has(user.username.toLowerCase()) || (user.email ? adminIdentifiers.has(user.email.toLowerCase()) : false);
}

async function requireAdminUser(authorization: string | undefined) {
  const userId = await requireUserId(authorization);
  if (!userId) return null;
  const [user] = await sql<UserRow[]>`
    SELECT id, username, name, password_hash, email FROM users WHERE id = ${userId} LIMIT 1
  `;
  return user && isAdminIdentity(user) ? user : null;
}

function parseStartedAt(startedAtDate: string | undefined) {
  if (!startedAtDate) return new Date();

  const [yearRaw, monthRaw, dayRaw] = startedAtDate.split('-');
  const startedAt = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 12, 0, 0));
  return Number.isNaN(startedAt.getTime()) ? new Date() : startedAt;
}

function numericValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const servingUnits = ['g', 'ml', 'oz', 'fl oz', 'cup', 'tbsp', 'tsp', 'piece', 'bottle', 'can', 'packet', 'slice', 'serving'] as const;
type ServingUnit = typeof servingUnits[number];

function parseServingSize(value: string | undefined) {
  const match = value?.match(/(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|grams?|g|millilit(?:er|re)s?|ml|ounces?|oz|cups?|tbsp|tablespoons?|tsp|teaspoons?|pieces?|bottles?|cans?|packets?|slices?|servings?)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rawUnit = match[2].toLowerCase().replace('.', '').replace(/\s+/g, ' ');
  const unit: ServingUnit | null = rawUnit.startsWith('g') ? 'g'
    : rawUnit.startsWith('ml') || rawUnit.startsWith('millil') ? 'ml'
      : rawUnit === 'fl oz' ? 'fl oz'
        : rawUnit.startsWith('oz') || rawUnit.startsWith('ounce') ? 'oz'
          : rawUnit.startsWith('cup') ? 'cup'
            : rawUnit.startsWith('tbsp') || rawUnit.startsWith('table') ? 'tbsp'
              : rawUnit.startsWith('tsp') || rawUnit.startsWith('tea') ? 'tsp'
                : rawUnit.startsWith('piece') ? 'piece'
                  : rawUnit.startsWith('bottle') ? 'bottle'
                    : rawUnit.startsWith('can') ? 'can'
                      : rawUnit.startsWith('packet') ? 'packet'
                        : rawUnit.startsWith('slice') ? 'slice'
                          : rawUnit.startsWith('serving') ? 'serving' : null;
  return unit ? { value: amount, unit, text: value?.trim() ?? `${amount} ${unit}` } : null;
}

async function lookupOpenFoodFacts(code: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, {
      headers: { 'user-agent': 'Transmute/1.0 barcode lookup' },
      signal: controller.signal,
    });
    if (!response.ok) return { found: false as const, source: 'none' as const };
    const payload = await response.json() as {
      status?: number;
      product?: {
        product_name?: string;
        serving_size?: string;
        nutriments?: {
          'energy-kcal_100g'?: number;
          'energy-kcal_serving'?: number;
          proteins_100g?: number;
          proteins_serving?: number;
          carbohydrates_100g?: number;
          carbohydrates_serving?: number;
          fat_100g?: number;
          fat_serving?: number;
        };
      };
    };
    if (payload.status !== 1 || !payload.product) return { found: false as const, source: 'none' as const };
    const serving = parseServingSize(payload.product.serving_size);
    const servingCalories = payload.product.nutriments?.['energy-kcal_serving'];
    const servingProtein = payload.product.nutriments?.proteins_serving;
    const servingCarbs = payload.product.nutriments?.carbohydrates_serving;
    const servingFat = payload.product.nutriments?.fat_serving;
    const hasProviderServingNutrition = [servingCalories, servingProtein, servingCarbs, servingFat].every((value) => typeof value === 'number' && Number.isFinite(value));
    // Open Food Facts' *_100g fields are not a product-serving amount. Only
    // scale them when the label gives a gram serving; otherwise preserve 100 g
    // as the reference instead of silently treating a bottle/cup as 100 g.
    const gramServing = serving?.unit === 'g' ? serving : null;
    const reference = hasProviderServingNutrition && serving
      ? serving
      : gramServing ?? { value: 100, unit: 'g' as const, text: '100 g reference' };
    const scale = hasProviderServingNutrition ? 1 : reference.value / 100;
    return {
      found: true as const,
      source: 'openfoodfacts' as const,
      food: {
        id: null,
        name: payload.product.product_name ?? `UPC ${code}`,
        barcodeUpc: code,
        servingSizeValue: reference.value,
        servingSizeUnit: reference.unit,
        servingSizeText: reference.text,
        caloriesKcal: Math.round(numericValue(hasProviderServingNutrition ? servingCalories : payload.product.nutriments?.['energy-kcal_100g']) * scale),
        proteinG: numericValue(hasProviderServingNutrition ? servingProtein : payload.product.nutriments?.proteins_100g) * scale,
        carbsG: numericValue(hasProviderServingNutrition ? servingCarbs : payload.product.nutriments?.carbohydrates_100g) * scale,
        fatG: numericValue(hasProviderServingNutrition ? servingFat : payload.product.nutriments?.fat_100g) * scale,
      },
    };
  } catch {
    return { found: false as const, source: 'none' as const };
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupBarcodeWithAi(code: string, log: { warn: (error: unknown, message: string) => void }) {
  if (!env.AI_WORKOUT_WORKER_URL || !env.AI_WORKOUT_WORKER_TOKEN) return { found: false as const, source: 'none' as const };
  try {
    const response = await requestAiBarcodeLookup({
      workerUrl: env.AI_WORKOUT_WORKER_URL,
      workerToken: env.AI_WORKOUT_WORKER_TOKEN,
      barcode: code,
    });
    const food = parseAiBarcodeFood(response);
    return {
      found: true as const,
      source: 'ai' as const,
      food: {
        id: null,
        name: food.name,
        barcodeUpc: code,
        servingSizeValue: food.servingSizeValue,
        servingSizeUnit: food.servingSizeUnit,
        servingSizeText: food.servingSizeText,
        caloriesKcal: food.caloriesKcal,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
      },
    };
  } catch (error) {
    log.warn(error, 'Barcode AI lookup failed');
    return { found: false as const, source: 'none' as const };
  }
}

function nutritionNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseNutritionLabel(rawText: string, ocrConfidence: number) {
  const text = rawText.replace(/\r/g, '\n').replace(/\u00A0/g, ' ').replace(/[|]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const nutritionFactsIndex = lines.findIndex((line) => /nutrition\s+facts/i.test(line));
  const name = nutritionFactsIndex > 0
    ? lines.slice(0, nutritionFactsIndex).reverse().find((line) => /[a-z]/i.test(line) && !/serving|calories/i.test(line)) ?? null
    : lines.find((line) => /[a-z]/i.test(line) && !/nutrition\s+facts/i.test(line)) ?? null;
  const servingLine = text.match(/serving\s*size\s*[:\-]?\s*([^\n]+)/i)?.[1] ?? null;
  const serving = parseServingSize(servingLine ?? undefined);
  const servingsPerContainer = nutritionNumber(text, [/servings?\s+per\s+container\s*[:\-]?\s*(\d+(?:\.\d+)?)/i, /about\s+(\d+(?:\.\d+)?)\s+servings?/i]);
  const caloriesKcal = nutritionNumber(text, [/calories\s*[:\-]?\s*(\d{1,4})\b/i]);
  const fatG = nutritionNumber(text, [/(?:total\s+)?fat[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*(?:g|mg)?/i]);
  const carbsG = nutritionNumber(text, [/(?:total\s+)?carbohydrate(?:s)?[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*(?:g|mg)?/i]);
  const proteinG = nutritionNumber(text, [/protein[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*(?:g|mg)?/i]);
  return {
    name,
    servingSizeText: servingLine?.trim() ?? null,
    servingSizeValue: serving?.value ?? null,
    servingSizeUnit: serving?.unit ?? null,
    servingsPerContainer,
    caloriesKcal,
    fatG,
    carbsG,
    proteinG,
    parseConfidence: Math.max(0, Math.min(1, Math.round(ocrConfidence * 100) / 100)),
    rawText: text,
  };
}

function progressExtension(fileName: string) {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  return extension && /^[a-z0-9]{1,10}$/.test(extension) ? extension : 'jpg';
}

function parseCapturedAt(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
}

function isOwnedProgressKey(userId: string, key: string) {
  return key.startsWith(`progress/${userId}/`);
}

function isOwnedMealPhotoKey(userId: string, mealId: string, key: string) {
  return key.startsWith(`meals/${userId}/${mealId}/`);
}

async function readAdminUsers() {
  const [users, addresses] = await Promise.all([
    sql<AdminUserRow[]>`
      SELECT id, username, name, email, created_at, updated_at
      FROM users
      ORDER BY username ASC
    `,
    sql<UserIpRow[]>`
      SELECT id, user_id, ip_address, first_seen_at, last_seen_at, hit_count
      FROM user_ip_addresses
      ORDER BY last_seen_at DESC
    `,
  ]);
  const addressesByUser = new Map<string, UserIpRow[]>();
  for (const address of addresses) {
    addressesByUser.set(address.user_id, [...(addressesByUser.get(address.user_id) ?? []), address]);
  }
  return users.map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    ipAddresses: (addressesByUser.get(user.id) ?? []).map((address) => ({
      id: address.id,
      ipAddress: address.ip_address,
      firstSeenAt: address.first_seen_at,
      lastSeenAt: address.last_seen_at,
      hitCount: address.hit_count,
    })),
  }));
}

await app.register(cors, {
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  origin: (origin, callback) => {
    if (!origin || env.CORS_ORIGINS.split(',').map((value) => value.trim()).includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin is not allowed by CORS'), false);
  },
});

app.get('/health', async () => {
  await sql`SELECT 1`;
  return { ok: true };
});

app.get('/v1/capabilities', async () => ({ offlineSetSync: true }));

app.post('/v1/auth/register', async (request, reply) => {
  const parsed = registrationSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });

  const [existing] = await sql<UserRow[]>`
    SELECT id, username, name, password_hash
    FROM users
    WHERE username = ${parsed.data.username}
    LIMIT 1
  `;

  if (existing) return reply.code(409).send({ error: 'Username already taken' });

  const [user] = await sql<UserRow[]>`
    INSERT INTO users (id, username, name, password_hash, created_at, updated_at)
    VALUES (${randomUUID()}, ${parsed.data.username}, ${parsed.data.name ?? parsed.data.username}, ${await hash(parsed.data.password, 12)}, now(), now())
    RETURNING id, username, name, password_hash
  `;

  if (!user) return reply.code(500).send({ error: 'Unable to create account' });

  return reply.code(201).send(await createSession(user));
});

app.post('/v1/auth/login', async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const [user] = await sql<UserRow[]>`
    SELECT id, username, name, password_hash
    FROM users
    WHERE username = ${parsed.data.username}
    LIMIT 1
  `;

  if (!user?.password_hash || !(await compare(parsed.data.password, user.password_hash))) {
    return reply.code(401).send({ error: 'Invalid username or password.' });
  }

  return reply.send(await createSession(user));
});

app.post('/v1/auth/refresh', async (request, reply) => {
  const parsed = refreshSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  const tokenHash = refreshTokenHash(parsed.data.refreshToken);
  const [session] = await sql<SessionRow[]>`
    SELECT id, user_id, expires_at, revoked_at
    FROM mobile_sessions
    WHERE refresh_token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (!session || session.revoked_at || session.expires_at <= new Date()) {
    return reply.code(401).send({ error: 'Session expired. Sign in again.' });
  }

  const [user] = await sql<UserRow[]>`
    SELECT id, username, name, password_hash
    FROM users
    WHERE id = ${session.user_id}
    LIMIT 1
  `;

  if (!user) return reply.code(401).send({ error: 'Session user no longer exists.' });

  await sql`UPDATE mobile_sessions SET revoked_at = now() WHERE id = ${session.id}`;
  return reply.send(await createSession(user));
});

app.post('/v1/auth/logout', async (request, reply) => {
  const parsed = refreshSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

  await sql`
    UPDATE mobile_sessions
    SET revoked_at = now()
    WHERE refresh_token_hash = ${refreshTokenHash(parsed.data.refreshToken)} AND revoked_at IS NULL
  `;

  return reply.code(204).send();
});

app.get('/v1/me', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const [user] = await sql<UserRow[]>`
    SELECT id, username, name, password_hash
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  if (!user) return reply.code(401).send({ error: 'Unauthorized' });
  return reply.send({ user: publicUser(user) });
});

app.post('/v1/plans', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = planSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid workout plan payload.' });

  const plan = await sql.begin(async (transaction) => {
    const [created] = await transaction<{ id: string; name: string; description: string | null; created_at: Date }[]>`
      INSERT INTO routines (id, user_id, name, description, is_preset, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, ${parsed.data.name}, ${parsed.data.description ?? null}, false, now(), now())
      RETURNING id, name, description, created_at
    `;
    const day = parsed.data.empty ? null : (await transaction<{ id: string; day_name: string; sort_order: number }[]>`
      INSERT INTO routine_days (id, routine_id, day_name, sort_order, created_at)
      VALUES (${randomUUID()}, ${created.id}, 'Day 1', 0, now())
      RETURNING id, day_name, sort_order
    `)[0];
    return { ...created, day };
  });

  return reply.code(201).send({
    plan: { id: plan.id, name: plan.name, description: plan.description, createdAt: plan.created_at, days: plan.day ? [{ id: plan.day.id, name: plan.day.day_name, sortOrder: plan.day.sort_order, exerciseCount: 0 }] : [] },
  });
});

function parseAiWorkoutDraft(response: string) {
  const unwrapped = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The plan assistant did not return a JSON workout draft.');
  const parsed = aiWorkoutDraftSchema.safeParse(JSON.parse(unwrapped.slice(start, end + 1)));
  if (!parsed.success) throw new Error('The plan assistant returned an invalid workout draft. Please try again.');
  return parsed.data;
}

function parseAiNutritionLabel(response: string) {
  const unwrapped = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The label assistant did not return JSON.');
  const parsed = aiNutritionLabelSchema.safeParse(JSON.parse(unwrapped.slice(start, end + 1)));
  if (!parsed.success) throw new Error('The label assistant returned invalid nutrition data.');
  const label = parsed.data;
  if (![label.servingSizeValue, label.caloriesKcal, label.proteinG, label.carbsG, label.fatG].some((value) => value !== null)) {
    throw new Error('The label assistant could not find nutrition values.');
  }
  return label;
}

function parseAiBarcodeFood(response: string) {
  const unwrapped = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The barcode assistant did not return JSON.');
  const parsed = aiBarcodeFoodSchema.safeParse(JSON.parse(unwrapped.slice(start, end + 1)));
  if (!parsed.success) throw new Error('The barcode assistant returned incomplete product nutrition.');
  return parsed.data;
}

function parseAiFoodPhotoAnalysis(response: string) {
  const unwrapped = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The food photo assistant did not return JSON.');
  const parsed = aiFoodPhotoAnalysisSchema.safeParse(JSON.parse(unwrapped.slice(start, end + 1)));
  if (!parsed.success) throw new Error('The food photo assistant returned invalid food candidates.');
  return parsed.data;
}

function aiExerciseNameKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

app.post('/v1/ai/workout-drafts', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = aiWorkoutPromptSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Describe the plan you want in at least 12 characters.' });
  if (!env.AI_WORKOUT_WORKER_URL || !env.AI_WORKOUT_WORKER_TOKEN) {
    return reply.code(503).send({ error: 'The plan assistant is not configured yet.' });
  }

  try {
    const [exercises, calistreeExercises] = await Promise.all([
      sql<{ name: string; category: string; muscle_group: string | null }[]>`
        SELECT name, category, muscle_group FROM exercises ORDER BY name ASC LIMIT 300
      `,
      getCalistreeCatalog(),
    ]);
    const response = await requestAiWorkoutDraft({
      workerUrl: env.AI_WORKOUT_WORKER_URL,
      workerToken: env.AI_WORKOUT_WORKER_TOKEN,
      prompt: parsed.data.prompt,
      exerciseCatalog: {
        library: exercises.map((exercise) => ({
          name: exercise.name,
          category: exercise.category,
          muscleGroup: exercise.muscle_group,
        })),
        calistree: calistreeExercises.map((exercise) => ({ name: exercise.name })),
      },
    });
    return reply.send({ draft: parseAiWorkoutDraft(response) });
  } catch (error) {
    request.log.error(error, 'AI workout draft generation failed');
    return reply.code(502).send({ error: error instanceof Error ? error.message : 'The plan assistant could not respond right now.' });
  }
});

app.post('/v1/ai/workout-plans', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = aiWorkoutImportSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid AI workout plan.' });
  const draft = parsed.data.plan;
  const exerciseNames = [...new Set(draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseName)))];
  const existingExercises = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM exercises
    WHERE lower(name) = ANY(${exerciseNames.map(aiExerciseNameKey)}::text[])
  `;
  const existingNames = new Set(existingExercises.map((exercise) => aiExerciseNameKey(exercise.name)));
  let metadataByName: Map<string, Awaited<ReturnType<typeof getCalistreeExerciseMetadata>>>;
  try {
    const metadata = await Promise.all(exerciseNames.map(async (name) => ({
      name,
      metadata: existingNames.has(aiExerciseNameKey(name)) ? null : await getCalistreeExerciseMetadata({ name }),
    })));
    const unresolved = metadata.find((entry) => !existingNames.has(aiExerciseNameKey(entry.name)) && !entry.metadata);
    if (unresolved) {
      return reply.code(409).send({ error: `The plan assistant suggested “${unresolved.name},” which could not be resolved. Generate the plan again.` });
    }
    metadataByName = new Map(metadata.map((entry) => [aiExerciseNameKey(entry.name), entry.metadata]));
  } catch (error) {
    request.log.error(error, 'Calistree exercise resolution failed for AI workout plan');
    return reply.code(502).send({ error: 'The exercise catalog is unavailable right now. Try importing the plan again shortly.' });
  }

  const plan = await sql.begin(async (transaction) => {
    const resolvedExerciseIds = new Map<string, string>();
    let addedExercises = 0;
    for (const exerciseName of exerciseNames) {
      const metadata = metadataByName.get(aiExerciseNameKey(exerciseName));
      const canonicalName = metadata?.name ?? exerciseName;
      const [existing] = await transaction<{ id: string }[]>`
        SELECT id FROM exercises
        WHERE lower(name) = lower(${exerciseName}) OR lower(name) = lower(${canonicalName})
        LIMIT 1
      `;
      if (existing) {
        resolvedExerciseIds.set(aiExerciseNameKey(exerciseName), existing.id);
        continue;
      }
      if (!metadata) throw new Error('Unable to resolve an AI-suggested exercise.');
      const [exercise] = await transaction<{ id: string }[]>`
        INSERT INTO exercises (id, name, category, muscle_group, created_by_user_id, created_at)
        VALUES (${randomUUID()}, ${metadata.name}, ${metadata.category}, ${metadata.muscleGroup}, ${userId}, now())
        RETURNING id
      `;
      addedExercises += 1;
      if (metadata.videoUrl) {
        const sourceName = JSON.stringify({ provider: 'Exercise catalog', sourceUrl: metadata.sourceUrl, importedAt: new Date().toISOString() });
        await transaction`
          INSERT INTO exercise_gif_overrides (id, user_id, exercise_id, gif_url, source_name, created_at, updated_at)
          VALUES (${randomUUID()}, ${userId}, ${exercise.id}, ${metadata.videoUrl}, ${sourceName}, now(), now())
          ON CONFLICT (user_id, exercise_id) DO UPDATE
            SET gif_url = EXCLUDED.gif_url, source_name = EXCLUDED.source_name, updated_at = now()
        `;
      }
      resolvedExerciseIds.set(aiExerciseNameKey(exerciseName), exercise.id);
    }
    const [created] = await transaction<{ id: string; name: string; description: string | null; created_at: Date }[]>`
      INSERT INTO routines (id, user_id, name, description, is_preset, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, ${draft.name}, ${draft.description ?? null}, false, now(), now())
      RETURNING id, name, description, created_at
    `;
    const days = [] as Array<{ id: string; name: string; sortOrder: number; exercises: typeof draft.days[number]['exercises'] }>;
    for (const [dayIndex, day] of draft.days.entries()) {
      const [createdDay] = await transaction<{ id: string; day_name: string; sort_order: number }[]>`
        INSERT INTO routine_days (id, routine_id, day_name, sort_order, created_at)
        VALUES (${randomUUID()}, ${created.id}, ${day.name}, ${dayIndex}, now())
        RETURNING id, day_name, sort_order
      `;
      for (const [exerciseIndex, exercise] of day.exercises.entries()) {
        const exerciseId = resolvedExerciseIds.get(aiExerciseNameKey(exercise.exerciseName));
        if (!exerciseId) throw new Error('Unable to resolve an AI-suggested exercise.');
        await transaction`
          INSERT INTO routine_day_exercises (id, routine_day_id, exercise_id, sort_order, target_sets, target_reps, target_weight)
          VALUES (${randomUUID()}, ${createdDay.id}, ${exerciseId}, ${exerciseIndex}, ${exercise.targetSets}, ${exercise.targetReps ?? null}, ${exercise.targetWeight?.toString() ?? null})
        `;
      }
      days.push({ id: createdDay.id, name: createdDay.day_name, sortOrder: createdDay.sort_order, exercises: day.exercises });
    }
    return { created, days, addedExercises };
  });

  return reply.code(201).send({
    plan: {
      id: plan.created.id,
      name: plan.created.name,
      description: plan.created.description,
      createdAt: plan.created.created_at,
      days: plan.days.map((day) => ({ id: day.id, name: day.name, sortOrder: day.sortOrder, exerciseCount: day.exercises.length })),
    },
    addedExercises: plan.addedExercises,
  });
});

app.post('/v1/exercises', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = exerciseSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid exercise payload.' });
  const [exercise] = await sql<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
    INSERT INTO exercises (id, name, category, muscle_group, created_by_user_id, created_at)
    VALUES (${randomUUID()}, ${parsed.data.name}, ${parsed.data.category}, ${parsed.data.muscleGroup ?? null}, ${userId}, now())
    RETURNING id, name, category, muscle_group
  `;
  return reply.code(201).send({ exercise: { id: exercise.id, name: exercise.name, category: exercise.category, muscleGroup: exercise.muscle_group } });
});

app.put('/v1/exercises/:id/demo', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = exerciseDemoSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Enter a valid public demo URL.' });
  const [exercise] = await sql<{ id: string }[]>`SELECT id FROM exercises WHERE id = ${params.data.id} LIMIT 1`;
  if (!exercise) return reply.code(404).send({ error: 'Exercise not found.' });
  const [demo] = await sql<{ exercise_id: string; gif_url: string; source_name: string | null }[]>`
    INSERT INTO exercise_gif_overrides (id, user_id, exercise_id, gif_url, source_name, created_at, updated_at)
    VALUES (${randomUUID()}, ${userId}, ${exercise.id}, ${parsed.data.demoUrl}, ${parsed.data.sourceName ?? null}, now(), now())
    ON CONFLICT (user_id, exercise_id) DO UPDATE
      SET gif_url = EXCLUDED.gif_url, source_name = EXCLUDED.source_name, updated_at = now()
    RETURNING exercise_id, gif_url, source_name
  `;
  return reply.send({ demo: { exerciseId: demo.exercise_id, demoUrl: demo.gif_url, sourceName: demo.source_name } });
});

app.get('/v1/calistree/exercises', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = calistreeSearchSchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'Enter at least two characters to search the exercise catalog.' });

  try {
    const results = await searchCalistreeExercises(parsed.data.q);
    return reply.send({ results });
  } catch (error) {
    request.log.error(error, 'Calistree catalog search failed');
    return reply.code(502).send({ error: 'The exercise catalog is unavailable right now. Try again shortly.' });
  }
});

app.get('/v1/calistree/exercise', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = calistreeExerciseSchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid exercise.' });

  try {
    const exercise = await getCalistreeExerciseMetadata(parsed.data);
    if (!exercise) return reply.code(404).send({ error: 'No matching exercise was found.' });
    return reply.send({ exercise });
  } catch (error) {
    request.log.error(error, 'Calistree exercise lookup failed');
    return reply.code(502).send({ error: 'The exercise catalog is unavailable right now. Try again shortly.' });
  }
});

app.patch('/v1/plans/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = planSchema.pick({ name: true }).safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout plan payload.' });

  const [updated] = await sql<{ id: string; name: string }[]>`
    UPDATE routines SET name = ${parsed.data.name}, updated_at = now()
    WHERE id = ${params.data.id} AND user_id = ${userId}
    RETURNING id, name
  `;
  if (!updated) return reply.code(404).send({ error: 'Workout plan not found.' });
  return reply.send({ plan: updated });
});

app.delete('/v1/plans/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid workout plan id.' });

  const result = await sql.begin(async (transaction) => {
    const [plan] = await transaction<{ id: string }[]>`
      SELECT id FROM routines WHERE id = ${params.data.id} AND user_id = ${userId} FOR UPDATE
    `;
    if (!plan) return 'missing' as const;
    const [session] = await transaction<{ id: string }[]>`
      SELECT id FROM workout_sessions WHERE user_id = ${userId} AND routine_id = ${plan.id} LIMIT 1
    `;
    if (session) return 'used' as const;
    await transaction`DELETE FROM routines WHERE id = ${plan.id}`;
    return 'deleted' as const;
  });
  if (result === 'missing') return reply.code(404).send({ error: 'Workout plan not found.' });
  if (result === 'used') return reply.code(409).send({ error: 'This folder has workout history and cannot be deleted. Rename it to keep that history intact.' });
  return reply.code(204).send();
});

app.post('/v1/plans/:planId/days', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = planIdParamsSchema.safeParse(request.params);
  const parsed = planDaySchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout day payload.' });

  const [plan] = await sql<{ id: string }[]>`SELECT id FROM routines WHERE id = ${params.data.planId} AND user_id = ${userId} LIMIT 1`;
  if (!plan) return reply.code(404).send({ error: 'Workout plan not found.' });
  const [day] = await sql<{ id: string; day_name: string; sort_order: number }[]>`
    INSERT INTO routine_days (id, routine_id, day_name, sort_order, created_at)
    VALUES (
      ${randomUUID()}, ${plan.id}, ${parsed.data.dayName},
      (SELECT coalesce(max(sort_order), -1) + 1 FROM routine_days WHERE routine_id = ${plan.id}), now()
    )
    RETURNING id, day_name, sort_order
  `;
  return reply.code(201).send({ day: { id: day.id, name: day.day_name, sortOrder: day.sort_order, exerciseCount: 0 } });
});

app.patch('/v1/plan-days/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = planDaySchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout day payload.' });

  const [updated] = await sql<{ id: string; day_name: string }[]>`
    UPDATE routine_days AS rd SET day_name = ${parsed.data.dayName}
    FROM routines AS r
    WHERE rd.id = ${params.data.id} AND rd.routine_id = r.id AND r.user_id = ${userId}
    RETURNING rd.id, rd.day_name
  `;
  if (!updated) return reply.code(404).send({ error: 'Workout day not found.' });
  return reply.send({ day: { id: updated.id, name: updated.day_name } });
});

app.delete('/v1/plan-days/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid workout day id.' });

  const result = await sql.begin(async (transaction) => {
    const [day] = await transaction<{ id: string; routine_id: string }[]>`
      SELECT rd.id, rd.routine_id FROM routine_days rd
      INNER JOIN routines r ON r.id = rd.routine_id
      WHERE rd.id = ${params.data.id} AND r.user_id = ${userId} LIMIT 1
    `;
    if (!day) return { error: 'Workout day not found.', status: 404 } as const;
    const [used] = await transaction<{ id: string; status: string }[]>`
      SELECT id, status FROM workout_sessions
      WHERE user_id = ${userId} AND routine_day_id = ${day.id}
      LIMIT 1
    `;
    if (used) return { error: used.status === 'active'
      ? 'Finish or discard the active workout before deleting this routine.'
      : 'This routine has workout history and cannot be deleted. Rename it to keep that history intact.', status: 409 } as const;
    await transaction`DELETE FROM routine_days WHERE id = ${day.id}`;
    return { id: day.id } as const;
  });
  if ('error' in result) return reply.code(typeof result.status === 'number' ? result.status : 400).send({ error: result.error });
  return reply.code(204).send();
});

function routineShareStatus(share: { revoked_at: Date | null; expires_at: Date }) {
  if (share.revoked_at) return 'revoked' as const;
  if (share.expires_at.getTime() <= Date.now()) return 'expired' as const;
  return 'active' as const;
}

function parseRoutineShareSnapshot(value: unknown) {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  const parsed = routineShareSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function routineSharePayload(share: {
  id: string;
  token: string;
  routine_day_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  snapshot: unknown;
}) {
  const snapshot = parseRoutineShareSnapshot(share.snapshot);
  if (!snapshot) return null;
  return {
    id: share.id,
    token: share.token,
    routineDayId: share.routine_day_id,
    status: routineShareStatus(share),
    createdAt: share.created_at,
    expiresAt: share.expires_at,
    snapshot,
  };
}

function storedWeightToKg(weight: string | null, unit: string | null) {
  if (weight == null) return null;
  const value = Number(weight);
  return unit === 'kg' ? value : value / 2.20462262185;
}

function kgToStoredWeight(weightKg: number | null, unit: string | null) {
  if (weightKg == null) return null;
  return unit === 'kg' ? weightKg : weightKg * 2.20462262185;
}

app.get('/v1/routine-shares', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = routineShareListSchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid routine share query.' });
  const shares = await sql<{
    id: string; token: string; routine_day_id: string; created_at: Date;
    expires_at: Date; revoked_at: Date | null; snapshot: unknown;
  }[]>`
    SELECT id, token, routine_day_id, created_at, expires_at, revoked_at, snapshot
    FROM routine_share_snapshots
    WHERE owner_user_id = ${userId} AND routine_day_id = ${parsed.data.routineDayId}
    ORDER BY created_at DESC
  `;
  return reply.send({
    shares: shares.map(routineSharePayload).filter((share) => share != null),
  });
});

app.post('/v1/routine-shares', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = routineShareCreateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid routine share payload.' });

  const created = await sql.begin(async (transaction) => {
    const [day] = await transaction<{
      day_id: string; day_name: string; routine_id: string; folder_name: string;
      owner_name: string | null; owner_username: string; weight_unit: string | null;
    }[]>`
      SELECT rd.id AS day_id, rd.day_name, r.id AS routine_id, r.name AS folder_name,
        u.name AS owner_name, u.username, p.weight_unit
      FROM routine_days rd
      INNER JOIN routines r ON r.id = rd.routine_id
      INNER JOIN users u ON u.id = r.user_id
      LEFT JOIN user_preferences p ON p.user_id = r.user_id
      WHERE rd.id = ${parsed.data.routineDayId} AND r.user_id = ${userId}
      FOR UPDATE
    `;
    if (!day) return null;
    const exercises = await transaction<{
      exercise_id: string; name: string; category: string; muscle_group: string | null;
      target_sets: number; target_reps: number | null; target_weight: string | null;
      tracking_mode: string; target_duration_seconds: number | null;
    }[]>`
      SELECT e.id AS exercise_id, e.name, e.category, e.muscle_group,
        rde.target_sets, rde.target_reps, rde.target_weight,
        rde.tracking_mode, rde.target_duration_seconds
      FROM routine_day_exercises rde
      INNER JOIN exercises e ON e.id = rde.exercise_id
      WHERE rde.routine_day_id = ${day.day_id}
      ORDER BY rde.sort_order ASC, rde.id ASC
    `;
    if (exercises.length === 0) return { empty: true } as const;
    const snapshot = routineShareSnapshotSchema.parse({
      routineName: day.day_name,
      folderName: day.folder_name,
      ownerName: day.owner_name,
      ownerUsername: day.owner_username,
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exercise_id,
        name: exercise.name,
        category: exercise.category,
        muscleGroup: exercise.muscle_group,
        targetSets: exercise.target_sets,
        targetReps: exercise.target_reps ?? 10,
        trackingMode: exercise.tracking_mode,
        targetDurationSeconds: exercise.target_duration_seconds,
        targetWeightKg: storedWeightToKg(exercise.target_weight, day.weight_unit),
      })),
    });
    const [share] = await transaction<{
      id: string; token: string; routine_day_id: string; created_at: Date;
      expires_at: Date; revoked_at: Date | null; snapshot: unknown;
    }[]>`
      INSERT INTO routine_share_snapshots
        (id, token, owner_user_id, routine_id, routine_day_id, snapshot, created_at, expires_at)
      VALUES
        (${randomUUID()}, ${randomBytes(24).toString('base64url')}, ${userId},
         ${day.routine_id}, ${day.day_id}, ${JSON.stringify(snapshot)}, now(), now() + interval '30 days')
      RETURNING id, token, routine_day_id, created_at, expires_at, revoked_at, snapshot
    `;
    return { share } as const;
  });
  if (created == null) return reply.code(404).send({ code: 'routine_not_found', error: 'Routine not found.' });
  if ('empty' in created) {
    return reply.code(409).send({
      code: 'routine_share_empty',
      error: 'Add at least one exercise before sharing this routine.',
    });
  }
  const share = routineSharePayload(created.share);
  if (!share) return reply.code(500).send({ error: 'Could not prepare this routine share.' });
  return reply.code(201).send({ share });
});

app.delete('/v1/routine-shares/:token', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = routineShareTokenSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid routine share link.' });
  const [revoked] = await sql<{ id: string }[]>`
    UPDATE routine_share_snapshots
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE token = ${params.data.token} AND owner_user_id = ${userId}
    RETURNING id
  `;
  if (!revoked) return reply.code(404).send({ code: 'routine_share_not_found', error: 'Routine link not found.' });
  return reply.code(204).send();
});

app.get('/v1/routine-shares/:token', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = routineShareTokenSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid routine share link.' });
  const [share] = await sql<{
    id: string; token: string; routine_day_id: string; created_at: Date;
    expires_at: Date; revoked_at: Date | null; snapshot: unknown;
  }[]>`
    SELECT id, token, routine_day_id, created_at, expires_at, revoked_at, snapshot
    FROM routine_share_snapshots
    WHERE token = ${params.data.token}
    LIMIT 1
  `;
  if (!share) return reply.code(404).send({ code: 'routine_share_not_found', error: 'Routine link not found.' });
  const status = routineShareStatus(share);
  if (status === 'revoked') return reply.code(410).send({ code: 'routine_share_revoked', error: 'This routine link was revoked.' });
  if (status === 'expired') return reply.code(410).send({ code: 'routine_share_expired', error: 'This routine link has expired.' });
  const payload = routineSharePayload(share);
  if (!payload) return reply.code(404).send({ code: 'routine_share_not_found', error: 'Routine link not found.' });
  return reply.send({ share: payload.snapshot });
});

app.post('/v1/routine-shares/:token/import', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = routineShareTokenSchema.safeParse(request.params);
  const parsed = routineShareImportSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid routine import payload.' });
  const result = await sql.begin(async (transaction) => {
    const [share] = await transaction<{
      id: string; token: string; routine_day_id: string; created_at: Date;
      expires_at: Date; revoked_at: Date | null; snapshot: unknown;
    }[]>`
      SELECT id, token, routine_day_id, created_at, expires_at, revoked_at, snapshot
      FROM routine_share_snapshots WHERE token = ${params.data.token} FOR UPDATE
    `;
    if (!share) return { error: 'routine_share_not_found' } as const;
    const status = routineShareStatus(share);
    if (status !== 'active') return { error: `routine_share_${status}` } as const;
    const snapshot = parseRoutineShareSnapshot(share.snapshot);
    if (!snapshot) return { error: 'routine_share_not_found' } as const;
    const [folder] = await transaction<{ id: string; weight_unit: string | null }[]>`
      SELECT r.id, p.weight_unit
      FROM routines r
      LEFT JOIN user_preferences p ON p.user_id = r.user_id
      WHERE r.id = ${parsed.data.routineId} AND r.user_id = ${userId}
      FOR UPDATE
    `;
    if (!folder) return { error: 'routine_folder_not_found' } as const;
    for (const entry of snapshot.exercises) {
      const [exercise] = await transaction<{ id: string }[]>`
        SELECT id FROM exercises WHERE id = ${entry.exerciseId} LIMIT 1
      `;
      if (!exercise) return { error: 'routine_share_exercise_unavailable', name: entry.name } as const;
    }
    const [day] = await transaction<{ id: string; day_name: string; sort_order: number }[]>`
      INSERT INTO routine_days (id, routine_id, day_name, sort_order, created_at, imported_from_share_id)
      VALUES (
        ${randomUUID()}, ${folder.id}, ${parsed.data.name ?? snapshot.routineName},
        (SELECT coalesce(max(sort_order), -1) + 1 FROM routine_days WHERE routine_id = ${folder.id}),
        now(), ${share.id}
      )
      RETURNING id, day_name, sort_order
    `;
    for (const [index, entry] of snapshot.exercises.entries()) {
      await transaction`
        INSERT INTO routine_day_exercises
          (id, routine_day_id, exercise_id, sort_order, target_sets, target_reps, target_weight, tracking_mode, target_duration_seconds)
        VALUES (
          ${randomUUID()}, ${day.id}, ${entry.exerciseId}, ${index}, ${entry.targetSets},
          ${entry.targetReps}, ${kgToStoredWeight(entry.targetWeightKg, folder.weight_unit)?.toString() ?? null},
          ${entry.trackingMode}, ${entry.trackingMode === 'timed' ? entry.targetDurationSeconds : null}
        )
      `;
    }
    return { day } as const;
  });
  if ('error' in result) {
    const message = result.error === 'routine_share_revoked'
      ? 'This routine link was revoked.'
      : result.error === 'routine_share_expired'
      ? 'This routine link has expired.'
      : result.error === 'routine_share_exercise_unavailable'
      ? `“${result.name}” is no longer available to import.`
      : result.error === 'routine_folder_not_found'
      ? 'Choose a routine folder you own.'
      : 'Routine link not found.';
    const status = result.error === 'routine_share_revoked' || result.error === 'routine_share_expired' ? 410 : 404;
    return reply.code(status).send({ code: result.error, error: message });
  }
  return reply.code(201).send({
    day: {
      id: result.day.id,
      name: result.day.day_name,
      sortOrder: result.day.sort_order,
      sourceShareToken: params.data.token,
    },
  });
});

app.post('/v1/plan-days/:id/reorder', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = reorderSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid routine reorder payload.' });

  const result = await sql.begin(async (transaction) => {
    const [day] = await transaction<{ id: string; routine_id: string }[]>`
      SELECT rd.id, rd.routine_id FROM routine_days rd
      INNER JOIN routines r ON r.id = rd.routine_id
      WHERE rd.id = ${params.data.id} AND r.user_id = ${userId} LIMIT 1
    `;
    if (!day) return null;
    const days = await transaction<{ id: string }[]>`
      SELECT id FROM routine_days WHERE routine_id = ${day.routine_id}
      ORDER BY sort_order ASC, id ASC FOR UPDATE
    `;
    const fromIndex = days.findIndex((item) => item.id === day.id);
    const toIndex = parsed.data.direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= days.length) return day;
    const reordered = [...days];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    for (const [index, item] of reordered.entries()) {
      await transaction`UPDATE routine_days SET sort_order = ${index} WHERE id = ${item.id}`;
    }
    await transaction`UPDATE routines SET updated_at = now() WHERE id = ${day.routine_id}`;
    return day;
  });
  if (!result) return reply.code(404).send({ error: 'Routine not found.' });
  return reply.send({ id: result.id });
});

app.post('/v1/plan-days/:id/exercises', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = planDayExerciseSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout day exercise payload.' });

  const [day] = await sql<{ id: string }[]>`
    SELECT rd.id FROM routine_days rd INNER JOIN routines r ON r.id = rd.routine_id
    WHERE rd.id = ${params.data.id} AND r.user_id = ${userId} LIMIT 1
  `;
  if (!day) return reply.code(404).send({ error: 'Workout day not found.' });
  const [exercise] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM exercises WHERE id = ${parsed.data.exerciseId} LIMIT 1`;
  if (!exercise) return reply.code(404).send({ error: 'Exercise not found.' });
  const [entry] = await sql<{ id: string; sort_order: number }[]>`
    INSERT INTO routine_day_exercises (id, routine_day_id, exercise_id, sort_order, target_sets, target_reps, target_weight)
    VALUES (
      ${randomUUID()}, ${day.id}, ${exercise.id},
      (SELECT coalesce(max(sort_order), -1) + 1 FROM routine_day_exercises WHERE routine_day_id = ${day.id}),
      ${parsed.data.targetSets ?? 3}, ${parsed.data.targetReps ?? null}, ${parsed.data.targetWeight?.toString() ?? null}
    )
    RETURNING id, sort_order
  `;
  return reply.code(201).send({ entry: { id: entry.id, exerciseId: exercise.id, exerciseName: exercise.name, sortOrder: entry.sort_order } });
});

app.post('/v1/plan-days/:id/calistree-exercises', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = planDayCalistreeImportSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid exercise payload.' });

  let metadata;
  try {
    metadata = await getCalistreeExerciseMetadata({ slug: parsed.data.slug });
  } catch (error) {
    request.log.error(error, 'Calistree exercise import lookup failed');
    return reply.code(502).send({ error: 'The exercise catalog is unavailable right now. Try again shortly.' });
  }
  if (!metadata) return reply.code(404).send({ error: 'No matching exercise was found.' });

  const result = await sql.begin(async (transaction) => {
    const [day] = await transaction<{ id: string }[]>`
      SELECT rd.id FROM routine_days rd INNER JOIN routines r ON r.id = rd.routine_id
      WHERE rd.id = ${params.data.id} AND r.user_id = ${userId} LIMIT 1
    `;
    if (!day) return null;
    const [existing] = await transaction<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
      SELECT id, name, category, muscle_group FROM exercises WHERE lower(name) = lower(${metadata.name}) LIMIT 1
    `;
    const exercise = existing ?? (await transaction<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
      INSERT INTO exercises (id, name, category, muscle_group, created_by_user_id, created_at)
      VALUES (${randomUUID()}, ${metadata.name}, ${metadata.category}, ${metadata.muscleGroup}, ${userId}, now())
      RETURNING id, name, category, muscle_group
    `)[0];
    if (metadata.videoUrl) {
      const sourceName = JSON.stringify({ provider: 'Exercise catalog', sourceUrl: metadata.sourceUrl, importedAt: new Date().toISOString() });
      await transaction`
        INSERT INTO exercise_gif_overrides (id, user_id, exercise_id, gif_url, source_name, created_at, updated_at)
        VALUES (${randomUUID()}, ${userId}, ${exercise.id}, ${metadata.videoUrl}, ${sourceName}, now(), now())
        ON CONFLICT (user_id, exercise_id) DO UPDATE SET gif_url = EXCLUDED.gif_url, source_name = EXCLUDED.source_name, updated_at = now()
      `;
    }
    const [entry] = await transaction<{ id: string; sort_order: number }[]>`
      INSERT INTO routine_day_exercises (id, routine_day_id, exercise_id, sort_order, target_sets, target_reps, target_weight)
      VALUES (${randomUUID()}, ${day.id}, ${exercise.id}, (SELECT coalesce(max(sort_order), -1) + 1 FROM routine_day_exercises WHERE routine_day_id = ${day.id}), ${parsed.data.targetSets ?? 3}, ${parsed.data.targetReps ?? null}, ${parsed.data.targetWeight?.toString() ?? null})
      RETURNING id, sort_order
    `;
    return { entry, exercise };
  });
  if (!result) return reply.code(404).send({ error: 'Workout day not found.' });
  return reply.code(201).send({ entry: { id: result.entry.id, exerciseId: result.exercise.id, exerciseName: result.exercise.name, sortOrder: result.entry.sort_order } });
});

app.delete('/v1/plan-day-exercises/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid workout day exercise id.' });
  const [deleted] = await sql<{ id: string }[]>`
    DELETE FROM routine_day_exercises rde
    USING routine_days rd, routines r
    WHERE rde.id = ${params.data.id} AND rde.routine_day_id = rd.id AND rd.routine_id = r.id AND r.user_id = ${userId}
    RETURNING rde.id
  `;
  if (!deleted) return reply.code(404).send({ error: 'Workout day exercise not found.' });
  return reply.code(204).send();
});

app.patch('/v1/plan-day-exercises/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = planDayExerciseUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid exercise prescription payload.' });

  const [updated] = await sql<{ id: string; target_sets: number; target_reps: number | null; target_weight: string | null; tracking_mode: string; target_duration_seconds: number | null }[]>`
    UPDATE routine_day_exercises AS rde
    SET target_sets = ${parsed.data.targetSets},
        target_reps = ${parsed.data.targetReps},
        target_weight = ${parsed.data.targetWeight?.toString() ?? null},
        tracking_mode = ${parsed.data.trackingMode},
        target_duration_seconds = ${parsed.data.trackingMode === 'timed' ? parsed.data.targetDurationSeconds ?? null : null}
    FROM routine_days AS rd, routines AS r
    WHERE rde.id = ${params.data.id}
      AND rde.routine_day_id = rd.id
      AND rd.routine_id = r.id
      AND r.user_id = ${userId}
    RETURNING rde.id, rde.target_sets, rde.target_reps, rde.target_weight, rde.tracking_mode, rde.target_duration_seconds
  `;
  if (!updated) return reply.code(404).send({ error: 'Workout day exercise not found.' });
  return reply.send({ entry: { id: updated.id, targetSets: updated.target_sets, targetReps: updated.target_reps, targetWeight: updated.target_weight, trackingMode: updated.tracking_mode, targetDurationSeconds: updated.target_duration_seconds } });
});

app.post('/v1/plan-day-exercises/:id/reorder', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = reorderSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid exercise reorder payload.' });

  const result = await sql.begin(async (transaction) => {
    const [entry] = await transaction<{ id: string; routine_day_id: string }[]>`
      SELECT rde.id, rde.routine_day_id
      FROM routine_day_exercises rde
      INNER JOIN routine_days rd ON rd.id = rde.routine_day_id
      INNER JOIN routines r ON r.id = rd.routine_id
      WHERE rde.id = ${params.data.id} AND r.user_id = ${userId}
      LIMIT 1
    `;
    if (!entry) return null;
    const entries = await transaction<{ id: string }[]>`
      SELECT id FROM routine_day_exercises
      WHERE routine_day_id = ${entry.routine_day_id}
      ORDER BY sort_order ASC, id ASC
    `;
    const fromIndex = entries.findIndex((item) => item.id === entry.id);
    const toIndex = parsed.data.direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= entries.length) return entry;
    const reordered = [...entries];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    for (const [index, item] of reordered.entries()) {
      await transaction`UPDATE routine_day_exercises SET sort_order = ${index} WHERE id = ${item.id}`;
    }
    return entry;
  });
  if (!result) return reply.code(404).send({ error: 'Workout day exercise not found.' });
  return reply.send({ id: result.id });
});

app.put('/v1/preferences/active-plan', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = activePlanSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid active workout plan.' });
  if (parsed.data.routineId) {
    const [plan] = await sql<{ id: string }[]>`SELECT id FROM routines WHERE id = ${parsed.data.routineId} AND user_id = ${userId} LIMIT 1`;
    if (!plan) return reply.code(404).send({ error: 'Workout plan not found.' });
  }
  await sql`
    INSERT INTO user_preferences (user_id, active_routine_id, weight_unit, theme_overrides, updated_at)
    VALUES (${userId}, ${parsed.data.routineId}, 'lbs', '{}'::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET active_routine_id = EXCLUDED.active_routine_id, updated_at = now()
  `;
  return reply.send({ activeRoutineId: parsed.data.routineId });
});

app.get('/v1/preferences', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const [preferences] = await sql<{
    weight_unit: string | null;
    active_routine_id: string | null;
    theme_overrides: unknown;
  }[]>`
    SELECT weight_unit, active_routine_id, theme_overrides
    FROM user_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return reply.send({
    settings: {
      weight_unit: preferences?.weight_unit ?? 'lbs',
      active_routine_id: preferences?.active_routine_id ?? null,
      theme_overrides: preferences?.theme_overrides ?? {},
    },
  });
});

app.post('/v1/quick-add', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = quickAddSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid quick-add payload.' });

  const [exercise, preferences] = await Promise.all([
    sql<{ id: string; name: string; category: string }[]>`
      SELECT id, name, category FROM exercises WHERE id = ${parsed.data.exerciseId} LIMIT 1
    `,
    sql<{ weight_unit: string }[]>`
      SELECT weight_unit FROM user_preferences WHERE user_id = ${userId} LIMIT 1
    `,
  ]);
  if (!exercise[0]) return reply.code(404).send({ error: 'Exercise not found.' });
  const weightUnit = preferences[0]?.weight_unit === 'kg' ? 'kg' : 'lbs';
  const now = new Date();
  const startedAt = parsed.data.durationSeconds
    ? new Date(now.getTime() - parsed.data.durationSeconds * 1_000)
    : now;

  const result = await sql.begin(async (transaction) => {
    const [session] = await transaction<{ id: string; started_at: Date; ended_at: Date }[]>`
      INSERT INTO workout_sessions (id, user_id, routine_id, routine_day_id, started_at, ended_at, status, origin)
      VALUES (${randomUUID()}, ${userId}, NULL, NULL, ${startedAt}, ${now}, 'completed', 'quick_add')
      RETURNING id, started_at, ended_at
    `;
    const [sessionExercise] = await transaction<{ id: string }[]>`
      INSERT INTO session_exercises (id, session_id, exercise_id, sort_order, target_reps, target_weight, created_at)
      VALUES (${randomUUID()}, ${session.id}, ${exercise[0].id}, 0, NULL, NULL, ${now})
      RETURNING id
    `;
    const [set] = await transaction<{ id: string; created_at: Date }[]>`
      INSERT INTO workout_sets (id, session_id, exercise_id, set_order, reps, weight, duration_seconds, is_warmup, created_at)
      VALUES (${randomUUID()}, ${session.id}, ${exercise[0].id}, 1, ${parsed.data.reps ?? 1}, ${parsed.data.weight?.toString() ?? null}, ${parsed.data.durationSeconds ?? null}, false, ${now})
      RETURNING id, created_at
    `;
    return { session, sessionExercise, set };
  });
  await recordProgressionEvent(sql, userId, 'workout_session_completed', 'workout_session', result.session.id, {
    quickAdd: true,
    exerciseId: exercise[0].id,
  });
  await recordProgressionEvent(sql, userId, 'workout_set_logged', 'workout_set', result.set.id, {
    sessionId: result.session.id,
    exerciseId: exercise[0].id,
    quickAdd: true,
  });
  return reply.code(201).send({
    session: {
      id: result.session.id,
      planName: 'Quick Add',
      dayName: 'Quick Add',
      status: 'completed',
      startedAt: result.session.started_at,
      endedAt: result.session.ended_at,
    },
    exercise: { id: exercise[0].id, name: exercise[0].name, category: exercise[0].category },
    weightUnit,
  });
});

async function startActiveWorkout(
  userId: string,
  routineId: string | null,
  routineDayId: string | null,
  origin: 'plan_day' | 'freeform',
  startedAt: Date,
) {
  return sql.begin(async (transaction) => {
    // Both start routes serialize on the user row. The partial unique index in
    // migration 011 also protects against writers outside these routes.
    await transaction`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const [active] = await transaction<{ id: string }[]>`
      SELECT id FROM workout_sessions
      WHERE user_id = ${userId} AND status = 'active' LIMIT 1
    `;
    if (active) return { activeSessionId: active.id, session: null };
    const [session] = await transaction<{ id: string; started_at: Date }[]>`
      INSERT INTO workout_sessions
        (id, user_id, routine_id, routine_day_id, started_at, status, origin)
      VALUES
        (${randomUUID()}, ${userId}, ${routineId}, ${routineDayId}, ${startedAt}, 'active', ${origin})
      RETURNING id, started_at
    `;
    return { activeSessionId: null, session };
  });
}

function rankResponse(row: {
  exercise_id: string; exercise_name: string; category: string; muscle_group: string | null;
  tracking_mode: string | null; metric: string | null; baseline_value: string | null;
  best_value: string | null; tier: string | null; subdivision: number | null;
  progress_points: number | null; next_threshold: string | null; rule_version: number | null;
  calculated_at: Date | null;
}) {
  return {
    exerciseId: row.exercise_id, exerciseName: row.exercise_name, category: row.category,
    muscleGroup: row.muscle_group, trackingMode: row.tracking_mode,
    metric: row.metric, baselineValue: row.baseline_value == null ? null : Number(row.baseline_value),
    bestValue: row.best_value == null ? null : Number(row.best_value), tier: row.tier,
    subdivision: row.subdivision, progressPoints: row.progress_points,
    nextThreshold: row.next_threshold == null ? null : Number(row.next_threshold),
    ruleVersion: row.rule_version, calculatedAt: row.calculated_at,
  };
}

app.get('/v1/exercise-ranks', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const query = exerciseRankQuerySchema.safeParse(request.query);
  if (!query.success) return reply.code(400).send({ error: 'Invalid rank query.' });
  const rows = await sql<{
    exercise_id: string; exercise_name: string; category: string; muscle_group: string | null;
    tracking_mode: string | null; metric: string | null; baseline_value: string | null;
    best_value: string | null; tier: string | null; subdivision: number | null;
    progress_points: number | null; next_threshold: string | null; rule_version: number | null; calculated_at: Date | null;
  }[]>`
    SELECT e.id AS exercise_id, e.name AS exercise_name, e.category, e.muscle_group,
      ers.tracking_mode, ers.metric, ers.baseline_value, ers.best_value, ers.tier,
      ers.subdivision, ers.progress_points, ers.next_threshold, ers.rule_version, ers.calculated_at
    FROM exercises e
    LEFT JOIN exercise_rank_snapshots ers ON ers.exercise_id = e.id AND ers.user_id = ${userId}
      AND ers.is_current ${query.data.mode ? sql`AND ers.tracking_mode = ${query.data.mode}` : sql``}
    WHERE (${query.data.q ?? ''} = '' OR e.name ILIKE ${`%${query.data.q ?? ''}%`})
    ORDER BY (ers.tier IS NULL), e.name ASC
    LIMIT ${query.data.limit} OFFSET ${query.data.offset}
  `;
  return reply.send({ ruleVersion: EXERCISE_RANK_RULE_VERSION, ranks: rows.map(rankResponse), nextOffset: rows.length === query.data.limit ? query.data.offset + rows.length : null });
});

app.get('/v1/exercise-ranks/:exerciseId', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = exerciseRankParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid exercise id.' });
  const [row] = await sql<{
    exercise_id: string; exercise_name: string; category: string; muscle_group: string | null;
    tracking_mode: string | null; metric: string | null; baseline_value: string | null;
    best_value: string | null; tier: string | null; subdivision: number | null;
    progress_points: number | null; next_threshold: string | null; rule_version: number | null; calculated_at: Date | null;
    evidence_session_ids: string[] | null;
  }[]>`
    SELECT e.id AS exercise_id, e.name AS exercise_name, e.category, e.muscle_group,
      ers.tracking_mode, ers.metric, ers.baseline_value, ers.best_value, ers.tier,
      ers.subdivision, ers.progress_points, ers.next_threshold, ers.rule_version, ers.calculated_at,
      ers.evidence_session_ids
    FROM exercises e LEFT JOIN exercise_rank_snapshots ers
      ON ers.exercise_id = e.id AND ers.user_id = ${userId} AND ers.is_current
    WHERE e.id = ${params.data.exerciseId} LIMIT 1
  `;
  if (!row) return reply.code(404).send({ error: 'Exercise not found.' });
  const evidence = row.evidence_session_ids?.length
    ? await sql<{ session_id: string; ended_at: Date; value: string }[]>`
        SELECT ws.id AS session_id, ws.ended_at,
          coalesce(max(wset.duration_seconds)::numeric, max(wset.weight * (1 + least(wset.reps, 12)::numeric / 30)), max(wset.reps)::numeric)::text AS value
        FROM workout_sessions ws INNER JOIN workout_sets wset ON wset.session_id = ws.id
        WHERE ws.id = ANY(${row.evidence_session_ids}::uuid[]) AND wset.exercise_id = ${row.exercise_id}
        GROUP BY ws.id, ws.ended_at ORDER BY ws.ended_at ASC
      `
    : [];
  return reply.send({ rank: { ...rankResponse(row), evidence: evidence.map((item) => ({ sessionId: item.session_id, completedAt: item.ended_at, value: Number(item.value) })) } });
});

app.get('/v1/ranks/overview', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  await recomputeRankProjections(sql, userId);
  const [overall] = await sql<{
    eligible_exercise_count: number; mapped_group_count: number; placement_eligible: boolean;
    score: string | null; tier: string | null; delta_value: string | null; calculated_at: Date; evidence_exercise_ids: string[];
  }[]>`SELECT eligible_exercise_count, mapped_group_count, placement_eligible, score::text, tier, delta_value::text, calculated_at, evidence_exercise_ids
    FROM overall_rank_snapshots WHERE user_id = ${userId} AND is_current LIMIT 1`;
  const groups = await sql<{
    muscle_group: string; region_id: string; body_side: string; eligible_exercise_count: number;
    score: string | null; tier: string | null; delta_value: string | null; calculated_at: Date; evidence_exercise_ids: string[];
  }[]>`SELECT muscle_group, region_id, body_side, eligible_exercise_count, score::text, tier, delta_value::text, calculated_at, evidence_exercise_ids
    FROM muscle_rank_snapshots WHERE user_id = ${userId} AND is_current ORDER BY muscle_group`;
  const label: Record<string, string> = { arms: 'Arms', back: 'Back', calves: 'Calves', chest: 'Chest', glutes: 'Glutes', hamstrings: 'Hamstrings', quads: 'Quads', shoulders: 'Shoulders' };
  return reply.send({
    overall: overall ? {
      eligibleExerciseCount: overall.eligible_exercise_count, mappedGroupCount: overall.mapped_group_count,
      placementEligible: overall.placement_eligible, score: overall.score == null ? null : Number(overall.score), tier: overall.tier,
      delta: overall.delta_value == null ? null : Number(overall.delta_value), calculatedAt: overall.calculated_at,
      evidenceExerciseIds: overall.evidence_exercise_ids,
    } : { eligibleExerciseCount: 0, mappedGroupCount: 0, placementEligible: false, score: null, tier: null, delta: null, calculatedAt: null, evidenceExerciseIds: [] },
    groups: groups.map((item) => ({
      groupId: item.muscle_group, label: label[item.muscle_group] ?? item.muscle_group, regionId: item.region_id, bodySide: item.body_side,
      eligibleExerciseCount: item.eligible_exercise_count, score: item.score == null ? null : Number(item.score), tier: item.tier,
      delta: item.delta_value == null ? null : Number(item.delta_value), calculatedAt: item.calculated_at,
      evidenceExerciseIds: item.evidence_exercise_ids,
    })),
    lastSessionChanges: groups.filter((item) => item.delta_value != null && Number(item.delta_value) > 0).map((item) => label[item.muscle_group] ?? item.muscle_group),
  });
});

app.get('/v1/ranks/history', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const rows = await sql<{
    eligible_exercise_count: number; score: string | null; tier: string | null; calculated_at: Date;
  }[]>`SELECT eligible_exercise_count, score::text, tier, calculated_at FROM overall_rank_snapshots
    WHERE user_id = ${userId} ORDER BY calculated_at DESC LIMIT 60`;
  return reply.send({ history: rows.reverse().map((item) => ({
    eligibleExerciseCount: item.eligible_exercise_count, score: item.score == null ? null : Number(item.score), tier: item.tier, calculatedAt: item.calculated_at,
  })) });
});


app.get('/v1/progress/training', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = trainingAnalyticsQuerySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid training query parameters.' });
  const period = parsed.data.period;
  const metric = parsed.data.metric;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 14;

  const [aggregates] = await sql<{
    workout_count: number;
    total_duration_seconds: number;
    total_volume_kg: string;
    total_reps: number;
    working_set_count: number;
  }[]>`
    SELECT
      count(DISTINCT ws.id)::int AS workout_count,
      coalesce(sum(EXTRACT(EPOCH FROM (ws.ended_at - ws.started_at))), 0)::int AS total_duration_seconds,
      coalesce(sum(CASE WHEN wset.duration_seconds IS NULL AND coalesce(wset.weight, 0) > 0 THEN wset.weight * wset.reps ELSE 0 END), 0)::text AS total_volume_kg,
      coalesce(sum(CASE WHEN wset.duration_seconds IS NULL THEN wset.reps ELSE 0 END), 0)::int AS total_reps,
      count(wset.id)::int AS working_set_count
    FROM workout_sessions ws
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
    WHERE ws.user_id = ${userId}
      AND ws.status = 'completed'
      AND ws.ended_at IS NOT NULL
      AND ws.ended_at >= now() - (${days} || ' days')::interval
  `;

  const dailyBuckets = await sql<{
    date: string;
    session_count: number;
    duration_seconds: number;
    volume_kg: string;
    reps: number;
  }[]>`
    SELECT
      to_char(ws.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      count(DISTINCT ws.id)::int AS session_count,
      coalesce(sum(EXTRACT(EPOCH FROM (ws.ended_at - ws.started_at))), 0)::int AS duration_seconds,
      coalesce(sum(CASE WHEN wset.duration_seconds IS NULL AND coalesce(wset.weight, 0) > 0 THEN wset.weight * wset.reps ELSE 0 END), 0)::text AS volume_kg,
      coalesce(sum(CASE WHEN wset.duration_seconds IS NULL THEN wset.reps ELSE 0 END), 0)::int AS reps
    FROM workout_sessions ws
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
    WHERE ws.user_id = ${userId}
      AND ws.status = 'completed'
      AND ws.ended_at IS NOT NULL
      AND ws.ended_at >= now() - (${days} || ' days')::interval
    GROUP BY to_char(ws.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    ORDER BY date ASC
  `;

  const prCountRow = await sql<{ count: number }[]>`
    SELECT count(DISTINCT p.id)::int AS count
    FROM progression_events p
    WHERE p.user_id = ${userId}
      AND p.event_type = 'personal_record'
      AND p.created_at >= now() - (${days} || ' days')::interval
  `;

  return reply.send({
    period,
    metric,
    days,
    summary: {
      workoutCount: aggregates.workout_count,
      totalDurationSeconds: aggregates.total_duration_seconds,
      totalVolumeKg: Number(aggregates.total_volume_kg),
      totalReps: aggregates.total_reps,
      workingSetCount: aggregates.working_set_count,
      personalRecordCount: prCountRow[0]?.count ?? 0,
    },
    daily: dailyBuckets.map((b) => ({
      date: b.date,
      sessionCount: b.session_count,
      durationSeconds: b.duration_seconds,
      volumeKg: Number(b.volume_kg),
      reps: b.reps,
    })),
  });
});

app.get('/v1/ranks/analysis', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  // Category averages
  const categoryStats = await sql<{
    category: string;
    ranked_count: number;
    total_count: number;
    avg_ratio: string | null;
  }[]>`
    SELECT
      e.category,
      count(ers.exercise_id) FILTER (WHERE ers.tier IS NOT NULL)::int AS ranked_count,
      count(e.id)::int AS total_count,
      avg(ers.best_value / nullif(ers.baseline_value, 0)) FILTER (WHERE ers.tier IS NOT NULL)::text AS avg_ratio
    FROM exercises e
    LEFT JOIN exercise_rank_snapshots ers
      ON ers.exercise_id = e.id AND ers.user_id = ${userId} AND ers.is_current
    GROUP BY e.category
    ORDER BY e.category ASC
  `;

  // Tier distribution
  const distributionRows = await sql<{
    tier: string;
    count: number;
  }[]>`
    SELECT
      ers.tier,
      count(ers.exercise_id)::int AS count
    FROM exercise_rank_snapshots ers
    WHERE ers.user_id = ${userId}
      AND ers.is_current
      AND ers.tier IS NOT NULL
    GROUP BY ers.tier
  `;

  // Weekly rank up counts in the last 12 weeks
  const weeklyRankUps = await sql<{
    week_start: string;
    rank_up_count: number;
  }[]>`
    SELECT
      to_char(date_trunc('week', calculated_at), 'YYYY-MM-DD') AS week_start,
      count(id)::int AS rank_up_count
    FROM exercise_rank_snapshots
    WHERE user_id = ${userId}
      AND tier IS NOT NULL
      AND calculated_at >= now() - interval '12 weeks'
    GROUP BY date_trunc('week', calculated_at)
    ORDER BY week_start ASC
  `;

  // Upcoming targets / examples: rank snapshot with next_threshold
  const upcomingTargets = await sql<{
    exercise_id: string;
    exercise_name: string;
    category: string;
    muscle_group: string | null;
    tracking_mode: string;
    metric: string;
    best_value: string;
    baseline_value: string;
    tier: string;
    progress_points: number;
    next_threshold: string | null;
  }[]>`
    SELECT
      e.id AS exercise_id,
      e.name AS exercise_name,
      e.category,
      e.muscle_group,
      ers.tracking_mode,
      ers.metric,
      ers.best_value::text,
      ers.baseline_value::text,
      ers.tier,
      ers.progress_points,
      ers.next_threshold::text
    FROM exercise_rank_snapshots ers
    INNER JOIN exercises e ON e.id = ers.exercise_id
    WHERE ers.user_id = ${userId}
      AND ers.is_current
      AND ers.tier IS NOT NULL
      AND ers.next_threshold IS NOT NULL
    ORDER BY ers.progress_points DESC, e.name ASC
    LIMIT 6
  `;

  return reply.send({
    categories: categoryStats.map((c) => {
      const avgRatio = c.avg_ratio != null ? Number(c.avg_ratio) : null;
      const tier = avgRatio != null ? scoreExerciseRank(1, avgRatio).tier : null;
      return {
        category: c.category,
        rankedCount: c.ranked_count,
        totalCount: c.total_count,
        averageRatio: avgRatio,
        averageTier: tier,
      };
    }),
    tierDistribution: distributionRows.map((d) => ({
      tier: d.tier,
      count: d.count,
    })),
    weeklyRankUps: weeklyRankUps.map((w) => ({
      weekStart: w.week_start,
      count: w.rank_up_count,
    })),
    upcomingTargets: upcomingTargets.map((t) => ({
      exerciseId: t.exercise_id,
      exerciseName: t.exercise_name,
      category: t.category,
      muscleGroup: t.muscle_group,
      trackingMode: t.tracking_mode,
      metric: t.metric,
      currentValue: Number(t.best_value),
      baselineValue: Number(t.baseline_value),
      tier: t.tier,
      progressPoints: t.progress_points,
      nextThreshold: t.next_threshold != null ? Number(t.next_threshold) : null,
    })),
  });
});

app.post('/v1/sessions', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = startSessionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid session payload.' });
  const [day] = await sql<{ routine_id: string }[]>`
    SELECT rd.routine_id FROM routine_days rd
    INNER JOIN routines r ON r.id = rd.routine_id
    WHERE rd.id = ${parsed.data.routineDayId} AND r.user_id = ${userId} LIMIT 1
  `;
  if (!day) return reply.code(404).send({ error: 'Workout day not found.' });
  const result = await startActiveWorkout(
    userId, day.routine_id, parsed.data.routineDayId, 'plan_day',
    parseStartedAt(parsed.data.startedAtDate),
  );
  if (result.activeSessionId) return reply.code(409).send({
    code: 'active_session_exists',
    error: 'Resume your existing workout.',
    activeSessionId: result.activeSessionId,
  });
  return reply.code(201).send({ session: { id: result.session!.id, startedAt: result.session!.started_at, origin: 'plan_day' } });
});

app.post('/v1/sessions/freeform', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const result = await startActiveWorkout(userId, null, null, 'freeform', new Date());
  if (result.activeSessionId) return reply.code(409).send({
    code: 'active_session_exists',
    error: 'Resume your existing workout.',
    activeSessionId: result.activeSessionId,
  });
  return reply.code(201).send({ session: { id: result.session!.id, startedAt: result.session!.started_at, origin: 'freeform' } });
});

app.get('/v1/sessions/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });

  const [session] = await sql<{ id: string; status: string; origin: string; started_at: Date; ended_at: Date | null; routine_id: string | null; routine_name: string | null; day_name: string | null; routine_day_id: string | null }[]>`
    SELECT ws.id, ws.status, ws.origin, ws.started_at, ws.ended_at, ws.routine_id, ws.routine_day_id, r.name AS routine_name, rd.day_name
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
    WHERE ws.id = ${params.data.id} AND ws.user_id = ${userId} LIMIT 1
  `;
  if (!session) return reply.code(404).send({ error: 'Workout session not found.' });

  const [plannedExercises, addedExercises, sets, libraryExercises, preferences] = await Promise.all([
    session.routine_day_id
      ? sql<{ id: string; name: string; category: string; muscle_group: string | null; target_sets: number | null; target_reps: number | null; target_weight: string | null; tracking_mode: string; target_duration_seconds: number | null; demo_url: string | null; demo_source_name: string | null }[]>`
          SELECT e.id, e.name, e.category, e.muscle_group, rde.target_sets, rde.target_reps, rde.target_weight,
            rde.tracking_mode, rde.target_duration_seconds,
            COALESCE(ego.gif_url, edd.demo_url) AS demo_url,
            COALESCE(ego.source_name, edd.source_name) AS demo_source_name
          FROM routine_day_exercises rde INNER JOIN exercises e ON e.id = rde.exercise_id
          LEFT JOIN exercise_gif_overrides ego ON ego.exercise_id = e.id AND ego.user_id = ${userId}
          LEFT JOIN exercise_demo_defaults edd ON edd.exercise_id = e.id
          WHERE rde.routine_day_id = ${session.routine_day_id} ORDER BY rde.sort_order ASC
        `
      : Promise.resolve([]),
    sql<{ id: string; name: string; category: string; muscle_group: string | null; target_sets: number | null; target_reps: number | null; target_weight: string | null; tracking_mode: string; target_duration_seconds: number | null; demo_url: string | null; demo_source_name: string | null }[]>`
      SELECT e.id, e.name, e.category, e.muscle_group, null::integer AS target_sets, se.target_reps, se.target_weight,
        se.tracking_mode, se.target_duration_seconds,
        COALESCE(ego.gif_url, edd.demo_url) AS demo_url,
        COALESCE(ego.source_name, edd.source_name) AS demo_source_name
      FROM session_exercises se INNER JOIN exercises e ON e.id = se.exercise_id
      LEFT JOIN exercise_gif_overrides ego ON ego.exercise_id = e.id AND ego.user_id = ${userId}
      LEFT JOIN exercise_demo_defaults edd ON edd.exercise_id = e.id
      WHERE se.session_id = ${session.id} ORDER BY se.sort_order ASC
    `,
    sql<{ id: string; exercise_id: string; set_order: number; reps: number; weight: string | null; duration_seconds: number | null; is_warmup: boolean; created_at: Date }[]>`
      SELECT id, exercise_id, set_order, reps, weight, duration_seconds, is_warmup, created_at
      FROM workout_sets WHERE session_id = ${session.id} ORDER BY set_order ASC, created_at ASC
    `,
    sql<{ id: string; name: string; category: string; muscle_group: string | null; demo_url: string | null; demo_source_name: string | null }[]>`
      SELECT e.id, e.name, e.category, e.muscle_group,
        COALESCE(ego.gif_url, edd.demo_url) AS demo_url,
        COALESCE(ego.source_name, edd.source_name) AS demo_source_name
      FROM exercises e
      LEFT JOIN exercise_gif_overrides ego ON ego.exercise_id = e.id AND ego.user_id = ${userId}
      LEFT JOIN exercise_demo_defaults edd ON edd.exercise_id = e.id
      ORDER BY e.name ASC LIMIT 300
    `,
    sql<{ weight_unit: string }[]>`SELECT weight_unit FROM user_preferences WHERE user_id = ${userId} LIMIT 1`,
  ]);

  const plannedIds = new Set(plannedExercises.map((exercise) => exercise.id));
  const sessionExercises = [...plannedExercises, ...addedExercises.filter((exercise) => !plannedIds.has(exercise.id))];
  const sessionExerciseIds = sessionExercises.map((exercise) => exercise.id);
  const repExerciseIds = sessionExercises.filter((exercise) => exercise.tracking_mode !== 'timed').map((exercise) => exercise.id);
  const timedExerciseIds = sessionExercises.filter((exercise) => exercise.tracking_mode === 'timed').map((exercise) => exercise.id);
  const previousPerformances = sessionExerciseIds.length
    ? await sql<{ exercise_id: string; started_at: Date; ordinal: number; reps: number; weight: string | null; duration_seconds: number | null }[]>`
        WITH latest_completed AS (
          SELECT DISTINCT ON (wset.exercise_id) wset.exercise_id, ws.id AS session_id, ws.started_at
          FROM workout_sets wset
          INNER JOIN workout_sessions ws ON ws.id = wset.session_id
          WHERE ws.user_id = ${userId}
            AND ws.status = 'completed'
            AND ws.id <> ${session.id}
            AND wset.is_warmup = false
            AND ((wset.duration_seconds IS NULL AND wset.exercise_id = ANY(${repExerciseIds}::uuid[]))
              OR (wset.duration_seconds IS NOT NULL AND wset.exercise_id = ANY(${timedExerciseIds}::uuid[])))
          ORDER BY wset.exercise_id, ws.started_at DESC, ws.id DESC
        )
        SELECT wset.exercise_id, latest_completed.started_at,
          row_number() OVER (PARTITION BY wset.exercise_id ORDER BY wset.created_at ASC, wset.id ASC)::int AS ordinal,
          wset.reps, wset.weight, wset.duration_seconds
        FROM workout_sets wset
        INNER JOIN latest_completed ON latest_completed.session_id = wset.session_id AND latest_completed.exercise_id = wset.exercise_id
        WHERE wset.is_warmup = false
          AND ((wset.duration_seconds IS NULL AND wset.exercise_id = ANY(${repExerciseIds}::uuid[]))
            OR (wset.duration_seconds IS NOT NULL AND wset.exercise_id = ANY(${timedExerciseIds}::uuid[])))
        ORDER BY wset.exercise_id, ordinal ASC
      `
    : [];
  return reply.send({
    session: {
      id: session.id,
      status: session.status,
      origin: session.origin,
      routineId: session.routine_id,
      routineDayId: session.routine_day_id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      routineName: session.routine_name,
      dayName: session.day_name,
      weightUnit: preferences[0]?.weight_unit === 'kg' ? 'kg' : 'lbs',
    },
    exercises: sessionExercises.map((exercise) => ({ id: exercise.id, name: exercise.name, category: exercise.category, muscleGroup: exercise.muscle_group, targetSets: exercise.target_sets, targetReps: exercise.target_reps, targetWeight: exercise.target_weight, trackingMode: exercise.tracking_mode, targetDurationSeconds: exercise.target_duration_seconds, demoUrl: exercise.demo_url, demoSourceName: exercise.demo_source_name })),
    libraryExercises: libraryExercises.map((exercise) => ({ id: exercise.id, name: exercise.name, category: exercise.category, muscleGroup: exercise.muscle_group, demoUrl: exercise.demo_url, demoSourceName: exercise.demo_source_name })),
    sets: sets.map((set) => ({ id: set.id, exerciseId: set.exercise_id, setOrder: set.set_order, reps: set.reps, weight: set.weight, durationSeconds: set.duration_seconds, isWarmup: set.is_warmup, createdAt: set.created_at })),
    previousPerformances: previousPerformances.map((set) => ({ exerciseId: set.exercise_id, startedAt: set.started_at, order: set.ordinal, reps: set.reps, weight: set.weight, durationSeconds: set.duration_seconds })),
  });
});

app.get('/v1/sessions/:id/share', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });

  const [session] = await sql<{
    id: string;
    owner_user_id: string;
    owner_username: string;
    owner_name: string | null;
    status: string;
    started_at: Date;
    ended_at: Date | null;
    routine_name: string | null;
    day_name: string | null;
  }[]>`
    SELECT ws.id, ws.user_id AS owner_user_id, u.username AS owner_username, u.name AS owner_name,
      ws.status, ws.started_at, ws.ended_at, r.name AS routine_name, rd.day_name
    FROM workout_sessions ws
    INNER JOIN users u ON u.id = ws.user_id
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
    WHERE ws.id = ${params.data.id} LIMIT 1
  `;
  if (!session) return reply.code(404).send({ error: 'Workout session not found.' });

  if (session.owner_user_id !== userId) {
    const [friendship] = await sql<{ id: string }[]>`
      SELECT id FROM friend_requests
      WHERE status = 'accepted' AND (
        (requester_id = ${userId} AND addressee_id = ${session.owner_user_id}) OR
        (addressee_id = ${userId} AND requester_id = ${session.owner_user_id})
      )
      LIMIT 1
    `;
    if (!friendship) return reply.code(404).send({ error: 'Workout session not found.' });
  }

  const [sets, preferences] = await Promise.all([
    sql<{ id: string; set_order: number; reps: number; weight: string | null; duration_seconds: number | null; is_warmup: boolean; exercise_name: string }[]>`
      SELECT wset.id, wset.set_order, wset.reps, wset.weight, wset.duration_seconds, wset.is_warmup, e.name AS exercise_name
      FROM workout_sets wset
      INNER JOIN exercises e ON e.id = wset.exercise_id
      WHERE wset.session_id = ${session.id}
      ORDER BY wset.set_order ASC, wset.created_at ASC
    `,
    sql<{ weight_unit: string }[]>`SELECT weight_unit FROM user_preferences WHERE user_id = ${session.owner_user_id} LIMIT 1`,
  ]);

  return reply.send({
    owner: { id: session.owner_user_id, username: session.owner_username, name: session.owner_name },
    session: {
      id: session.id,
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      routineName: session.routine_name,
      dayName: session.day_name,
      weightUnit: preferences[0]?.weight_unit === 'kg' ? 'kg' : 'lbs',
    },
    sets: sets.map((set) => ({
      id: set.id,
      order: set.set_order,
      reps: set.reps,
      weight: set.weight,
      durationSeconds: set.duration_seconds,
      isWarmup: set.is_warmup,
      exerciseName: set.exercise_name,
    })),
  });
});

app.post('/v1/sessions/:id/exercises', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = sessionExerciseSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid session exercise payload.' });
  const [session, exercise] = await Promise.all([
    sql<{ id: string; routine_day_id: string | null; status: string }[]>`
      SELECT id, routine_day_id, status FROM workout_sessions
      WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1
    `,
    sql<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
      SELECT id, name, category, muscle_group FROM exercises WHERE id = ${parsed.data.exerciseId} LIMIT 1
    `,
  ]);
  const currentSession = session[0];
  if (!currentSession) return reply.code(404).send({ error: 'Workout session not found.' });
  if (currentSession.status !== 'active') return reply.code(409).send({ error: 'Only active sessions can be changed.' });
  const selectedExercise = exercise[0];
  if (!selectedExercise) return reply.code(404).send({ error: 'Exercise not found.' });
  const [entry] = await sql<{ id: string }[]>`
    INSERT INTO session_exercises (id, session_id, exercise_id, sort_order, target_reps, target_weight, created_at)
    VALUES (
      ${randomUUID()}, ${currentSession.id}, ${selectedExercise.id},
      (SELECT coalesce(max(sort_order), -1) + 1 FROM session_exercises WHERE session_id = ${currentSession.id}),
      ${parsed.data.targetReps ?? null}, ${parsed.data.targetWeight?.toString() ?? null}, now()
    )
    ON CONFLICT (session_id, exercise_id) DO UPDATE SET
      target_reps = coalesce(EXCLUDED.target_reps, session_exercises.target_reps),
      target_weight = coalesce(EXCLUDED.target_weight, session_exercises.target_weight)
    RETURNING id
  `;
  return reply.code(201).send({
    entry: {
      id: entry.id,
      exerciseId: selectedExercise.id,
      name: selectedExercise.name,
      category: selectedExercise.category,
      muscleGroup: selectedExercise.muscle_group,
    },
  });
});

app.post('/v1/sessions/:id/calistree-exercises', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = calistreeImportSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid exercise payload.' });

  let metadata;
  try {
    metadata = await getCalistreeExerciseMetadata({ slug: parsed.data.slug });
  } catch (error) {
    request.log.error(error, 'Calistree exercise import lookup failed');
    return reply.code(502).send({ error: 'The exercise catalog is unavailable right now. Try again shortly.' });
  }
  if (!metadata) return reply.code(404).send({ error: 'No matching exercise was found.' });

  const result = await sql.begin(async (transaction) => {
    const [session] = await transaction<{ id: string; status: string }[]>`
      SELECT id, status FROM workout_sessions WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1
    `;
    if (!session) return { kind: 'missing-session' as const };
    if (session.status !== 'active') return { kind: 'inactive-session' as const };

    const [existing] = await transaction<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
      SELECT id, name, category, muscle_group FROM exercises
      WHERE lower(name) = lower(${metadata.name}) LIMIT 1
    `;
    const exercise = existing ?? (await transaction<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
      INSERT INTO exercises (id, name, category, muscle_group, created_by_user_id, created_at)
      VALUES (${randomUUID()}, ${metadata.name}, ${metadata.category}, ${metadata.muscleGroup}, ${userId}, now())
      RETURNING id, name, category, muscle_group
    `)[0];

    const sourceName = JSON.stringify({ provider: 'Exercise catalog', sourceUrl: metadata.sourceUrl, importedAt: new Date().toISOString() });
    if (metadata.videoUrl) {
      await transaction`
        INSERT INTO exercise_gif_overrides (id, user_id, exercise_id, gif_url, source_name, created_at, updated_at)
        VALUES (${randomUUID()}, ${userId}, ${exercise.id}, ${metadata.videoUrl}, ${sourceName}, now(), now())
        ON CONFLICT (user_id, exercise_id) DO UPDATE
          SET gif_url = EXCLUDED.gif_url, source_name = EXCLUDED.source_name, updated_at = now()
      `;
    }

    const [entry] = await transaction<{ id: string }[]>`
      INSERT INTO session_exercises (id, session_id, exercise_id, sort_order, target_reps, target_weight, created_at)
      VALUES (
        ${randomUUID()}, ${session.id}, ${exercise.id},
        (SELECT coalesce(max(sort_order), -1) + 1 FROM session_exercises WHERE session_id = ${session.id}),
        null, null, now()
      )
      ON CONFLICT (session_id, exercise_id) DO UPDATE SET exercise_id = EXCLUDED.exercise_id
      RETURNING id
    `;
    return { kind: 'created' as const, entry, exercise, sourceName: metadata.videoUrl ? sourceName : null, videoUrl: metadata.videoUrl };
  });

  if (result.kind === 'missing-session') return reply.code(404).send({ error: 'Workout session not found.' });
  if (result.kind === 'inactive-session') return reply.code(409).send({ error: 'Only active sessions can be changed.' });
  return reply.code(201).send({
    entry: { id: result.entry.id, exerciseId: result.exercise.id, name: result.exercise.name, category: result.exercise.category, muscleGroup: result.exercise.muscle_group },
    exercise: {
      id: result.exercise.id,
      name: result.exercise.name,
      category: result.exercise.category,
      muscleGroup: result.exercise.muscle_group,
      demoUrl: result.videoUrl,
      demoSourceName: result.sourceName,
    },
  });
});

app.post('/v1/sessions/:id/sets', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = workoutSetSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout set payload.' });
  const timed = parsed.data.durationSeconds != null;
  const [session, exercise, previousSets] = await Promise.all([
    sql<{ id: string; status: string; tracking_mode: string }[]>`
      SELECT ws.id, ws.status,
        coalesce(rde.tracking_mode, se.tracking_mode, 'reps') AS tracking_mode
      FROM workout_sessions ws
      LEFT JOIN routine_day_exercises rde
        ON rde.routine_day_id = ws.routine_day_id AND rde.exercise_id = ${parsed.data.exerciseId}
      LEFT JOIN session_exercises se
        ON se.session_id = ws.id AND se.exercise_id = ${parsed.data.exerciseId}
      WHERE ws.id = ${params.data.id} AND ws.user_id = ${userId}
      LIMIT 1
    `,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM exercises WHERE id = ${parsed.data.exerciseId} LIMIT 1`,
    parsed.data.isWarmup || timed
      ? Promise.resolve([] as PersonalRecordSet[])
      : sql<PersonalRecordSet[]>`
          SELECT wset.reps, wset.weight
          FROM workout_sets wset
          INNER JOIN workout_sessions ws ON ws.id = wset.session_id
          WHERE ws.user_id = ${userId} AND wset.exercise_id = ${parsed.data.exerciseId}
            AND wset.is_warmup = false AND wset.duration_seconds IS NULL
        `,
  ]);
  const currentSession = session[0];
  if (!currentSession) return reply.code(404).send({ error: 'Workout session not found.' });
  if (currentSession.status !== 'active') return reply.code(409).send({ error: 'Only active sessions can be logged.' });
  if ((currentSession.tracking_mode === 'timed') !== timed) {
    return reply.code(400).send({ error: 'The set input must match the exercise tracking mode.' });
  }
  if (!exercise[0]) return reply.code(404).send({ error: 'Exercise not found.' });
  const [inserted] = await sql<{ id: string; set_order: number; created_at: Date }[]>`
    INSERT INTO workout_sets (id, session_id, exercise_id, set_order, reps, weight, duration_seconds, is_warmup, client_operation_id, created_at)
    VALUES (
      ${randomUUID()}, ${currentSession.id}, ${parsed.data.exerciseId},
      (SELECT coalesce(max(set_order), 0) + 1 FROM workout_sets WHERE session_id = ${currentSession.id}),
      ${timed ? 1 : parsed.data.reps!}, ${timed ? null : parsed.data.weight?.toString() ?? null}, ${parsed.data.durationSeconds ?? null}, ${parsed.data.isWarmup ?? false}, ${parsed.data.clientOperationId ?? null}, now()
    )
    ON CONFLICT (session_id, client_operation_id) WHERE client_operation_id IS NOT NULL DO NOTHING
    RETURNING id, set_order, created_at
  `;
  if (!inserted) {
    const [existing] = await sql<{ id: string; exercise_id: string; set_order: number; reps: number; weight: string | null; duration_seconds: number | null; is_warmup: boolean; created_at: Date }[]>`
      SELECT wset.id, wset.exercise_id, wset.set_order, wset.reps, wset.weight, wset.duration_seconds, wset.is_warmup, wset.created_at
      FROM workout_sets wset
      WHERE wset.session_id = ${currentSession.id}
        AND wset.client_operation_id = ${parsed.data.clientOperationId!}
      LIMIT 1
    `;
    if (!existing) return reply.code(409).send({ error: 'The set could not be reconciled. Retry the sync.' });
    return reply.send({
      set: { id: existing.id, exerciseId: existing.exercise_id, setOrder: existing.set_order, reps: existing.reps, weight: existing.weight, durationSeconds: existing.duration_seconds, isWarmup: existing.is_warmup, createdAt: existing.created_at },
      personalRecord: null,
      idempotent: true,
      clientOperationId: parsed.data.clientOperationId,
    });
  }
  const set = inserted;
  const personalRecord = parsed.data.isWarmup || timed
    ? null
    : detectPersonalRecord(
        { reps: parsed.data.reps!, weight: parsed.data.weight?.toString() ?? null },
        previousSets,
        exercise[0].name,
      );
  await recordProgressionEvent(sql, userId, 'workout_set_logged', 'workout_set', set.id, {
    sessionId: currentSession.id,
    exerciseId: parsed.data.exerciseId,
    isWarmup: parsed.data.isWarmup ?? false,
  });
  await evaluateArcanaForUser(sql, userId);
  return reply.code(201).send({
    set: { id: set.id, exerciseId: parsed.data.exerciseId, setOrder: set.set_order, reps: timed ? 1 : parsed.data.reps, weight: timed ? null : parsed.data.weight ?? null, durationSeconds: parsed.data.durationSeconds ?? null, isWarmup: parsed.data.isWarmup ?? false, createdAt: set.created_at },
    personalRecord,
    clientOperationId: parsed.data.clientOperationId ?? null,
  });
});

app.patch('/v1/sets/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = workoutSetSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout set payload.' });
  const timed = parsed.data.durationSeconds != null;
  const [updated] = await sql<{ id: string; session_id: string; exercise_id: string; status: string }[]>`
    UPDATE workout_sets wset SET exercise_id = ${parsed.data.exerciseId}, reps = ${timed ? 1 : parsed.data.reps!}, weight = ${timed ? null : parsed.data.weight?.toString() ?? null}, duration_seconds = ${parsed.data.durationSeconds ?? null}, is_warmup = ${parsed.data.isWarmup ?? false}
    FROM workout_sessions ws
    WHERE wset.id = ${params.data.id} AND wset.session_id = ws.id AND ws.user_id = ${userId}
    RETURNING wset.id, wset.session_id, wset.exercise_id, ws.status
  `;
  if (!updated) return reply.code(404).send({ error: 'Workout set not found.' });
  await recordProgressionEvent(sql, userId, 'workout_set_updated', 'workout_set', updated.id, { sessionId: updated.session_id });
  await evaluateArcanaForUser(sql, userId);
  if (updated.status === 'completed') await recomputeExerciseRanks(sql, userId, [updated.exercise_id, parsed.data.exerciseId]);
  return reply.send({ set: { id: updated.id, sessionId: updated.session_id } });
});

app.delete('/v1/sets/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid workout set id.' });
  const result = await sql.begin(async (transaction) => {
    const [ownedSet] = await transaction<{ id: string; session_id: string; exercise_id: string; status: string }[]>`
      SELECT wset.id, wset.session_id, wset.exercise_id, ws.status FROM workout_sets wset
      INNER JOIN workout_sessions ws ON ws.id = wset.session_id
      WHERE wset.id = ${params.data.id} AND ws.user_id = ${userId} LIMIT 1
    `;
    if (!ownedSet) return null;
    await transaction`DELETE FROM workout_sets WHERE id = ${ownedSet.id}`;
    const remaining = await transaction<{ id: string }[]>`SELECT id FROM workout_sets WHERE session_id = ${ownedSet.session_id} ORDER BY set_order ASC, created_at ASC`;
    for (const [index, set] of remaining.entries()) {
      await transaction`UPDATE workout_sets SET set_order = ${index + 1} WHERE id = ${set.id}`;
    }
    return ownedSet;
  });
  if (!result) return reply.code(404).send({ error: 'Workout set not found.' });
  await recordProgressionEvent(sql, userId, 'workout_set_deleted', 'workout_set', result.id, { sessionId: result.session_id });
  await evaluateArcanaForUser(sql, userId);
  if (result.status === 'completed') await recomputeExerciseRanks(sql, userId, [result.exercise_id]);
  return reply.code(204).send();
});

app.post('/v1/sessions/:id/complete', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });
  const [updated] = await sql<{ id: string; ended_at: Date }[]>`
    UPDATE workout_sessions SET status = 'completed', ended_at = now()
    WHERE id = ${params.data.id} AND user_id = ${userId}
    RETURNING id, ended_at
  `;
  if (!updated) return reply.code(404).send({ error: 'Workout session not found.' });
  await recordProgressionEvent(sql, userId, 'workout_session_completed', 'workout_session', updated.id, { endedAt: updated.ended_at });
  await evaluateArcanaForUser(sql, userId);
  const exerciseIds = await sql<{ exercise_id: string }[]>`SELECT DISTINCT exercise_id FROM workout_sets WHERE session_id = ${updated.id} AND is_warmup = false`;
  const rankUpdates = await recomputeExerciseRanks(sql, userId, exerciseIds.map((row) => row.exercise_id));

  // XP progression calculation (Transmute v1 rules)
  // 1. Qualified completed session (>=3 working sets) earns 100 XP
  // 2. Each of the first 10 working sets earns 10 XP (up to 100 XP)
  // 3. First tier promotion in this session earns 50 XP
  const workingSets = await sql<{ id: string; exercise_id: string }[]>`
    SELECT id, exercise_id FROM workout_sets
    WHERE session_id = ${updated.id} AND is_warmup = false
    ORDER BY set_order ASC LIMIT 10
  `;
  const completionDate = updated.ended_at.toISOString().slice(0, 10);
  if (workingSets.length >= 3) {
    await awardXp(
      sql,
      userId,
      'workout_session',
      updated.id,
      100,
      'Completed qualified workout',
      completionDate,
      { sessionId: updated.id, workingSetCount: workingSets.length },
    );
  }
  for (const set of workingSets) {
    await awardXp(
      sql,
      userId,
      'workout_set',
      set.id,
      10,
      'Completed working set',
      completionDate,
      { sessionId: updated.id, setId: set.id },
    );
  }
  if (rankUpdates.some((u) => u.established)) {
    await awardXp(
      sql,
      userId,
      'tier_promotion',
      updated.id,
      50,
      'Promoted exercise tier',
      completionDate,
      { sessionId: updated.id },
    );
  }

  await recomputeStreaksForUser(sql, userId);

  return reply.send({ session: { id: updated.id, status: 'completed', endedAt: updated.ended_at }, rankUpdates });
});

app.delete('/v1/sessions/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });
  const [deleted] = await sql<{ id: string }[]>`DELETE FROM workout_sessions WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING id`;
  if (!deleted) return reply.code(404).send({ error: 'Workout session not found.' });
  await recomputeExerciseRanks(sql, userId);
  await recomputeStreaksForUser(sql, userId);
  return reply.code(204).send();
});

app.get('/v1/barcodes/:code', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = barcodeParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Enter an 8–14 digit barcode.' });
  const [localFood] = await sql<{
    id: string;
    name: string;
    barcode_upc: string | null;
    serving_size_g: string | null;
    serving_size_unit: ServingUnit | null;
    serving_size_text: string | null;
    calories_kcal: number;
    protein_g: string;
    carbs_g: string;
    fat_g: string;
  }[]>`
    SELECT id, name, barcode_upc, serving_size_g, serving_size_unit, serving_size_text, calories_kcal, protein_g, carbs_g, fat_g
    FROM foods WHERE barcode_upc = ${params.data.code} LIMIT 1
  `;
  if (localFood) {
    return reply.send({
      found: true,
      source: 'local',
      food: {
        id: localFood.id,
        name: localFood.name,
        barcodeUpc: localFood.barcode_upc,
        servingSizeValue: localFood.serving_size_g ? numericValue(localFood.serving_size_g) : null,
        servingSizeUnit: localFood.serving_size_unit ?? 'g',
        servingSizeText: localFood.serving_size_text,
        caloriesKcal: localFood.calories_kcal,
        proteinG: numericValue(localFood.protein_g),
        carbsG: numericValue(localFood.carbs_g),
        fatG: numericValue(localFood.fat_g),
      },
    });
  }
  // The scanner gives us a numeric barcode; send only that number to the
  // existing AI worker. Open Food Facts remains a provider fallback.
  const aiLookup = await lookupBarcodeWithAi(params.data.code, request.log);
  if (aiLookup.found) return reply.send(aiLookup);
  return reply.send(await lookupOpenFoodFacts(params.data.code));
});

app.post('/v1/nutrition-label/parse', { bodyLimit: 13 * 1024 * 1024 }, async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = nutritionLabelOcrSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Choose a readable nutrition-label image smaller than 9 MB.' });
  const encoded = parsed.data.imageBase64.replace(/^data:[^;]+;base64,/, '');

  if (env.AI_WORKOUT_WORKER_URL && env.AI_WORKOUT_WORKER_TOKEN) {
    try {
      const response = await requestAiNutritionLabel({
        workerUrl: env.AI_WORKOUT_WORKER_URL,
        workerToken: env.AI_WORKOUT_WORKER_TOKEN,
        imageBase64: encoded,
      });
      const label = parseAiNutritionLabel(response);
      return reply.send({
        ok: true,
        source: 'ai',
        parsed: {
          name: label.name,
          servingSizeText: label.servingSizeText,
          servingSizeValue: label.servingSizeValue,
          servingSizeUnit: label.servingSizeUnit,
          servingsPerContainer: null,
          caloriesKcal: label.caloriesKcal,
          proteinG: label.proteinG,
          carbsG: label.carbsG,
          fatG: label.fatG,
          parseConfidence: label.confidence,
          rawText: '',
        },
      });
    } catch (error) {
      request.log.warn(error, 'Nutrition-label AI extraction failed; falling back to OCR');
    }
  }

  let worker: Worker | null = null;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');
    const result = await worker.recognize(Buffer.from(encoded, 'base64'));
    const rawText = result.data.text.trim();
    if (!rawText) return reply.code(422).send({ error: 'No readable nutrition text was found in that image.' });
    return reply.send({ ok: true, source: 'ocr', parsed: parseNutritionLabel(rawText, result.data.confidence / 100) });
  } catch (error) {
    request.log.error(error, 'Nutrition-label OCR failed');
    return reply.code(422).send({ error: 'The nutrition label could not be read. Try a clearer, tightly cropped photo.' });
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
});

app.post('/v1/nutrition-photo/analyze', { bodyLimit: 13 * 1024 * 1024 }, async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = nutritionLabelOcrSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Choose a readable food photo smaller than 9 MB.' });
  const encoded = parsed.data.imageBase64.replace(/^data:[^;]+;base64,/, '');

  if (env.AI_WORKOUT_WORKER_URL && env.AI_WORKOUT_WORKER_TOKEN) {
    try {
      const response = await requestAiFoodPhoto({
        workerUrl: env.AI_WORKOUT_WORKER_URL,
        workerToken: env.AI_WORKOUT_WORKER_TOKEN,
        imageBase64: encoded,
      });
      const analysis = parseAiFoodPhotoAnalysis(response);
      return reply.send({
        source: 'ai',
        suggestedPortionGrams: analysis.suggestedPortionGrams,
        candidates: analysis.candidates,
      });
    } catch (error) {
      request.log.warn(error, 'Food-photo AI analysis failed; falling back to heuristic candidate');
    }
  }

  // Fallback heuristic candidate if AI worker is not configured or fails
  return reply.send({
    source: 'simulation',
    suggestedPortionGrams: 250,
    candidates: [
      {
        name: 'Mixed plate',
        caloriesKcal: 380,
        proteinG: 28,
        carbsG: 35,
        fatG: 14,
        servingSizeValue: 250,
        servingSizeUnit: 'g',
        servingSizeText: '250 g portion',
        confidence: 0.70,
        estimatedPortionGrams: 250,
      },
    ],
  });
});

app.post('/v1/foods', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = foodSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid food payload.' });
  const servingSizeValue = parsed.data.servingSizeValue ?? parsed.data.servingSizeG;
  const servingSizeUnit = parsed.data.servingSizeUnit ?? 'g';
  const servingSizeText = parsed.data.servingSizeText ?? (servingSizeValue ? `${servingSizeValue} ${servingSizeUnit}` : null);
  try {
    const [food] = await sql<{ id: string; name: string; calories_kcal: number; protein_g: string; carbs_g: string; fat_g: string }[]>`
      INSERT INTO foods (id, name, barcode_upc, calories_kcal, serving_size_g, serving_size_unit, serving_size_text, protein_g, carbs_g, fat_g, created_by_user_id, created_at)
      VALUES (${randomUUID()}, ${parsed.data.name}, ${parsed.data.barcodeUpc ?? null}, ${parsed.data.caloriesKcal}, ${servingSizeValue?.toString() ?? null}, ${servingSizeUnit}, ${servingSizeText}, ${parsed.data.proteinG?.toString() ?? '0'}, ${parsed.data.carbsG?.toString() ?? '0'}, ${parsed.data.fatG?.toString() ?? '0'}, ${userId}, now())
      RETURNING id, name, calories_kcal, protein_g, carbs_g, fat_g
    `;
    return reply.code(201).send({ food });
  } catch (error) {
    if (error instanceof postgres.PostgresError && error.code === '23505') return reply.code(409).send({ error: 'That barcode already belongs to a food.' });
    throw error;
  }
});

app.post('/v1/meals', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = mealSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid meal payload.' });
  const foodIds = [...new Set(parsed.data.items.map((item) => item.foodId))];
  const foods = await sql<{ id: string }[]>`
    SELECT id FROM foods WHERE id = ANY(${foodIds}::uuid[])
  `;
  if (foods.length !== foodIds.length) return reply.code(404).send({ error: 'One or more foods could not be found.' });
  const consumedAt = parsed.data.consumedAt ? new Date(parsed.data.consumedAt) : new Date();
  const meals = await sql.begin(async (transaction) => {
    const created: Array<{ id: string; consumed_at: Date }> = [];
    for (const item of parsed.data.items) {
      const [meal] = await transaction<{ id: string; consumed_at: Date }[]>`
        INSERT INTO meal_logs (id, user_id, food_id, quantity, meal_type, consumed_at)
        VALUES (${randomUUID()}, ${userId}, ${item.foodId}, ${item.grams.toString()}, ${parsed.data.mealType}, ${consumedAt})
        RETURNING id, consumed_at
      `;
      created.push(meal);
    }
    return created;
  });
  await Promise.all(meals.map((meal) => recordProgressionEvent(sql, userId, 'meal_logged', 'meal_log', meal.id, { mealType: parsed.data.mealType, consumedAt: meal.consumed_at })));
  await evaluateArcanaForUser(sql, userId);
  return reply.code(201).send({ meals: meals.map((meal) => ({ id: meal.id, consumedAt: meal.consumed_at })) });
});

app.patch('/v1/meals/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = mealUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid meal update payload.' });

  const [meal] = await sql<{ id: string }[]>`
    UPDATE meal_logs
    SET quantity = ${parsed.data.grams.toString()}, meal_type = ${parsed.data.mealType}, consumed_at = ${new Date(parsed.data.consumedAt)}
    WHERE id = ${params.data.id} AND user_id = ${userId}
    RETURNING id
  `;
  if (!meal) return reply.code(404).send({ error: 'Logged food not found.' });
  await recordProgressionEvent(sql, userId, 'meal_updated', 'meal_log', meal.id, { mealType: parsed.data.mealType });
  await evaluateArcanaForUser(sql, userId);
  return reply.send({ meal: { id: meal.id } });
});

app.delete('/v1/meals/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid logged food id.' });

  const deleted = await sql.begin(async (transaction) => {
    const [meal] = await transaction<{ id: string }[]>`
      SELECT id FROM meal_logs WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1
    `;
    if (!meal) return null;
    const photos = await transaction<{ object_key: string }[]>`
      DELETE FROM uploads
      WHERE user_id = ${userId} AND entity_type = 'meal_log_photo' AND entity_id = ${meal.id}
      RETURNING object_key
    `;
    await transaction`DELETE FROM meal_logs WHERE id = ${meal.id}`;
    return photos;
  });
  if (!deleted) return reply.code(404).send({ error: 'Logged food not found.' });

  await Promise.all(
    deleted.map((photo) => storage.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: photo.object_key })).catch(() => undefined)),
  );
  await recordProgressionEvent(sql, userId, 'meal_deleted', 'meal_log', params.data.id, {});
  await evaluateArcanaForUser(sql, userId);
  return reply.code(204).send();
});

app.get('/v1/nutrition/targets', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const [target] = await sql<{
    id: string;
    calories_target: number;
    protein_g_target: string;
    carbs_g_target: string;
    fat_g_target: string;
    effective_date: string;
  }[]>`
    SELECT id, calories_target, protein_g_target, carbs_g_target, fat_g_target, effective_date::text
    FROM daily_nutrition_targets
    WHERE user_id = ${userId}
    ORDER BY effective_date DESC, created_at DESC
    LIMIT 1
  `;

  if (!target) {
    return reply.send({ target: null });
  }

  return reply.send({
    target: {
      id: target.id,
      caloriesTarget: target.calories_target,
      proteinGTarget: parseFloat(target.protein_g_target),
      carbsGTarget: parseFloat(target.carbs_g_target),
      fatGTarget: parseFloat(target.fat_g_target),
      effectiveDate: target.effective_date,
    },
  });
});

app.post('/v1/nutrition/targets', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = nutritionTargetInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid target payload.' });

  const effectiveDate = parsed.data.effectiveDate || new Date().toISOString().substring(0, 10);

  const [saved] = await sql<{
    id: string;
    calories_target: number;
    protein_g_target: string;
    carbs_g_target: string;
    fat_g_target: string;
    effective_date: string;
  }[]>`
    INSERT INTO daily_nutrition_targets (
      user_id, calories_target, protein_g_target, carbs_g_target, fat_g_target, effective_date
    )
    VALUES (
      ${userId},
      ${parsed.data.caloriesTarget},
      ${parsed.data.proteinGTarget.toString()},
      ${parsed.data.carbsGTarget.toString()},
      ${parsed.data.fatGTarget.toString()},
      ${effectiveDate}
    )
    ON CONFLICT (user_id, effective_date)
    DO UPDATE SET
      calories_target = EXCLUDED.calories_target,
      protein_g_target = EXCLUDED.protein_g_target,
      carbs_g_target = EXCLUDED.carbs_g_target,
      fat_g_target = EXCLUDED.fat_g_target,
      created_at = now()
    RETURNING id, calories_target, protein_g_target, carbs_g_target, fat_g_target, effective_date::text
  `;

  return reply.code(201).send({
    target: {
      id: saved.id,
      caloriesTarget: saved.calories_target,
      proteinGTarget: parseFloat(saved.protein_g_target),
      carbsGTarget: parseFloat(saved.carbs_g_target),
      fatGTarget: parseFloat(saved.fat_g_target),
      effectiveDate: saved.effective_date,
    },
  });
});

app.get('/v1/nutrition/diary', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = nutritionDiaryQuerySchema.safeParse(request.query);
  const targetDate = parsed.success && parsed.data.date ? parsed.data.date : new Date().toISOString().substring(0, 10);

  // Fetch effective target on or before targetDate
  const [targetRow] = await sql<{
    id: string;
    calories_target: number;
    protein_g_target: string;
    carbs_g_target: string;
    fat_g_target: string;
    effective_date: string;
  }[]>`
    SELECT id, calories_target, protein_g_target, carbs_g_target, fat_g_target, effective_date::text
    FROM daily_nutrition_targets
    WHERE user_id = ${userId} AND effective_date <= ${targetDate}
    ORDER BY effective_date DESC, created_at DESC
    LIMIT 1
  `;

  // Fetch user timezone from preferences for local date grouping
  const [pref] = await sql<{ timezone?: string | null }[]>`
    SELECT timezone FROM user_preferences WHERE user_id = ${userId} LIMIT 1
  `;
  const tz = pref?.timezone || 'UTC';

  // Query meal logs for the given local date
  const mealRows = await sql<{
    id: string;
    meal_type: string;
    quantity: string;
    consumed_at: Date;
    food_id: string;
    food_name: string;
    calories_kcal: number;
    protein_g: string;
    carbs_g: string;
    fat_g: string;
    serving_size_g: string | null;
    serving_size_unit: string | null;
    serving_size_text: string | null;
  }[]>`
    SELECT
      ml.id,
      ml.meal_type,
      ml.quantity,
      ml.consumed_at,
      f.id AS food_id,
      f.name AS food_name,
      f.calories_kcal,
      f.protein_g,
      f.carbs_g,
      f.fat_g,
      f.serving_size_g,
      f.serving_size_unit,
      f.serving_size_text
    FROM meal_logs ml
    JOIN foods f ON f.id = ml.food_id
    WHERE ml.user_id = ${userId}
      AND (ml.consumed_at AT TIME ZONE ${tz})::date = ${targetDate}::date
    ORDER BY ml.consumed_at ASC
  `;

  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  const meals = mealRows.map((row) => {
    const qty = parseFloat(row.quantity) || 1;
    const servingG = row.serving_size_g ? parseFloat(row.serving_size_g) : 100;
    const scale = servingG > 0 ? qty / servingG : 1;
    const cals = Math.round(row.calories_kcal * scale);
    const protein = parseFloat((parseFloat(row.protein_g) * scale).toFixed(1));
    const carbs = parseFloat((parseFloat(row.carbs_g) * scale).toFixed(1));
    const fat = parseFloat((parseFloat(row.fat_g) * scale).toFixed(1));

    totalCalories += cals;
    totalProtein += protein;
    totalCarbs += carbs;
    totalFat += fat;

    return {
      id: row.id,
      foodId: row.food_id,
      foodName: row.food_name,
      mealType: row.meal_type,
      grams: qty,
      consumedAt: row.consumed_at.toISOString(),
      caloriesKcal: cals,
      proteinG: protein,
      carbsG: carbs,
      fatG: fat,
      servingSizeValue: row.serving_size_g ? parseFloat(row.serving_size_g) : null,
      servingSizeUnit: row.serving_size_unit,
      servingSizeText: row.serving_size_text,
    };
  });

  const target = targetRow
    ? {
        id: targetRow.id,
        caloriesTarget: targetRow.calories_target,
        proteinGTarget: parseFloat(targetRow.protein_g_target),
        carbsGTarget: parseFloat(targetRow.carbs_g_target),
        fatGTarget: parseFloat(targetRow.fat_g_target),
        effectiveDate: targetRow.effective_date,
      }
    : null;

  const remainingCalories = target ? target.caloriesTarget - totalCalories : null;

  return reply.send({
    date: targetDate,
    target,
    consumed: {
      calories: totalCalories,
      proteinG: parseFloat(totalProtein.toFixed(1)),
      carbsG: parseFloat(totalCarbs.toFixed(1)),
      fatG: parseFloat(totalFat.toFixed(1)),
    },
    remainingCalories,
    meals,
  });
});

app.get('/v1/recipes', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = recipesQuerySchema.safeParse(request.query);
  const q = parsed.success && parsed.data.query ? `%${parsed.data.query.toLowerCase()}%` : null;

  const rows = await sql<{
    id: string;
    title: string;
    description: string;
    author_name: string;
    servings: number;
    serving_calories_kcal: number;
    serving_protein_g: string;
    serving_carbs_g: string;
    serving_fat_g: string;
    serving_size_g: string;
    serving_size_unit: string;
    image_url: string | null;
    instructions: string[] | string;
    version: number;
    is_curated: boolean;
  }[]>`
    SELECT id, title, description, author_name, servings,
      serving_calories_kcal, serving_protein_g, serving_carbs_g, serving_fat_g,
      serving_size_g, serving_size_unit, image_url, instructions, version, is_curated
    FROM recipes
    WHERE (${q}::text IS NULL OR lower(title) LIKE ${q}::text OR lower(description) LIKE ${q}::text)
    ORDER BY is_curated DESC, title ASC
    LIMIT 50
  `;

  const recipeIds = rows.map((r) => r.id);
  const ingredientRows = recipeIds.length > 0
    ? await sql<{
        recipe_id: string;
        name: string;
        amount: string;
        unit: string;
        sort_order: number;
      }[]>`
        SELECT recipe_id, name, amount, unit, sort_order
        FROM recipe_ingredients
        WHERE recipe_id = ANY(${recipeIds}::uuid[])
        ORDER BY sort_order ASC
      `
    : [];

  const ingredientsByRecipe: Record<string, Array<{ name: string; amount: number; unit: string }>> = {};
  for (const ing of ingredientRows) {
    if (!ingredientsByRecipe[ing.recipe_id]) ingredientsByRecipe[ing.recipe_id] = [];
    ingredientsByRecipe[ing.recipe_id].push({
      name: ing.name,
      amount: parseFloat(ing.amount),
      unit: ing.unit,
    });
  }

  const recipes = rows.map((r) => {
    let instructionsList: string[] = [];
    if (Array.isArray(r.instructions)) {
      instructionsList = r.instructions;
    } else if (typeof r.instructions === 'string') {
      try { instructionsList = JSON.parse(r.instructions); } catch { instructionsList = []; }
    }

    return {
      id: r.id,
      title: r.title,
      description: r.description,
      authorName: r.author_name,
      servings: r.servings,
      servingCaloriesKcal: r.serving_calories_kcal,
      servingProteinG: parseFloat(r.serving_protein_g),
      servingCarbsG: parseFloat(r.serving_carbs_g),
      servingFatG: parseFloat(r.serving_fat_g),
      servingSizeGrams: parseFloat(r.serving_size_g),
      servingSizeUnit: r.serving_size_unit,
      imageUrl: r.image_url,
      ingredients: ingredientsByRecipe[r.id] ?? [],
      instructions: instructionsList,
      version: r.version,
      isCurated: r.is_curated,
    };
  });

  return reply.send({ recipes });
});

app.get('/v1/recipes/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid recipe id.' });

  const [recipeRow] = await sql<{
    id: string;
    title: string;
    description: string;
    author_name: string;
    servings: number;
    serving_calories_kcal: number;
    serving_protein_g: string;
    serving_carbs_g: string;
    serving_fat_g: string;
    serving_size_g: string;
    serving_size_unit: string;
    image_url: string | null;
    instructions: string[] | string;
    version: number;
    is_curated: boolean;
  }[]>`
    SELECT id, title, description, author_name, servings,
      serving_calories_kcal, serving_protein_g, serving_carbs_g, serving_fat_g,
      serving_size_g, serving_size_unit, image_url, instructions, version, is_curated
    FROM recipes
    WHERE id = ${params.data.id}
    LIMIT 1
  `;
  if (!recipeRow) return reply.code(404).send({ error: 'Recipe not found.' });

  const ingredientRows = await sql<{
    name: string;
    amount: string;
    unit: string;
    sort_order: number;
  }[]>`
    SELECT name, amount, unit, sort_order
    FROM recipe_ingredients
    WHERE recipe_id = ${recipeRow.id}
    ORDER BY sort_order ASC
  `;

  let instructionsList: string[] = [];
  if (Array.isArray(recipeRow.instructions)) {
    instructionsList = recipeRow.instructions;
  } else if (typeof recipeRow.instructions === 'string') {
    try { instructionsList = JSON.parse(recipeRow.instructions); } catch { instructionsList = []; }
  }

  return reply.send({
    recipe: {
      id: recipeRow.id,
      title: recipeRow.title,
      description: recipeRow.description,
      authorName: recipeRow.author_name,
      servings: recipeRow.servings,
      servingCaloriesKcal: recipeRow.serving_calories_kcal,
      servingProteinG: parseFloat(recipeRow.serving_protein_g),
      servingCarbsG: parseFloat(recipeRow.serving_carbs_g),
      servingFatG: parseFloat(recipeRow.serving_fat_g),
      servingSizeGrams: parseFloat(recipeRow.serving_size_g),
      servingSizeUnit: recipeRow.serving_size_unit,
      imageUrl: recipeRow.image_url,
      ingredients: ingredientRows.map((ing) => ({
        name: ing.name,
        amount: parseFloat(ing.amount),
        unit: ing.unit,
      })),
      instructions: instructionsList,
      version: recipeRow.version,
      isCurated: recipeRow.is_curated,
    },
  });
});

app.post('/v1/recipes/:id/log', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = recipeLogSchema.safeParse(request.body);
  if (!params.success || !parsed.success) {
    request.log.warn({ paramsError: params.error, bodyError: parsed.error, body: request.body }, 'Recipe log payload invalid');
    return reply.code(400).send({ error: 'Invalid recipe log payload.' });
  }

  const [recipeRow] = await sql<{
    id: string;
    title: string;
    serving_calories_kcal: number;
    serving_protein_g: string;
    serving_carbs_g: string;
    serving_fat_g: string;
    serving_size_g: string;
    serving_size_unit: string;
    version: number;
  }[]>`
    SELECT id, title, serving_calories_kcal, serving_protein_g, serving_carbs_g, serving_fat_g,
      serving_size_g, serving_size_unit, version
    FROM recipes
    WHERE id = ${params.data.id}
    LIMIT 1
  `;
  if (!recipeRow) return reply.code(404).send({ error: 'Recipe not found.' });

  const portionServings = parsed.data.portionServings;
  const consumedAt = parsed.data.consumedAt ? new Date(parsed.data.consumedAt) : new Date();

  // Find or create a food record snapshot representing this recipe version
  const foodName = `${recipeRow.title} (Recipe v${recipeRow.version})`;
  let [food] = await sql<{ id: string }[]>`
    SELECT id FROM foods
    WHERE name = ${foodName} AND serving_size_unit = 'serving'
    LIMIT 1
  `;

  if (!food) {
    const [createdFood] = await sql<{ id: string }[]>`
      INSERT INTO foods (
        id, name, calories_kcal, serving_size_g, serving_size_unit, serving_size_text,
        protein_g, carbs_g, fat_g, created_by_user_id, created_at
      )
      VALUES (
        ${randomUUID()},
        ${foodName},
        ${recipeRow.serving_calories_kcal},
        1,
        'serving',
        '1 serving',
        ${recipeRow.serving_protein_g},
        ${recipeRow.serving_carbs_g},
        ${recipeRow.serving_fat_g},
        ${userId},
        now()
      )
      RETURNING id
    `;
    food = createdFood;
  }

  const [meal] = await sql<{ id: string; consumed_at: Date }[]>`
    INSERT INTO meal_logs (id, user_id, food_id, quantity, meal_type, consumed_at, notes)
    VALUES (
      ${randomUUID()},
      ${userId},
      ${food.id},
      ${portionServings.toString()},
      ${parsed.data.mealType},
      ${consumedAt},
      ${`Logged from recipe ${recipeRow.title} v${recipeRow.version}`}
    )
    RETURNING id, consumed_at
  `;

  await recordProgressionEvent(sql, userId, 'meal_logged', 'meal_log', meal.id, {
    mealType: parsed.data.mealType,
    consumedAt: meal.consumed_at,
    recipeId: recipeRow.id,
    recipeVersion: recipeRow.version,
  });
  await evaluateArcanaForUser(sql, userId);

  return reply.code(201).send({
    meal: {
      id: meal.id,
      consumedAt: meal.consumed_at.toISOString(),
      recipeId: recipeRow.id,
      recipeVersion: recipeRow.version,
    },
  });
});

app.post('/v1/meals/:id/photo/presign', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = progressPresignSchema.safeParse(request.body);
  if (!params.success || !parsed.success || !parsed.data.contentType.startsWith('image/')) {
    return reply.code(400).send({ error: 'Only image uploads are allowed for meal photos.' });
  }
  const [meal] = await sql<{ id: string }[]>`
    SELECT id FROM meal_logs WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1
  `;
  if (!meal) return reply.code(404).send({ error: 'Meal not found.' });
  const key = `meals/${userId}/${meal.id}/${Date.now()}-${randomUUID()}.${progressExtension(parsed.data.fileName)}`;
  const url = await getSignedUrl(
    storage,
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: parsed.data.contentType }),
    { expiresIn: 300 },
  );
  return reply.send({ url, key });
});

app.post('/v1/meals/:id/photo', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = mealPhotoCreateSchema.safeParse(request.body);
  if (!params.success || !parsed.success || !parsed.data.mimeType.startsWith('image/') || !isOwnedMealPhotoKey(userId, params.data.id, parsed.data.objectKey)) {
    return reply.code(400).send({ error: 'Invalid meal photo payload.' });
  }
  const [meal] = await sql<{ id: string }[]>`
    SELECT id FROM meal_logs WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1
  `;
  if (!meal) return reply.code(404).send({ error: 'Meal not found.' });

  const replacedPhotos = await sql<{ object_key: string }[]>`
    DELETE FROM uploads
    WHERE user_id = ${userId} AND entity_type = 'meal_log_photo' AND entity_id = ${meal.id}
    RETURNING object_key
  `;
  await Promise.all(
    replacedPhotos.map((photo) => storage.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: photo.object_key })).catch(() => undefined)),
  );
  const [photo] = await sql<{ id: string }[]>`
    INSERT INTO uploads (id, user_id, entity_type, entity_id, object_key, mime_type, size_bytes, captured_at, created_at)
    VALUES (${randomUUID()}, ${userId}, 'meal_log_photo', ${meal.id}, ${parsed.data.objectKey}, ${parsed.data.mimeType}, ${parsed.data.sizeBytes}, now(), now())
    RETURNING id
  `;
  return reply.code(201).send({ id: photo.id });
});

app.post('/v1/fasting', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = fastSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid fasting payload.' });
  if (parsed.data.action === 'start') {
    const [active] = await sql<{ id: string; started_at: Date; note: string | null; target_minutes: number | null }[]>`
      INSERT INTO active_fasts (id, user_id, started_at, note, target_minutes, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, now(), ${parsed.data.note ?? null}, ${parsed.data.targetMinutes ?? null}, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET started_at = now(), note = EXCLUDED.note, target_minutes = EXCLUDED.target_minutes, updated_at = now()
      RETURNING id, started_at, note, target_minutes
    `;
    return reply.send({ active: { id: active.id, startedAt: active.started_at, note: active.note, targetMinutes: active.target_minutes } });
  }
  const [active] = await sql<{ id: string; started_at: Date; note: string | null; target_minutes: number | null }[]>`SELECT id, started_at, note, target_minutes FROM active_fasts WHERE user_id = ${userId} LIMIT 1`;
  if (!active) return reply.code(404).send({ error: 'No active fast to end.' });
  const endedAt = new Date();
  const durationMilliseconds = endedAt.getTime() - active.started_at.getTime();
  if (durationMilliseconds < 5 * 60_000) {
    await sql`DELETE FROM active_fasts WHERE id = ${active.id}`;
    return reply.send({ discarded: true });
  }
  const durationMinutes = Math.round(durationMilliseconds / 60_000);
  if (durationMinutes > 60 * 24 * 7) return reply.code(400).send({ error: 'Fast duration must be no more than 7 days.' });
  const [fast] = await sql<{ id: string }[]>`
    INSERT INTO fasting_logs (id, user_id, started_at, ended_at, duration_minutes, target_minutes, note, created_at)
    VALUES (${randomUUID()}, ${userId}, ${active.started_at}, ${endedAt}, ${durationMinutes}, ${active.target_minutes}, ${parsed.data.note ?? active.note}, now()) RETURNING id
  `;
  await sql`DELETE FROM active_fasts WHERE id = ${active.id}`;
  return reply.send({ fast: { id: fast.id, durationMinutes } });
});

app.delete('/v1/fasting/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = idParamsSchema.safeParse(request.params);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid fasting record.' });
  const [removed] = await sql<{ id: string }[]>`
    DELETE FROM fasting_logs WHERE id = ${parsed.data.id} AND user_id = ${userId} RETURNING id
  `;
  if (!removed) return reply.code(404).send({ error: 'Fasting record not found.' });
  return reply.code(204).send();
});

app.get('/v1/arcana', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  return reply.send(await evaluateArcanaForUser(sql, userId, 'recovered'));
});

app.post('/v1/arcana/reconcile', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  // Reconciliation re-reads factual history under the server-owned rule
  // version. It can advance a card with durable evidence, never retract one.
  return reply.send({ reconciled: true, arcana: await evaluateArcanaForUser(sql, userId, 'recovered') });
});

app.put('/v1/arcana/pins', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = pinArcanaSchema.safeParse(request.body);
  if (!parsed.success || !arcanaDefinitions.some((card) => card.id === parsed.data.cardId)) return reply.code(400).send({ error: 'Choose a valid Arcana card and spread position.' });
  const [state] = await sql<{ highest_stage: number }[]>`SELECT highest_stage FROM user_arcana_states WHERE user_id = ${userId} AND card_id = ${parsed.data.cardId} LIMIT 1`;
  if (!state || state.highest_stage < 1) return reply.code(409).send({ error: 'Only revealed cards can be pinned.' });
  await sql`
    INSERT INTO user_arcana_pins (user_id, slot, card_id, updated_at)
    VALUES (${userId}, ${parsed.data.slot}, ${parsed.data.cardId}, now())
    ON CONFLICT (user_id, slot) DO UPDATE SET card_id = EXCLUDED.card_id, updated_at = now()
  `;
  return reply.send(await evaluateArcanaForUser(sql, userId));
});

app.get('/v1/recovery-checkins', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const checkins = await sql`
    SELECT checked_on, sleep_duration_minutes, energy, soreness, stress, note, created_at, updated_at
    FROM recovery_checkins WHERE user_id = ${userId} ORDER BY checked_on DESC LIMIT 90
  `;
  return reply.send({ checkins });
});

app.put('/v1/recovery-checkins/:date', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = z.object({ date: recordDateSchema }).safeParse(request.params);
  const parsed = recoveryCheckinSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid recovery check-in.' });
  const [checkin] = await sql`
    INSERT INTO recovery_checkins (id, user_id, checked_on, sleep_duration_minutes, energy, soreness, stress, note, created_at, updated_at)
    VALUES (${randomUUID()}, ${userId}, ${params.data.date}, ${parsed.data.sleepHours ? Math.round(parsed.data.sleepHours * 60) : null}, ${parsed.data.recoveryScore}, ${parsed.data.sorenessScore ?? null}, ${parsed.data.stressScore ?? null}, ${parsed.data.note ?? null}, now(), now())
    ON CONFLICT (user_id, checked_on) DO UPDATE SET sleep_duration_minutes = EXCLUDED.sleep_duration_minutes, energy = EXCLUDED.energy, soreness = EXCLUDED.soreness, stress = EXCLUDED.stress, note = EXCLUDED.note, updated_at = now()
    RETURNING id, checked_on, energy
  `;
  await recordProgressionEvent(sql, userId, 'recovery_checkin_recorded', 'recovery_checkin', checkin.id, { date: checkin.checked_on, recoveryScore: checkin.energy });
  return reply.send({ checkin, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.put('/v1/nutrition-adherence-target', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = nutritionTargetSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid nutrition target.' });
  await sql`
    INSERT INTO nutrition_adherence_targets (user_id, meal_days_per_week, updated_at)
    VALUES (${userId}, ${parsed.data.targetMealDays}, now())
    ON CONFLICT (user_id) DO UPDATE SET meal_days_per_week = EXCLUDED.meal_days_per_week, updated_at = now()
  `;
  await recordProgressionEvent(sql, userId, 'nutrition_target_set', 'nutrition_adherence_target', userId, parsed.data);
  return reply.send({ targetMealDays: parsed.data.targetMealDays, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.get('/v1/training-blocks', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const blocks = await sql`
    SELECT b.*, coalesce(json_agg(s ORDER BY s.scheduled_on) FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS sessions
    FROM training_blocks b LEFT JOIN training_block_sessions s ON s.block_id = b.id
    WHERE b.user_id = ${userId} GROUP BY b.id ORDER BY b.start_date DESC
  `;
  return reply.send({ blocks });
});

app.post('/v1/training-blocks', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = trainingBlockSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid training block.' });
  if (parsed.data.routineId) {
    const [routine] = await sql<{ id: string }[]>`SELECT id FROM routines WHERE id = ${parsed.data.routineId} AND user_id = ${userId} LIMIT 1`;
    if (!routine) return reply.code(404).send({ error: 'Workout plan not found.' });
  }
  const [block] = await sql`
    INSERT INTO training_blocks (id, user_id, routine_id, title, primary_goal, start_date, end_date, weekly_target, status, created_at, updated_at)
    VALUES (${randomUUID()}, ${userId}, ${parsed.data.routineId ?? null}, ${parsed.data.name}, ${parsed.data.note ?? null}, ${parsed.data.startDate}, ${parsed.data.endDate}, ${parsed.data.targetSessionsPerWeek}, 'active', now(), now()) RETURNING *
  `;
  await recordProgressionEvent(sql, userId, 'training_block_created', 'training_block', block.id, { name: block.title, startDate: block.start_date, endDate: block.end_date });
  return reply.code(201).send({ block, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.patch('/v1/training-blocks/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = trainingBlockUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid training block update.' });
  const [block] = await sql`
    UPDATE training_blocks SET status = coalesce(${parsed.data.status ?? null}, status), primary_goal = coalesce(${parsed.data.note ?? null}, primary_goal), ended_reason = coalesce(${parsed.data.endedReason ?? null}, ended_reason), replacement_block_id = ${parsed.data.replacementBlockId ?? null}, updated_at = now()
    WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING *
  `;
  if (!block) return reply.code(404).send({ error: 'Training block not found.' });
  await recordProgressionEvent(sql, userId, 'training_block_updated', 'training_block', block.id, { status: block.status });
  return reply.send({ block, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.post('/v1/training-blocks/:id/sessions', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = scheduledBlockSessionSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid scheduled session.' });
  const [block] = await sql<{ id: string }[]>`SELECT id FROM training_blocks WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1`;
  if (!block) return reply.code(404).send({ error: 'Training block not found.' });
  const [session] = await sql`
    INSERT INTO training_block_sessions (id, block_id, scheduled_on, routine_day_id, status, rescheduled_from_id, is_deload, is_recovery_session, skip_reason, created_at, updated_at)
    VALUES (${randomUUID()}, ${block.id}, ${parsed.data.scheduledFor}, ${parsed.data.routineDayId ?? null}, ${parsed.data.status}, ${parsed.data.rescheduledFromId ?? null}, ${parsed.data.isDeload ?? false}, ${parsed.data.isRecoverySession ?? false}, ${parsed.data.note ?? null}, now(), now()) RETURNING *
  `;
  await recordProgressionEvent(sql, userId, 'training_session_scheduled', 'training_block_session', session.id, { blockId: block.id, status: session.status, scheduledFor: session.scheduled_on });
  return reply.code(201).send({ session, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.patch('/v1/training-block-sessions/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = scheduledBlockSessionUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid scheduled-session update.' });
  const [session] = await sql`
    UPDATE training_block_sessions s SET scheduled_on = coalesce(${parsed.data.scheduledFor ?? null}, s.scheduled_on), status = coalesce(${parsed.data.status ?? null}, s.status), rescheduled_from_id = ${parsed.data.rescheduledFromId ?? null}, completed_session_id = ${parsed.data.completedSessionId ?? null}, is_deload = coalesce(${parsed.data.isDeload ?? null}, s.is_deload), is_recovery_session = coalesce(${parsed.data.isRecoverySession ?? null}, s.is_recovery_session), skip_reason = coalesce(${parsed.data.note ?? null}, s.skip_reason), updated_at = now()
    FROM training_blocks b WHERE s.id = ${params.data.id} AND s.block_id = b.id AND b.user_id = ${userId} RETURNING s.*
  `;
  if (!session) return reply.code(404).send({ error: 'Scheduled session not found.' });
  await recordProgressionEvent(sql, userId, 'training_session_updated', 'training_block_session', session.id, { status: session.status, scheduledFor: session.scheduled_on });
  return reply.send({ session, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.get('/v1/weekly-reviews', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  return reply.send({ reviews: await sql`SELECT * FROM weekly_reviews WHERE user_id = ${userId} ORDER BY period_start DESC LIMIT 52` });
});

app.post('/v1/weekly-reviews', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = weeklyReviewSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid weekly review.' });
  const [review] = await sql`
    INSERT INTO weekly_reviews (id, user_id, period_start, period_end, what_worked, what_did_not, decision, created_at)
    VALUES (${randomUUID()}, ${userId}, ${parsed.data.weekStart}, ${parsed.data.weekEnd}, ${parsed.data.reflection}, ${parsed.data.adjustments ?? null}, ${parsed.data.decision ?? 'Continue with the next planned action.'}, now()) RETURNING *
  `;
  await recordProgressionEvent(sql, userId, 'weekly_review_recorded', 'weekly_review', review.id, { weekStart: review.period_start, hasAdjustment: Boolean(review.what_did_not) });
  return reply.code(201).send({ review, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.get('/v1/goals', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const goals = await sql`
    SELECT g.*,
      e.name AS exercise_name,
      coalesce(json_agg(a ORDER BY a.assessed_on DESC) FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS assessments
    FROM goals g
    LEFT JOIN exercises e ON e.id = g.exercise_id
    LEFT JOIN goal_assessments a ON a.goal_id = g.id
    WHERE g.user_id = ${userId}
    GROUP BY g.id, e.name
    ORDER BY g.created_at DESC
  `;
  return reply.send({ goals });
});

app.post('/v1/goals', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = goalSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid goal.' });
  const [goal] = await sql`
    INSERT INTO goals (id, user_id, domain, metric_type, baseline_value, target_value, measurement_method, target_date, status, exercise_id, tracking_mode, created_at)
    VALUES (${randomUUID()}, ${userId}, ${parsed.data.category}, ${parsed.data.title}, ${parsed.data.baselineValue}, ${parsed.data.targetValue}, ${parsed.data.unit}, ${parsed.data.targetDate}, 'active', ${parsed.data.exerciseId ?? null}, ${parsed.data.trackingMode ?? null}, now()) RETURNING *
  `;
  await recordProgressionEvent(sql, userId, 'goal_created', 'goal', goal.id, { category: goal.domain, title: goal.metric_type });
  return reply.code(201).send({ goal, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.patch('/v1/goals/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = goalUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid goal update.' });
  const [goal] = await sql`
    UPDATE goals SET
      domain = coalesce(${parsed.data.category ?? null}, domain),
      metric_type = coalesce(${parsed.data.title ?? null}, metric_type),
      baseline_value = coalesce(${parsed.data.baselineValue ?? null}, baseline_value),
      target_value = coalesce(${parsed.data.targetValue ?? null}, target_value),
      measurement_method = coalesce(${parsed.data.unit ?? null}, measurement_method),
      target_date = coalesce(${parsed.data.targetDate ?? null}, target_date),
      status = coalesce(${parsed.data.status ?? null}, status),
      exercise_id = coalesce(${parsed.data.exerciseId ?? null}, exercise_id),
      tracking_mode = coalesce(${parsed.data.trackingMode ?? null}, tracking_mode),
      completed_at = CASE WHEN ${parsed.data.status ?? null} = 'completed' THEN now() ELSE completed_at END
    WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING *
  `;
  if (!goal) return reply.code(404).send({ error: 'Goal not found.' });
  await recordProgressionEvent(sql, userId, 'goal_updated', 'goal', goal.id, { status: goal.status });
  return reply.send({ goal, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.delete('/v1/goals/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid goal id.' });
  const [deleted] = await sql`DELETE FROM goals WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING id`;
  if (!deleted) return reply.code(404).send({ error: 'Goal not found.' });
  return reply.code(204).send();
});

app.post('/v1/goals/:id/assessments', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = goalAssessmentSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid goal assessment.' });
  const [goal] = await sql<{ id: string }[]>`SELECT id FROM goals WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1`;
  if (!goal) return reply.code(404).send({ error: 'Goal not found.' });
  const [assessment] = await sql`
    INSERT INTO goal_assessments (id, goal_id, user_id, assessed_on, value, decision, decision_reason, created_at)
    VALUES (${randomUUID()}, ${goal.id}, ${userId}, ${parsed.data.assessedAt ?? new Date().toISOString().slice(0, 10)}, ${parsed.data.value}, ${parsed.data.decision ?? null}, ${parsed.data.note}, now()) RETURNING *
  `;
  await recordProgressionEvent(sql, userId, 'goal_assessed', 'goal_assessment', assessment.id, { goalId: goal.id, value: assessment.value });
  return reply.code(201).send({ assessment, arcana: await evaluateArcanaForUser(sql, userId) });
});

app.get('/v1/bodyweight', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const rows = await sql<{
    id: string;
    measured_at: string;
    weight_kg: string;
    notes: string | null;
    created_at: Date;
  }[]>`
    SELECT id, to_char(measured_at, 'YYYY-MM-DD') AS measured_at, weight_kg::text, notes, created_at
    FROM bodyweight_measurements
    WHERE user_id = ${userId}
    ORDER BY measured_at DESC, created_at DESC
  `;
  return reply.send({
    measurements: rows.map((r) => ({
      id: r.id,
      measuredAt: r.measured_at,
      weightKg: Number(r.weight_kg),
      notes: r.notes,
      createdAt: r.created_at,
    })),
  });
});

app.post('/v1/bodyweight', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = bodyweightMeasurementSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid bodyweight measurement.' });

  const [row] = await sql<{
    id: string;
    measured_at: string;
    weight_kg: string;
    notes: string | null;
    created_at: Date;
  }[]>`
    INSERT INTO bodyweight_measurements (id, user_id, measured_at, weight_kg, notes, created_at, updated_at)
    VALUES (${randomUUID()}, ${userId}, ${parsed.data.measuredAt}, ${parsed.data.weightKg}, ${parsed.data.notes ?? null}, now(), now())
    ON CONFLICT (user_id, measured_at)
    DO UPDATE SET
      weight_kg = EXCLUDED.weight_kg,
      notes = coalesce(EXCLUDED.notes, bodyweight_measurements.notes),
      updated_at = now()
    RETURNING id, to_char(measured_at, 'YYYY-MM-DD') AS measured_at, weight_kg::text, notes, created_at
  `;

  return reply.code(201).send({
    measurement: {
      id: row.id,
      measuredAt: row.measured_at,
      weightKg: Number(row.weight_kg),
      notes: row.notes,
      createdAt: row.created_at,
    },
  });
});

app.delete('/v1/bodyweight/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid measurement id.' });
  const [deleted] = await sql`DELETE FROM bodyweight_measurements WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING id`;
  if (!deleted) return reply.code(404).send({ error: 'Measurement not found.' });
  return reply.code(204).send();
});

app.get('/v1/progression', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const progression = await getUserProgression(sql, userId);
  return reply.send(progression);
});

app.post('/v1/rewards/:id/claim', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid reward id.' });

  const rewardDef = REWARDS_CATALOG.find((r) => r.id === params.data.id);
  if (!rewardDef) return reply.code(404).send({ error: 'Reward not found.' });

  const progression = await getUserProgression(sql, userId);
  if (progression.currentLevel < rewardDef.requiredLevel) {
    return reply.code(400).send({
      error: `Reward requires Level ${rewardDef.requiredLevel}. You are Level ${progression.currentLevel}.`,
    });
  }

  // Idempotent claim
  const [claimed] = await sql<{ id: string; claimed_at: Date }[]>`
    INSERT INTO reward_claims (user_id, reward_id, level_at_claim, claimed_at)
    VALUES (${userId}, ${rewardDef.id}, ${progression.currentLevel}, now())
    ON CONFLICT (user_id, reward_id) DO UPDATE SET claimed_at = reward_claims.claimed_at
    RETURNING id, claimed_at
  `;

  return reply.send({
    claimed: true,
    rewardId: rewardDef.id,
    claimedAt: claimed.claimed_at.toISOString(),
  });
});

app.get('/v1/streaks', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const querySchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  });
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid calendar query.' });

  const data = await getStreaksAndCalendar(sql, userId, parsed.data.year, parsed.data.month);
  return reply.send(data);
});

app.patch('/v1/user/timezone', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const bodySchema = z.object({
    timezone: z.string().min(1),
  });
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid timezone.' });

  await sql`
    UPDATE user_preferences SET timezone = ${parsed.data.timezone}, updated_at = now()
    WHERE user_id = ${userId}
  `;
  return reply.send({ ok: true, timezone: parsed.data.timezone });
});

app.post('/v1/friends', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = friendUsernameSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid friend username.' });
  const result = await sql.begin(async (transaction) => {
    const [target] = await transaction<{ id: string }[]>`SELECT id FROM users WHERE username = ${parsed.data.username} LIMIT 1`;
    if (!target) return { error: 'User not found.', status: 404 } as const;
    if (target.id === userId) return { error: 'You cannot add yourself.', status: 400 } as const;
    const rows = await transaction<{ id: string; requester_id: string; addressee_id: string; status: string }[]>`
      SELECT id, requester_id, addressee_id, status FROM friend_requests
      WHERE (requester_id = ${userId} AND addressee_id = ${target.id}) OR (requester_id = ${target.id} AND addressee_id = ${userId})
    `;
    if (rows.some((row) => row.status === 'accepted')) return { status: 'accepted' } as const;
    const incoming = rows.find((row) => row.requester_id === target.id && row.addressee_id === userId && row.status === 'pending');
    if (incoming) {
      await transaction`UPDATE friend_requests SET status = 'accepted', updated_at = now() WHERE id = ${incoming.id}`;
      return { status: 'accepted' } as const;
    }
    if (rows.some((row) => row.requester_id === userId && row.addressee_id === target.id && row.status === 'pending')) return { error: 'Friend request already sent.', status: 409 } as const;
    const rejected = rows.find((row) => row.requester_id === userId && row.addressee_id === target.id && row.status === 'rejected');
    if (rejected) {
      await transaction`UPDATE friend_requests SET status = 'pending', updated_at = now() WHERE id = ${rejected.id}`;
      return { status: 'pending' } as const;
    }
    await transaction`INSERT INTO friend_requests (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (${randomUUID()}, ${userId}, ${target.id}, 'pending', now(), now())`;
    return { status: 'pending' } as const;
  });
  if ('error' in result) return reply.code(typeof result.status === 'number' ? result.status : 400).send({ error: result.error });
  return reply.code(201).send({ status: result.status });
});

app.post('/v1/friends/:id/accept', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid friend request id.' });
  const [updated] = await sql<{ id: string }[]>`
    UPDATE friend_requests SET status = 'accepted', updated_at = now()
    WHERE id = ${params.data.id} AND addressee_id = ${userId} AND status = 'pending' RETURNING id
  `;
  if (!updated) return reply.code(404).send({ error: 'Friend request not found.' });
  return reply.send({ status: 'accepted' });
});

app.post('/v1/friends/:id/reject', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid friend request id.' });
  const [updated] = await sql<{ id: string }[]>`
    UPDATE friend_requests SET status = 'rejected', updated_at = now()
    WHERE id = ${params.data.id} AND addressee_id = ${userId} AND status = 'pending' RETURNING id
  `;
  if (!updated) return reply.code(404).send({ error: 'Friend request not found.' });
  return reply.send({ status: 'rejected' });
});

app.delete('/v1/friends/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid friend id.' });
  const [deleted] = await sql<{ id: string }[]>`
    DELETE FROM friend_requests
    WHERE status = 'accepted' AND ((requester_id = ${userId} AND addressee_id = ${params.data.id}) OR (requester_id = ${params.data.id} AND addressee_id = ${userId}))
    RETURNING id
  `;
  if (!deleted) return reply.code(404).send({ error: 'Friendship not found.' });
  return reply.code(204).send();
});

app.put('/v1/preferences/weight-unit', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = weightUnitSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid weight unit.' });
  await sql`
    INSERT INTO user_preferences (user_id, weight_unit, theme_overrides, updated_at)
    VALUES (${userId}, ${parsed.data.weightUnit}, '{}'::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET weight_unit = EXCLUDED.weight_unit, updated_at = now()
  `;
  return reply.send({ weightUnit: parsed.data.weightUnit });
});

app.get('/v1/preferences/theme', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const [preferences] = await sql<{ theme_overrides: Record<string, unknown> }[]>`
    SELECT theme_overrides FROM user_preferences WHERE user_id = ${userId} LIMIT 1
  `;
  const mobileTheme = preferences?.theme_overrides?.mobileTheme;
  const parsed = themePreferenceSchema.safeParse(mobileTheme);
  return reply.send({ preference: parsed.success ? parsed.data : null });
});

app.put('/v1/preferences/theme', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = themePreferenceSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid theme preference.' });
  await sql`
    INSERT INTO user_preferences (user_id, weight_unit, theme_overrides, updated_at)
    VALUES (${userId}, 'lbs', ${JSON.stringify({ mobileTheme: parsed.data })}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE
    SET theme_overrides = user_preferences.theme_overrides || EXCLUDED.theme_overrides,
        updated_at = now()
  `;
  return reply.send({ preference: parsed.data });
});

app.get('/v1/admin/users', async (request, reply) => {
  const admin = await requireAdminUser(request.headers.authorization);
  if (!admin) return reply.code(403).send({ error: 'Administrator access is required.' });
  return reply.send({ users: await readAdminUsers() });
});

app.post('/v1/admin/users', async (request, reply) => {
  const admin = await requireAdminUser(request.headers.authorization);
  if (!admin) return reply.code(403).send({ error: 'Administrator access is required.' });
  const parsed = adminCreateUserSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid user payload.' });
  try {
    const [user] = await sql<AdminUserRow[]>`
      INSERT INTO users (id, username, name, email, password_hash, created_at, updated_at)
      VALUES (${randomUUID()}, ${parsed.data.username}, ${parsed.data.name ?? parsed.data.username}, ${parsed.data.email ?? null}, ${await hash(parsed.data.password, 12)}, now(), now())
      RETURNING id, username, name, email, created_at, updated_at
    `;
    return reply.code(201).send({ user });
  } catch (error) {
    if (error instanceof postgres.PostgresError && error.code === '23505') {
      return reply.code(409).send({ error: 'That username or email already exists.' });
    }
    throw error;
  }
});

app.patch('/v1/admin/users/:id', async (request, reply) => {
  const admin = await requireAdminUser(request.headers.authorization);
  if (!admin) return reply.code(403).send({ error: 'Administrator access is required.' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = adminUpdateUserSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid user update payload.' });
  try {
    const passwordHash = parsed.data.password ? await hash(parsed.data.password, 12) : null;
    const [user] = await sql<AdminUserRow[]>`
      UPDATE users
      SET username = ${parsed.data.username},
          name = ${parsed.data.name ?? parsed.data.username},
          email = ${parsed.data.email ?? null},
          password_hash = coalesce(${passwordHash}, password_hash),
          updated_at = now()
      WHERE id = ${params.data.id}
      RETURNING id, username, name, email, created_at, updated_at
    `;
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    return reply.send({ user });
  } catch (error) {
    if (error instanceof postgres.PostgresError && error.code === '23505') {
      return reply.code(409).send({ error: 'That username or email already exists.' });
    }
    throw error;
  }
});

app.delete('/v1/admin/users/:id', async (request, reply) => {
  const admin = await requireAdminUser(request.headers.authorization);
  if (!admin) return reply.code(403).send({ error: 'Administrator access is required.' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid user id.' });
  if (params.data.id === admin.id) return reply.code(400).send({ error: 'You cannot delete your own administrator account.' });
  const [deleted] = await sql<{ id: string }[]>`DELETE FROM users WHERE id = ${params.data.id} RETURNING id`;
  if (!deleted) return reply.code(404).send({ error: 'User not found.' });
  return reply.code(204).send();
});

app.post('/v1/progress/presign', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = progressPresignSchema.safeParse(request.body);
  if (!parsed.success || !parsed.data.contentType.startsWith('image/')) {
    return reply.code(400).send({ error: 'Only image uploads are allowed for progress photos.' });
  }
  const key = `progress/${userId}/${Date.now()}-${randomUUID()}.${progressExtension(parsed.data.fileName)}`;
  const url = await getSignedUrl(storage, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: parsed.data.contentType }), { expiresIn: 300 });
  return reply.send({ url, key });
});

// Browser clients cannot rely on the storage origin's CORS policy for private
// progress photos. Accept their image bytes at the authenticated API instead,
// then write the object with server credentials.
app.post('/v1/progress/upload', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = progressProxyUploadSchema.safeParse(request.query);
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.toLowerCase() ?? '';
  const bytes = request.body;
  if (
    !parsed.success ||
    !contentType.startsWith('image/') ||
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > 20 * 1024 * 1024
  ) {
    return reply.code(400).send({ error: 'Invalid progress photo payload.' });
  }
  const key = `progress/${userId}/${Date.now()}-${randomUUID()}.${progressExtension(parsed.data.fileName)}`;
  await storage.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
  const [progress] = await sql<{ id: string }[]>`
    INSERT INTO uploads (id, user_id, entity_type, entity_id, object_key, mime_type, size_bytes, note, captured_at, created_at)
    VALUES (${randomUUID()}, ${userId}, 'progress_photo', ${userId}, ${key}, ${contentType}, ${bytes.length}, ${parsed.data.note ?? null}, ${parseCapturedAt(parsed.data.capturedAt)}, now())
    RETURNING id
  `;
  return reply.code(201).send({ id: progress.id });
});

app.post('/v1/progress', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = progressCreateSchema.safeParse(request.body);
  if (
    !parsed.success ||
    !parsed.data.mimeType.startsWith('image/') ||
    !isOwnedProgressKey(userId, parsed.data.objectKey)
  ) {
    return reply.code(400).send({ error: 'Invalid progress photo payload.' });
  }
  const [progress] = await sql<{ id: string }[]>`
    INSERT INTO uploads (id, user_id, entity_type, entity_id, object_key, mime_type, size_bytes, note, captured_at, created_at)
    VALUES (${randomUUID()}, ${userId}, 'progress_photo', ${userId}, ${parsed.data.objectKey}, ${parsed.data.mimeType}, ${parsed.data.sizeBytes}, ${parsed.data.note ?? null}, ${parseCapturedAt(parsed.data.capturedAt)}, now())
    RETURNING id
  `;
  return reply.code(201).send({ id: progress.id });
});

app.get('/v1/progress/:id/image', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid progress photo id.' });
  const [progress] = await sql<{ object_key: string; mime_type: string }[]>`
    SELECT object_key, mime_type FROM uploads
    WHERE id = ${params.data.id} AND user_id = ${userId} AND entity_type = 'progress_photo'
    LIMIT 1
  `;
  if (!progress) return reply.code(404).send({ error: 'Progress photo not found.' });
  const object = await storage.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: progress.object_key }),
  );
  if (!object.Body) return reply.code(404).send({ error: 'Progress photo is unavailable.' });
  return reply
    .header('Cache-Control', 'private, max-age=300')
    .type(progress.mime_type)
    .send(object.Body);
});

app.delete('/v1/progress/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid progress photo id.' });
  const [progress] = await sql<{ id: string; object_key: string }[]>`
    SELECT id, object_key FROM uploads WHERE id = ${params.data.id} AND user_id = ${userId} AND entity_type = 'progress_photo' LIMIT 1
  `;
  if (!progress) return reply.code(404).send({ error: 'Progress photo not found.' });
  await sql`DELETE FROM uploads WHERE id = ${progress.id}`;
  await storage.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: progress.object_key })).catch(() => undefined);
  return reply.code(204).send();
});

app.patch('/v1/progress/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = progressUpdateSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid progress photo update.' });
  const [progress] = await sql<{ id: string; captured_at: Date }[]>`
    UPDATE uploads
    SET captured_at = ${parseCapturedAt(parsed.data.capturedAt)}
    WHERE id = ${params.data.id} AND user_id = ${userId} AND entity_type = 'progress_photo'
    RETURNING id, captured_at
  `;
  if (!progress) return reply.code(404).send({ error: 'Progress photo not found.' });
  return reply.send({ progress: { id: progress.id, capturedAt: progress.captured_at } });
});

/**
 * Read model for the migrated client.  These queries intentionally use the
 * same tables and ownership rules as the Next app; the mobile client never
 * connects to Postgres directly.
 */
app.get('/v1/record', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const [user, activeSession, routines, planExercises, exercises, sessions, recoverySessions, foods, meals, activeFast, fasts, progress, incoming, outgoing, preferences] = await Promise.all([
    sql`SELECT id, username, name, email FROM users WHERE id = ${userId} LIMIT 1`,
    sql`
      SELECT ws.id, ws.status, ws.origin, ws.started_at, ws.ended_at,
        CASE WHEN ws.origin = 'freeform' THEN 'Empty Workout' ELSE r.name END AS routine_name,
        CASE WHEN ws.origin = 'freeform' THEN 'Freeform' ELSE rd.day_name END AS day_name
      FROM workout_sessions ws
      LEFT JOIN routines r ON r.id = ws.routine_id
      LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
      WHERE ws.user_id = ${userId} AND ws.status = 'active'
      ORDER BY ws.started_at DESC LIMIT 1
    `,
    sql`
      SELECT r.id, r.name, r.description, r.is_preset, r.created_at,
        rd.id AS day_id, rd.day_name, rd.sort_order,
        count(rde.id)::int AS exercise_count
      FROM routines r
      LEFT JOIN routine_days rd ON rd.routine_id = r.id
      LEFT JOIN routine_day_exercises rde ON rde.routine_day_id = rd.id
      WHERE r.user_id = ${userId}
      GROUP BY r.id, rd.id
      ORDER BY r.updated_at DESC, rd.sort_order ASC
    `,
    sql<{
      plan_id: string;
      day_id: string;
      id: string;
      exercise_id: string;
      name: string;
      category: string;
      muscle_group: string | null;
      sort_order: number;
      target_sets: number | null;
      target_reps: number | null;
      target_weight: string | null;
      tracking_mode: string;
      target_duration_seconds: number | null;
    }[]>`
      SELECT rd.routine_id AS plan_id, rd.id AS day_id, rde.id, rde.exercise_id,
        e.name, e.category, e.muscle_group, rde.sort_order,
        rde.target_sets, rde.target_reps, rde.target_weight,
        rde.tracking_mode, rde.target_duration_seconds
      FROM routine_day_exercises rde
      INNER JOIN routine_days rd ON rd.id = rde.routine_day_id
      INNER JOIN routines r ON r.id = rd.routine_id
      INNER JOIN exercises e ON e.id = rde.exercise_id
      WHERE r.user_id = ${userId}
      ORDER BY rd.sort_order ASC, rde.sort_order ASC
    `,
    sql<{ id: string; name: string; category: string; muscle_group: string | null; demo_url: string | null; demo_source_name: string | null }[]>`
      SELECT e.id, e.name, e.category, e.muscle_group,
        COALESCE(ego.gif_url, edd.demo_url) AS demo_url,
        COALESCE(ego.source_name, edd.source_name) AS demo_source_name
      FROM exercises e
      LEFT JOIN exercise_gif_overrides ego ON ego.exercise_id = e.id AND ego.user_id = ${userId}
      LEFT JOIN exercise_demo_defaults edd ON edd.exercise_id = e.id
      ORDER BY e.name ASC LIMIT 300
    `,
    sql`
      SELECT ws.id, ws.status, ws.origin, ws.started_at, ws.ended_at,
        CASE WHEN ws.origin = 'freeform' THEN 'Empty Workout' ELSE coalesce(r.name, 'Quick Add') END AS routine_name,
        CASE WHEN ws.origin = 'freeform' THEN 'Freeform' ELSE coalesce(rd.day_name, 'Quick Add') END AS day_name,
        count(wset.id)::int AS set_count
      FROM workout_sessions ws
      LEFT JOIN routines r ON r.id = ws.routine_id
      LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
      LEFT JOIN workout_sets wset ON wset.session_id = ws.id
      WHERE ws.user_id = ${userId}
      GROUP BY ws.id, r.name, rd.day_name
      ORDER BY ws.started_at DESC LIMIT 80
    `,
    sql<{ ended_at: Date; muscle_group: string | null; working_set_count: number }[]>`
      SELECT ws.ended_at, e.muscle_group, count(wset.id)::int AS working_set_count
      FROM workout_sessions ws
      INNER JOIN workout_sets wset ON wset.session_id = ws.id AND wset.is_warmup = false
      INNER JOIN exercises e ON e.id = wset.exercise_id
      WHERE ws.user_id = ${userId}
        AND ws.status = 'completed'
        AND ws.ended_at IS NOT NULL
        AND ws.ended_at >= now() - interval '48 hours'
      GROUP BY ws.id, ws.ended_at, e.muscle_group
      ORDER BY ws.ended_at DESC
    `,
    sql`SELECT id, name, barcode_upc, calories_kcal, protein_g, carbs_g, fat_g, serving_size_g, serving_size_unit, serving_size_text FROM foods ORDER BY name ASC LIMIT 300`,
    sql`
      SELECT ml.id, ml.meal_type, ml.quantity, ml.consumed_at, f.id AS food_id, f.name,
        round(f.calories_kcal * (ml.quantity / coalesce(nullif(f.serving_size_g, 0), 100)))::int AS calories_kcal,
        round(f.protein_g::numeric * (ml.quantity / coalesce(nullif(f.serving_size_g, 0), 100)), 1) AS protein_g,
        round(f.carbs_g::numeric * (ml.quantity / coalesce(nullif(f.serving_size_g, 0), 100)), 1) AS carbs_g,
        round(f.fat_g::numeric * (ml.quantity / coalesce(nullif(f.serving_size_g, 0), 100)), 1) AS fat_g,
        f.serving_size_g, f.serving_size_unit, f.serving_size_text
      FROM meal_logs ml INNER JOIN foods f ON f.id = ml.food_id
      WHERE ml.user_id = ${userId} ORDER BY ml.consumed_at DESC LIMIT 100
    `,
    sql`SELECT id, started_at, note, target_minutes FROM active_fasts WHERE user_id = ${userId} LIMIT 1`,
    sql`SELECT id, started_at, ended_at, duration_minutes, target_minutes, note FROM fasting_logs WHERE user_id = ${userId} ORDER BY ended_at DESC LIMIT 100`,
    sql<ProgressPhotoRow[]>`SELECT id, object_key, mime_type, size_bytes, note, captured_at FROM uploads WHERE user_id = ${userId} AND entity_type = 'progress_photo' ORDER BY captured_at DESC LIMIT 100`,
    sql`
      SELECT fr.id, fr.status, fr.created_at, u.id AS user_id, u.username, u.name
      FROM friend_requests fr INNER JOIN users u ON u.id = fr.requester_id
      WHERE fr.addressee_id = ${userId} ORDER BY fr.created_at DESC
    `,
    sql`
      SELECT fr.id, fr.status, fr.created_at, u.id AS user_id, u.username, u.name
      FROM friend_requests fr INNER JOIN users u ON u.id = fr.addressee_id
      WHERE fr.requester_id = ${userId} ORDER BY fr.created_at DESC
    `,
    sql`SELECT weight_unit, active_routine_id, theme_overrides FROM user_preferences WHERE user_id = ${userId} LIMIT 1`,
  ]);

  const currentUser = user[0] as { id: string; username: string; name: string | null; email: string | null } | undefined;
  if (!currentUser) return reply.code(401).send({ error: 'Unauthorized' });

  const mealPhotoRows = await sql<MealPhotoRow[]>`
    SELECT DISTINCT ON (entity_id) entity_id, object_key, mime_type
    FROM uploads
    WHERE user_id = ${userId} AND entity_type = 'meal_log_photo'
    ORDER BY entity_id, created_at ASC
  `;
  const mealPhotoByMealId = new Map(mealPhotoRows.map((photo) => [photo.entity_id, photo]));
  const mealsWithPhotos = await Promise.all(
    (meals as unknown as Array<Record<string, unknown> & { id: string }>).map(async (meal) => {
      const photo = mealPhotoByMealId.get(meal.id);
      return {
        ...meal,
        imageUrl: photo
          ? await getSignedUrl(
              storage,
              new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: photo.object_key }),
              { expiresIn: 30 * 60 },
            ).catch(() => null)
          : null,
      };
    }),
  );

  const friendActivity = await sql<{
    id: string;
    user_id: string;
    username: string;
    name: string | null;
    started_at: Date;
    status: string;
    routine_name: string | null;
    day_name: string | null;
    set_count: number;
  }[]>`
    SELECT ws.id, u.id AS user_id, u.username, u.name, ws.started_at, ws.status,
      r.name AS routine_name, rd.day_name, count(wset.id)::int AS set_count
    FROM workout_sessions ws
    INNER JOIN users u ON u.id = ws.user_id
    INNER JOIN friend_requests fr ON fr.status = 'accepted' AND (
      (fr.requester_id = ${userId} AND fr.addressee_id = ws.user_id) OR
      (fr.addressee_id = ${userId} AND fr.requester_id = ws.user_id)
    )
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
    LEFT JOIN workout_sets wset ON wset.session_id = ws.id
    GROUP BY ws.id, u.id, r.name, rd.day_name
    ORDER BY ws.started_at DESC
    LIMIT 50
  `;

  const workoutPlans = Array.from(
    (routines as unknown as Array<{
      id: string;
      name: string;
      description: string | null;
      is_preset: boolean;
      created_at: Date;
      day_id: string | null;
      day_name: string | null;
      sort_order: number | null;
      exercise_count: number;
    }>).reduce((plans, row) => {
      const existing = plans.get(row.id) ?? {
        id: row.id,
        name: row.name,
        description: row.description,
        isPreset: row.is_preset,
        createdAt: row.created_at,
        days: [] as Array<{
          id: string;
          name: string;
          sortOrder: number;
          exerciseCount: number;
          exercises: Array<{
            id: string;
            exerciseId: string;
            name: string;
            category: string;
            muscleGroup: string | null;
            sortOrder: number;
            targetSets: number | null;
            targetReps: number | null;
            targetWeight: string | null;
            trackingMode: string;
            targetDurationSeconds: number | null;
          }>;
        }>,
      };

      if (row.day_id && row.day_name) {
        existing.days.push({
          id: row.day_id,
          name: row.day_name,
          sortOrder: row.sort_order ?? 0,
          exerciseCount: row.exercise_count,
          exercises: [],
        });
      }

      plans.set(row.id, existing);
      return plans;
    }, new Map<string, {
      id: string;
      name: string;
      description: string | null;
      isPreset: boolean;
      createdAt: Date;
      days: Array<{
        id: string;
        name: string;
        sortOrder: number;
        exerciseCount: number;
        exercises: Array<{
          id: string;
          exerciseId: string;
          name: string;
          category: string;
          muscleGroup: string | null;
          sortOrder: number;
          targetSets: number | null;
          targetReps: number | null;
          targetWeight: string | null;
          trackingMode: string;
          targetDurationSeconds: number | null;
        }>;
      }>;
    }>()).values(),
  );

  const plansById = new Map(workoutPlans.map((plan) => [plan.id, plan]));
  for (const exercise of planExercises) {
    const day = plansById.get(exercise.plan_id)?.days.find((candidate) => candidate.id === exercise.day_id);
    if (!day) continue;
    day.exercises.push({
      id: exercise.id,
      exerciseId: exercise.exercise_id,
      name: exercise.name,
      category: exercise.category,
      muscleGroup: exercise.muscle_group,
      sortOrder: exercise.sort_order,
      targetSets: exercise.target_sets,
      targetReps: exercise.target_reps,
      targetWeight: exercise.target_weight,
      trackingMode: exercise.tracking_mode,
      targetDurationSeconds: exercise.target_duration_seconds,
    });
  }

  const activeRoutineId = (preferences[0] as { active_routine_id?: string | null } | undefined)?.active_routine_id ?? null;
  const activePlan = activeRoutineId ? plansById.get(activeRoutineId) : null;
  const nextPlannedDay = activePlan?.days.slice().sort((left, right) => left.sortOrder - right.sortOrder)[0] ?? null;

  const progressWithUrls = await Promise.all(
    (progress as ProgressPhotoRow[]).map(async (photo) => ({
      id: photo.id,
      captured_at: photo.captured_at,
      mime_type: photo.mime_type,
      note: photo.note,
      imageUrl: await getSignedUrl(
        storage,
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: photo.object_key }),
        { expiresIn: 30 * 60 },
      ).catch(() => null),
    })),
  );

  return reply.send({
    user: publicUser(currentUser),
    isAdmin: isAdminIdentity(currentUser),
    dashboard: {
      activeSession: activeSession[0] ?? null,
      nextSession: nextPlannedDay
        ? {
            routineId: activePlan?.id ?? null,
            routineName: activePlan?.name ?? null,
            dayId: nextPlannedDay.id,
            dayName: nextPlannedDay.name,
            exerciseCount: nextPlannedDay.exerciseCount,
          }
        : null,
      recoverySessions: recoverySessions.map((session) => ({
        endedAt: session.ended_at,
        muscleGroup: session.muscle_group,
        workingSetCount: session.working_set_count,
      })),
    },
    workoutPlans,
    exercises: (exercises as Array<{ id: string; name: string; category: string; muscle_group: string | null; demo_url: string | null; demo_source_name: string | null }>).map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      category: exercise.category,
      muscle_group: exercise.muscle_group,
      demoUrl: exercise.demo_url,
      demoSourceName: exercise.demo_source_name,
    })),
    sessions,
    nutrition: { foods, meals: mealsWithPhotos },
    fasting: { active: activeFast[0] ?? null, logs: fasts },
    progress: progressWithUrls,
    friends: {
      incoming: (incoming as unknown as Array<{ id: string; status: string; user_id: string; username: string; name: string | null }>).map(({ user_id, ...request }) => ({ ...request, userId: user_id })),
      outgoing: (outgoing as unknown as Array<{ id: string; status: string; user_id: string; username: string; name: string | null }>).map(({ user_id, ...request }) => ({ ...request, userId: user_id })),
      activity: friendActivity.map((session) => ({
        id: session.id,
        userId: session.user_id,
        username: session.username,
        name: session.name,
        startedAt: session.started_at,
        status: session.status,
        routineName: session.routine_name,
        dayName: session.day_name,
        setCount: session.set_count,
      })),
    },
    settings: preferences[0] ?? { weight_unit: 'lbs', active_routine_id: null, theme_overrides: {} },
  });
});

const close = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
};

process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ host: '0.0.0.0', port: env.PORT });
