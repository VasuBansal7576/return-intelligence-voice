# Evaluation contract

## Executed code

`scenarios.mjs` defines 59 deterministic scenarios. The runner calls the real functions in `agent/lib/demo`, `agent/lib/engine`, and `agent/lib/knowledge`. It does not replace those functions with mocks.

Every case runs in a separate Node process with a fresh temporary JSONL ledger. The runner forces local storage and deletes the ledger after the case. Tests cannot add refunds, preferences, or insights to the UI's demo records.

The source report includes SHA-256 hashes and detects edits made during a run. It contains the actual assertion output, captured evidence, execution time, and failure category. A duration is test execution time, not voice latency.

## Scope

The 59 scenarios cover:

- Canonical return-window boundaries, final sale, delivery status, existing returns, reported item condition, shipping totals, and fabricated-damage requests
- Specific fit reasons, positive length constraints, material complaints, multiple reasons, explicit primary blockers, and vague complaints
- Preserved liked attributes, historical positive and negative signals, explicit preference priority, preference updates, price limits, and cold start
- Refund-only instructions, no-pressure handling, sensitive complaints, defects, and wrong-item correction
- Exact catalog tool responses, unknown attributes, missing stock, unavailable sizes, and inventory changes before confirmation
- Exact action proposals, explicit confirmation, condition confirmation, cancellation, stale requests, changed prices, duplicate calls, and multi-item separation
- Disk-ledger reload, pending and completed session serialization, preference persistence, simulated product feedback, and metric provenance
- Public-catalog provenance, published and unknown attributes, exact garment dimensions, selected sizes, explicit length and price changes, and synthetic inventory labels
- Negated-defect clauses, genuine post-wash seam failures, quality-support confirmation, and rejection of condition waivers

D47 launches additional fresh processes. It verifies ledger reload, pending-session hydration, completed-session hydration, and retry after restart. It does not call a remote database.

D51 through D59 extend the original 50 cases. They do not replace prior coverage. The source report hashes both TypeScript code and the public-catalog JSON. Its aggregate SHA-256 identifies the complete hashed input set.

D50 invokes the server's voice-tool dispatcher directly. It verifies proposal-only tool access and duplicate call handling. It is not a live voice test.

## Simulation boundaries

Each new demo session intentionally starts a new synthetic copy of a seeded order. Idempotency in the UI is scoped to that simulation run. Legacy domain tools use a global order-line scope. Tests check both contracts and do not establish production-wide order idempotency.

The catalog separates 40 dated public-product snapshots from 37 legacy synthetic products. Tests compare imported product values with the captured source JSON, including unknown fields and the distinction between body and garment measurements. These checks do not refetch live product pages. Customer, order, inventory, and policy records remain synthetic. Stock is pooled by size across colors. Tests do not verify live Souled Store stock, policy, or customer records.

All transactions are simulated. An exchange or refund assertion checks a local record, not a payment or shipment.

## Original PRD matrix

`prd-requirements.json` preserves the supplied 48-case matrix with its original `NOT_RUN` statuses. The executable suite is a separate set of 59 domain scenarios adapted to the implemented interfaces and seeded data.

The report lists related checks for each original requirement. The matrix status remains `NOT_RUN_AS_WRITTEN`: related checks do not establish that the original fixture and all its expectations ran.

Some checks use broader taxonomy labels than the matrix. D15 verifies an appearance reason, D30 verifies the sensitive-reaction gate, D32 verifies a defect gate, and D34 verifies a fulfillment gate. These do not prove the matrix's more specific subtype names.

D36 checks catalog-data equality rather than a model-generated material answer. D46 switches items through the actual item-selection API rather than asking a model to split one utterance across several products.

## Unmeasured behavior

The suite makes zero model calls and starts zero audio sessions. It does not measure:

- AssemblyAI connectivity, spoken turn-taking, transcription, barge-in, audio latency, voice naturalness, or generated-response grounding
- Model tool selection, model instruction following, or end-to-end hallucination rates
- Foreign-market policy routing, gift-history exclusion, or configurable policy variants
- Live Supabase, distributed concurrent writes, live inventory, real commerce, or customer authentication
- Cohort performance, second-return performance, customer satisfaction, or business uplift

A passing count is the number of these deterministic scenarios whose assertions passed. It is not agent accuracy, full PRD coverage, or a business-performance claim.

The separate [live voice checklist](live-voice-checklist.md) has not been executed by this suite.
