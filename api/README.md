# Transmute API

This is the standalone server for the Expo client. The mobile client talks to this service, never to the legacy Next.js application or Postgres directly.

## Local development

```sh
cp .env.example .env.local
# Set DATABASE_URL and JWT_ACCESS_SECRET locally; do not commit either.
npm install
npm run dev
```

## Required production migration

Apply `migrations/001_mobile_sessions.sql` once to the deployed database. It creates a new additive `mobile_sessions` table for hashed refresh tokens and does not modify existing user data.

## Coolify deployment

Create a new application from this repository with `/api` as the base directory and `Dockerfile` as the Dockerfile. In Coolify, set:

- `DATABASE_URL`: the same deployed Postgres URL currently used by Gym-Micro
- `JWT_ACCESS_SECRET`: a new random secret with at least 32 characters; do not reuse `NEXTAUTH_SECRET`
- `AUTH_ISSUER=transmute-api`
- `CORS_ORIGINS`: the final web origin plus local Expo web origin if needed

Apply `migrations/001_mobile_sessions.sql` as the new API application's one-time release migration, then deploy the API. The Expo client should use the resulting public HTTPS URL through `EXPO_PUBLIC_API_BASE_URL`.

The mobile app receives only the public API base URL, for example `https://api.transmute.example`. It never receives `DATABASE_URL` or storage credentials.
