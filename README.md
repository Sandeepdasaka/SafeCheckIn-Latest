# Safe CheckIn

A guest check-in platform for hotels/lodges with built-in police verification —
built for the Indian hospitality context, where accommodation providers are
expected to record and, when needed, share guest identity data with local
police.

## About

Safe CheckIn is four services working together:

1. **Guest check-in** at the front desk (name, ID proof, photo, stay details).
2. **Automatic flagging/alerting** to police when a hotel raises a concern
   about a guest.
3. **Police-side verification**, evidence review, and case tracking, scoped
   to each officer's jurisdiction.
4. **An AI assistant** ("SafeAI") embedded in both the hotel and police apps,
   so staff can ask questions in plain English instead of building filters.

A guest's photo and ID document scans are **never viewable from the hotel
app** — only from the police dashboard, through an endpoint that requires a
police login and logs every view. See [Security notes](#security-notes)
below for why that boundary exists and how it's enforced.

## Architecture

```
                     ┌─────────────────────────┐
                     │   MongoDB (shared)       │
                     └───────────▲──────────────┘
                                 │
                    ┌────────────┴─────────────┐
                    │                           │
          ┌─────────▼─────────┐       ┌─────────▼──────────┐
          │  backend/          │       │  ai-agent/          │
          │  Node/Express API  │◄──────┤  Python/FastAPI     │
          │  :5000             │ proxy │  :8000               │
          └─────────▲─────────┘  /api/ └──────────▲───────────┘
                     │            agent            │
     ┌───────────────┴───────────┐   chat requests forwarded
     │                           │   from the backend at /api/agent/*
┌────▼─────────────────┐  ┌──────▼──────────────────────┐
│ safe-checkin-suite-   │  │ police-insight-dashboard-    │
│ main/ (receptionist)  │  │ app-main/ (police dashboard) │
│ :8081                 │  │ :8081 (or :8082 if both run) │
└───────────────────────┘  └───────────────────────────────┘
```

- The two frontends never talk to the AI agent directly — their chat pages
  call the Node backend at `/api/agent/*`, which proxies through to the
  Python service on port 8000.
- The Node backend and the Python agent connect to the **same** MongoDB
  database and must share the **same** `JWT_SECRET`, since the agent decodes
  tokens the Node backend issued.

## Tech stack

| Component | Stack |
|---|---|
| `backend/` | Node.js 18, Express 4, MongoDB + Mongoose, JWT auth (jsonwebtoken), bcrypt, multer (file uploads), node-cron |
| `safe-checkin-suite-main/` | React 18 + TypeScript, Vite, shadcn/ui + Tailwind CSS, React Router, TanStack Query, Axios, Capacitor (Android wrapper) |
| `police-insight-dashboard-app-main/` | React 18 + TypeScript, Vite, shadcn/ui + Tailwind CSS, React Router, TanStack Query, Leaflet/react-leaflet (jurisdiction map) |
| `ai-agent/` | Python 3.11, FastAPI, Motor (async MongoDB driver), python-jose (JWT), NVIDIA-hosted LLM via an OpenAI-compatible client |

Both frontends were scaffolded with [Lovable](https://lovable.dev) and use
the same design system (shadcn/ui on Tailwind), so they look and behave
consistently.

## Prerequisites

- Node.js **18** (see `backend/.nvmrc`) and npm (or `bun`, since `bun.lockb`
  files are present in both frontend apps — either works)
- Python **3.11** (see `ai-agent/.python-version`)
- A MongoDB instance (local `mongod`, or a free Atlas cluster) — the same
  database is shared by `backend` and `ai-agent`
- An API key from [build.nvidia.com](https://build.nvidia.com) for the AI
  agent (it calls NVIDIA's OpenAI-compatible endpoint, not OpenAI or
  Anthropic directly, despite those packages being listed in
  `ai-agent/requirements.txt`)

## Running each part separately

Each folder is an independent project — there's no root-level "run
everything" script (yet). Run them in this order so the backend is up before
anything that depends on it.

### 1. `backend/` — the API (port 5000)

```bash
cd backend
npm install
cp .env.example .env      # then fill in the values below
npm run dev                # nodemon, auto-restarts on changes
# or: npm start            # plain node, for production
```

Required `.env` values:

| Variable | Notes |
|---|---|
| `MONGODB_URI` | e.g. `mongodb://localhost:27017/safecheckin`. Falls back to that value if unset, but set it explicitly. |
| `JWT_SECRET` | **Required, must be ≥ 32 characters** — the server refuses to start otherwise. Generate one with `openssl rand -hex 32`. |
| `JWT_EXPIRES_IN` | Optional, defaults to `7d`. |
| `PORT` | Optional, defaults to `5000`. |
| `ALLOWED_ORIGINS` | **Required for the frontends to be able to call the API from a browser** — comma-separated, e.g. `http://localhost:8081,http://localhost:8082`. If unset, no browser origin is allowed through CORS. |
| `NODE_ENV` | `development` or `production`. |

Seed data (optional, run after the server can connect to MongoDB):

```bash
node scripts/createTestPolice.js      # creates a test police login
node scripts/seedJurisdictionData.js  # seeds jurisdiction/geo data
```

(The `npm run seed` script in `package.json` points at a `scripts/seed.js`
that doesn't exist in this repo — use the two scripts above instead.)

### 2. `ai-agent/` — the AI assistant service (port 8000)

```bash
cd ai-agent
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # then fill in the values below
uvicorn main:app --reload --port 8000
```

Required `.env` values (the service won't start without the three marked
**required**):

| Variable | Notes |
|---|---|
| `MONGODB_URI` | **Required.** Must point at the *same* database as the backend. |
| `MONGODB_DB_NAME` | Optional, defaults to `safecheckin`. |
| `JWT_SECRET` | **Required — must be the exact same value as the backend's `JWT_SECRET`.** The agent decodes tokens the Node backend issued; if these don't match, every request gets a 401. |
| `JWT_ALGORITHM` | Optional, defaults to `HS256`. |
| `NVIDIA_API_KEY` | **Required.** From build.nvidia.com. |
| `NVIDIA_MODEL` | Optional, defaults to `meta/llama-3.1-70b-instruct`. |
| `BACKEND_URL` | Optional, defaults to `http://localhost:5000`. |
| `PORT` | Optional, defaults to `8000`. |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins, same idea as the backend's. |

You normally won't call this service directly — the frontends reach it
through the backend's `/api/agent/*` proxy. Its own `/health` endpoint is
useful for checking it's up.

### 3. `safe-checkin-suite-main/` — receptionist app (port 8081)

```bash
cd safe-checkin-suite-main
npm install        # or: bun install
cp .env.example .env
npm run dev         # or: bun run dev
```

| Variable | Notes |
|---|---|
| `VITE_API_URL` | The backend's URL, e.g. `http://localhost:5000`. |

Open `http://localhost:8081`.

### 4. `police-insight-dashboard-app-main/` — police dashboard (port 8081, or 8082 if the receptionist app is already running)

```bash
cd police-insight-dashboard-app-main
npm install        # or: bun install
cp .env.example .env
npm run dev         # or: bun run dev
```

| Variable | Notes |
|---|---|
| `VITE_API_URL` | The backend's URL, e.g. `http://localhost:5000`. |

Both frontends are configured to use port **8081** by default (see each
`vite.config.ts`) — if you start the receptionist app first, Vite will
auto-shift the police dashboard to **8082** when it finds 8081 taken (which
is why the backend's default `ALLOWED_ORIGINS` guidance above includes
both).

## Ports at a glance

| Service | Default port |
|---|---|
| `backend/` | 5000 |
| `ai-agent/` | 8000 |
| `safe-checkin-suite-main/` | 8081 |
| `police-insight-dashboard-app-main/` | 8081 (auto-shifts to 8082 if 8081 is taken) |

## Security notes

This repo has had a security/privacy pass applied on top of the original
prototype:

- **Guest photos and ID documents are police-only.** They're only ever
  servable through a police-authenticated, audit-logged endpoint
  (`/api/police/guests/:id/photo/:type`) — the hotel app and the AI chat can
  no longer see, fetch, or render them.
- **ID/Aadhaar numbers are masked for the hotel app.** Every hotel-facing
  guest and suspect endpoint returns ID numbers as `XXXX-XXXX-1234`-style
  masked strings (see `backend/utils/mask.js`) — only police-facing
  endpoints (`/api/suspects/*`) return the full number. Consent capture was
  deliberately not built for this: the platform is intended for statutory
  government/police use, not a consumer product requiring opt-in consent.
- **Evidence has chain-of-custody integrity.** Every uploaded evidence file
  is SHA-256 hashed at upload time; every download re-hashes the file and
  compares it against that record, logging the result (`Integrity
  Verified` / `INTEGRITY MISMATCH`) to the evidence's own audit trail.
- **Police login requires OTP (2FA).** A correct password alone doesn't
  issue a session — it issues a one-time passcode that must be verified
  within 5 minutes (max 5 attempts) before a real token is granted. No
  SMS/email provider is wired up yet, so in non-production the OTP is
  logged server-side and echoed in the API response for demo purposes (see
  `backend/utils/otp.js` — swap `deliverOtp` for a real provider before
  using this beyond a demo).
- There is no unauthenticated static file serving or debug endpoint exposing
  the `backend/uploads/` directory.
- `backend/uploads/` (real guest ID photos in any live deployment) is
  git-ignored and was never committed to this repo.
- `JWT_SECRET` has no insecure fallback anywhere — the backend refuses to
  boot without a strong one.
- Login rate limiting is enforced at a realistic threshold rather than
  effectively disabled, with the police login and OTP-verification steps
  on **separate** rate limiters so one doesn't drain the other's budget.

This is still a project under active hardening, not a production-audited
system — treat data retention policy and encryption-at-rest for Aadhaar/ID
data as open items before using it with real guest data. See
[`TestReports/`](./TestReports/README.md) for the test methodology, the
bugs an end-to-end pass found (and fixed) in this security work, and the
evidence for both.

## Project structure

```
backend/                              Express API + MongoDB models
safe-checkin-suite-main/              Receptionist / hotel check-in app
police-insight-dashboard-app-main/    Police dashboard
ai-agent/                             FastAPI microservice for the AI chat assistant
```
