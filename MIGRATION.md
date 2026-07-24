# Transmute mobile architecture

## Decision

`transmute-mobile` is the primary client repository. Its `api/` directory is a standalone server deployed as a separate Coolify application and connects to the existing production Postgres database. The legacy Next.js app is not part of the mobile request path and can be retired independently.

The Expo client calls only the public standalone API URL through `EXPO_PUBLIC_API_BASE_URL`. It must never import database code, S3 credentials, Next server actions, or browser-cookie authentication.

## Mobile authentication contract

The API uses the existing production `users` table and an additive `mobile_sessions` table:

1. `POST /v1/auth/register` creates a user and returns a mobile session.
2. `POST /v1/auth/login` verifies the existing username/password credential and returns a mobile session.
3. `POST /v1/auth/refresh` rotates a hashed refresh token.
4. `POST /v1/auth/logout` revokes the current refresh token.
5. `GET /v1/me` accepts `Authorization: Bearer <access-token>`.

Access tokens are signed by the standalone API and expire after 15 minutes. Refresh tokens expire after 30 days, are stored only in Expo SecureStore on-device, and are stored only as hashes in Postgres. Do not reuse `NEXTAUTH_SECRET` or browser cookies.

## Deployment boundary

- Apply `api/migrations/001_mobile_sessions.sql` once to the production database as part of the standalone API release.
- Configure `DATABASE_URL` and `JWT_ACCESS_SECRET` only in the new Coolify application.
- Configure the Expo client with the API's public HTTPS URL only.
- Keep OCR, R2 signing, barcode lookup, and all future data APIs in `api/`; native capture and uploads happen in Expo.

## Current scope

- Three-stage pre-auth Transmute introduction.
- Four-stage first-login orientation flow.
- Native username/password registration, sign-in, session storage, sign-out, and current-user lookup against the standalone API.

## Verification

Run `npm run lint`, `npx tsc --noEmit`, `npm run api:typecheck`, and `npm run api:build`. Browser verification is intentionally left to the user.
