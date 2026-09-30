# Data and security controls

The hosted demo stores synthetic commerce state in `riv_private`. The schema is not exposed through Supabase's Data API. All four tables enable RLS. Anonymous and authenticated roles have no schema, table, or RPC privileges.

Six explicit `SECURITY INVOKER` RPCs are available only to the server role. Browser requests never receive the Supabase secret key. Each browser receives a signed, HttpOnly, SameSite=Strict cookie. The server derives the owner ID from that cookie. Session reads, session writes, voice tickets, and the merchant dashboard are owner-scoped.

Hosted mode refuses API access if durable storage or signing credentials are missing. It cannot silently fall back to shared local state.

## Commit and retry behavior

A request loads a session revision and its owner's ledger into an isolated context. PostgreSQL commits the new session state and all new records in one transaction. A stale revision, mismatched owner, or duplicate order-line resolution aborts the transaction. The server reports success only after that commit succeeds.

Each demo run has its own synthetic order namespace. This permits repeated judge demonstrations without pretending to prove production-wide order identity.

## Voice controls

The browser receives a one-use local proxy ticket, never an AssemblyAI token or API key. The server pins the managed model and tools. Client `session.update`, `tool.result`, system messages, and configurable `reply.create` payloads are rejected.

The database reserves the full 180-second allowance before initialization. Its atomic update enforces the lower of the stored ceiling and the approved runtime ceiling. Failed requests, short calls, and ambiguous outcomes do not refund that allowance. Redeployment does not reset it. Ticket consumption renews the active lease for the bounded call and termination grace period.

The proxy sends `session.end` on stop and interruption cleanup discards stale tool results and playback. Live verification of provider termination and billing remains necessary before release.

## Interpretation boundaries

Guided text mode uses disclosed deterministic rules. Live voice uses the native model's structured extraction tool. Every extracted reason and explicit preference must cite an actual customer transcript span. The application rejects invented evidence, contradicted defect claims, and unsupported explicit-preference values before it mutates state.

Explicit refusal and safety signals prevent stale recommendations. Exact proposals require human confirmation. Price and stock are rechecked before a simulated exchange. A changed proposal cannot reuse an old approval.

## Canonical demo policy version 2

`2026.09-demo.2` makes the existing condition requirement explicit: a reported washed, worn, or tag-removed item requires support review. The prototype has no configured automatic condition waiver.

A genuine seam failure after one wash still creates a confirmed synthetic escalation, a quality case, and structured SKU feedback. A day-one defect with no reported condition failure can produce a no-charge replacement. A washed item described as undamaged cannot acquire a defect exception through negated words.

This is a configured demo policy. It is not a statement of The Souled Store's operational policy.

## Retention and consent

Before microphone access, the UI explains that AssemblyAI processes speech and requests fictional inputs only. The app retains finalized text transcripts, extracted preferences, and insights. The local adapter writes JSONL. The hosted adapter stores owner-scoped records in Supabase.

Starting another demo does not delete those records. No app control claims to delete provider logs. Raw audio is not stored by this application. Do not submit personal, medical, payment, or account information.
