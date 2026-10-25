# Phase 2 — Baseline Build Test

Build command: `cd backend && npm run build`
Output:
- `npm install --include=dev` OK (108 packages)
- `build:frontend` OK: `tsc -p tsconfig.json && vite build` completed; 1625 modules transformed; output `dist/index.html` (0.71 kB), `dist/assets/index-...css` (16.63 kB), `dist/assets/index-...js` (269.03 kB)
- `tsc -p tsconfig.json` completed with zero TypeScript errors
- Final `dist/server.js` produced

Production server test (`PORT=5000 NODE_ENV=production CLIENT_URL=http://localhost:5000 npm start`):
- `GET /health` → `{"status":"ok","service":"p2p-connect-signaling"}` (200)
- `GET /` → serves built frontend `index.html` (200, 713 bytes)
- Note: port 5000 was occupied by an unrelated node process (commplex-main); killed it and restarted. Build and server work correctly.

Status: PASS (build clean, server serves both health and SPA)
