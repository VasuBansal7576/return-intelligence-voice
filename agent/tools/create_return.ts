import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { findOrder } from "../lib/knowledge/customers.ts";
import { getProduct, normalizeId } from "../lib/knowledge/catalog.ts";
import { checkEligibility } from "../lib/engine/eligibility.ts";
import { diagnosisLabelSchema } from "../lib/engine/diagnosis.ts";
import { appendRecord } from "../lib/engine/records.ts";
import { POLICY } from "../lib/knowledge/policy.ts";

export default defineTool({
  description:
    "Create a return and refund for an eligible order item. TRANSACTIONAL: only call after the customer has explicitly confirmed they want a refund, and after check_eligibility returned eligible. Eligibility is re-verified here — an ineligible item is refused even if you call.",
  inputSchema: z.object({
    orderId: z.string(),
    productId: z.string(),
    itemId: z.string().optional().describe("Line item ID if known"),
    reasonLabel: diagnosisLabelSchema,
    reasonNotes: z
      .string()
      .optional()
      .describe("Customer's own words about what went wrong"),
  }),
  approval: always(),
  async execute({ orderId, productId, itemId, reasonLabel, reasonNotes }, ctx) {
    const hit = findOrder(orderId);
    if (!hit) throw new Error(`Order ${orderId} not found.`);
    const pid = normalizeId(productId);
    const item = hit.order.items.find(
      (i) =>
        normalizeId(i.productId) === pid &&
        (itemId === undefined || i.itemId === itemId),
    );
    const product = getProduct(pid);
    if (!item || !product) {
      throw new Error(`Product ${productId} is not part of order ${orderId}.`);
    }

    const eligibility = checkEligibility({
      customer: hit.customer,
      order: hit.order,
      item,
      product,
      reasonLabel,
    });
    if (!eligibility.eligible) {
      return {
        created: false as const,
        reasonCode: eligibility.reasonCode,
        message: `Return refused: ${eligibility.explanation}`,
      };
    }
    if (!eligibility.allowedActions.includes("refund")) {
      return {
        created: false as const,
        message: `A refund is not an allowed resolution for this case (${eligibility.allowedActions.join(", ")}).`,
      };
    }

    const record = appendRecord(
      "return",
      {
        customerId: hit.customer.customerId,
        orderId: hit.order.orderId,
        productId: product.id,
        productName: product.name,
        size: item.size,
        reasonLabel,
        reasonNotes: reasonNotes ?? null,
        outcome: "refund_requested",
        refundAmountInr: item.priceInr * item.qty,
        refundProcessingDays: POLICY.rules.refundProcessingDays,
      },
      ctx.session.id,
    );
    return {
      created: true as const,
      returnId: record.recordId,
      outcome: "REFUND_REQUESTED",
      refundAmountInr: item.priceInr * item.qty,
      message:
        `Return ${record.recordId} created for ${product.name}. ` +
        `₹${item.priceInr * item.qty} will be refunded to the original payment method ` +
        `within ${POLICY.rules.refundProcessingDays} working days of pickup verification.`,
    };
  },
});
