# Transmute

Transmute is a universal fitness record: one Expo codebase for iOS, Android, and web, backed by a standalone API that connects to the deployed Coolify Postgres database.

The project is deliberately independent of the legacy Next.js app. The Expo client never connects to Postgres, R2, or NextAuth directly.

## Repository layout

```text
src/                 Expo Router client
src/app/             Shared iOS, Android, and web routes
api/                 Standalone Fastify API for Coolify
api/migrations/      Additive production database migrations
assets/transmute/    Licensed alchemical and brand SVG assets
```

## Local development

Install the Expo client dependencies and start the development server:

```sh
npm install
npm start
```

For real sign-in and registration, create a local `.env.local` file with the public URL of the deployed Transmute API:

```sh
EXPO_PUBLIC_API_BASE_URL=https://api.transmute.example
```

This is a public client setting. Never add `DATABASE_URL`, R2 credentials, JWT secrets, or other server secrets to an Expo environment file.

## Platforms

The client is shared across all supported platforms:

```sh
npm run ios
npm run android
npm run web
```

The root routes include a three-stage pre-auth introduction, username/password registration and sign-in, a four-stage first-login orientation, and the signed-in workbench.

## Web production build

Expo web is a static site. Build it for deployment with:

```sh
npx expo export --platform web
```

Coolify should serve the generated static output. Do not run `expo start` in production; it is only a local development server.

Set `EXPO_PUBLIC_API_BASE_URL` in the web build environment to the public HTTPS URL of the standalone API. The web build and native apps use the same API contract.

## API and Coolify

The API lives in [`api/`](./api). Deploy it as a **separate** Coolify application from the same Git repository:

- Base directory: `/api`
- Dockerfile: `Dockerfile`
- `DATABASE_URL`: copy the existing production Coolify Postgres URL into this server-only variable
- `JWT_ACCESS_SECRET`: a new random value of at least 32 characters; do not reuse NextAuth secrets
- `AUTH_ISSUER=transmute-api`
- `CORS_ORIGINS`: the final Transmute web URL, plus `http://localhost:8081` when local web access is needed

Before the first API deploy, apply [`api/migrations/001_mobile_sessions.sql`](./api/migrations/001_mobile_sessions.sql). It only adds the `mobile_sessions` table for hashed mobile refresh tokens; it does not modify existing user data.

The API returns short-lived access tokens and rotating refresh tokens. The Expo client stores them in Expo SecureStore; browser-cookie sessions from the old web app are not used.

## Quality checks

```sh
npm run lint
npx tsc --noEmit
npm run api:typecheck
npm run api:build
npx expo export --platform web
```

## Asset notices

Third-party SVG sources and their licenses are recorded in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
