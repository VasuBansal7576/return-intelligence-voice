# Signal Desk integration

Isolated checkout: `/Users/vasu/Documents/Codex/2026-09-30/task-7/riv-ui`, branch `signal-desk`, based on owner backend commit `9010d64f0a1b2bdbcb812e1911e1662b8ae4eb1e`. No owner checkout/private data was edited or copied.

UI scope: frontend/app.js, art.js, catalog-images.js, styles.css, exact official photo assets, UI test/capture helpers, package UI test entry, browser asset build/verification lists, this handoff and design QA report. Backend policy/API/security/budget logic unchanged. Exception: parent explicitly supplied owner grammar patch dda9f0ab319b87ae5c255f4f5e9f0a15197da1ec; applied as isolated commit2accfc4, changing only generator article and its integration regression. Build lists preserve owner demo-capture.js.

## Integration

Apply the exported task-7/riv-ui-only.patch (excludes owner grammar files); task-7/riv-ui-integrated.patch includes the owner grammar patch. Apply on owner branch9010d64 or later with `git apply --3way`, or fetch the local isolated branch and cherry-pick the UI commits, skipping2accfc4 if the owner grammar patch is already integrated. Check current owner edits before applying. Do not overwrite owner frontend/voice-client.js, demo-capture.js, server, agent or private source changes. Only publisher/parent should integrate or push.

Use Node24 via:
`PATH=/tmp/riv-npm-cache/_npx/387698761821791d/node_modules/node/bin:$PATH npm run verify`

Start public-style offline QA with `PORT=8897 RIV_STORAGE=local npm run dev:demo`. Voice remains unconfigured. Public defaults to Demo customer mode; returning/new customer story selector and freeform feedback use real local engine. Suggested lines are optional test inputs, not scripted provider responses.

Private historical UI is capability-gated. GET /api/replays/sources is called only after explicit selection and only if sourceLookupAvailable. An opaque sourceToken starts the offline replay, then prepare-voice returns receiptId. With configured voice and explicit consent, POST /api/replay-voice-sessions creates a separate durable ID for the existing voice-client pipeline. Only onStatus.ready marks live. Confirm/cancel use existing session endpoints; replay outcome is app-owned replay_selection, never merchant refund/exchange. No new provider settings or budget changes.

## Product photos

Exact source URL map includes Midnight, On The Coast, Darkseid, Bugs and owner-verified HotWheels: Nightburn. Metadata records original CDN URLs and observed date. HotWheels current source photo/name are not a historical paid-price/material claim. Unknown stock, GSM, availability, complaint resolution and material safety remain unknown. Other unmatched products show explicit photo-unavailable text.

## Verification

Full npm run verify passed on Node24.21.0 against latest backend base: twelve UI boundary tests; owner replay-provider/provider-history/private-history/private replay/HTTP tests; 16 voice-client/capture tests; 10 engine tests; resolution tests; 59/59 deterministic scenarios; 17 embedded SQL checks; live extraction/storage contracts; 10 voice coordination; six voice runtime; five deployment checks. All provider operations mocked/offline; zero live provider requests or remote SQL.

Actual Chrome QA: desktop freeform feedback → recommendations → comparison → exchange proposal/cancel; keyboard dialog focus loop; refund-only correction → mobile confirmation → durable simulated refund; synthetic historical source → offline replay → prepared receipt. Mobile document width equals390px viewport. Existing client/runtime suites cover mocked interruption; physical microphone/provider interruption was not run.

Evidence directory is task-7/evidence. Library representative screenshot: library_file_id libfile_98eede4078608191bf542f70d1a9027d / file_000000005c5c81f599f22f5256d64a9a (version1). Parent reported scope denial accessing that Library image; no workaround was attempted. Consuming executor inspected actual browser pixels and combined references itself.

Latest design-qa.md is blocked pending independent retest, with implemented P2 corrections and exact browser evidence. Final Node24 fullverify exit0 log: /tmp/riv-ui-final-constraints-verify.log. New evidence: signal-desk-fixed-desktop.jpg, signal-desk-fixed-mobile.jpg, fit-stencil-wipe-desktop.jpg, fit-stencil-wipe-mobile.jpg. Mobile wipe Library: libfile_520bae72b2608191af866b616c88b6a9 / file_00000000e51081f5a878ca994dc09e40.

Final review fixes: four-column desktop catalog, retained suggested-response scroll position, genuine latest customer quote, sourced compact measurement deltas/unknowns, native range and two non-drag photo controls, sticky dialog review action, simulated stock at each UI rationale, grammar of proposal bar, stale confirmation clearing on changed-mind updates, and per-tab demo session ID restoration via existing GET endpoint. Historical source/receipt data is never stored by this restoration; no audio readiness is restored. Connection details refreshes bootstrap without discarding prepared receipt.

Lineage: backend9010d64 → UI4f4273f → UI7f329ab → QA87b3570 → replay disclosureed64503 → explicitly authorized owner grammar2accfc4 → final review-fix commit (see git log). The reviewer’s ed64503 fingerprint was the earlier UI tip, not the backend base. No deployment or publication performed.

Targeted final follow-up after5f0a6fa: shared CHANGE summary includes all grounded primary/secondary reasons and labels, with explicit KEEP unchanged. Added two-/three-issue actual main/modal renderer regressions; fullverify passed again. Earlier independent retest verified ordinary flows and four prior P2s. Only this final summary retest remains pending. Screenshot: evidence/fit-stencil-multi-constraint.jpg.
