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
});

const env = envSchema.parse(process.env);
const jwtSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const sql = postgres(env.DATABASE_URL, { max: 10, idle_timeout: 20, connect_timeout: 10 });
const app = Fastify({ logger: true });
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
const planIdParamsSchema = z.object({ planId: z.string().uuid() });
const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
});
const planDaySchema = z.object({ dayName: z.string().trim().min(2).max(32) });
const planDayExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  targetSets: z.number().int().positive().max(20).optional(),
  targetReps: z.number().int().positive().max(50).optional(),
  targetWeight: z.number().nonnegative().max(2000).optional(),
});
const reorderSchema = z.object({ direction: z.enum(['up', 'down']) });
const exerciseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(['strength', 'cardio', 'mobility']).default('strength'),
  muscleGroup: z.string().trim().max(80).optional(),
});
const activePlanSchema = z.object({ routineId: z.string().uuid() });
const startSessionSchema = z.object({
  routineDayId: z.string().uuid(),
  startedAtDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const workoutSetSchema = z.object({
  exerciseId: z.string().uuid(),
  reps: z.number().int().positive().max(100),
  weight: z.number().nonnegative().max(2000).optional(),
  isWarmup: z.boolean().optional(),
});
const sessionExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  targetReps: z.number().int().positive().max(50).optional(),
  targetWeight: z.number().nonnegative().max(2000).optional(),
});
const foodSchema = z.object({
  name: z.string().trim().min(2).max(120),
  barcodeUpc: z.string().trim().regex(/^\d+$/).min(8).max(14).optional(),
  caloriesKcal: z.number().int().nonnegative().max(2000),
  servingSizeG: z.number().positive().max(5000).optional(),
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
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  consumedAt: z.string().datetime().optional(),
  items: z.array(z.object({
    foodId: z.string().uuid(),
    grams: z.number().positive().max(5000),
  })).min(1).max(20),
});
const fastSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), note: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal('end'), note: z.string().trim().max(240).optional() }),
]);
const friendUsernameSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[^\s]+$/).transform((value) => value.toLowerCase()),
});
const weightUnitSchema = z.object({ weightUnit: z.enum(['kg', 'lbs']) });
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
const mealPhotoCreateSchema = z.object({
  objectKey: z.string().min(4).max(512),
  mimeType: z.string().min(3).max(128),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
});

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
        serving_quantity?: number;
        nutriments?: {
          'energy-kcal_100g'?: number;
          proteins_100g?: number;
          carbohydrates_100g?: number;
          fat_100g?: number;
        };
      };
    };
    if (payload.status !== 1 || !payload.product) return { found: false as const, source: 'none' as const };
    return {
      found: true as const,
      source: 'openfoodfacts' as const,
      food: {
        id: null,
        name: payload.product.product_name ?? `UPC ${code}`,
        barcodeUpc: code,
        // Open Food Facts values below are the _100g fields, so the paired
        // serving value must also be 100g for meal calculations to remain true.
        servingSizeG: 100,
        caloriesKcal: numericValue(payload.product.nutriments?.['energy-kcal_100g']),
        proteinG: numericValue(payload.product.nutriments?.proteins_100g),
        carbsG: numericValue(payload.product.nutriments?.carbohydrates_100g),
        fatG: numericValue(payload.product.nutriments?.fat_100g),
      },
    };
  } catch {
    return { found: false as const, source: 'none' as const };
  } finally {
    clearTimeout(timeout);
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
  const servingSizeG = servingLine ? nutritionNumber(servingLine, [/(\d+(?:\.\d+)?)\s*g\b/i]) : null;
  const servingsPerContainer = nutritionNumber(text, [/servings?\s+per\s+container\s*[:\-]?\s*(\d+(?:\.\d+)?)/i, /about\s+(\d+(?:\.\d+)?)\s+servings?/i]);
  const caloriesKcal = nutritionNumber(text, [/calories\s*[:\-]?\s*(\d{1,4})\b/i]);
  const fatG = nutritionNumber(text, [/(?:total\s+)?fat[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*(?:g|mg)?/i]);
  const carbsG = nutritionNumber(text, [/(?:total\s+)?carbohydrate(?:s)?[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*(?:g|mg)?/i]);
  const proteinG = nutritionNumber(text, [/protein[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*(?:g|mg)?/i]);
  return {
    name,
    servingSizeText: servingLine?.trim() ?? null,
    servingSizeG,
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
    const [day] = await transaction<{ id: string; day_name: string; sort_order: number }[]>`
      INSERT INTO routine_days (id, routine_id, day_name, sort_order, created_at)
      VALUES (${randomUUID()}, ${created.id}, 'Day 1', 0, now())
      RETURNING id, day_name, sort_order
    `;
    return { ...created, day };
  });

  return reply.code(201).send({
    plan: { id: plan.id, name: plan.name, description: plan.description, createdAt: plan.created_at, days: [{ id: plan.day.id, name: plan.day.day_name, sortOrder: plan.day.sort_order, exerciseCount: 0 }] },
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

  const [deleted] = await sql<{ id: string }[]>`
    DELETE FROM routines WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING id
  `;
  if (!deleted) return reply.code(404).send({ error: 'Workout plan not found.' });
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
    const [{ count }] = await transaction<{ count: number }[]>`SELECT count(*)::int AS count FROM routine_days WHERE routine_id = ${day.routine_id}`;
    if (count <= 1) return { error: 'A workout plan must keep at least one day.', status: 409 } as const;
    await transaction`DELETE FROM routine_days WHERE id = ${day.id}`;
    return { id: day.id } as const;
  });
  if ('error' in result) return reply.code(typeof result.status === 'number' ? result.status : 400).send({ error: result.error });
  return reply.code(204).send();
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
  const [plan] = await sql<{ id: string }[]>`SELECT id FROM routines WHERE id = ${parsed.data.routineId} AND user_id = ${userId} LIMIT 1`;
  if (!plan) return reply.code(404).send({ error: 'Workout plan not found.' });
  await sql`
    INSERT INTO user_preferences (user_id, active_routine_id, weight_unit, theme_overrides, updated_at)
    VALUES (${userId}, ${plan.id}, 'lbs', '{}'::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET active_routine_id = EXCLUDED.active_routine_id, updated_at = now()
  `;
  return reply.send({ activeRoutineId: plan.id });
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
  const [session] = await sql<{ id: string; started_at: Date }[]>`
    INSERT INTO workout_sessions (id, user_id, routine_id, routine_day_id, started_at, status)
    VALUES (${randomUUID()}, ${userId}, ${day.routine_id}, ${parsed.data.routineDayId}, ${parseStartedAt(parsed.data.startedAtDate)}, 'active')
    RETURNING id, started_at
  `;
  return reply.code(201).send({ session: { id: session.id, startedAt: session.started_at } });
});

app.get('/v1/sessions/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });

  const [session] = await sql<{ id: string; status: string; started_at: Date; ended_at: Date | null; routine_name: string | null; day_name: string | null; routine_day_id: string | null }[]>`
    SELECT ws.id, ws.status, ws.started_at, ws.ended_at, ws.routine_day_id, r.name AS routine_name, rd.day_name
    FROM workout_sessions ws
    LEFT JOIN routines r ON r.id = ws.routine_id
    LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
    WHERE ws.id = ${params.data.id} AND ws.user_id = ${userId} LIMIT 1
  `;
  if (!session) return reply.code(404).send({ error: 'Workout session not found.' });

  const [plannedExercises, addedExercises, sets, libraryExercises] = await Promise.all([
    session.routine_day_id
      ? sql<{ id: string; name: string; category: string; muscle_group: string | null; target_reps: number | null; target_weight: string | null }[]>`
          SELECT e.id, e.name, e.category, e.muscle_group, rde.target_reps, rde.target_weight
          FROM routine_day_exercises rde INNER JOIN exercises e ON e.id = rde.exercise_id
          WHERE rde.routine_day_id = ${session.routine_day_id} ORDER BY rde.sort_order ASC
        `
      : Promise.resolve([]),
    sql<{ id: string; name: string; category: string; muscle_group: string | null; target_reps: number | null; target_weight: string | null }[]>`
      SELECT e.id, e.name, e.category, e.muscle_group, se.target_reps, se.target_weight
      FROM session_exercises se INNER JOIN exercises e ON e.id = se.exercise_id
      WHERE se.session_id = ${session.id} ORDER BY se.sort_order ASC
    `,
    sql<{ id: string; exercise_id: string; set_order: number; reps: number; weight: string | null; is_warmup: boolean; created_at: Date }[]>`
      SELECT id, exercise_id, set_order, reps, weight, is_warmup, created_at
      FROM workout_sets WHERE session_id = ${session.id} ORDER BY set_order ASC, created_at ASC
    `,
    sql<{ id: string; name: string; category: string; muscle_group: string | null }[]>`
      SELECT id, name, category, muscle_group FROM exercises ORDER BY name ASC LIMIT 300
    `,
  ]);

  const plannedIds = new Set(plannedExercises.map((exercise) => exercise.id));
  return reply.send({
    session: { id: session.id, status: session.status, startedAt: session.started_at, endedAt: session.ended_at, routineName: session.routine_name, dayName: session.day_name },
    exercises: [...plannedExercises, ...addedExercises.filter((exercise) => !plannedIds.has(exercise.id))].map((exercise) => ({ id: exercise.id, name: exercise.name, category: exercise.category, muscleGroup: exercise.muscle_group, targetReps: exercise.target_reps, targetWeight: exercise.target_weight })),
    libraryExercises: libraryExercises.map((exercise) => ({ id: exercise.id, name: exercise.name, category: exercise.category, muscleGroup: exercise.muscle_group })),
    sets: sets.map((set) => ({ id: set.id, exerciseId: set.exercise_id, setOrder: set.set_order, reps: set.reps, weight: set.weight, isWarmup: set.is_warmup, createdAt: set.created_at })),
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

app.post('/v1/sessions/:id/sets', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = workoutSetSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout set payload.' });
  const [session, exercise, previousSets] = await Promise.all([
    sql<{ id: string; status: string }[]>`SELECT id, status FROM workout_sessions WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1`,
    sql<{ id: string; name: string }[]>`SELECT id, name FROM exercises WHERE id = ${parsed.data.exerciseId} LIMIT 1`,
    parsed.data.isWarmup
      ? Promise.resolve([] as PersonalRecordSet[])
      : sql<PersonalRecordSet[]>`
          SELECT wset.reps, wset.weight
          FROM workout_sets wset
          INNER JOIN workout_sessions ws ON ws.id = wset.session_id
          WHERE ws.user_id = ${userId} AND wset.exercise_id = ${parsed.data.exerciseId} AND wset.is_warmup = false
        `,
  ]);
  const currentSession = session[0];
  if (!currentSession) return reply.code(404).send({ error: 'Workout session not found.' });
  if (currentSession.status !== 'active') return reply.code(409).send({ error: 'Only active sessions can be logged.' });
  if (!exercise[0]) return reply.code(404).send({ error: 'Exercise not found.' });
  const [set] = await sql<{ id: string; set_order: number; created_at: Date }[]>`
    INSERT INTO workout_sets (id, session_id, exercise_id, set_order, reps, weight, is_warmup, created_at)
    VALUES (
      ${randomUUID()}, ${currentSession.id}, ${parsed.data.exerciseId},
      (SELECT coalesce(max(set_order), 0) + 1 FROM workout_sets WHERE session_id = ${currentSession.id}),
      ${parsed.data.reps}, ${parsed.data.weight?.toString() ?? null}, ${parsed.data.isWarmup ?? false}, now()
    ) RETURNING id, set_order, created_at
  `;
  const personalRecord = parsed.data.isWarmup
    ? null
    : detectPersonalRecord(
        { reps: parsed.data.reps, weight: parsed.data.weight?.toString() ?? null },
        previousSets,
        exercise[0].name,
      );
  return reply.code(201).send({
    set: { id: set.id, exerciseId: parsed.data.exerciseId, setOrder: set.set_order, reps: parsed.data.reps, weight: parsed.data.weight ?? null, isWarmup: parsed.data.isWarmup ?? false, createdAt: set.created_at },
    personalRecord,
  });
});

app.patch('/v1/sets/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = workoutSetSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout set payload.' });
  const [updated] = await sql<{ id: string; session_id: string }[]>`
    UPDATE workout_sets wset SET exercise_id = ${parsed.data.exerciseId}, reps = ${parsed.data.reps}, weight = ${parsed.data.weight?.toString() ?? null}, is_warmup = ${parsed.data.isWarmup ?? false}
    FROM workout_sessions ws
    WHERE wset.id = ${params.data.id} AND wset.session_id = ws.id AND ws.user_id = ${userId}
    RETURNING wset.id, wset.session_id
  `;
  if (!updated) return reply.code(404).send({ error: 'Workout set not found.' });
  return reply.send({ set: { id: updated.id, sessionId: updated.session_id } });
});

app.delete('/v1/sets/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid workout set id.' });
  const result = await sql.begin(async (transaction) => {
    const [ownedSet] = await transaction<{ id: string; session_id: string }[]>`
      SELECT wset.id, wset.session_id FROM workout_sets wset
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
  return reply.send({ session: { id: updated.id, status: 'completed', endedAt: updated.ended_at } });
});

app.delete('/v1/sessions/:id', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });
  const [deleted] = await sql<{ id: string }[]>`DELETE FROM workout_sessions WHERE id = ${params.data.id} AND user_id = ${userId} RETURNING id`;
  if (!deleted) return reply.code(404).send({ error: 'Workout session not found.' });
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
    calories_kcal: number;
    protein_g: string;
    carbs_g: string;
    fat_g: string;
  }[]>`
    SELECT id, name, barcode_upc, serving_size_g, calories_kcal, protein_g, carbs_g, fat_g
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
        servingSizeG: numericValue(localFood.serving_size_g, 100),
        caloriesKcal: localFood.calories_kcal,
        proteinG: numericValue(localFood.protein_g),
        carbsG: numericValue(localFood.carbs_g),
        fatG: numericValue(localFood.fat_g),
      },
    });
  }
  return reply.send(await lookupOpenFoodFacts(params.data.code));
});

app.post('/v1/nutrition-label/parse', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = nutritionLabelOcrSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Choose a readable nutrition-label image smaller than 9 MB.' });
  const encoded = parsed.data.imageBase64.replace(/^data:[^;]+;base64,/, '');
  let worker: Worker | null = null;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');
    const result = await worker.recognize(Buffer.from(encoded, 'base64'));
    const rawText = result.data.text.trim();
    if (!rawText) return reply.code(422).send({ error: 'No readable nutrition text was found in that image.' });
    return reply.send({ ok: true, parsed: parseNutritionLabel(rawText, result.data.confidence / 100) });
  } catch (error) {
    request.log.error(error, 'Nutrition-label OCR failed');
    return reply.code(422).send({ error: 'The nutrition label could not be read. Try a clearer, tightly cropped photo.' });
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
});

app.post('/v1/foods', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const parsed = foodSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid food payload.' });
  try {
    const [food] = await sql<{ id: string; name: string; calories_kcal: number; protein_g: string; carbs_g: string; fat_g: string }[]>`
      INSERT INTO foods (id, name, barcode_upc, calories_kcal, serving_size_g, protein_g, carbs_g, fat_g, created_by_user_id, created_at)
      VALUES (${randomUUID()}, ${parsed.data.name}, ${parsed.data.barcodeUpc ?? null}, ${parsed.data.caloriesKcal}, ${parsed.data.servingSizeG?.toString() ?? null}, ${parsed.data.proteinG?.toString() ?? '0'}, ${parsed.data.carbsG?.toString() ?? '0'}, ${parsed.data.fatG?.toString() ?? '0'}, ${userId}, now())
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
  return reply.code(201).send({ meals: meals.map((meal) => ({ id: meal.id, consumedAt: meal.consumed_at })) });
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
    const [active] = await sql<{ id: string; started_at: Date; note: string | null }[]>`
      INSERT INTO active_fasts (id, user_id, started_at, note, created_at, updated_at)
      VALUES (${randomUUID()}, ${userId}, now(), ${parsed.data.note ?? null}, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET started_at = now(), note = EXCLUDED.note, updated_at = now()
      RETURNING id, started_at, note
    `;
    return reply.send({ active: { id: active.id, startedAt: active.started_at, note: active.note } });
  }
  const [active] = await sql<{ id: string; started_at: Date; note: string | null }[]>`SELECT id, started_at, note FROM active_fasts WHERE user_id = ${userId} LIMIT 1`;
  if (!active) return reply.code(404).send({ error: 'No active fast to end.' });
  const endedAt = new Date();
  const durationMinutes = Math.round((endedAt.getTime() - active.started_at.getTime()) / 60000);
  if (durationMinutes <= 0 || durationMinutes > 60 * 24 * 7) return reply.code(400).send({ error: 'Fast duration must be between 1 minute and 7 days.' });
  const [fast] = await sql<{ id: string }[]>`
    INSERT INTO fasting_logs (id, user_id, started_at, ended_at, duration_minutes, note, created_at)
    VALUES (${randomUUID()}, ${userId}, ${active.started_at}, ${endedAt}, ${durationMinutes}, ${parsed.data.note ?? active.note}, now()) RETURNING id
  `;
  await sql`DELETE FROM active_fasts WHERE id = ${active.id}`;
  return reply.send({ fast: { id: fast.id, durationMinutes } });
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

/**
 * Read model for the migrated client.  These queries intentionally use the
 * same tables and ownership rules as the Next app; the mobile client never
 * connects to Postgres directly.
 */
app.get('/v1/record', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const [user, activeSession, routines, planExercises, exercises, sessions, foods, meals, activeFast, fasts, progress, incoming, outgoing, preferences] = await Promise.all([
    sql`SELECT id, username, name, email FROM users WHERE id = ${userId} LIMIT 1`,
    sql`
      SELECT ws.id, ws.status, ws.started_at, ws.ended_at, r.name AS routine_name, rd.day_name
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
    }[]>`
      SELECT rd.routine_id AS plan_id, rd.id AS day_id, rde.id, rde.exercise_id,
        e.name, e.category, e.muscle_group, rde.sort_order,
        rde.target_sets, rde.target_reps, rde.target_weight
      FROM routine_day_exercises rde
      INNER JOIN routine_days rd ON rd.id = rde.routine_day_id
      INNER JOIN routines r ON r.id = rd.routine_id
      INNER JOIN exercises e ON e.id = rde.exercise_id
      WHERE r.user_id = ${userId}
      ORDER BY rd.sort_order ASC, rde.sort_order ASC
    `,
    sql`SELECT id, name, category, muscle_group FROM exercises ORDER BY name ASC LIMIT 300`,
    sql`
      SELECT ws.id, ws.status, ws.started_at, ws.ended_at, r.name AS routine_name, rd.day_name,
        count(wset.id)::int AS set_count
      FROM workout_sessions ws
      LEFT JOIN routines r ON r.id = ws.routine_id
      LEFT JOIN routine_days rd ON rd.id = ws.routine_day_id
      LEFT JOIN workout_sets wset ON wset.session_id = ws.id
      WHERE ws.user_id = ${userId}
      GROUP BY ws.id, r.name, rd.day_name
      ORDER BY ws.started_at DESC LIMIT 80
    `,
    sql`SELECT id, name, barcode_upc, calories_kcal, protein_g, carbs_g, fat_g, serving_size_g, serving_size_text FROM foods ORDER BY name ASC LIMIT 300`,
    sql`
      SELECT ml.id, ml.meal_type, ml.quantity, ml.consumed_at, f.id AS food_id, f.name,
        round(f.calories_kcal * (ml.quantity / coalesce(nullif(f.serving_size_g, 0), 100)))::int AS calories_kcal,
        f.protein_g, f.carbs_g, f.fat_g, f.serving_size_g
      FROM meal_logs ml INNER JOIN foods f ON f.id = ml.food_id
      WHERE ml.user_id = ${userId} ORDER BY ml.consumed_at DESC LIMIT 100
    `,
    sql`SELECT id, started_at, note FROM active_fasts WHERE user_id = ${userId} LIMIT 1`,
    sql`SELECT id, started_at, ended_at, duration_minutes, note FROM fasting_logs WHERE user_id = ${userId} ORDER BY ended_at DESC LIMIT 100`,
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
    },
    workoutPlans,
    exercises,
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
