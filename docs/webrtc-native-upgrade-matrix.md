# WebRTC Native Upgrade Matrix

This checklist provides a safe path to restore native WebRTC audio transport while keeping production usability via MJPEG + PCM fallback.

## Current Baseline

- Baseline coordinate: `com.infobip:google-webrtc:1.0.40793`
- Known unstable device during investigation: Xiaomi 23076RA4BI (Android 16)
- Current safe mode: MJPEG video + PCM fallback audio

## Version Candidates

Published candidates from Maven metadata (latest window):

1. `com.infobip:google-webrtc:1.0.40794`
2. `com.infobip:google-webrtc:1.0.42469`
3. `com.infobip:google-webrtc:1.0.43591`
4. `com.infobip:google-webrtc:1.0.44992`
5. `com.infobip:google-webrtc:1.0.45036`

## Build Command

Run one candidate at a time from `apps/android`:

```bash
./gradlew :app:assembleDebug -PSAFELENS_WEBRTC_COORDINATE=com.infobip:google-webrtc:1.0.45036
```

## Runtime Flags

- Enable native WebRTC attempts in dashboard only while testing:

```bash
NEXT_PUBLIC_ENABLE_WEBRTC_NATIVE=true
```

- Keep high-risk devices gated in API during rollout:

```bash
CAMERA_STREAM_WEBRTC_BLOCKLIST_PATTERNS=xiaomi 23076ra4bi
```

## Compatibility Matrix Template

Fill one row per device/version pair.

| Device | Android | WebRTC Coordinate | Start Success | 60s Stability | Audio Present | Crash (SIGABRT/libjingle) | Fallback Triggered | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Xiaomi 23076RA4BI | 16 | com.infobip:google-webrtc:1.0.40793 | no | no | no | yes | yes | baseline crash |
| Pixel 7 | 15 | com.infobip:google-webrtc:1.0.45036 |  |  |  |  |  |  |
| Samsung A54 | 14 | com.infobip:google-webrtc:1.0.45036 |  |  |  |  |  |  |

## Pass Criteria

A coordinate is rollout-ready only if all are true:

1. No native crash signatures in crash buffer across 10 consecutive starts per device class.
2. Audio remains continuous for 60 seconds with at least one joined viewer.
3. Reconnection after network toggle succeeds without app restart.
4. No regression in MJPEG + PCM fallback path when WebRTC is disabled.
