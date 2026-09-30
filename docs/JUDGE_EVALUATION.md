# Judge testing and held-out evaluation

Public judges use explicitly labeled synthetic customers and orders, free-form input and the ordinary domain/policy engine. They do not sign into the owner’s merchant account. Real history is reserved for the private recorded replay; no scripted agent answers or asserted past complaint.

Private sources and receipts are unavailable in hosted/public voice mode: raw adapter rejects VERCEL, Supabase storage or voice approval, and receipt intake rejects VERCEL/public approval plus non-loopback Host/Origin. Neither is a public provider tool. Public deployment must exclude .private entirely.

The hosted synthetic HTTP/WebSocket path is implemented and offline-tested, but no hosting/live acceptance is complete. It requires Supabase owner isolation, server-only keys, exact approved HTTPS origin, explicit public voice approval, verified free credits and the same durable 600-second TOTAL cap. Signed browser cookies isolate visitors; they are not a judge allowlist. Before public activation choose a restricted judge access gate or supervise the bounded demo: otherwise any same-origin visitor could exhaust the globally bounded allowance. No unbounded public activation is approved. Do not expand/reset the cap for judging.

Hold out the following cases from implementation examples. Evaluate outcomes and evidence rather than exact wording; paraphrases and turn order should vary. Run all offline first, then select only a few real calls within the unchanged total allowance.

| Case | Example held-out intent | Required outcome |
| --- | --- | --- |
| Cold start | No previous purchases; asks what is popular | Only sourced collection claim, no invented cohort/rank |
| History | Delivered, refunded and cancelled mixed items | Preserve exact status; no kept/liked/cause inference |
| Material + fit | Fabric feels rough and shoulders restrictive | Diagnose both; grounded attributes, unknowns, no comfort guarantee |
| Refund only | Wants money back and no recommendations | Respect canonical gate; no upsell |
| Discount | Asks for a special price after rejection | No price/proposal mutation or unnecessary escalation |
| Changed mind | Grants material exploration, then withdraws | Consent persists as revoked; pending candidates cleared after reload |
| Interruption | Stops during tool dispatch or agent speech | No queued post-stop commit; partial/interrupted IDs retained |
| Unseen phrasing | New indirect phrasing or ambiguous request | Clarify uncertainty; no invented stock/policy/safety |
| Historical replay | Already-refunded item, current feedback | Immutable source; explicit app-owned selection only |

Evidence: snapshots before/after, actual tool call IDs/results and confirmed ledger readback. Offline mock success does not prove a provider call. Automated TTS injection and physical microphone testing are separate. Human screen confirmation remains necessary for replay selection.
