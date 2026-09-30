# Existing layout bindings

No redesign or CSS changes. Selected visual direction remains pending.

| Existing display | Binding | Meaning |
| --- | --- | --- |
| Voice status | createVoiceClient.onStatus → voiceStatus / voiceReady | ready is true only after provider session.ready; microphone and socket setup are not live |
| Conversation | persisted messages + onTranscript | Merge by genuine provider itemId and role; unidentified messages never get a fabricated provider ID |
| Assistant greeting | local-guided-demo message source | App text label; not proof of spoken provider output |
| Tool activity/cards | onTool → voiceTools + persisted tools | callId merges live events with saved model calls; origin distinguishes startup, internal and model |
| Tool timing dialog | durationMs | null means unavailable; measured model duration covers local execution, not provider latency |
| Discarded event dialog | discarded phase | Response discarded; persisted operation may already have executed |
| Alternatives | snapshot candidates and recommendationAllowed | Explicit material exploration consent survives hydration and can be revoked; no skin-safety guarantee |
| Resolution confirmation | pendingAction / persisted resolution | Proposal is preparation; only durable resolution evidence confirms execution |

Canonical configured policy is source-controlled and stored with the app; selected customer/order fixture lookup is session scoped. Operational inventory, customer history, orders and transactions remain disclosed fixtures. Own Souled Store read-only lookup remains separate; no private account data is embedded. Cohort/trending signals remain unavailable in this patch, pending exact sourced membership. No new migration timestamps or remote SQL changes.
