# P2P Connect

1-to-1 peer-to-peer communication: text messaging, audio/video calling, file sharing over WebRTC.
Signaling only via Socket.IO. No database, no accounts, no storage.

## Structure

- `frontend/` — React + TypeScript + Vite + Tailwind
- `backend/` — Node + TypeScript + Express + Socket.IO (signaling only)

## Run

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Env:

- Frontend: copy `.env.example` to `.env` (`VITE_SIGNALING_URL`, `VITE_STUN_SERVER`)
- Backend: copy `.env.example` to `.env` (`PORT`, `CLIENT_URL`)

## Test with two browsers

Open app in two windows (e.g. normal + incognito), create ID in A, join from B.
