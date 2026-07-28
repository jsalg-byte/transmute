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

Apply the numbered migrations through `migrations/005_arcana_foundation.sql` once to the deployed database. Migration 004 preserves each food's serving unit and label text so barcode and nutrition-label amounts can be logged as grams, mL, bottles, pieces, and other serving units. Migration 005 adds the Arcana journal and progression-evidence foundation without changing existing workout or nutrition records.

## Coolify deployment

Create a new application from this repository with `/api` as the base directory and `Dockerfile` as the Dockerfile. In Coolify, set:

- `DATABASE_URL`: the same deployed Postgres URL currently used by Gym-Micro
- `JWT_ACCESS_SECRET`: a new random secret with at least 32 characters; do not reuse `NEXTAUTH_SECRET`
- `AUTH_ISSUER=transmute-api`
- `CORS_ORIGINS`: the final web origin plus local Expo web origin if needed

Apply the numbered migrations through `migrations/005_arcana_foundation.sql` as the API application's release migrations, then deploy the API. The Expo client should use the resulting public HTTPS URL through `EXPO_PUBLIC_API_BASE_URL`.

The mobile app receives only the public API base URL, for example `https://api.transmute.example`. It never receives `DATABASE_URL` or storage credentials.
