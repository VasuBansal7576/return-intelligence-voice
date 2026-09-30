import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { createReturn, returnInputSchema } from "../lib/engine/resolutions.ts";

export default defineTool({
  description:
    "Create a return and refund for an eligible order item. TRANSACTIONAL: only call after the customer has explicitly confirmed they want a refund, and after check_eligibility returned eligible. Eligibility is re-verified here — an ineligible item is refused even if you call.",
  inputSchema: returnInputSchema,
  approval: always(),
  execute(input, ctx) { return createReturn(input, ctx.session.id); },
});
