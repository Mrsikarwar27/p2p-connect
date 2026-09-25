# Deploy P2P Connect to Render

## Overview
Single Render Web Service that serves both:
- **Backend** (Socket.IO signaling on `/socket.io`, health on `/health`)
- **Frontend** (React SPA served statically, all other routes)

---

## Prerequisites
- GitHub account with this repo pushed
- Render account (free tier works)

---

## One-Time Setup

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/p2p-connect.git
git push -u origin main
```

### 2. Create Render Web Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Configure:
   ```
   Name:           p2p-connect
   Runtime:        Node
   Build Command:  npm run render-build
   Start Command:  npm start
   Plan:           Free
   ```

### 3. Add Environment Variables
In Render dashboard → Environment tab, add:
| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render requires this) |
| `CLIENT_URL` | `https://p2p-connect.onrender.com` (replace with your actual URL after first deploy) |

### 4. Deploy
Click **Create Web Service**. First build takes ~3-5 min.

---

## How It Works

### Build Process (`npm run render-build`)
```bash
# 1. Install frontend deps & build
cd frontend && npm install && npm run build
#    → outputs to frontend/dist/

# 2. Compile backend TypeScript
tsc -p tsconfig.json
#    → outputs to backend/dist/
```

### Runtime (`npm start`)
```
node dist/server.js
```
- Express serves `frontend/dist/` as static files
- SPA fallback: `GET *` → `index.html`
- Socket.IO on `/socket.io` (WebSocket + polling)
- Health check on `/health`

---

## Local Development (Unchanged)
```bash
# Terminal 1 - Backend
cd backend
npm install
npm run dev          # :5000

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev          # :5173
```

---

## After Deploy

1. **Get your URL** from Render dashboard (e.g., `https://p2p-connect-xyz.onrender.com`)
2. **Update `CLIENT_URL`** in Render env vars to match
3. **Redeploy** (Settings → Manual Deploy → Deploy latest commit)

---

## Testing Checklist
- [ ] `https://your-app.onrender.com/health` → `{"status":"ok"}`
- [ ] Open in two browser tabs (normal + incognito)
- [ ] Create session in Tab A, join from Tab B
- [ ] Chat messages deliver
- [ ] File transfer works
- [ ] Video/audio works (if camera/mic available)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails on frontend | Check `frontend/package.json` has `vite` in devDependencies |
| Socket.IO 404 | Ensure `rewrites` not needed; Render passes all traffic to Node |
| CORS errors | `CLIENT_URL` must exactly match your Render URL (include `https://`) |
| WebRTC fails on mobile | Requires HTTPS (Render provides) + valid TURN server for NAT traversal |

---

## Adding TURN Server (Optional, for better connectivity)
1. Get free TURN credentials from [metered.ca](https://www.metered.ca/tools/openrelay/) or [Twilio](https://www.twilio.com/docs/stun-turn)
2. Add to Render env vars:
   ```
   VITE_STUN_SERVER=stun:stun.l.google.com:19302
   VITE_TURN_SERVER=turn:your-turn-server.com:3478
   VITE_TURN_USERNAME=your-username
   VITE_TURN_CREDENTIAL=your-password
   ```
3. Update `frontend/src/types/webrtc.ts` to read these from `import.meta.env`

---

## Cost
- **Free tier**: 750 hrs/month, spins down after 15 min inactivity
- **Paid ($7/mo)**: Always on, custom domains, more resources

---

## Files Changed for Render
| File | Purpose |
|------|---------|
| `backend/src/server.ts` | Serves `frontend/dist` in production, SPA fallback |
| `backend/package.json` | `render-build` script builds both apps |
| `render.yaml` | Render service configuration |
| `frontend/src/services/socket.ts` | Auto-detects same-origin in production |