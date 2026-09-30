# Approved nontransactional feedback replay

Keep actual historical source items immutable, preserving dates/status and unknowns. An already-refunded item stays Refund Completed. Select by an opaque sourceItemRef, without constructing a current merchant order or changing eligibility.

A separate app-owned replay session would contain replay=true, nonTransactional=true, sourceItemRef, source provenance, currentFeedback initially null and currentMerchantEligibility=null. Ask for the customer's present feedback; never assert a historical return reason. Current public composition is not verified purchase composition.

The replay may end with an app-owned replay_selection record containing sourceItemRef, selectedPublicProductRef, explicit currentFeedback, recordedAt and simulated=true. It does not invoke create_return/create_exchange, count a merchant exchange/refund, claim retained revenue, or change the historical item. No material guarantees or invented cohort outcomes.

Prepared local history adapter: bind an opaque sessionId/customerRef to an ignored .private input file. Every lookup rereads and validates the file and loads the relevant selected record. No permanent prompt history and no serialized private history. Adapter is currently disconnected from HTTP, UI, model tools and provider configuration; hosted/Supabase/approved-voice modes reject access. Real input is excluded from source archives and deployments.

Approved scope: distinct local replay session/selection model is implemented in server/private/replay.ts with private atomic app-owned persistence. Later bindings: user-selected source item, current feedback, public evidence comparison and app-owned selection confirmation. No live merchant action binding.
