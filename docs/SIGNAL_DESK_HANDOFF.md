# Signal Desk integration

Isolated checkout: `/Users/vasu/Documents/Codex/2026-09-30/task-7/riv-ui`, branch `signal-desk`, based on owner backend commit `9010d64f0a1b2bdbcb812e1911e1662b8ae4eb1e`. No owner checkout/private data was edited or copied.

UI scope: frontend/app.js, art.js, catalog-images.js, styles.css, exact official photo assets, UI test/capture helpers, package UI test entry, browser asset build/verification lists, this handoff and design QA report. Backend policy/API/security/budget logic unchanged. Build lists preserve owner demo-capture.js.

## Integration

Apply the exported task-7/riv-ui.patch on owner branch9010d64 or later with `git apply --3way`, or fetch the local isolated branch and cherry-pick the UI commits. Check current owner edits before applying. Do not overwrite owner frontend/voice-client.js, demo-capture.js, server, agent or private source changes. Only publisher/parent should integrate or push.

Use Node24 via:
`PATH=/tmp/riv-npm-cache/_npx/387698761821791d/node_modules/node/bin:$PATH npm run verify`

Start public-style offline QA with `PORT=8897 RIV_STORAGE=local npm run dev:demo`. Voice remains unconfigured. Public defaults to Demo customer mode; returning/new customer story selector and freeform feedback use real local engine. Suggested lines are optional test inputs, not scripted provider responses.

Private historical UI is capability-gated. GET /api/replays/sources is called only after explicit selection and only if sourceLookupAvailable. An opaque sourceToken starts the offline replay, then prepare-voice returns receiptId. With configured voice and explicit consent, POST /api/replay-voice-sessions creates a separate durable ID for the existing voice-client pipeline. Only onStatus.ready marks live. Confirm/cancel use existing session endpoints; replay outcome is app-owned replay_selection, never merchant refund/exchange. No new provider settings or budget changes.

## Product photos

Exact source URL map includes Midnight, On The Coast, Darkseid, Bugs and owner-verified HotWheels: Nightburn. Metadata records original CDN URLs and observed date. HotWheels current source photo/name are not a historical paid-price/material claim. Unknown stock, GSM, availability, complaint resolution and material safety remain unknown. Other unmatched products show explicit photo-unavailable text.

## Verification

Full npm run verify passed on Node24.21.0 against latest backend base: seven new UI boundary tests; owner replay-provider/provider-history/private-history/private replay/HTTP tests; 16 voice-client/capture tests; 10 engine tests; resolution tests; 59/59 deterministic scenarios; 17 embedded SQL checks; live extraction/storage contracts; 10 voice coordination; six voice runtime; five deployment checks. All provider operations mocked/offline; zero live provider requests or remote SQL.

Actual Chrome QA: desktop freeform feedback → recommendations → comparison → exchange proposal/cancel; keyboard dialog focus loop; refund-only correction → mobile confirmation → durable simulated refund; synthetic historical source → offline replay → prepared receipt. Mobile document width equals390px viewport. Existing client/runtime suites cover mocked interruption; physical microphone/provider interruption was not run.

Evidence directory is task-7/evidence. Library representative screenshot: library_file_id libfile_98eede4078608191bf542f70d1a9027d / file_00000000975881f5996d0def9a7c6605. Parent reported scope denial accessing that Library image; no workaround was attempted. Consuming executor inspected actual browser pixels and combined references itself.

Latest design-qa.md documents intentional hybrid adaptations, actual source captures, fixed visual issues and remaining live-provider verification limits.
