# Deploy the restricted demo

Checked against current official documentation on September 30, 2026. These instructions do not establish that a remote deployment or live voice call has passed.

## Select the tested source

Repository: https://github.com/VasuBansal7576/return-intelligence-voice

Publication branch: `codex/return-voice-demo-20260930`

Base: `fm/riv-base-v1`, commit `deac6db6b7dd9984a1636b03a5d376b914010238`

Use the approved commit from the draft PR. Preserve the original branches; no merge is needed for a preview or branch deployment. The original `main` contains only the starter README. After cloning the publication branch, run:

```sh
node --version
npm ci --ignore-scripts
npm run verify
node --test frontend/qa/voice-client.test.mjs
```

Use Node 24. The original eve build invokes a model gateway, so do not substitute `npm run build`, `eve build`, or a framework auto-detection result for `build:demo`. The independent app does not require the eve compiler.

## Import settings

Use the existing authorized GitHub connection in the user's Vercel Hobby account. Select the publication branch or its exact commit. Keep the project on Hobby; do not accept a paid upgrade, add-on, or trial to continue.

| Setting | Value |
| --- | --- |
| Root directory | Repository root |
| Framework preset | Other |
| Node version | 24.x, also pinned in package.json |
| Install command | npm ci --ignore-scripts |
| Build command | npm run build:demo |
| Output directory | dist/frontend |
| Fluid compute | true in vercel.json |
| Function entry | api/server.ts |
| Function duration | 300 seconds |

`api/server.ts` exports a Node HTTP server without listening in hosted mode. Its `upgrade` listener uses `ws`. This matches Vercel's documented Node server pattern. The API rewrite applies to upgrade requests too. Exact route/query behavior still needs the preview smoke checks below. [Vercel WebSockets](https://vercel.com/docs/functions/websockets)

Node 24 is supported; `engines.node` pins the major version. [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

Hobby's Fluid function limit is 300 seconds. The app ends voice at 180 seconds and idle voice at 30 seconds. The provider token independently caps its session at 180 seconds. [Duration limits](https://vercel.com/docs/functions/configuring-functions/duration)

The build copies seven app files to `dist/frontend`, excluding QA scripts and captures. The function includes this output and the evaluation/build reports. TypeScript checks include `api/**/*.ts`. [Function configuration](https://vercel.com/docs/project-configuration/vercel-json#functions)

## Configure durable private storage

1. Use only the approved isolated Supabase Free project with synthetic data.
2. Apply both migration files in lexical order:
   - `20260930042724_return_voice_durable_state.sql`
   - `20260930053014_voice_instance_control.sql`
3. Verify all four private tables have RLS. Verify neither `anon` nor `authenticated` can access those tables or execute any of the seven `riv_*` RPCs. Local embedded checks do not replace these remote checks.
4. Keep `riv_private` outside the exposed schemas. RPCs use `SECURITY INVOKER` and explicit server-role grants. Their predicates enforce signed-browser ownership because the server role itself bypasses RLS.
5. Through the approved secure credential setup, configure server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the intended deployment environment. Never put these in browser code, public variables, chat, source, or URLs.
6. Set `RIV_STORAGE=supabase` and `RIV_DEPLOYMENT=production`. Hosted mode fails closed when storage is missing or misspelled.
7. Keep `RIV_VOICE_APPROVED=false` for initial text-mode validation.

The adapter sends new `sb_secret_` keys on `apikey`, not as a JWT bearer token. Only legacy JWT keys receive both headers. It calls the approved HTTPS project host over the REST Data API, so it needs no direct PostgreSQL connection pool or database password. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)

A separate `RIV_SESSION_SIGNING_SECRET` may be configured through an approved secret path. Otherwise the existing backend secret signs the cookie. Keep the signing value stable across instances and deployments. Changing it invalidates existing browser ownership cookies. Cookies are HttpOnly, Secure, SameSite=Strict, and expire after 24 hours. This is demo-browser isolation, not real customer authentication.

## Verify the preview before voice

- Open `/api/health` and `/api/bootstrap`. Confirm HTTP 200, durable signed-browser storage, and disabled voice.
- Create a session through the UI. Confirm nested `/api/sessions/:id/messages`, proposal, and confirmation routes work.
- Check the response cookie is Secure and HttpOnly and private API responses are `no-store`.
- In another browser profile, request the first session and its stop endpoint. Expect 404; the merchant view must show only the second profile's records.
- Complete one synthetic resolution. Reload its session from a fresh invocation, then retry the same confirmation. Expect the same record ID, with one ledger resolution.
- Test a new deployment against the same database and signing secret. State and the reserved voice allowance must survive.
- Confirm the public static output does not serve QA scripts, environment files, local ledgers, or source archives.
- An unapproved `/api/voice/ws?sessionId=...&ticket=...` upgrade must fail without a provider request. After voice approval, verify a valid ticket reaches the upgrade listener with its original path and query intact.

If the branch is initially deployed as a preview, configure its preview environment deliberately. A production alias requires its own approved origin and matching environment variables. Do not disable deployment protection or broaden the audience without approval.

## Enable bounded native voice

Keep every approval flag unset until the corresponding operator check is complete.

- `ASSEMBLYAI_API_KEY`: server-only credential supplied through an approved secure path
- `RIV_VOICE_APPROVED=true`: native API use approved
- `RIV_FREE_CREDIT_BALANCE_VERIFIED=true`: current free-credit and billing checks completed
- `RIV_MAX_RESERVED_VOICE_SECONDS`: approved cumulative ceiling, 180 to 10800 seconds
- `RIV_PUBLIC_VOICE_APPROVED=true`: the hosted demo audience approved
- `RIV_PUBLIC_VOICE_ORIGIN`: exact HTTPS deployment origin, without a path

The first migration creates a database ceiling of zero. An authorized operator sets `riv_private.voice_budget.max_seconds` to the approved total. Both runtime and database ceilings apply in one atomic reservation. Do not reset `reserved_seconds` to regain capacity. A short or failed call still consumes its full reservation. The app allows only one active lease.

No provider token reaches the browser. The browser receives a one-use local proxy ticket. The proxy fixes managed-native configuration and rejects browser `session.update`, model overrides, and fabricated tool results. No LLM Gateway override is included.

Use the live checklist to test a spoken exchange, interruption, refund-only request, an ambiguous field, and termination. Check actual account usage after closed sessions have appeared. A ready flag alone is not proof of credit availability or zero spending.

## Restarts and cross-instance control

An established WebSocket stays on its accepting instance. Separate HTTP requests and new connections can reach other instances. Durable state must therefore remain in Supabase. [Vercel connection lifecycle](https://vercel.com/docs/functions/websockets#manage-persistent-state)

The browser ends the active socket with `session.end`. The REST fallback records a durable cancellation request and returns `stopRequested: true, providerEnded: false`. It does not claim the provider acknowledged termination. The socket owner checks durable cancellation every two seconds after each completed check. A storage error ends the connection safely. A provider `session.ended` event is the acknowledgment; only then may the active lease be released early. The cumulative reservation is never refunded.

The socket owner also refreshes committed session state. It announces each newly committed resolution once, even when a different HTTP instance executed confirmation. Reconnects seed existing outcomes without presenting them as new actions. This path is tested with independent observer/request contexts and embedded PostgreSQL.

There is no automatic voice reconnection. A new connection requires a deliberate user start, a fresh single-use ticket, and another full reservation. After a crash, stored session data survives; speech resumes as a new provider session. The active lease may remain until its bounded expiry. Hard crashes cannot guarantee delivery of `session.end`, so the provider's 180-second cap remains essential.

The 180-second timer includes provider initialization; slow setup reduces usable talk time. HTTP/DB latency affects cancellation and resolution notification latency, which is not claimed to be instantaneous. Simultaneous state writes may return a safe revision conflict rather than silently overwrite each other.

## Verified locally and still pending

Local verification covers the exported server over real local HTTP/WebSocket transport, SQL ACLs and transactions, cross-instance cancellation and resolution observations, mocked 180/30-second timers, fixed native configuration, and the browser-only output directory. No remote provider call is used by these checks.

Still required: the actual Vercel traced bundle and rewrites, the actual Supabase API/privileges and persistence, native audio and model tool behavior, interruption, microphone permission, and post-call usage. The prototype does not connect to commerce login, live inventory, payments, shipping, or a real support desk.
