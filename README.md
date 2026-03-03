# Landscape Generator — Full Stack

## Architecture
- **backend/**  → Node.js/Express on Railway ($5/month) — long-running agent jobs, SSE streaming
- **frontend/** → React/Vite on Vercel (free) — the UI everyone with the URL can access

## What it does
1. Fill in a domain brief → pipeline runs 9 parallel Claude API calls with web search
2. Watch logs stream live as vendors, categories, and scores are generated
3. Review: filterable vendor grid, category cards, capability matrix — all with expandable drawers
4. Edit: Download Excel → edit in Excel → Import Excel back in
5. Approve → Deploy to Vercel (auto) → live URL returned
6. Export JSON for your web team to integrate into the main website

## Deploy in 4 steps

### 1. Push to GitHub
Push this whole repo to a new GitHub repo.

### 2. Deploy backend to Railway
- railway.app → New Project → Deploy from GitHub → select backend/ folder
- Add env vars: ANTHROPIC_API_KEY (required), VERCEL_TOKEN (optional, for auto-deploy)
- Copy your Railway URL: https://your-app.up.railway.app

### 3. Deploy frontend to Vercel
- vercel.com → New Project → Import GitHub → select frontend/ folder
- Add env var: VITE_API_URL=https://your-railway-url.up.railway.app
- Deploy → get your shareable URL

### 4. Share
Send anyone the Vercel URL. No install required.
- If ANTHROPIC_API_KEY is on Railway → they use your shared key
- If not → they paste their own key in the form

## Local development
```bash
# Terminal 1
cd backend && npm install && node server.js

# Terminal 2
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

## Editing workflow
1. Generate landscape → Review
2. Export Excel → edit vendor names, scores, descriptions in Excel
3. Import Excel → data updates in the UI immediately
4. Approve → Deploy

## Two output formats
- **Vercel prototype** — live interactive site for stakeholders and builders
- **JSON export** — schema-consistent data for your web team to integrate into main website
