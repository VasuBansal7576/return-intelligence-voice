import { defineTool } from "eve/tools";
import { z } from "zod";
import { diagnosisLabelSchema } from "../lib/engine/diagnosis.ts";
import { appendRecord } from "../lib/engine/records.ts";

const signalSchema = z.object({
  attribute: z
    .string()
    .describe("Product or preference attribute, e.g. fit, fabric_weight, color, material"),
  value: z.string().describe("Observed value, e.g. oversized, heavy, dark colors"),
  sentiment: z.enum(["positive", "negative"]),
  source: z
    .enum(["explicit_statement", "kept_item", "returned_item", "chose_alternate"])
    .describe("How the signal was observed"),
});

export default defineTool({
  description:
    "Save the structured product-intelligence record for this return: diagnosed reason(s), customer preference signals heard in conversation, and the outcome. Call once per resolved session — this is how every conversation becomes merchandising signal.",
  inputSchema: z.object({
    customerId: z.string().optional(),
    orderId: z.string().optional(),
    productId: z.string().describe("Product the return was about"),
    diagnosisLabels: z
      .array(diagnosisLabelSchema)
      .min(1)
      .describe("All root causes diagnosed, most important first"),
    signals: z
      .array(signalSchema)
      .default([])
      .describe("Preference signals the customer stated or demonstrated"),
    alternateOfferedIds: z.array(z.string()).default([]),
    alternateChosenId: z.string().optional(),
    outcome: z.enum([
      "refund",
      "exchange_same_product",
      "exchange_different_product",
      "replacement",
      "escalated",
      "cancelled",
    ]),
    notes: z
      .string()
      .optional()
      .describe("One line in the customer's words — what actually went wrong"),
  }),
  async execute(input, ctx) {
    const record = appendRecord(
      "insight",
      {
        ...input,
        qualityFlag:
          input.diagnosisLabels.includes("quality_defect") ||
          input.diagnosisLabels.includes("wrong_item"),
      },
      ctx.session.id,
    );
    return {
      saved: true as const,
      insightId: record.recordId,
      message: "Insight recorded for the merchandising team.",
    };
  },
});
