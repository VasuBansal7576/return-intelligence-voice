import { revokesMaterialExploration } from "../engine/consent.ts";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { CATALOG, getProduct } from "../knowledge/catalog.ts";
import { CUSTOMERS, findCustomerById, findOrder } from "../knowledge/customers.ts";
import { POLICY } from "../knowledge/policy.ts";
import { PUBLIC_CATALOG, PUBLIC_CATALOG_EVIDENCE } from "../knowledge/public-catalog.ts";
import type { Customer, Order, OrderItem, Product } from "../knowledge/types.ts";
import { checkEligibility, type EligibilityResult } from "../engine/eligibility.ts";
import { diagnoseReturn, diagnosisLabelSchema, isReportedEvidence, type ReturnDiagnosis } from "../engine/diagnosis.ts";
import { buildCustomerBrain, extractPreferences, type CustomerBrain, type PreferenceSignal } from "../engine/customer-brain.ts";
import { recommendForCustomer, type PersonalizedCandidate } from "../engine/recommend.ts";
import { createReturn, createExchange } from "../engine/resolutions.ts";
import { appendRecord, listRecords, parseStoredRecord, type AppRecord } from "../engine/records.ts";

export const newSessionSchema = z.object({ customerId: z.string(), orderId: z.string().optional(), itemId: z.string().optional(), scenario: z.string().optional() });
export const proposalSchema = z.object({ action: z.enum(["exchange", "refund", "replacement", "escalate"]), productId: z.string().optional(), size: z.string().optional(), color: z.string().optional() });
export type ResolutionAction = z.infer<typeof proposalSchema>["action"];
export interface PendingAction {
  proposalId: string; action: ResolutionAction; summary: string; orderId: string; itemId: string;
  sourceProductId: string; sourceProductName: string;
  productId: string | null; productName: string | null; size: string | null; color: string | null;
  refundAmountInr: number; priceDeltaInr: number; simulated: true;
  conditionConfirmationRequired: boolean;
}
export interface Message { id: string; role: "user" | "assistant"; text: string; at: string; source: "local-guided-demo" | "assemblyai"; interrupted?: boolean; itemId?: string }
export interface ToolEvent { id: string; name: string; status: "completed" | "blocked"; detail: string; at: string; durationMs: number | null; origin: "startup" | "internal" | "model"; callId?: string; input?: unknown; output?: unknown }
interface ItemWork {
  item: OrderItem; product: Product; diagnosis: ReturnDiagnosis | null;
  eligibility: EligibilityResult; candidates: PersonalizedCandidate[];
  excluded: Array<{ productId: string; name: string; reason: string }>;
  recommendationGate: string | null; pendingAction: PendingAction | null; resolution: AppRecord | null;
  condition: "unknown" | "confirmed" | "not_met"; sensitiveExplorationConsent: boolean;
}
export interface SessionSnapshot {
  id: string; mode: "local-guided-demo" | "assemblyai"; synthetic: true; createdAt: string;
  customer: Customer; customerBrain: CustomerBrain; order: Order; item: OrderItem; sourceProduct: Product;
  activeItemId: string; items: Array<{ item: OrderItem; product: Product; status: string; resolution: AppRecord | null }>;
  phase: string; messages: Message[]; tools: ToolEvent[]; diagnosis: ReturnDiagnosis | null;
  eligibility: EligibilityResult; candidates: PersonalizedCandidate[];
  excluded: Array<{ productId: string; name: string; reason: string }>;
  recommendationAllowed: boolean; recommendationGate: string | null;
  pendingAction: PendingAction | null; resolution: AppRecord | null; policy: typeof POLICY;
  conditions: { status: ItemWork["condition"]; required: string[] };
  cohort: { status: "insufficient_outcome_data"; explanation: string };
}
interface Session {
  id: string; createdAt: string; mode: SessionSnapshot["mode"]; customer: Customer; order: Order;
  activeItemId: string; work: Map<string, ItemWork>; preferences: PreferenceSignal[];
  messages: Message[]; tools: ToolEvent[]; phase: string; completedProposalIds: Map<string, AppRecord>;
  toolResults: Map<string, unknown>; transcriptIds: Set<string>;
}
export class DomainError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; this.name = "DomainError"; }
}

const sessions = new Map<string, Session>();
const sessionContext = new AsyncLocalStorage<Map<string, Session>>();
function sessionMap(): Map<string, Session> { return sessionContext.getStore() ?? sessions; }
export function withSessionContext<T>(work: () => T): T { return sessionContext.run(new Map(), work); }
const now = () => new Date().toISOString();
function getSession(id: string): Session {
  const session = sessionMap().get(id); if (!session) throw new DomainError("session_not_found", "This demo session is unavailable. Start a new session.", 404);
  return session;
}
function active(session: Session): ItemWork {
  const item = session.work.get(session.activeItemId); if (!item) throw new DomainError("item_not_found", "Choose an item from this order."); return item;
}
function brain(session: Session): CustomerBrain { return buildCustomerBrain(session.customer, session.preferences); }
function tool(session: Session, name: string, detail: string, input: unknown, output: unknown, started: number | undefined = undefined, blocked = false, origin: ToolEvent["origin"] = "internal", callId?: string): void {
  session.tools.push({ id: randomUUID(), name, status: blocked ? "blocked" : "completed", detail, at: now(), durationMs: started === undefined ? null : Math.max(0, Math.round((performance.now() - started) * 100) / 100), origin, ...(callId ? { callId } : {}), input, output });
}
function message(session: Session, role: Message["role"], text: string, source: Message["source"] = "local-guided-demo", interrupted?: boolean, itemId?: string): void {
  session.messages.push({ id: randomUUID(), role, text, at: now(), source, ...(itemId ? { itemId } : {}), ...(interrupted ? { interrupted } : {}) });
}
function snapshot(session: Session): SessionSnapshot {
  const item = active(session);
  return { id: session.id, createdAt: session.createdAt, mode: session.mode, synthetic: true,
    customer: session.customer, customerBrain: brain(session), order: session.order, item: item.item, sourceProduct: item.product,
    activeItemId: session.activeItemId, items: [...session.work.values()].map((w) => ({ item: w.item, product: w.product, status: w.resolution ? "resolved" : w.diagnosis ? "diagnosed" : "not_started", resolution: w.resolution })),
    phase: session.phase, messages: [...session.messages], tools: [...session.tools], diagnosis: item.diagnosis,
    eligibility: item.eligibility, candidates: item.candidates, excluded: item.excluded,
    recommendationAllowed: item.candidates.length > 0 && item.recommendationGate === null,
    recommendationGate: item.recommendationGate, pendingAction: item.pendingAction, resolution: item.resolution, policy: POLICY,
    conditions: { status: item.condition, required: ["tags attached", "unworn", "unwashed"] },
    cohort: { status: "insufficient_outcome_data", explanation: "No measured cohort keep/second-return evidence is available yet. Recommendations use current context, stated preferences and synthetic history." } };
}

export function bootstrap() {
  return { customers: CUSTOMERS.map((customer) => ({ ...customer, customerBrain: buildCustomerBrain(customer) })), catalog: PUBLIC_CATALOG, fixtureCatalog: CATALOG, catalogEvidence: PUBLIC_CATALOG_EVIDENCE, policy: POLICY,
    dataNotice: "Independent prototype, no affiliation with The Souled Store. Public product attributes have dated official sources. Customer/order histories, all operational inventory and transactions are simulated. Legacy synthetic products are separately labeled fixtures. No real refunds or shipments.",
    scenarios: [
      { id: "grounded", name: "Measured, sourced alternatives", customerId: "CUST-001", orderId: "TSS-GROUND-2001", prompt: "The shoulders feel too tight and the fabric is too heavy. I am open to a different design.", description: "Verified garment dimensions and fabric weight, with explicit trade-offs" },
      { id: "grounded-cold", name: "Keep the fit, change the fabric", customerId: "CUST-002", orderId: "TSS-GROUND-2002", prompt: "The fit is great, but the fabric feels too heavy.", description: "Public material and size-chart evidence with no historical assumption" },
      { id: "returning", name: "A better match", customerId: "CUST-001", prompt: "I like the design, but this feels too tight and hot.", description: "History-aware fit and fabric recovery" },
      { id: "cold-start", name: "First order, better understanding", customerId: "CUST-002", prompt: "The fit is great. I just hate how heavy the fabric feels.", description: "Preserve what works; change the fabric" },
      { id: "defect", name: "Quality comes first", customerId: "CUST-004", prompt: "The seam opened after one wash.", description: "Replacement or refund without an upsell" },
      { id: "refund", name: "Respect the refund", customerId: "CUST-001", prompt: "I don't want anything else. I only want my refund.", description: "Customer choice ends the recommendation" },
      { id: "sensitive", name: "Handle with care", customerId: "CUST-002", prompt: "This makes my skin itch.", description: "No diagnosis or material-safety claims" },
      { id: "ineligible", name: "An honest policy answer", customerId: "CUST-003", prompt: "I changed my mind and want to return this.", description: "Canonical policy wins, with a support option" },
      { id: "multi-item", name: "Different items, different rules", customerId: "CUST-005", prompt: "I want to return the beanie and the t-shirt.", description: "Item-specific policy and state" },
    ],
  };
}

export function startSession(input: z.infer<typeof newSessionSchema>): SessionSnapshot {
  const customer = findCustomerById(input.customerId); if (!customer) throw new DomainError("customer_not_found", "Select a seeded demo customer.");
  const selectedOrderId = input.orderId ?? (input.scenario === "grounded" ? "TSS-GROUND-2001" : input.scenario === "grounded-cold" ? "TSS-GROUND-2002" : undefined);
  const order = selectedOrderId ? customer.orders.find((o) => o.orderId === selectedOrderId) : customer.orders[0];
  if (!order) throw new DomainError("order_not_found", "That order does not belong to this demo customer.");
  const first = input.itemId ? order.items.find((i) => i.itemId === input.itemId) : order.items[0];
  if (!first) throw new DomainError("item_not_found", "Select an item on the chosen order.");
  const session: Session = { id: randomUUID(), createdAt: now(), mode: "local-guided-demo", customer, order, activeItemId: first.itemId,
    work: new Map(), preferences: readSavedPreferences(customer.customerId), messages: [], tools: [], phase: "DIAGNOSING_RETURN", completedProposalIds: new Map(), toolResults: new Map(), transcriptIds: new Set() };
  for (const item of order.items) {
    const product = getProduct(item.productId); if (!product) throw new DomainError("catalog_gap", "The demo catalog is missing the ordered item.", 500);
    session.work.set(item.itemId, { item, product, diagnosis: null, eligibility: checkEligibility({ customer, order, item, product }), candidates: [], excluded: [], recommendationGate: null, pendingAction: null, resolution: null, condition: "unknown", sensitiveExplorationConsent: false });
  }
  sessionMap().set(session.id, session);
  tool(session, "get_customer", "Loaded a synthetic customer and evidence-based preferences", { customerId: customer.customerId }, brain(session));
  tool(session, "get_order", "Loaded the selected demo order", { orderId: order.orderId }, order);
  tool(session, "check_return_eligibility", "Applied the canonical demo policy", { itemId: first.itemId }, active(session).eligibility);
  for (const event of session.tools) event.origin = "startup";
  message(session, "assistant", `Hi ${customer.name.split(" ")[0]}. I have your ${active(session).product.name}, size ${first.size}. What did not work for you?`);
  return snapshot(session);
}
export function getSessionSnapshot(id: string): SessionSnapshot { return snapshot(getSession(id)); }
export function selectItem(id: string, itemId: string): SessionSnapshot {
  const session = getSession(id); if (!session.work.has(itemId)) throw new DomainError("item_not_found", "That item is not in this order.");
  active(session).pendingAction = null; session.activeItemId = itemId;
  const item = active(session); session.phase = item.resolution ? "COMPLETED" : "DIAGNOSING_RETURN";
  tool(session, "get_order_items", "Switched item without losing other items' diagnoses", { itemId }, item.item);
  return snapshot(session);
}

const extractedPreferenceSchema = z.object({ attribute: z.enum(["fit", "color", "material", "fabric_weight", "theme", "price"]), value: z.string().min(1).max(100), sentiment: z.enum(["positive", "negative"]), confidence: z.number().min(0).max(1), evidence: z.array(z.string().min(1)).min(1).max(5), strict: z.boolean().default(false) });
function updateItemCondition(item: ItemWork, text: string): void {
  if (/\b(tags?.{0,12}(attached|on)|with tags)\b/i.test(text) && /\b(unworn|unused)\b/i.test(text) && /\b(unwashed)\b/i.test(text)) item.condition = "confirmed";
  if (/\b(tags?.{0,12}(removed|missing|off)|removed.{0,12}tags?|i (wore|washed)|already (worn|washed)|after (one |a |the first )?wash)\b/i.test(text)) item.condition = "not_met";
}
export const structuredDiagnosisSchema = z.object({
  text: z.string().min(1).max(4000), primaryReason: z.string().regex(/^(fit|material|comfort|appearance|product_expectation|quality|fulfillment|logistics|preference|value|sensitive|other)\.[a-z_]+$/),
  secondaryReasons: z.array(z.string().max(100)).max(8), labels: z.array(diagnosisLabelSchema).min(1).max(8),
  evidence: z.array(z.object({ label: z.string().max(100), quote: z.string().min(1).max(4000) })).min(1).max(12),
  likedAttributes: z.array(z.enum(["fit", "theme", "color", "length", "material"])).max(5), confidence: z.number().min(0).max(1),
  clarifyingQuestion: z.string().max(250).nullable(), preferences: z.array(extractedPreferenceSchema).max(12),
});
function updateUnderstanding(session: Session, text: string, structured?: z.infer<typeof structuredDiagnosisSchema>): void {
  const item = active(session);
  if (item.resolution) return;
  const guard = diagnoseReturn(text);
  let current = guard;
  if (structured) {
    const spoken = session.messages.filter((m) => m.role === "user").map((m) => m.text);
    const quotes = [structured.text, ...structured.evidence.map((e) => e.quote), ...structured.preferences.flatMap((p) => p.evidence)];
    if (quotes.some((quote) => !spoken.some((utterance) => utterance.toLowerCase().includes(quote.toLowerCase())))) {
      throw new DomainError("ungrounded_extraction", "Every diagnosis and preference must cite an exact span from the customer's actual transcript.", 409);
    }
    if (structured.labels.some((label) => label === "quality_defect" || label === "wrong_item")) {
      const criticalEvidence = structured.evidence.filter((e) => /^(quality|fulfillment)\./.test(e.label));
      if (!criticalEvidence.length || criticalEvidence.some((e) => !isReportedEvidence(e.quote, spoken))) throw new DomainError("unasserted_critical_issue", "A defect or fulfillment exception needs a positively reported event. Negated, hypothetical, or uncertain language requires clarification.", 409);
    }
    for (const preference of structured.preferences) {
      const evidence = preference.evidence.join(" ").toLowerCase();
      const literal = evidence.includes(preference.value.toLowerCase());
      const groundedCurrentFit = preference.attribute === "fit" && preference.value === item.product.fit && structured.likedAttributes.includes("fit") && preference.sentiment === "positive";
      const groundedCurrentTheme = preference.attribute === "theme" && preference.value === item.product.theme && structured.likedAttributes.includes("theme") && preference.sentiment === "positive";
      const weightSynonym = preference.attribute === "fabric_weight" && preference.value === "heavy" && /\b(heavy|hot|warm|thick)\b/.test(evidence);
      if (!literal && !groundedCurrentFit && !groundedCurrentTheme && !weightSynonym) throw new DomainError("inferred_preference_not_explicit", "Do not present an inferred preference as an explicit statement. Use the customer's words or omit it.", 409);
    }
    if (guard.gateReason?.startsWith("We cannot") && structured.labels.includes("quality_defect")) throw new DomainError("fabricated_defect", "A request to invent damage cannot become a defect record.", 409);
    if (structured.labels.includes("quality_defect") && !guard.labels.includes("quality_defect") && /\b(not damaged|no defect|not defective|not broken)\b/i.test(text)) throw new DomainError("negated_defect", "The customer explicitly denied damage. Clarify rather than using a defect exception.", 409);
    if (structured.labels.includes("wrong_item") && !guard.labels.includes("wrong_item") && /\b(not (the )?wrong (item|product|size|colou?r))\b/i.test(text)) throw new DomainError("negated_fulfillment_error", "The customer denied a fulfillment error. Do not waive policy on that basis.", 409);
    current = { ...guard, primaryReason: structured.primaryReason, secondaryReasons: structured.secondaryReasons,
      labels: structured.labels, evidence: structured.evidence, likedAttributes: structured.likedAttributes, confidence: structured.confidence,
      requiresClarification: structured.confidence < 0.7 || structured.clarifyingQuestion !== null,
      clarifyingQuestion: structured.clarifyingQuestion ?? (structured.confidence < 0.7 ? "Could you clarify the detail that matters most before I suggest a resolution?" : null),
      recommendationAllowed: guard.gateReason === null && structured.confidence >= 0.7 && structured.clarifyingQuestion === null };
  }
  // All structured evidence is validated before any session mutation, in
  // local mode as well as the database transaction path.
  item.pendingAction = null;
  updateItemCondition(item, text);
  const previous = item.diagnosis;
  const wantsRecommendations = /\b(actually|changed my mind|now)\b.{0,35}\b(want|show|explore)\b.{0,20}\b(exchange|alternatives|recommendations)\b/i.test(text);
  // A concrete new reason augments this item's diagnosis, while an explicit
  // refund/refusal always takes precedence over earlier recommendations.
  if (item.diagnosis && current.labels.length === 1 && current.labels[0] === "other" && !current.gateReason) {
    const prior = item.diagnosis;
    if (/\b(yes|roomier|similar length|go ahead|show me|explore|alternatives)\b/i.test(text)) {
      item.diagnosis = { ...prior, requiresClarification: false, clarifyingQuestion: null,
        recommendationAllowed: prior.gateReason === null };
    }
  } else if (item.diagnosis && current.labels[0] !== "other" && !current.gateReason) {
    const prior = item.diagnosis;
    item.diagnosis = { ...current, labels: [...new Set([...prior.labels.filter((l) => l !== "other"), ...current.labels])],
      secondaryReasons: [...new Set([...prior.secondaryReasons, ...current.secondaryReasons, ...(prior.primaryReason !== current.primaryReason ? [prior.primaryReason] : [])])],
      likedAttributes: [...new Set([...prior.likedAttributes, ...current.likedAttributes])], evidence: [...prior.evidence, ...current.evidence] };
  } else item.diagnosis = current;
  if (previous) {
    const next = item.diagnosis;
    if (next.labels.length === 1 && next.labels[0] === "other") {
      item.diagnosis = { ...next, labels: previous.labels, primaryReason: previous.primaryReason,
        secondaryReasons: previous.secondaryReasons, evidence: previous.evidence,
        likedAttributes: previous.likedAttributes };
    }
    if (previous.refundOnly && !wantsRecommendations) item.diagnosis = { ...item.diagnosis, refundOnly: true,
      recommendationAllowed: false, gateReason: "Customer requested a refund without recommendations.", requiresClarification: false, clarifyingQuestion: null };
    if (wantsRecommendations && previous.refundOnly && !current.refundOnly) item.diagnosis = { ...item.diagnosis,
      refundOnly: false, gateReason: null, recommendationAllowed: !item.diagnosis.requiresClarification };
    if (previous.frustrated && !wantsRecommendations) item.diagnosis = { ...item.diagnosis, frustrated: true };
  }
  const merged = item.diagnosis;
  const persistentGate = merged.refundOnly ? "Customer requested a refund without recommendations."
    : merged.frustrated ? "Prioritize a short resolution or human support for a frustrated customer."
    : merged.labels.includes("sensitive_skin_reaction") ? "Reported skin reaction: no unsolicited alternatives or medical claims."
    : merged.labels.includes("quality_defect") ? "Quality failure: replacement, refund or quality support; no upsell."
    : merged.labels.includes("wrong_item") ? "Fulfillment error: correction or refund; no alternative-product selling."
    : merged.gateReason;
  if (persistentGate) item.diagnosis = { ...merged, gateReason: persistentGate, recommendationAllowed: false };
  let diagnosis = item.diagnosis ?? current;
  const measurements = item.product.garmentMeasurements?.[item.item.size];
  if (diagnosis.requiresClarification && diagnosis.likedAttributes.includes("length") && measurements?.chestIn !== undefined && measurements.lengthIn !== undefined) {
    diagnosis = { ...diagnosis, clarifyingQuestion: `Your current size ${item.item.size} has a published garment chest of ${measurements.chestIn} inches and length of ${measurements.lengthIn} inches. Should I keep that length while looking for more room at the shoulders?` };
    item.diagnosis = diagnosis;
  }
  const signals: PreferenceSignal[] = structured ? structured.preferences.map((p) => ({ ...p, source: "explicit_statement", updatedAt: now() })) : extractPreferences(text, item.product, diagnosis);
  for (const signal of signals) {
    session.preferences.push(signal);
    appendRecord("preference", { customerId: session.customer.customerId, signal, synthetic: true }, session.id);
  }
  tool(session, "diagnose_return", "Captured root causes and customer autonomy constraints", { text }, diagnosis);
  if (signals.length) tool(session, "save_customer_preference", "Saved explicit preference evidence", { customerId: session.customer.customerId }, signals);
  item.eligibility = checkEligibility({ customer: session.customer, order: session.order, item: item.item, product: item.product,
    reasonLabel: diagnosis.labels.find((l) => l === "quality_defect" || l === "wrong_item") ?? diagnosis.labels[0] });
  tool(session, "check_return_eligibility", "Rechecked policy with the diagnosed reason", { reasonLabels: diagnosis.labels }, item.eligibility);
  if (diagnosis.refundOnly || diagnosis.frustrated || revokesMaterialExploration(text)) item.sensitiveExplorationConsent = false;
  else if (diagnosis.labels.includes("sensitive_skin_reaction") && /\b(show|explore|want).{0,20}(different material|alternatives)\b/i.test(text)) item.sensitiveExplorationConsent = true;
  const sensitiveExploration = item.sensitiveExplorationConsent;
  const recommendations = item.eligibility.eligible && item.eligibility.allowedActions.includes("exchange_different_product")
    ? recommendForCustomer({ source: item.product, catalog: item.product.catalogSource ? PUBLIC_CATALOG : CATALOG, diagnosis, brain: brain(session), size: item.item.size, allowSensitiveExploration: sensitiveExploration })
    : { candidates: [], excluded: [], gateReason: item.eligibility.explanation };
  item.candidates = recommendations.candidates; item.excluded = recommendations.excluded; item.recommendationGate = recommendations.gateReason;
  tool(session, "search_products", item.candidates.length ? "Ranked candidates against every known constraint" : "Recommendation gate prevented inappropriate suggestions",
    { labels: diagnosis.labels, size: item.item.size }, recommendations, undefined, item.candidates.length === 0);
  session.phase = diagnosis.requiresClarification ? "DIAGNOSING_RETURN" : item.candidates.length ? "RECOMMENDATION_FLOW" : "RESOLUTION_DECISION";
}

export function addMessage(id: string, text: string): SessionSnapshot {
  const session = getSession(id); message(session, "user", text);
  const item = active(session);
  if (item.resolution) { message(session, "assistant", "This item already has a recorded demo resolution. You can inspect it or select another item."); return snapshot(session); }
  if (/\b(discount|coupon|promo code|waive.{0,15}price)\b/i.test(text)) {
    const decision = discountDecision();
    tool(session, "get_discount_policy", "Applied canonical discretionary discount rule", { text }, decision);
    message(session, "assistant", decision.message); return snapshot(session);
  }
  if (/\b(garment length|chest measurement|shoulder measurement|garment measurements)\b/i.test(text) && /\?|\b(is|does|what)\b/i.test(text)) {
    const measures = item.product.garmentMeasurements?.[item.item.size];
    if (measures && Object.values(measures).some((value) => value !== undefined)) {
      tool(session, "get_product_variant", "Read this product's verified garment chart", { productId: item.product.id, size: item.item.size }, measures);
      message(session, "assistant", `For size ${item.item.size}, the source chart lists ${[measures.chestIn === undefined ? null : `garment chest ${measures.chestIn} inches`, measures.lengthIn === undefined ? null : `length ${measures.lengthIn} inches`, measures.shoulderIn === undefined ? null : `shoulder ${measures.shoulderIn} inches`].filter(Boolean).join(", ")}. These measurements do not guarantee fit.`);
      return snapshot(session);
    }
  }
  if (/\b(egyptian|organic|hypoallergenic|allergy.safe|chest measurement|garment length)\b/i.test(text) && /\?|\b(is|does|what)\b/i.test(text)) {
    tool(session, "get_product", "Checked the catalog without inventing missing attributes", { productId: item.product.id }, item.product);
    message(session, "assistant", `The catalog confirms ${item.product.material}. It does not confirm ${/egyptian/i.test(text) ? "Egyptian cotton" : "that additional attribute"}, so I cannot claim it. What would you like to do next?`);
    return snapshot(session);
  }
  updateUnderstanding(session, text);
  const d = item.diagnosis;
  if (!d) return snapshot(session);
  if (!item.eligibility.eligible) message(session, "assistant", `${item.eligibility.explanation} I can prepare a support escalation if you would like.`);
  else if (item.condition === "not_met") message(session, "assistant", "The reported item condition needs support review under the demo policy. I can prepare a quality or support case; I cannot automatically waive the condition requirement.");
  else if (d.gateReason?.startsWith("We cannot")) message(session, "assistant", `${d.gateReason} Tell me what actually happened, and I will check the allowed resolution.`);
  else if (d.refundOnly) { message(session, "assistant", `Understood. I will stop recommending alternatives. I can prepare the ₹${item.item.priceInr * item.item.qty} demo refund for your review.`); proposeResolution(id, { action: "refund" }); }
  else if (d.labels.includes("sensitive_skin_reaction") && !item.sensitiveExplorationConsent) message(session, "assistant", "I'm sorry it was uncomfortable. I cannot determine which material is suitable for your skin. We can prepare a return or support case; I will only explore other materials if you ask.");
  else if (d.labels.includes("quality_defect") || d.labels.includes("wrong_item")) message(session, "assistant", "This needs a replacement, refund or quality support case. I will not offer an upsell. Which would you prefer?");
  else if (d.frustrated) message(session, "assistant", "I will keep this short. Would you prefer a refund or help from a person?");
  else if (d.clarifyingQuestion) message(session, "assistant", d.clarifyingQuestion);
  else if (item.candidates.length) {
    const top = item.candidates[0];
    message(session, "assistant", `${d.labels.includes("sensitive_skin_reaction") ? "You asked to explore alternatives. I cannot determine material suitability or guarantee skin comfort. " : ""}${top.name} has ${/^[aeiou]/i.test(top.fit) ? "an" : "a"} ${top.fit} fit and ${top.gsm ?? "unspecified"} GSM ${top.material.toLowerCase()} fabric, at ₹${top.priceInr}. It is in the simulated inventory in ${top.recommendedSize}. ${top.tradeoffs.length ? `${top.tradeoffs.join(". ")}. Published dimensions and lower GSM do not guarantee comfort or fit. ` : ""}Would you like to compare the options?`);
  } else message(session, "assistant", "I do not have a verified in-stock alternative that solves the known problem. We can continue with a refund or support.");
  return snapshot(session);
}

export function recordTranscript(id: string, input: { role: "user" | "assistant"; text: string; itemId?: string; interrupted?: boolean }): SessionSnapshot {
  const session = getSession(id); session.mode = "assemblyai";
  if (input.itemId && session.transcriptIds.has(input.itemId)) return snapshot(session);
  if (input.itemId) session.transcriptIds.add(input.itemId);
  message(session, input.role, input.text, "assemblyai", input.interrupted, input.itemId);
  if (input.role === "user") {
    // Live semantics come from the managed model's schema-validated tool call,
    // not from the keyword-based guided-demo adapter. This narrow immediate
    // guard only stops stale proposals/selling on explicit refusal or risk.
    const item = active(session); const guard = diagnoseReturn(input.text);
    updateItemCondition(item, input.text);
    if (guard.refundOnly || guard.frustrated || guard.labels.includes("sensitive_skin_reaction") || /\b(cancel|instead|actually)\b/i.test(input.text)) item.pendingAction = null;
    if (guard.gateReason) {
      item.candidates = []; item.recommendationGate = guard.gateReason;
      if (item.diagnosis) item.diagnosis = { ...item.diagnosis,
        labels: [...new Set([...item.diagnosis.labels, ...guard.labels.filter((l) => l !== "other")])],
        refundOnly: item.diagnosis.refundOnly || guard.refundOnly,
        frustrated: item.diagnosis.frustrated || guard.frustrated, recommendationAllowed: false, gateReason: guard.gateReason };
    }
  }
  return snapshot(session);
}

export function proposeResolution(id: string, input: z.infer<typeof proposalSchema>): SessionSnapshot {
  const session = getSession(id); const item = active(session);
  if (item.resolution) throw new DomainError("already_resolved", "This item already has a resolution.", 409);
  if (!item.diagnosis && input.action !== "escalate") throw new DomainError("diagnosis_required", "Capture the return reason before preparing a transaction.", 409);
  if (!item.eligibility.eligible && input.action !== "escalate") throw new DomainError("ineligible", item.eligibility.explanation, 409);
  const replacement = input.action === "exchange" || input.action === "replacement" ? getProduct(input.productId ?? item.product.id) : undefined;
  if ((input.action === "exchange" || input.action === "replacement") && !replacement) throw new DomainError("unknown_product", "Choose a catalog product.");
  if (input.action === "exchange" && item.diagnosis && !item.diagnosis.recommendationAllowed && !item.candidates.length) throw new DomainError("recommendation_blocked", item.diagnosis.gateReason ?? "Clarify the customer's requirements before exchanging.", 409);
  if (input.action === "replacement" && (!item.eligibility.allowedActions.includes("replacement") || replacement?.id !== item.product.id)) throw new DomainError("replacement_not_allowed", "Replacement is allowed only for the original product in a verified defect/fulfillment case.", 409);
  if (input.action === "exchange" && replacement?.id !== item.product.id && !item.candidates.some((c) => c.productId === replacement?.id)) throw new DomainError("unverified_candidate", "That product does not satisfy the current recommendation constraints.", 409);
  const size = replacement ? input.size ?? item.item.size : null;
  const color = replacement ? input.color ?? (replacement.colors.includes(item.item.color) ? item.item.color : replacement.colors[0]) : null;
  if (replacement && size && color) verifyStock(replacement, size, color);
  const proposedCandidate = item.candidates.find((candidate) => candidate.productId === replacement?.id);
  if (input.action === "exchange" && replacement?.catalogSource && item.diagnosis?.labels.some((l) => l === "fit_too_small" || l === "fit_too_large") && proposedCandidate && proposedCandidate.recommendedSize !== size) throw new DomainError("unverified_variant", `The measured comparison supports size ${proposedCandidate.recommendedSize}. Choose that variant or clarify the required dimensions.`, 409);
  const priceDelta = replacement && input.action !== "replacement" ? (replacement.priceInr - item.item.priceInr) * item.item.qty : 0;
  const refundAmount = input.action === "refund" ? item.item.priceInr * item.item.qty : 0;
  const summary = input.action === "refund" ? `Request a simulated ₹${refundAmount} refund for ${item.product.name}, size ${item.item.size}.`
    : input.action === "escalate" ? `Create a simulated support case for ${item.product.name} with the recorded evidence.`
    : `${input.action === "replacement" ? "Replace" : "Exchange"} ${item.product.name} for ${replacement?.name}, ${color}, size ${size}. ${priceDelta === 0 ? "No price difference." : priceDelta > 0 ? `₹${priceDelta} additional simulated payment.` : `₹${-priceDelta} simulated price-difference refund.`}`;
  item.pendingAction = { proposalId: randomUUID(), action: input.action, summary, orderId: session.order.orderId, itemId: item.item.itemId,
    sourceProductId: item.product.id, sourceProductName: item.product.name, productId: replacement?.id ?? null, productName: replacement?.name ?? null, size, color,
    refundAmountInr: refundAmount, priceDeltaInr: priceDelta, simulated: true,
    conditionConfirmationRequired: input.action !== "escalate" && input.action !== "replacement" && !item.eligibility.qualityCase && item.condition !== "confirmed" };
  session.phase = "CUSTOMER_CONFIRMATION";
  tool(session, "request_resolution", "Prepared exact terms; nothing has been executed", input, item.pendingAction);
  return snapshot(session);
}
export function cancelProposal(id: string): SessionSnapshot {
  const session = getSession(id); active(session).pendingAction = null; session.phase = "RESOLUTION_DECISION";
  tool(session, "cancel_proposal", "Dismissed the proposal without a transaction", {}, { cancelled: true }); return snapshot(session);
}
export async function resolveProposal(id: string, input: { proposalId: string; confirmed: boolean; conditionConfirmed?: boolean }): Promise<SessionSnapshot> {
  const session = getSession(id); const item = active(session);
  if (input.confirmed !== true) throw new DomainError("confirmation_required", "Explicit confirmation is required.", 409);
  if (session.completedProposalIds.has(input.proposalId)) return snapshot(session);
  const proposal = item.pendingAction;
  if (!proposal || proposal.proposalId !== input.proposalId) throw new DomainError("stale_proposal", "The proposal changed or was cancelled. Review the current proposal.", 409);
  if (proposal.conditionConfirmationRequired && input.conditionConfirmed !== true) throw new DomainError("condition_confirmation_required", "Confirm that the item is unworn and unwashed with tags attached, or ask for support.", 409);
  if (item.condition === "not_met" && proposal.action !== "escalate" && POLICY.rules.reportedConditionFailureRequiresSupportReview) throw new DomainError("conditions_not_met", "The reported condition requires human support under this demo policy, including review of any reported defect.", 409);
  const started = performance.now(); let record: AppRecord;
  const reason = item.diagnosis?.labels.find((l) => l === "quality_defect" || l === "wrong_item") ?? item.diagnosis?.labels[0] ?? "other";
  if (proposal.action === "escalate") {
    record = appendRecord("escalation", { customerId: session.customer.customerId, orderId: session.order.orderId, itemId: item.item.itemId,
      productId: item.product.id, diagnosis: item.diagnosis, outcome: "HUMAN_ESCALATION", simulated: true }, session.id);
  } else if (proposal.action === "refund") {
    const result = await createReturn({ orderId: session.order.orderId, productId: item.product.id, itemId: item.item.itemId, reasonLabel: reason }, session.id, session.id);
    if (!result.created) throw new DomainError("resolution_refused", result.message, 409);
    const found = listRecords("return").find((r) => r.recordId === result.returnId); if (!found) throw new DomainError("ledger_failure", "Resolution record unavailable.", 500); record = found;
  } else {
    if (!proposal.productId || !proposal.size || !proposal.color) throw new DomainError("invalid_proposal", "The exact replacement variant is missing.", 409);
    const replacement = getProduct(proposal.productId); if (!replacement) throw new DomainError("unknown_product", "Replacement product is unavailable.", 409);
    try { verifyStock(replacement, proposal.size, proposal.color); }
    catch (error) { item.pendingAction = null; throw error; }
    const currentDelta = proposal.action === "replacement" ? 0 : (replacement.priceInr - item.item.priceInr) * item.item.qty;
    if (currentDelta !== proposal.priceDeltaInr) { item.pendingAction = null; throw new DomainError("price_changed", "The price changed after the proposal. Review a new proposal before confirming.", 409); }
    const result = await createExchange({ orderId: session.order.orderId, returnProductId: item.product.id, returnItemId: item.item.itemId,
      replacementProductId: replacement.id, replacementSize: proposal.size, replacementColor: proposal.color, reasonLabel: reason }, session.id, session.id);
    if (!result.created) throw new DomainError("resolution_refused", result.message, 409);
    const found = listRecords("exchange").find((r) => r.recordId === result.exchangeId); if (!found) throw new DomainError("ledger_failure", "Resolution record unavailable.", 500); record = found;
  }
  item.resolution = record; item.pendingAction = null; session.completedProposalIds.set(proposal.proposalId, record);
  session.phase = "COMPLETED";
  tool(session, proposal.action === "refund" ? "create_return" : proposal.action === "escalate" ? "escalate_to_human" : "create_exchange",
    "Committed the confirmed simulated resolution", { proposalId: proposal.proposalId }, record, started);
  const insight = appendRecord("insight", { customerId: session.customer.customerId, customerName: session.customer.name, orderId: session.order.orderId,
    productId: item.product.id, productName: item.product.name, itemId: item.item.itemId, size: item.item.size, diagnosis: item.diagnosis,
    diagnosisLabels: item.diagnosis?.labels ?? ["other"], primaryReason: item.diagnosis?.primaryReason ?? "other.unclear",
    signals: session.preferences.filter((p) => p.source === "explicit_statement"), offeredProductIds: item.candidates.map((c) => c.productId),
    chosenProductId: proposal.productId, outcome: proposal.action, qualityFlag: item.eligibility.qualityCase,
    refundAmountInr: proposal.refundAmountInr, retainedRevenueInr: proposal.action === "exchange" ? Math.min(item.item.priceInr, getProduct(proposal.productId ?? "")?.priceInr ?? 0) * item.item.qty : 0,
    policyCitation: item.eligibility.policyCitation, sourceMode: session.mode, synthetic: true, transcript: session.messages }, session.id);
  if (item.eligibility.qualityCase) appendRecord("quality_case", { productId: item.product.id, productName: item.product.name, reason: item.diagnosis?.primaryReason, insightId: insight.recordId, simulated: true }, session.id);
  tool(session, "save_return_insight", "Saved SKU-level feedback, preference evidence and resolution", { resolutionId: record.recordId }, insight);
  message(session, "assistant", `Your demo ${proposal.action === "escalate" ? "support case" : proposal.action} is recorded as ${record.recordId}. No real refund, payment or shipment was made. The product feedback is now available in the merchant view.`);
  return snapshot(session);
}
function verifyStock(product: Product, size: string, color: string): void {
  if (!product.sizes.includes(size) || (product.stock[size] ?? 0) <= 0) throw new DomainError("out_of_stock", `${product.name} is unavailable in ${size}.`, 409);
  if (!product.colors.some((c) => c.toLowerCase() === color.toLowerCase())) throw new DomainError("unknown_color", `${color} is not a listed color for ${product.name}.`, 409);
}

const signalSchema = z.object({ attribute: z.enum(["fit", "color", "material", "fabric_weight", "theme", "price"]), value: z.string(), sentiment: z.enum(["positive", "negative"]), source: z.enum(["explicit_statement", "behavioral_inference"]), confidence: z.number(), evidence: z.array(z.string()), updatedAt: z.string(), strict: z.boolean() });
function readSavedPreferences(customerId: string): PreferenceSignal[] {
  return listRecords("preference").filter((r) => r.customerId === customerId).flatMap((r) => { const parsed = signalSchema.safeParse(r.signal); return parsed.success ? [parsed.data] : []; });
}
export function merchantInsights() {
  const insights = listRecords("insight"); const outcomes = listRecords("outcome");
  const exchanges = insights.filter((r) => r.outcome === "exchange"); const refunds = insights.filter((r) => r.outcome === "refund");
  const escalations = insights.filter((r) => r.outcome === "escalate");
  const completed = insights.length;
  const skus = new Map<string, { productId: string; productName: string; returns: number; reasons: Record<string, number>; qualityCases: number; evidence: Array<{ text: string; sessionId: string | undefined }> }>();
  for (const row of insights) {
    const productId = String(row.productId); const product = skus.get(productId) ?? { productId, productName: String(row.productName), returns: 0, reasons: {}, qualityCases: 0, evidence: [] };
    product.returns += 1; const reason = String(row.primaryReason ?? "other.unclear"); product.reasons[reason] = (product.reasons[reason] ?? 0) + 1;
    if (row.qualityFlag === true) product.qualityCases += 1;
    const parsed = z.object({ evidence: z.array(z.object({ quote: z.string() })) }).safeParse(row.diagnosis);
    if (parsed.success) for (const evidence of parsed.data.evidence.slice(0, 2)) product.evidence.push({ text: evidence.quote, sessionId: row.sessionId });
    skus.set(productId, product);
  }
  return { synthetic: true, dataSource: "Actual records from isolated local demo runs", metrics: {
    returnSessions: sessionMap().size, completedSessions: completed, completedVoiceSessions: insights.filter((r) => r.sourceMode === "assemblyai").length,
    refunds: refunds.length, exchanges: exchanges.length, escalations: escalations.length,
    refundRate: completed ? refunds.length / completed : null, exchangeRate: completed ? exchanges.length / completed : null,
    revenueRetainedInr: insights.reduce((sum, r) => sum + (typeof r.retainedRevenueInr === "number" ? r.retainedRevenueInr : 0), 0),
    secondReturnRate: outcomes.length ? outcomes.filter((r) => r.outcome === "returned").length / outcomes.length : null,
    insightCoverage: completed ? insights.filter((r) => r.primaryReason !== "other.unclear").length / completed : null,
  }, products: [...skus.values()], insights, qualityCases: listRecords("quality_case"), escalations: listRecords("escalation"), outcomes,
    sessions: [...sessionMap().values()].map(snapshot), limitations: ["Demo-run metrics are not measured business impact", "No cohort or causal claims without outcome data", "Inventory is a labeled synthetic snapshot, pooled by size across colors"] };
}

export async function executeVoiceTool(id: string, call: { callId: string; name: string; arguments: unknown }): Promise<{ result: unknown; snapshot: SessionSnapshot }> {
  const session = getSession(id);
  if (session.toolResults.has(call.callId)) return { result: session.toolResults.get(call.callId), snapshot: snapshot(session) };
  const started = performance.now();
  let result: unknown; const item = active(session);
  switch (call.name) {
    case "get_discount_policy": result = discountDecision(); break;
    case "get_customer": result = { customer: session.customer, preferences: brain(session), synthetic: true }; break;
    case "get_order": result = { order: session.order, items: snapshot(session).items }; break;
    case "get_product": {
      const args = z.object({ productId: z.string() }).parse(call.arguments); result = getProduct(args.productId) ?? { found: false, message: "Unknown product. Do not invent attributes." }; break;
    }
    case "check_return_eligibility": result = { ...item.eligibility, conditionStatus: item.condition, policy: POLICY }; break;
    case "diagnose_return": {
      if (session.mode === "assemblyai") {
        const args = structuredDiagnosisSchema.parse(call.arguments); updateUnderstanding(session, args.text, args);
      } else {
        const args = z.object({ text: z.string().min(1).max(4000) }).parse(call.arguments); updateUnderstanding(session, args.text);
      }
      result = { diagnosis: active(session).diagnosis, customerBrain: brain(session), eligibility: active(session).eligibility }; break;
    }
    case "search_products": result = { candidates: item.candidates, excluded: item.excluded, recommendationAllowed: item.candidates.length > 0, gateReason: item.recommendationGate, sensitiveExplorationConsent: item.sensitiveExplorationConsent, safetyNote: item.diagnosis?.labels.includes("sensitive_skin_reaction") ? "Material suitability and skin comfort are unknown; alternatives are shown only with explicit consent, without any safety guarantee." : null, cohortDataAvailable: false }; break;
    case "compare_products": {
      const args = z.object({ productIds: z.array(z.string()).min(2).max(4) }).parse(call.arguments);
      result = { comparison: args.productIds.map((pid) => getProduct(pid) ?? { productId: pid, found: false }), note: "Missing attributes are unknown. Do not infer exact garment measurements." }; break;
    }
    case "check_inventory": {
      const args = z.object({ productId: z.string(), size: z.string(), color: z.string() }).parse(call.arguments);
      const product = getProduct(args.productId); if (!product) throw new DomainError("unknown_product", "Unknown catalog product.");
      verifyStock(product, args.size, args.color); result = { available: true, units: product.stock[args.size], synthetic: true, note: "Stock is pooled by size across colors." }; break;
    }
    case "request_resolution": {
      const args = proposalSchema.parse(call.arguments); const next = proposeResolution(id, args);
      result = { requiresHumanConfirmation: true, pendingAction: next.pendingAction, message: "The action is prepared, not executed. Ask the customer to review and confirm the on-screen exact terms. Do not claim completion." }; break;
    }
    case "select_item": {
      const args = z.object({ itemId: z.string() }).parse(call.arguments); const next = selectItem(id, args.itemId); result = { item: next.item, product: next.sourceProduct, eligibility: next.eligibility }; break;
    }
    default: throw new DomainError("unknown_tool", "This tool is not available in the demo.");
  }
  session.toolResults.set(call.callId, result); tool(session, call.name, "Executed an actual local tool for the voice session", call.arguments, result, started, false, "model", call.callId);
  return { result, snapshot: snapshot(session) };
}

const diagnosisStateSchema = z.object({ primaryReason: z.string(), secondaryReasons: z.array(z.string()), labels: z.array(z.enum(["fit_too_small", "fit_too_large", "fit_other", "material_too_heavy", "material_too_thin", "material_uncomfortable", "appearance_mismatch", "quality_defect", "wrong_item", "changed_mind", "sensitive_skin_reaction", "other"])), confidence: z.number(), evidence: z.array(z.object({ label: z.string(), quote: z.string() })), likedAttributes: z.array(z.string()), recommendationAllowed: z.boolean(), gateReason: z.string().nullable(), requiresClarification: z.boolean(), clarifyingQuestion: z.string().nullable(), refundOnly: z.boolean(), frustrated: z.boolean() });
const pendingStateSchema = z.object({ proposalId: z.string(), action: proposalSchema.shape.action, summary: z.string(), orderId: z.string(), itemId: z.string(), sourceProductId: z.string(), sourceProductName: z.string(), productId: z.string().nullable(), productName: z.string().nullable(), size: z.string().nullable(), color: z.string().nullable(), refundAmountInr: z.number(), priceDeltaInr: z.number(), simulated: z.literal(true), conditionConfirmationRequired: z.boolean() });
const savedSessionSchema = z.object({ id: z.string().uuid(), createdAt: z.string(), mode: z.enum(["local-guided-demo", "assemblyai"]), customerId: z.string(), orderId: z.string(), activeItemId: z.string(), phase: z.string(), preferences: z.array(signalSchema), messages: z.array(z.object({ id: z.string(), role: z.enum(["user", "assistant"]), text: z.string(), at: z.string(), source: z.enum(["local-guided-demo", "assemblyai"]), interrupted: z.boolean().optional(), itemId: z.string().optional() })), tools: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(["completed", "blocked"]), detail: z.string(), at: z.string(), durationMs: z.number().nullable(), origin: z.enum(["startup", "internal", "model"]).default("internal"), callId: z.string().optional(), input: z.unknown().optional(), output: z.unknown().optional() })), work: z.array(z.object({ itemId: z.string(), diagnosis: diagnosisStateSchema.nullable(), pendingAction: pendingStateSchema.nullable(), resolution: z.unknown().nullable(), condition: z.enum(["unknown", "confirmed", "not_met"]), sensitiveExplorationConsent: z.boolean().default(false) })), completedProposals: z.array(z.object({ proposalId: z.string(), record: z.unknown() })), toolResults: z.array(z.object({ callId: z.string(), result: z.unknown() })), transcriptIds: z.array(z.string()) });

export function serializeSession(id: string) {
  const session = getSession(id);
  return { id: session.id, createdAt: session.createdAt, mode: session.mode, customerId: session.customer.customerId, orderId: session.order.orderId, activeItemId: session.activeItemId,
    phase: session.phase, preferences: session.preferences, messages: session.messages, tools: session.tools,
    work: [...session.work.values()].map((w) => ({ itemId: w.item.itemId, diagnosis: w.diagnosis, pendingAction: w.pendingAction, resolution: w.resolution, condition: w.condition, sensitiveExplorationConsent: w.sensitiveExplorationConsent })),
    completedProposals: [...session.completedProposalIds].map(([proposalId, record]) => ({ proposalId, record })),
    toolResults: [...session.toolResults].map(([callId, result]) => ({ callId, result })), transcriptIds: [...session.transcriptIds] };
}
export function hydrateSession(value: unknown): string {
  const saved = savedSessionSchema.parse(value);
  const customer = findCustomerById(saved.customerId); const order = customer?.orders.find((o) => o.orderId === saved.orderId);
  if (!customer || !order || !order.items.some((i) => i.itemId === saved.activeItemId)) throw new DomainError("invalid_stored_session", "Stored session references unknown fixture data.", 500);
  const session: Session = { id: saved.id, createdAt: saved.createdAt, mode: saved.mode, customer, order, activeItemId: saved.activeItemId,
    phase: saved.phase, preferences: saved.preferences, messages: saved.messages, tools: saved.tools, work: new Map(),
    completedProposalIds: new Map(saved.completedProposals.map((p) => [p.proposalId, parseStoredRecord(p.record)])),
    toolResults: new Map(saved.toolResults.map((p) => [p.callId, p.result])), transcriptIds: new Set(saved.transcriptIds) };
  for (const state of saved.work) {
    const item = order.items.find((i) => i.itemId === state.itemId); const product = item ? getProduct(item.productId) : undefined;
    if (!item || !product) throw new DomainError("invalid_stored_item", "Stored item is outside the selected order.", 500);
    const eligibility = checkEligibility({ customer, order, item, product, reasonLabel: state.diagnosis?.labels.find((l) => l === "quality_defect" || l === "wrong_item") ?? state.diagnosis?.labels[0] });
    const recommendation = state.diagnosis && eligibility.eligible && eligibility.allowedActions.includes("exchange_different_product") ? recommendForCustomer({ source: product, catalog: product.catalogSource ? PUBLIC_CATALOG : CATALOG, diagnosis: state.diagnosis, brain: brain(session), size: item.size, allowSensitiveExploration: state.sensitiveExplorationConsent }) : { candidates: [], excluded: [], gateReason: null };
    session.work.set(item.itemId, { item, product, diagnosis: state.diagnosis, eligibility, candidates: recommendation.candidates, excluded: recommendation.excluded,
      recommendationGate: recommendation.gateReason, pendingAction: state.pendingAction, resolution: state.resolution === null ? null : parseStoredRecord(state.resolution), condition: state.condition, sensitiveExplorationConsent: state.sensitiveExplorationConsent });
  }
  if (session.work.size !== order.items.length) throw new DomainError("incomplete_stored_session", "Stored session is missing item state.", 500);
  sessionMap().set(session.id, session); return session.id;
}
export function currentSessionIds(): string[] { return [...sessionMap().keys()]; }

export function discountDecision() { return { allowed: POLICY.rules.discretionaryDiscountsAllowed, escalate: false, policyId: POLICY.policyId, policyVersion: POLICY.version, message: "Under the canonical demo policy, I cannot offer a discretionary discount or coupon. We can continue with the listed price or an eligible return or exchange." }; }
