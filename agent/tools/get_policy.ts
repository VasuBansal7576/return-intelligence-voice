import { defineTool } from "eve/tools";
import { z } from "zod";
import { POLICY } from "../lib/knowledge/policy.ts";

export default defineTool({
  description:
    "Look up the canonical return/exchange policy. Public sources conflict, so this pinned policy version is the only authority. Quote its windows and rules; cite its version when a customer pushes back.",
  inputSchema: z.object({
    topic: z
      .enum([
        "full_policy",
        "return_window",
        "refund_timing",
        "condition_requirements",
        "final_sale",
        "exchange_rules",
      ])
      .default("full_policy")
      .describe("Which part of the policy to read"),
  }),
  execute({ topic }) {
    const r = POLICY.rules;
    const meta = {
      policyId: POLICY.policyId,
      version: POLICY.version,
      market: POLICY.market,
      effectiveDate: POLICY.effectiveDate,
      asOf: POLICY.asOf,
      source: POLICY.source,
    };
    const sections: Record<string, unknown> = {
      return_window: {
        returnWindowDays: r.returnWindowDays,
        exchangeWindowDays: r.exchangeWindowDays,
      },
      refund_timing: {
        refundProcessingDays: r.refundProcessingDays,
        refundToOriginalPayment: r.refundToOriginalPayment,
        shippingChargesRefundable: r.shippingChargesRefundable,
      },
      condition_requirements: {
        requiresTags: r.requiresTags,
        unwornUnwashedRequired: r.unwornUnwashedRequired,
      },
      final_sale: { finalSaleCategories: r.finalSaleCategories },
      exchange_rules: {
        exchangeAllowsDifferentProduct: r.exchangeAllowsDifferentProduct,
        exchangeRequiresStock: r.exchangeRequiresStock,
        defectRoutesToQualityCase: r.defectRoutesToQualityCase,
        wrongItemFreeReplacement: r.wrongItemFreeReplacement,
      },
    };
    return {
      policy: meta,
      topic,
      ...(topic === "full_policy" ? { rules: r } : { rules: sections[topic] }),
    };
  },
});
