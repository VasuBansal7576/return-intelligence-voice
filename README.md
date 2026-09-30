# return-intelligence-voice

AI voice agent for returns, revenue recovery and product intelligence — AssemblyAI prototype for The Souled Store.

When a customer returns a product, the agent asks for product feedback in natural
conversation and suggests genuine alternates from the same brand. It knows brand
policies and catalog, fetches customer and order history fast and categorised,
handles edge cases explicitly, and saves structured learnings.

See the research report at `data/` (fleet records, not committed) once the
first investigation lands. Product spec lives in upcoming PRD docs.

---

# Return Intelligence Voice

A voice returns prototype that diagnoses why a product failed, proposes a grounded resolution, and saves product feedback.

This is an independent project inspired by The Souled Store. It has no brand affiliation. Customer accounts, orders, inventory, returns, refunds, and shipments are simulated. The public catalog contains 40 dated product snapshots with official source links. An additional 37 synthetic products remain as regression fixtures.

## Run the interactive demo

Use Node 24.

```sh
npm ci --ignore-scripts
npm run dev:demo
```

Open `http://127.0.0.1:8787`. The local guided-text mode needs no API key or model call. It uses deterministic text rules and the real application engines. It does not demonstrate speech quality or model reasoning.

Select **Measured, sourced alternatives** to compare a synthetic order for TSS Originals: Midnight with catalog-backed alternatives. Product facts, garment measurements, unknown attributes, simulated stock, and price differences remain separate.

## Verify the implementation

```sh
npm run verify
npm run build:demo
node --test frontend/qa/voice-client.test.mjs
```

The scenario report records its source hashes and distinguishes domain assertions from unrun live model/audio checks. The app flags a report when the current source differs. SQL checks use embedded PostgreSQL, not a production Supabase project.

The original eve agent remains under `agent/agent.ts` and `agent/tools/`. Its original `npm run build` invokes the eve compiler and can contact a model gateway. Use `build:demo` for this app. No Gateway is needed by the new voice path.

## Architecture

- Browser interface: plain JavaScript, CSS, and AudioWorklet capture/playback
- Application server: Node 24 HTTP and WebSocket handlers
- Voice: AssemblyAI managed native model, STT, and TTS through a server-side proxy
- Live interpretation: schema-constrained model tool calls with exact transcript evidence
- Policy, ranking, inventory checks, proposals, and simulated state changes: TypeScript application logic
- Local records: JSONL, for one local process
- Hosted state: private Supabase tables with signed browser ownership, atomic commits, and bounded voice reservations
- Hosting target: Vercel Node 24 Functions with a 300-second function limit and 180-second voice-session limit

Live voice remains disabled until the operator verifies free credits and billing controls, approves credentials, configures durable limits, and runs the live checklist. Provider credentials never reach the browser. The proxy rejects client model configuration and fabricated tool results.

## Deploy this app on Vercel

Use the reviewed `codex/return-voice-demo-20260930` branch of [VasuBansal7576/return-intelligence-voice](https://github.com/VasuBansal7576/return-intelligence-voice). It starts from `fm/riv-base-v1` at `deac6db6b7dd9984a1636b03a5d376b914010238`. The original `main` branch does not contain this app. Verify the approved commit before import; do not merge just to deploy.

- Root directory: repository root
- Framework preset: Other
- Node: 24.x
- Install: `npm ci --ignore-scripts`
- Build: `npm run build:demo`
- Output: `dist/frontend`
- Fluid compute: enabled explicitly in `vercel.json`
- Function: `api/server.ts`, 300 seconds

The build copies only the seven browser app files into the public output. `api/server.ts` exports the HTTP server, which owns both REST and WebSocket upgrades. No custom Next.js upgrade API is needed. Keep the checked-in API rewrite.

Configure the isolated Supabase project and both ordered migrations before testing private sessions. Keep live voice disabled initially. Follow [the deployment runbook](docs/DEPLOYMENT.md) for server-only variables, branch import, two-browser tests, restart checks, and the remaining live-provider gates.

## Boundaries

- Every new demo session creates an isolated synthetic copy of the seed order. Within that run, duplicate or conflicting resolutions are rejected.
- Public product facts are captured snapshots. Inventory is synthetic, pooled by size across colors. A listed size is not live stock evidence.
- Missing GSM, garment measurements, colors, and material facts remain unknown.
- A positive recommendation is not proof that a garment will fit or feel comfortable.
- Merchant metrics describe recorded demo actions, not measured commercial impact. Replacement keep rates are unmeasured.
- The app stores text transcripts, preference evidence, and insights. It does not store raw audio. AssemblyAI's retention is separate and must not be represented as controlled by the app.
- **Start a new demo** retains previous records. It is not a delete action.

See [the full PRD](docs/PRD.md), [data and security controls](docs/SECURITY_AND_DATA.md), [deployment setup](docs/DEPLOYMENT.md), and [live validation checklist](evals/live-voice-checklist.md).

## Private historical replay and automated audio preparation

The complete fixture return/exchange engine remains available. Separately, `server/private/history.ts` loads ignored local history per session; `server/private/replay.ts` keeps an immutable already-refunded historical source and persists an explicit app-owned `replay_selection`. No real return, exchange, refund, retained revenue or current merchant eligibility is claimed. Private routes require local-only mode and explicit `RIV_PRIVATE_REPLAY_ENABLED=true`; history stays under ignored `.private/`, outside source/deployment archives. Real account history is never committed.

The browser voice client accepts labeled `test-audio` PCM16 mono 24 kHz through the same proxy after actual `session.ready`. Locally observed events preserve approval/budget limits and a 180-second call maximum. This prepares automated customer input; it does not clone a voice, fake agent output or verify physical microphone/provider operation. See `docs/TEST_AUDIO_INPUT.md` and `docs/BACKEND_QA.md`.

Voice remains disabled by default with zero approved budget. Hosted/private-history/provider integration and the selected live-console redesign require separate completion and verification.
