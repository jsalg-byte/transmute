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

const close = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
};

process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ host: '0.0.0.0', port: env.PORT });
