import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { createExchange, exchangeInputSchema } from "../lib/engine/resolutions.ts";

export default defineTool({
  description:
    "Create an exchange: return an eligible order item and ship a replacement product/variant. TRANSACTIONAL: only call after the customer has explicitly confirmed the exact replacement (product, size, color). Eligibility and replacement stock are re-verified here — calls that fail either check are refused.",
  inputSchema: exchangeInputSchema,
  approval: always(),
  execute(input, ctx) { return createExchange(input, ctx.session.id); },
});
