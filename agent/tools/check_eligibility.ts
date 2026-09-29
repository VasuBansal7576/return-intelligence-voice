import { defineTool } from "eve/tools";
import { z } from "zod";
import { findOrder } from "../lib/knowledge/customers.ts";
import { getProduct, normalizeId } from "../lib/knowledge/catalog.ts";
import { checkEligibility } from "../lib/engine/eligibility.ts";
import { diagnosisLabelSchema } from "../lib/engine/diagnosis.ts";

export default defineTool({
  description:
    "Check whether an order item can be returned or exchanged under the canonical policy. This is the ONLY source of eligibility truth — never answer from memory. Pass the diagnosed reason when known, since defects and wrong items change the allowed resolutions.",
  inputSchema: z.object({
    orderId: z.string().describe("Order ID, e.g. TSS-10432"),
    productId: z.string().describe("Product ID being returned, e.g. TSS-RGT-001"),
    reasonLabel: diagnosisLabelSchema
      .optional()
      .describe("Classified return reason, if already diagnosed"),
  }),
  execute({ orderId, productId, reasonLabel }) {
    const hit = findOrder(orderId);
    if (!hit) {
      return {
        found: false as const,
        eligible: false,
        message: `Order ${orderId} not found.`,
      };
    }
    const item = hit.order.items.find(
      (i) => normalizeId(i.productId) === normalizeId(productId),
    );
    const product = getProduct(normalizeId(productId));
    if (!item || !product) {
      return {
        found: false as const,
        eligible: false,
        message: `Product ${productId} is not part of order ${orderId}. Ask which item from the order the customer means.`,
      };
    }
    return {
      found: true as const,
      itemId: item.itemId,
      productName: product.name,
      ...checkEligibility({
        customer: hit.customer,
        order: hit.order,
        item,
        product,
        reasonLabel,
      }),
    };
  },
});
