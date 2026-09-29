# return-intelligence-voice

AI returns voice agent for The Souled Store, built on the **eve** framework
(`eve@0.68.0`, pinned in `package.json`).

When a customer returns a product, the agent asks what went wrong in natural
conversation, checks eligibility deterministically, suggests genuine same-brand
alternates that fix the diagnosed problem, and records the resolution plus a
structured insight for the merchandising team.

## Architecture

Deterministic code owns truth; the model only owns conversation.

```
agent/
  instructions.md            persona + voice rules + anti-fabrication contract
  agent.ts                   model config (AI Gateway model id)
  channels/eve.ts            built-in HTTP channel
  lib/knowledge/             the ONE place facts live
    policy.ts                canonical demo policy (pinned version, cited on every verdict)
    catalog.ts               38 synthetic products (category, fit, size, material, GSM, price, stock)
    customers.ts             5 synthetic customers, orders, return history (deliveredDaysAgo = evergreen)
  lib/engine/                pure, unit-tested logic — no LLM
    eligibility.ts           in-window / final-sale / defect / already-returned decisions
    recommend.ts             ranked alternates with per-candidate "why"
    diagnosis.ts             return-reason enum the model must pick from
    records.ts               append-only JSONL record store (data/records.jsonl)
  tools/                     13 typed tools, thin wrappers over the engine
```

Transactional tools (`create_return`, `create_exchange`, `escalate_to_human`)
carry `approval: always()` — eve pauses the turn for an explicit approve/cancel
before any state changes. `save_insight` closes every resolved session and
feeds the product-intelligence record.

## Demo paths (seeded)

| Customer | Phone | Order | Path |
|---|---|---|---|
| Aarav Mehta | `98765 43210` | `TSS-10432` (delivered 22d ago) | In-window return → alternates → exchange or refund. History: keeps oversized, returned a slim polo before |
| Priya Sharma | `98123 45670` | `TSS-10512` (10d ago) | Cold start — no history, one order |
| Rohan Kapoor | `98200 98200` | `TSS-10188` (45d ago) | Outside the 30-day window → honest denial |
| Sneha Iyer | `97420 12345` | `TSS-10588` (5d ago) | Defect narrative → replacement/refund + quality flag |
| Kabir Singh | `96500 96500` | `TSS-10601` (7d ago) | Final-sale beanie denial + returnable tee in same order |

Happy path to drive: *"I want to return a t-shirt"* → phone `98765 43210` →
*"it's tighter than the size chart and the fabric feels hot"* → agent checks
eligibility → offers ranked alternates (looser/lighter, in stock in L) →
customer picks one → confirm → `create_exchange` (approval prompt) →
`save_insight` writes the record.

## Run locally

```sh
npm install
npm run dev          # eve dev — interactive REPL (first run: /login to connect a model)
```

Headless / scripted:

```sh
npm exec -- eve dev --no-ui            # http://127.0.0.1:2000
curl -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Hi, I want to return a t-shirt."}'
# → {"sessionId":"wrun_..."}; follow-ups POST /eve/v1/session/:id
# stream events: GET /eve/v1/session/:id/stream
```

Approval prompts surface as `input.requested` stream events; a follow-up
message of "approve"/"cancel" resolves them.

## Verify

```sh
npm run typecheck    # tsc strict, no emit
npm test             # node --test — 10 seeded engine/fixture assertions
npm run build        # eve build — full app compile
```

## Deploy

```sh
npm run deploy       # eve deploy — links a Vercel project, builds, ships
```

No partnership with The Souled Store: catalog/policy are a public-info-shaped
synthetic snapshot; all customer and order data is invented.
