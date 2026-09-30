# Backend checkpoint verification

Node 24.21.0. Zero external provider or merchant calls. Full verification passes all in-process checks; deployment test uses localhost sockets and embedded PGlite, rerun with local-bind permission after sandbox EPERM.

- Focused integration gaps: explicit canonical discount decision with no price/proposal/escalation mutation; item-scoped sensitive exploration survives text and native-tool hydrate roundtrips, respects revocation and no skin-safety guarantees; genuine transcript IDs and trace call IDs/origins.
- Private history: selected-session fresh-file lookup, null unknowns, strict extra-field rejection, cross-customer denial, hosted/approved-voice denial. Synthetic test input only.
- Historical replay: immutable refunded dates/status; current-feedback-only diagnosis; grounded evidence with unknown stock and eligibility; app-owned replay_selection needs explicit confirmation, is idempotent and survives a fresh Node process. Source input is unchanged.
- Local HTTP replay: default-disabled opt-in, loopback-only, same-origin JSON, no merchant execution or provider binding. Synthetic input only.
- Voice client: 15 checks including labeled automated PCM16 mono 24 kHz input through the same-origin proxy after actual session.ready, observed event timeline, disabled-capability gate and 180-second cap. Automated injection is not a physical microphone test.
- Domain and durability: 59 deterministic scenarios, 17 embedded SQL, structured extraction, storage adapter, 10 coordination, 5 mocked proxy runtime, and 5 local deployment transport checks.
- Actual isolated browser at 127.0.0.1:8794: refund confirmation focuses Close dialog; Shift-Tab wraps to Cancel inside dialog; Escape removes dialog and proposal, records cancel_proposal only, and restores message-input focus. Voice unconfigured and zero budget. Existing task/server at 8793 untouched.

Selected console redesign has not started: exact selected image must be downloaded/materialized and inspected by this executor. Live provider/audio, real microphone, hosted deployment and actual merchant integration are not verified. No real history enters source, Git, fixtures, screenshots, public deployment or provider prompts.
