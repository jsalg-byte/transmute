import { createHash, randomBytes, randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import { compare, hash } from 'bcryptjs';
import Fastify from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import postgres from 'postgres';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  AUTH_ISSUER: z.string().min(1).default('transmute-api'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
});

const env = envSchema.parse(process.env);
const jwtSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const sql = postgres(env.DATABASE_URL, { max: 10, idle_timeout: 20, connect_timeout: 10 });
const app = Fastify({ logger: true });

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

function refreshTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(user: Pick<UserRow, 'id' | 'username' | 'name'>) {
  return { id: user.id, username: user.username, name: user.name ?? user.username };
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

function parseStartedAt(startedAtDate: string | undefined) {
  if (!startedAtDate) return new Date();

  const [yearRaw, monthRaw, dayRaw] = startedAtDate.split('-');
  const startedAt = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw), 12, 0, 0));
  return Number.isNaN(startedAt.getTime()) ? new Date() : startedAt;
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
  if ('error' in result) return reply.code(result.status ?? 400).send({ error: result.error });
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

  const [plannedExercises, addedExercises, sets] = await Promise.all([
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
  ]);

  const plannedIds = new Set(plannedExercises.map((exercise) => exercise.id));
  return reply.send({
    session: { id: session.id, status: session.status, startedAt: session.started_at, endedAt: session.ended_at, routineName: session.routine_name, dayName: session.day_name },
    exercises: [...plannedExercises, ...addedExercises.filter((exercise) => !plannedIds.has(exercise.id))].map((exercise) => ({ id: exercise.id, name: exercise.name, category: exercise.category, muscleGroup: exercise.muscle_group, targetReps: exercise.target_reps, targetWeight: exercise.target_weight })),
    sets: sets.map((set) => ({ id: set.id, exerciseId: set.exercise_id, setOrder: set.set_order, reps: set.reps, weight: set.weight, isWarmup: set.is_warmup, createdAt: set.created_at })),
  });
});

app.post('/v1/sessions/:id/sets', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });
  const params = idParamsSchema.safeParse(request.params);
  const parsed = workoutSetSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid workout set payload.' });
  const [session, exercise] = await Promise.all([
    sql<{ id: string; status: string }[]>`SELECT id, status FROM workout_sessions WHERE id = ${params.data.id} AND user_id = ${userId} LIMIT 1`,
    sql<{ id: string }[]>`SELECT id FROM exercises WHERE id = ${parsed.data.exerciseId} LIMIT 1`,
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
  return reply.code(201).send({ set: { id: set.id, exerciseId: parsed.data.exerciseId, setOrder: set.set_order, reps: parsed.data.reps, weight: parsed.data.weight ?? null, isWarmup: parsed.data.isWarmup ?? false, createdAt: set.created_at } });
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

/**
 * Read model for the migrated client.  These queries intentionally use the
 * same tables and ownership rules as the Next app; the mobile client never
 * connects to Postgres directly.
 */
app.get('/v1/record', async (request, reply) => {
  const userId = await requireUserId(request.headers.authorization);
  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  const [user, activeSession, routines, exercises, sessions, foods, meals, activeFast, fasts, progress, incoming, outgoing, preferences] = await Promise.all([
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
    sql`SELECT id, name, calories_kcal, protein_g, carbs_g, fat_g, serving_size_text FROM foods ORDER BY name ASC LIMIT 300`,
    sql`
      SELECT ml.id, ml.meal_type, ml.quantity, ml.consumed_at, f.id AS food_id, f.name,
        f.calories_kcal, f.protein_g, f.carbs_g, f.fat_g
      FROM meal_logs ml INNER JOIN foods f ON f.id = ml.food_id
      WHERE ml.user_id = ${userId} ORDER BY ml.consumed_at DESC LIMIT 100
    `,
    sql`SELECT id, started_at, note FROM active_fasts WHERE user_id = ${userId} LIMIT 1`,
    sql`SELECT id, started_at, ended_at, duration_minutes, note FROM fasting_logs WHERE user_id = ${userId} ORDER BY ended_at DESC LIMIT 100`,
    sql`SELECT id, object_key, mime_type, size_bytes, note, captured_at FROM uploads WHERE user_id = ${userId} AND entity_type = 'progress_photo' ORDER BY captured_at DESC LIMIT 100`,
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

  const adminValues = new Set(['mzootfb@gmail.com', 'mzootfb']);
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
        days: [] as Array<{ id: string; name: string; sortOrder: number; exerciseCount: number }>,
      };

      if (row.day_id && row.day_name) {
        existing.days.push({
          id: row.day_id,
          name: row.day_name,
          sortOrder: row.sort_order ?? 0,
          exerciseCount: row.exercise_count,
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
      days: Array<{ id: string; name: string; sortOrder: number; exerciseCount: number }>;
    }>()).values(),
  );

  return reply.send({
    user: publicUser(currentUser),
    isAdmin: adminValues.has(currentUser.username.toLowerCase()) || adminValues.has(currentUser.email?.toLowerCase() ?? ''),
    dashboard: { activeSession: activeSession[0] ?? null },
    workoutPlans,
    exercises,
    sessions,
    nutrition: { foods, meals },
    fasting: { active: activeFast[0] ?? null, logs: fasts },
    progress,
    friends: { incoming, outgoing },
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
