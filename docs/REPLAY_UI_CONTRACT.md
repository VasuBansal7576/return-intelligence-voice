# Replay browser integration contract

Exact Mac Node: `/tmp/riv-npm-cache/_npx/387698761821791d/node_modules/node/bin/node` (24.21.0). Prefix its directory onto PATH for npm scripts; no global change.

`GET /api/bootstrap`: `capabilities.replay = {kind:'historical-replay',status:'prepared'|'unconfigured',sourceLookupAvailable:boolean,rawHistoryLiveAccess:false,merchantIntegration:false,requiresHumanConfirmation:true}`. `prepared` means explicitly enabled local receipt intake, NOT live provider readiness. Only capabilities.voice.status==='ready' allows Start; only voice-client onStatus.ready===true after session.ready means LIVE. Start remains Starting until then.

Offline local source selection (raw adapter guard unchanged):

- `GET /api/replays/sources` -> `{historical:true,merchantIntegration:false,items:[{sourceToken,name,size,orderedOn,deliveredOn,status,canReplay,publicUrl,currentPublicMaterial,pastReturnReason,keptOutcome,likedOutcome}],note}`. sourceToken is opaque/current lookup only; no customer identity/contact/payment. Never interpret delivered as kept, refunded as a particular cause, or cancelled as returned. Only canReplay:true already-refunded items may start. Unknown fields remain null.
- `POST /api/replays` with `{sourceToken}` -> original existing offline replay snapshot (`id,replay,nonTransactional,sourceItem,sourceProvenance,currentFeedback,diagnosis,currentMerchantEligibility:null,canonicalDiscountDecision,selection,alternatives,cohortDataAvailable:false,merchantActionExecuted:false,status,boundaryNotice`). Existing legacy `{customerRef,itemRef}` contract remains supported for disclosed tests.
- Existing `/api/replays/:id/feedback` `{text}`, `/alternatives` `{productRefs}`, `/select` `{productRef,confirmed:true}` unchanged.
- `POST /api/replays/:id/prepare-voice` with `{}` -> `{receiptId,kind:'historical-replay',sanitized:true,merchantIntegration:false}`. Done while raw adapter is OFFLINE; server stores only sanitized projection in a local mode600 receipt. Raw date/status snapshot may remain local UI context, never forwarded to provider.

Later guarded voice intake: `POST /api/replay-voice-sessions` with `{receiptId}` -> new owner-scoped durable voice session snapshot. Requires explicitly enabled actual local origin and excludes public/hosted mode. This is a separate session ID, use it for the existing `/api/voice-token`, `/api/voice/ws`, `/api/voice-end` pipeline and controls. Existing budget checks apply unchanged. Bootstrap/sourceLookupAvailable becomes false once raw adapter guard disallows raw lookup; do not call raw lookup during live admission.

Distinct voice snapshot:

```
{id,kind:'historical-replay',mode:'assemblyai',replay:true,nonTransactional:true,
 phase:'REPLAY_LOOKUP'|'REPLAY_FEEDBACK'|'AWAITING_CONFIRMATION'|'COMPLETED',
 source:{historicalReplay:true,merchantIntegration:false,items:[{product:{name,url}|null,size|null,orderStatus:'Refund Completed'}]},
 sourceHash,currentMerchantEligibility:null,feedback:string|null,sensitiveExplorationConsent:boolean,
 candidates:[{ref,name,url,material,fit,gsm,priceInr,availability:null,solvesComplaint:null,materialSafety:null,claim:string|null}],
 pendingAction:{proposalId,productRef}|null,
 resolution:{recordId,kind:'replay_selection',sessionId,createdAt,proposalId,selectedProductRef,sourceStatus:'Refund Completed',simulated:true,merchantActionExecuted:false}|null,
 messages:[{id,role,text,at,itemId?,interrupted?,source:'assemblyai'}],
 tools:[{id,callId,name,origin:'model',at,durationMs,result}],status,boundaryNotice}
```

Use candidates.ref as product identifier. Photos are optional sourced HTTPS fields; no photo data is invented by this backend. Fallback unavailable-photo is required for unmatched products. Unknown price, material, fit, GSM and stock remain visibly unknown. Collection claim is only “listed in the brand’s Trending Fandoms collection”; no cohort/rank claims. Source.product:null means public source match unavailable, not a made-up name/material.

On-screen confirmation: `POST /api/sessions/:voiceSessionId/resolve` `{proposalId,confirmed:true}` commits only app-owned replay selection; double confirmation is idempotent. `POST /api/sessions/:voiceSessionId/cancel-proposal` `{}` cancels current interest. No condition acknowledgement/merchant exchange/refund applies. Fixture /messages,/select-item,/propose are refused for this kind. Current feedback comes from actual current voice transcript; original past cause remains unknown.

Voice client events remain `onStatus,onTranscript,onTool,onSession,onError`. onSession receives the distinct shape above; branch on kind and don't feed it into fixture-only rendering. `onTranscript` preserves genuine itemId for partial merging; app greeting is not spoken transcript. Tool discarded means response discarded, not proof a DB action didn't execute. `onOutputAudio({pcm16le,sampleRate:24000,channels:1,source:'provider.reply.audio'})` and `onTimeline` support local actual response capture. Standard TTS input is `inputMode:'test-audio'`, await start() actual session.ready then injectTestAudio(PCM,{sampleRate:24000,channels:1}); explicitly label automated injection, not physical microphone proof or voice clone. No response is canned.

Ledger compatibility: replay selection is stored as existing SQL kind='outcome', payload.eventKind='replay_selection'; snapshot resolution.kind='replay_selection' is its app-owned view. No new SQL schema/migration. All ordinary fixture APIs are preserved. Integration is undergoing final synthetic HTTP/proxy/SQL tests; no real history/provider call occurred and live budget is still zero.
