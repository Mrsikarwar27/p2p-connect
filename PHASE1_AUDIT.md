# Phase 1 — Full Audit (corrected per instructions)

CONFIRMED BUGS:
1. render.yaml + build: no rootDir, no root package.json, buildCommand references backend-only `render-build`. (render.yaml:6-7)
2. CLIENT_URL missing; production CORS defaults to localhost:5173. (render.yaml; backend/src/config/env.ts:15; backend/src/server.ts:21-23,52-58)
3. No TURN — getRtcConfig() only STUN. (frontend/src/types/webrtc.ts:13-19)
4. useMediaStream.start() — NotFoundError branch leaves started=false with no stream. (useMediaStream.ts:77-122)
5. switchCamera broken — old track not removed cleanly, streamRef stale, Communication reads stale stream. (useMediaStream.ts:160-218; Communication.tsx:72-80)
6. VideoPanel swap broken — separate isLocalMain state; remoteRef/localVideoRef srcObject effects ignore swap state. (VideoPanel.tsx:23, 127-131, 36-40) [DO NOT TOUCH muted logic]
7. Offer glare — no signalingState guard when creating offers; retry loop fine. Fix signalingState guard, not retry stop. (Communication.tsx:138-147; useWebRTC.ts:300-313, 425-435; services/webrtc.ts:149-159)
8. Watch-together late join — signaling.ts forwards watch:sync but never calls sessions.setWatchState(); getWatchState() returns default. (signaling.ts:178-194; sessionManager.ts:81-91)
9. Rejoin/initiator role — peers[0] = initiator; if initiator disconnects/stale, new peer can become initiator incorrectly. Need cleanup + role verification. (sessionManager.ts:53-67, 130-151; signaling.ts:91)
10. React StrictMode double mount — socket join emitted twice; media started twice; effects lack full cleanup. (main.tsx:6-9; Communication.tsx:87-134, 150-158)

ADDITIONAL REAL BUGS FOUND:
11. File transfer cancel missing: no "file-cancel" message; sender must notify receiver; blob URL cleanup. hooks/useFileTransfer.ts dead. (services/fileTransfer.ts; hooks/useFileTransfer.ts)
12. Signaling security: webrtc-offer / webrtc-answer / ice-candidate don't verify peer belongs to session (watch:sync does). (signaling.ts:128-159)
13. Session IDs use Math.random instead of CSPRNG. (sessionManager.ts:6-28)
14. ICE recovery: connectionState "disconnected" mapped directly to "failed"; no restartIce() attempt. (useWebRTC.ts:39-45; services/webrtc.ts)
15. Production UI leak: Communication.tsx renders debug line with sock/joined/init/pc/chat/file/ch. (Communication.tsx:335-339)
16. Build trap: services/socket.ts uses VITE_SIGNALING_URL verbatim — localhost baked in. (services/socket.ts:5-11)
17. Watch-together: backend WatchPayload doesn't declare "sync" action. (signaling.ts:28-35)

ADDED BUGS (missed initially):
A. Landing.tsx UX — Create and Join not always visible; join requires creating session first. (Landing.tsx:112-148)
B. Ghost peer — Communication unmount doesn't emit leave-session; same socket joins twice (create + join); server broadcasts duplicate peer-joined. (Communication.tsx:166-175; signaling.ts:55-105; sessionManager.ts)
C. File cancel — sender must notify receiver with control message; revoke blob URLs; delete/useFileTransfer hook correctly. (hooks/useFileTransfer.ts; Communication.tsx; types/file.ts)
D. Signaling security + CSPRNG session IDs. (signaling.ts:128-159; sessionManager.ts:6-28)
E. ICE recovery — treat "disconnected" temporary; restart from initiator. (useWebRTC.ts:39-45; services/webrtc.ts)
F. Production UI debug line. (Communication.tsx:335-339)
G. Build trap VITE_SIGNALING_URL localhost baked in. (services/socket.ts:5-11)
H. Backend WatchPayload missing "sync". (signaling.ts:28-35)

NOT BUGS (skip per correction):
- ICE candidate queueing (#12 original) — NOT A BUG, skip.
- Data-channel isChat check (#13 original) — NOT A BUG, skip.
- Offer retry loop stop condition — retry stops correctly when channelOpen is true. Fix is signalingState guard, not retry stop.
- VideoPanel muted logic — CORRECT as-is.
