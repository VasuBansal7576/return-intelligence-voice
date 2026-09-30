import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { appendRecord } from "../lib/engine/records.ts";

export default defineTool({
  description:
    "Hand the case to a human returns specialist. Use when the customer asks for a person, when a case falls outside what tools can resolve, or when the customer is unhappy with every option. TERMINAL: only call after the customer has confirmed they want a human.",
  inputSchema: z.object({
    reason: z
      .string()
      .describe("Why this case needs a human, in one sentence"),
    context: z
      .string()
      .optional()
      .describe("Key facts the specialist needs (customer, order, what was tried)"),
  }),
  approval: always(),
  async execute({ reason, context }, ctx) {
    const record = appendRecord(
      "escalation",
      { reason, context: context ?? null, outcome: "human_escalation" },
      ctx.session.id,
    );
    return {
      escalated: true as const,
      caseId: record.recordId,
      outcome: "HUMAN_ESCALATION",
      message:
        `Case ${record.recordId} is with the returns team. A specialist will reach out ` +
        `within one working day. The customer does not need to repeat anything — the ` +
        `conversation summary travels with the case.`,
    };
  },
});
