import { POLICY } from "../knowledge/policy.ts";
import type { Customer, Order, OrderItem, Product } from "../knowledge/types.ts";
import type { DiagnosisLabel } from "./diagnosis.ts";

export type ResolutionAction =
  | "refund"
  | "exchange_same_product"
  | "exchange_different_product"
  | "replacement"
  | "quality_case";

export type IneligibilityCode =
  | "ok"
  | "not_delivered"
  | "final_sale"
  | "outside_window"
  | "already_returned";

export interface PolicyCitation {
  policyId: string;
  version: string;
  effectiveDate: string;
  source: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasonCode: IneligibilityCode;
  daysSinceDelivery: number | null;
  windowDays: number;
  allowedActions: ResolutionAction[];
  qualityCase: boolean;
  policyCitation: PolicyCitation;
  /** Deterministic sentence the model may relay to the customer verbatim. */
  explanation: string;
}

export function citePolicy(): PolicyCitation {
  return {
    policyId: POLICY.policyId,
    version: POLICY.version,
    effectiveDate: POLICY.effectiveDate,
    source: POLICY.source,
  };
}

export function checkEligibility(input: {
  customer: Customer;
  order: Order;
  item: OrderItem;
  product: Product;
  reasonLabel?: DiagnosisLabel;
}): EligibilityResult {
  const { customer, order, item, product, reasonLabel } = input;
  const rules = POLICY.rules;
  const base = {
    daysSinceDelivery: order.deliveredDaysAgo,
    windowDays: rules.returnWindowDays,
    policyCitation: citePolicy(),
  };

  const deny = (reasonCode: IneligibilityCode, explanation: string): EligibilityResult => ({
    eligible: false,
    reasonCode,
    allowedActions: [],
    qualityCase: false,
    explanation,
    ...base,
  });

  if (order.deliveredDaysAgo === null) {
    return deny(
      "not_delivered",
      `Order ${order.orderId} has not been delivered yet, so no return can be raised.`,
    );
  }

  if (
    customer.returns.some(
      (r) => r.orderId === order.orderId && r.productId === item.productId,
    )
  ) {
    return deny(
      "already_returned",
      `A return for this item on order ${order.orderId} has already been processed.`,
    );
  }

  const finalSale =
    !product.returnable ||
    (rules.finalSaleCategories as readonly string[]).includes(product.category);
  if (finalSale) {
    return deny(
      "final_sale",
      `${product.name} is a final-sale item under policy ${POLICY.policyId} v${POLICY.version} and cannot be returned or exchanged.`,
    );
  }

  if (order.deliveredDaysAgo > rules.returnWindowDays) {
    return deny(
      "outside_window",
      `This item was delivered ${order.deliveredDaysAgo} days ago. Policy ${POLICY.policyId} v${POLICY.version} allows returns within ${rules.returnWindowDays} days of delivery.`,
    );
  }

  const qualityCase =
    reasonLabel === "quality_defect" ||
    (reasonLabel === "wrong_item" && rules.wrongItemFreeReplacement);

  const allowedActions: ResolutionAction[] =
    reasonLabel === "quality_defect" || reasonLabel === "wrong_item"
      ? ["replacement", "refund"]
      : ["refund", "exchange_same_product", "exchange_different_product"];

  return {
    eligible: true,
    reasonCode: "ok",
    allowedActions,
    qualityCase,
    explanation:
      `This item was delivered ${order.deliveredDaysAgo} days ago, inside the ` +
      `${rules.returnWindowDays}-day return window under policy ${POLICY.policyId} ` +
      `v${POLICY.version}. ${actionPhrase(allowedActions, reasonLabel)}`,
    ...base,
  };
}

function actionPhrase(actions: ResolutionAction[], reasonLabel?: DiagnosisLabel): string {
  if (reasonLabel === "quality_defect") {
    return "Because this is a defect, we can replace the item or refund it — a quality case is also logged.";
  }
  if (reasonLabel === "wrong_item") {
    return "Because the wrong item was sent, we can ship the correct item or refund you at no cost.";
  }
  return `Available resolutions: ${actions
    .map((a) => a.replace(/_/g, " "))
    .join(", ")}.`;
}
