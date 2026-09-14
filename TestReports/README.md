# Test Report — Security Bug Fixes (ID masking, evidence integrity, OTP 2FA)

This folder is the evidence trail for the end-to-end test pass on the
ID/photo masking, evidence chain-of-custody, and police OTP 2FA work, and
the four bugs that pass found and this round fixed. Everything here was
actually run — nothing is a projection from reading code.

## Methodology

No live MongoDB is reachable in this environment (MongoDB's own CDN is
blocked by the sandbox's network policy, and GitHub access is scoped to
attached repos only, which ruled out a MongoDB-wire-protocol-compatible
alternative too). Given that constraint, testing split into what's real and
what's mocked:

- **Real:** npm/pip installs, TypeScript compilation (`tsc --noEmit`, not
  just the Vite/SWC transform, which doesn't type-check), production
  builds, ESLint, the actual Express routers and middleware chain, real
  JWT signing/verification, real bcrypt hashing, a real headless-browser
  run of the login/OTP UI against a stubbed backend, and a real
  cross-language check — Python decoding JWTs that Node itself signed via
  a subprocess call to `node -e`, not a hand-rolled payload.
- **Mocked:** only the Mongoose models (`Guest`, `Hotel`, `Police`,
  `Suspect`) in the backend test suite, since there's no database to point
  them at. Everything downstream of that (routing, auth, business logic,
  response shaping) is exercised for real.

## Bugs found last round, fixed this round

All four were found by actually running things, not by re-reading the
diff — three of them only became visible once a real request went through
the real middleware chain.

### 1. Police login and OTP verification shared one rate-limit budget
**File:** `backend/routes/policeRoutes.js`, `backend/middleware/security.js`

`authRateLimit` (10 requests/15min) was the same middleware instance on
both `POST /login` and `POST /login/verify-otp`. A single password retry
could burn into the OTP step's allowance, and since the limiter keys by IP,
an entire station behind one NAT'd address would share that budget across
every officer trying to log in.

**Fix:** a separate `otpVerifyRateLimit` instance (own counter, 30/15min)
now guards `/login/verify-otp`. The per-officer 5-attempt OTP lockout
(already in `verifyPoliceOtp`) remains the real defense against guessing;
this is just a backstop, so it can afford the larger, independent budget.

**Proof:** `backend/__tests__/security.test.js` →
*"exhausting the /login rate limit does not also block /login/verify-otp"*
— drains `/login`'s budget with 11 requests, confirms it's now 429, then
confirms a fresh OTP verification on the same officer still succeeds.

### 2. A failed activity-timestamp write could deny a valid login
**File:** `backend/middleware/policeAuth.js`

`await police.updateActivity()` (a database write, throttled to once per 5
minutes) sat inside the same `try` block as JWT verification. If that
write ever threw for any reason — a transient Mongo hiccup, a validation
error — the officer got told their *token* was invalid, when the token was
actually fine. The equivalent hotel middleware already isolates this exact
kind of call in its own try/catch; police auth didn't.

**Fix:** wrapped the `updateActivity()` call in its own try/catch that
logs a warning and continues, matching the hotel pattern.

**Proof:** *"a failing activity-timestamp update does not deny an
otherwise-valid token"* — forces `updateActivity()` to reject, confirms
the protected route still returns 200.

### 3. Python's `hotel_auth` rejected police tokens for the wrong reason
**File:** `ai-agent/auth/jwt_handler.py`

The intended check was `payload["role"] in ("admin_police", "sub_police")`
— but Node signs police tokens with `role: "police"` (a generic marker)
and the actual role in a *separate* `policeRole` field. The check compared
the wrong field and could never match. It was harmless only by accident:
a police payload also lacks `hotelId`/`id`, so a different, later check
("hotel_id missing from token") caught it anyway — the wrong reason, and
fragile if the payload shape ever changes.

**Fix:** checks both `role == "police"` and `policeRole in (...)`.

**Proof:** `ai-agent/tests/test_jwt_handler.py` — signs real tokens via
Node's own `jsonwebtoken` (not a Python re-implementation) for both
`sub_police` and `admin_police` roles, confirms `hotel_auth` now rejects
each with the *intended* message ("This endpoint requires a hotel token"),
and confirms the positive cases (`hotel_auth`+hotel token,
`police_auth`+police token) and the pre-existing negative case
(`police_auth`+hotel token) all still pass.

### 4. Inconsistent Aadhaar masking format between two call sites
**File:** `backend/utils/mask.js`

Both the hotel guest list and the hotel's suspect view mask ID numbers —
equally safely — but `Suspect.suspectData` has no `idType` field, so
`maskIdNumber` couldn't tell that snapshot's number was an Aadhaar and fell
back to generic `********1234` instead of the `XXXX-XXXX-1234` style used
everywhere else.

**Fix:** a bare 12-digit all-numeric ID is now treated as Aadhaar-shaped
regardless of whether `idType` is provided (still gated so a real
non-Aadhaar ID of a different length or format isn't misclassified).

**Proof:** two new `maskIdNumber` unit tests, plus the existing suspect
masking tests updated to expect the now-consistent `XXXX-XXXX-9012`
format.

## Test results

| Suite | Result | Log |
|---|---|---|
| Backend (Jest + Supertest) | **25/25 passed** | `logs/backend-jest-output.txt` |
| AI agent (pytest) | **5/5 passed** | `logs/ai-agent-pytest-output.txt` |
| AI agent startup/validation checks | pass (see log) | `logs/ai-agent-startup-checks.txt` |
| `safe-checkin-suite-main` — `tsc --noEmit` | **0 errors** | `logs/frontend-safe-checkin-tsc.txt` |
| `safe-checkin-suite-main` — production build | **success** | `logs/frontend-safe-checkin-build.txt` |
| `police-insight-dashboard-app-main` — `tsc --noEmit` | **0 errors** | `logs/frontend-police-dashboard-tsc.txt` |
| `police-insight-dashboard-app-main` — production build | **success** | `logs/frontend-police-dashboard-build.txt` |
| Live browser run of login → OTP → dashboard flow | pass | `logs/frontend-otp-flow-browser-test.txt` + `screenshots/` |

The backend suite (`backend/__tests__/security.test.js`) is committed to
the repo, not just run once here — it'll catch a regression on any future
change to auth, masking, or the OTP flow. Same for the new
`ai-agent/tests/test_jwt_handler.py`.

## Screenshots

Captured with a headless Chromium run against the real login page, with
only the backend's two OTP endpoints stubbed (everything else — routing,
form validation, the toast on wrong password, the step transition, the
OTP input, the demo-mode banner — is the real app).

1. `01-login-page.png` — initial police login screen.
2. `02-wrong-password-rejected.png` — wrong password correctly stays on
   the login step (no OTP issued).
3. `03-otp-verification-step.png` — after a correct password, the OTP
   step renders with the demo-mode banner (no SMS/email provider
   configured, so the OTP is shown here for a demo instead of texted).
4. `04-post-otp-dashboard-navigation.png` — after a correct OTP, the app
   navigates to `/dashboard` (the console errors visible in the browser
   log at this point are the *unstubbed* dashboard-data endpoints failing
   to connect — expected, since only the login/OTP endpoints were stubbed
   for this test, and unrelated to the login flow itself, which completed
   successfully).

## What's still not covered

Same limits as the original test report: no live MongoDB means the actual
check-in file-upload flow, uniqueness constraints, and the Evidence
upload→hash→download round trip are untested against real persistence —
only against mocked models. No `NVIDIA_API_KEY` means the AI chat's actual
LLM responses are untested. Recommend verifying both once this runs
somewhere with real MongoDB/API access.
