# SafeLens

SafeLens is a local-first monorepo for a multi-device monitoring platform composed of:

- a NestJS API in `apps/api`
- a Next.js dashboard in `apps/dashboard`
- a native Kotlin Android client in `apps/android`
- shared platform contracts in `packages/contracts`

## Workspace commands

```bash
npm install
npm run prisma:generate --workspace @safelens/api
npm run dev:api
npm run dev:dashboard
npm run test
```

## Local services

```bash
docker compose up -d
npm run prisma:push --workspace @safelens/api
```

The API now persists durable platform data in PostgreSQL and uses Redis for access sessions and pairing-code state.

## Google SSO

Configure the values from `.env.example` and point `GOOGLE_REDIRECT_URI` at the API callback route. When `ENABLE_GOOGLE_DEV_MOCK=true`, the API can fall back to a local mock flow for development.

## Camera Audio Streaming

- Dashboard uses WebRTC for native A/V when enabled, and can fall back to MJPEG video + PCM audio chunk playback when WebRTC is unstable.
- The Android app must have both camera and microphone runtime permissions granted for audio capture.
- API reads ICE configuration from `WEBRTC_ICE_SERVERS_JSON`. If unset, SafeLens falls back to public STUN defaults.
- For internet and carrier-grade NAT reliability, configure a TURN server in `WEBRTC_ICE_SERVERS_JSON`.
- Use `CAMERA_STREAM_WEBRTC_BLOCKLIST_PATTERNS` (comma-separated substrings matching manufacturer/model/fingerprint) to force MJPEG for known-crashy devices.
- Use `NEXT_PUBLIC_ENABLE_WEBRTC_NATIVE=true` only for compatibility test runs where native WebRTC is explicitly being validated.
- Android WebRTC library coordinate is controlled by `SAFELENS_WEBRTC_COORDINATE` in `apps/android/gradle.properties`.
