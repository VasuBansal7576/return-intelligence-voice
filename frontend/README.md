# Return Intelligence Voice UI

Dependency-free browser interface for the local deterministic engine and guarded AssemblyAI voice proxy.

## Run

From the project root:

```sh
npm run dev:demo
```

Open the service URL printed by the server. It serves `frontend/` and same-origin `/api/*` endpoints. No separate frontend build or external CDN is required.

## Main flows

- Voice workspace: select one of nine demo stories across five fictional customers, send a nuanced reason, inspect customer/diagnosis/tool evidence, compare grounded alternatives, and review an exact proposal
- Standard return/exchange proposals require an unchecked condition-confirmation box before the action can execute
- Same-product variant choice is exposed only for a clear fit-only case without a preserved-length constraint
- Refund-only, quality, sensitive, ineligible, and multi-item stories retain their distinct treatment
- Brand intelligence reads actual local session records, with SKU-level reasons and linked transcript/evidence
- Evaluation lab reads the backend's real evaluation report and explicitly separates unmeasured live speech/customer outcomes
- Canonical policy cites the pinned demo version

Live voice remains unavailable until `/api/bootstrap` reports `capabilities.voice.status: "ready"`. Starting it requires an explicit pre-microphone consent checkbox and button click. Consent discloses AssemblyAI speech processing, fictional-input requirements, storage behavior, retained records on starting a new demo, and no promise of provider-log deletion. The client connects only to the app's same-origin guarded proxy and never receives a provider API key. The proxy owns tools, transcripts, and provider configuration. Transactional confirmation stays in the UI.

The primary catalog contains 40 dated public product snapshots with official source URLs; 37 legacy synthetic products remain labeled fixtures. Customer/order histories, all operational inventory, and all transactional actions are simulated. Product artwork is schematic, not catalog photography. Published garment chest, shoulder, length, GSM, and price are shown for the selected variant, including numeric differences and explicit unknowns. Recommended size can differ from returned size. Neither equal length nor fit/comfort is promised. No business-impact uplift, latency, or keep-rate result is fabricated.

## Verification

```sh
node --check frontend/app.js
node --check frontend/voice-client.js
node --check frontend/pcm-processor.js
node frontend/qa/capture-states.mjs
node --test frontend/qa/voice-client.test.mjs
```

The capture script starts an isolated local service in the same process environment, exercises real HTTP flows, asserts state changes, and renders the production UI functions into labeled HTML captures. Output defaults to `/workspace/shared/return-voice-captures`; override with `RIV_CAPTURE_DIR`.

Covered: policy/catalog bootstrap, multi-reason diagnosis, condition confirmation, cancel without execution, stale-proposal rejection, exchange-to-insight persistence, cold-start fit preservation, quality restraint, and refund-only autonomy.

HTML captures are for visual review. They are not interactive browser QA. This environment's browser blocked both loopback and local-file URLs; no claim of passed browser interaction or live voice testing is made. A hosted preview still needs desktop/mobile, keyboard/dialog, repeated action, cancellation, and live voice verification.
