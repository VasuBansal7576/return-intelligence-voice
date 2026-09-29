import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { findOrder } from "../lib/knowledge/customers.ts";
import { getProduct, normalizeId } from "../lib/knowledge/catalog.ts";
import { checkEligibility } from "../lib/engine/eligibility.ts";
import { diagnosisLabelSchema } from "../lib/engine/diagnosis.ts";
import { appendRecord } from "../lib/engine/records.ts";

export default defineTool({
  description:
    "Create an exchange: return an eligible order item and ship a replacement product/variant. TRANSACTIONAL: only call after the customer has explicitly confirmed the exact replacement (product, size, color). Eligibility and replacement stock are re-verified here — calls that fail either check are refused.",
  inputSchema: z.object({
    orderId: z.string(),
    returnProductId: z.string().describe("Product being sent back"),
    returnItemId: z.string().optional(),
    replacementProductId: z
      .string()
      .describe("Replacement product — may be the same product for a size/color swap"),
    replacementSize: z.string(),
    replacementColor: z.string(),
    reasonLabel: diagnosisLabelSchema,
  }),
  approval: always(),
  async execute(input, ctx) {
    const hit = findOrder(input.orderId);
    if (!hit) throw new Error(`Order ${input.orderId} not found.`);

    const returnPid = normalizeId(input.returnProductId);
    const item = hit.order.items.find(
      (i) =>
        normalizeId(i.productId) === returnPid &&
        (input.returnItemId === undefined || i.itemId === input.returnItemId),
    );
    const returnProduct = getProduct(returnPid);
    if (!item || !returnProduct) {
      throw new Error(`Product ${input.returnProductId} is not part of order ${input.orderId}.`);
    }

    const eligibility = checkEligibility({
      customer: hit.customer,
      order: hit.order,
      item,
      product: returnProduct,
      reasonLabel: input.reasonLabel,
    });
    if (!eligibility.eligible) {
      return {
        created: false as const,
        reasonCode: eligibility.reasonCode,
        message: `Exchange refused: ${eligibility.explanation}`,
      };
    }

    const replacement = getProduct(normalizeId(input.replacementProductId));
    if (!replacement) {
      return { created: false as const, message: `No product ${input.replacementProductId} in the catalog.` };
    }
    if (!replacement.returnable) {
      return { created: false as const, message: `${replacement.name} is final sale and cannot be an exchange target.` };
    }

    const sameProduct = replacement.id === returnProduct.id;
    const neededAction = sameProduct ? "exchange_same_product" : "exchange_different_product";
    if (!eligibility.allowedActions.includes(neededAction)) {
      return {
        created: false as const,
        message: `This case only allows: ${eligibility.allowedActions.join(", ")}.`,
      };
    }

    const colorOk = replacement.colors.some(
      (c) => c.toLowerCase() === input.replacementColor.toLowerCase(),
    );
    const stock = replacement.stock[input.replacementSize] ?? 0;
    if (!replacement.sizes.includes(input.replacementSize) || stock <= 0) {
      return {
        created: false as const,
        message: `${replacement.name} is out of stock in size ${input.replacementSize}. Check inventory and offer another size or product.`,
      };
    }
    if (!colorOk) {
      return {
        created: false as const,
        message: `${replacement.name} is not offered in ${input.replacementColor}. Offered colors: ${replacement.colors.join(", ")}.`,
      };
    }

    const priceDelta = replacement.priceInr - item.priceInr;
    const record = appendRecord(
      "exchange",
      {
        customerId: hit.customer.customerId,
        orderId: hit.order.orderId,
        returned: {
          productId: returnProduct.id,
          productName: returnProduct.name,
          size: item.size,
          color: item.color,
        },
        replacement: {
          productId: replacement.id,
          productName: replacement.name,
          size: input.replacementSize,
          color: input.replacementColor,
        },
        reasonLabel: input.reasonLabel,
        outcome: sameProduct ? "same_product_exchange" : "different_product_exchange",
        priceDeltaInr: priceDelta,
      },
      ctx.session.id,
    );
    return {
      created: true as const,
      exchangeId: record.recordId,
      outcome: sameProduct ? "SAME_PRODUCT_EXCHANGE" : "DIFFERENT_PRODUCT_EXCHANGE",
      priceDeltaInr: priceDelta,
      message:
        `Exchange ${record.recordId} created: ${returnProduct.name} (${item.size}) → ` +
        `${replacement.name} in ${input.replacementColor}, size ${input.replacementSize}.` +
        (priceDelta === 0
          ? " No price difference."
          : priceDelta > 0
            ? ` The customer pays the ₹${priceDelta} difference on delivery.`
            : ` The ₹${-priceDelta} difference is refunded to the original payment method.`),
    };
  },
});
