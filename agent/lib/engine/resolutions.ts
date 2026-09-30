import { z } from "zod";
import { findOrder } from "../knowledge/customers.ts";
import { getProduct, normalizeId } from "../knowledge/catalog.ts";
import { checkEligibility } from "./eligibility.ts";
import { diagnosisLabelSchema } from "./diagnosis.ts";
import { appendResolution, findResolution } from "./records.ts";
import { POLICY } from "../knowledge/policy.ts";

export const returnInputSchema = z.object({
    orderId: z.string(),
    productId: z.string(),
    itemId: z.string().optional().describe("Line item ID if known"),
    reasonLabel: diagnosisLabelSchema,
    reasonNotes: z
      .string()
      .optional()
      .describe("Customer's own words about what went wrong"),
  });

export const exchangeInputSchema = z.object({
    orderId: z.string(),
    returnProductId: z.string().describe("Product being sent back"),
    returnItemId: z.string().optional(),
    replacementProductId: z
      .string()
      .describe("Replacement product — may be the same product for a size/color swap"),
    replacementSize: z.string(),
    replacementColor: z.string(),
    reasonLabel: diagnosisLabelSchema,
  });

export async function createReturn(input: z.infer<typeof returnInputSchema>, sessionId: string, scopeId = "global") {
  const { orderId, productId, itemId, reasonLabel, reasonNotes } = input;
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

    const existing = findResolution(hit.order.orderId, item.itemId, scopeId);
    if (existing) return { created: false as const, reasonCode: "already_resolved", existingResolutionId: existing.recordId,
      message: "This order item already has a resolution. No duplicate return was created." };

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

    const { record } = appendResolution(
      "return",
      {
        customerId: hit.customer.customerId,
        orderId: hit.order.orderId,
        itemId: item.itemId,
        scopeId,
        productId: product.id,
        productName: product.name,
        size: item.size,
        reasonLabel,
        reasonNotes: reasonNotes ?? null,
        outcome: "refund_requested",
        refundAmountInr: item.priceInr * item.qty,
        refundProcessingDays: POLICY.rules.refundProcessingDays,
        simulated: true,
      },
      sessionId,
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
}

export async function createExchange(input: z.infer<typeof exchangeInputSchema>, sessionId: string, scopeId = "global") {
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

    const existing = findResolution(hit.order.orderId, item.itemId, scopeId);
    if (existing) return { created: false as const, reasonCode: "already_resolved", existingResolutionId: existing.recordId,
      message: "This order item already has a resolution. No duplicate exchange was created." };

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
    const isReplacement = sameProduct && eligibility.allowedActions.includes("replacement");
    const neededAction = isReplacement ? "replacement" : sameProduct ? "exchange_same_product" : "exchange_different_product";
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

    const priceDelta = isReplacement ? 0 : (replacement.priceInr - item.priceInr) * item.qty;
    const { record } = appendResolution(
      "exchange",
      {
        customerId: hit.customer.customerId,
        orderId: hit.order.orderId,
        itemId: item.itemId,
        scopeId,
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
        outcome: isReplacement ? "replacement" : sameProduct ? "same_product_exchange" : "different_product_exchange",
        priceDeltaInr: priceDelta,
        qualityFlag: eligibility.qualityCase,
        simulated: true,
      },
      sessionId,
    );
    return {
      created: true as const,
      exchangeId: record.recordId,
      outcome: isReplacement ? "REPLACEMENT" : sameProduct ? "SAME_PRODUCT_EXCHANGE" : "DIFFERENT_PRODUCT_EXCHANGE",
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
}
