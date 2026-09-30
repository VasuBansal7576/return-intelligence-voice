/**
 * The one canonical demo policy.
 *
 * Public Souled Store sources disagree (storefront: 30 days; an official API
 * policy page: 15 days), so the agent must never decide between live pages on
 * its own. This pinned snapshot is the single source of truth for the demo;
 * every policy answer cites it.
 */
export const POLICY = {
  policyId: "tss-returns-demo",
  version: "2026.09-demo.2",
  market: "IN",
  effectiveDate: "2026-09-01",
  asOf: "2026-09-29",
  source: "canonical demo policy snapshot",
  sourceUrls: [
    "https://www.thesouledstore.com/returns-and-exchange",
    "https://www.thesouledstore.com/terms-and-conditions",
  ],
  rules: {
    /** Days from delivery in which a return may be raised. */
    returnWindowDays: 30,
    discretionaryDiscountsAllowed: false,
    /** Days from delivery in which an exchange may be raised. */
    exchangeWindowDays: 30,
    /** Working days for an approved refund to reach the payment source. */
    refundProcessingDays: 7,
    requiresTags: true,
    unwornUnwashedRequired: true,
    /** Categories that are never returnable (hygiene / final sale). */
    finalSaleCategories: ["innerwear", "socks", "accessory"],
    /** A manufacturing defect still routes through a quality case. */
    defectRoutesToQualityCase: true,
    /** A reported condition failure needs support review, even for a defect.
     * The prototype has no merchant-approved automatic condition waiver. */
    reportedConditionFailureRequiresSupportReview: true,
    /** A wrong item shipped is always replaced or refunded at no cost. */
    wrongItemFreeReplacement: true,
    exchangeAllowsDifferentProduct: true,
    exchangeRequiresStock: true,
    refundToOriginalPayment: true,
    shippingChargesRefundable: false,
  },
} as const;

export type Policy = typeof POLICY;
