# return-intelligence-voice

## For judges: working implementation

The app implementation is on **[fix/riv-integration-replay-20260930](https://github.com/VasuBansal7576/return-intelligence-voice/tree/fix/riv-integration-replay-20260930)**. This main branch is the project overview; use the implementation branch to inspect or run the app.

- [Immutable tested source: fc930f8c95967d08194d574c323616c27bd95d4f](https://github.com/VasuBansal7576/return-intelligence-voice/tree/fc930f8c95967d08194d574c323616c27bd95d4f)
- [Deployed demo](https://return-intelligence-voice.vercel.app/)
- [Implementation PR #4](https://github.com/VasuBansal7576/return-intelligence-voice/pull/4)

**Prototype status:** the public demo uses clearly labeled synthetic customer data and app-owned simulated outcomes. Recorded AssemblyAI trials demonstrate genuine voice interaction and tool calls, but did not complete the full voice recommendation-to-confirmation journey. Public voice is disabled. No real merchant exchange or refund is performed. The tested nullable-clarification repair is included in the pinned source; it has not been verified in another live call.

AI voice agent for returns, revenue recovery and product intelligence — AssemblyAI prototype for The Souled Store.

When a customer returns a product, the agent asks for product feedback in natural
conversation and suggests genuine alternates from the same brand. It knows brand
policies and catalog, fetches customer and order history fast and categorised,
handles edge cases explicitly, and saves structured learnings.

See the research report at `data/` (fleet records, not committed) once the
first investigation lands. Product spec lives in upcoming PRD docs.
