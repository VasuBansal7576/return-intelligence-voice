import { getProduct } from "../knowledge/catalog.ts";
import type { Customer, Product } from "../knowledge/types.ts";
import type { ReturnDiagnosis } from "./diagnosis.ts";

export interface PreferenceSignal {
  attribute: "fit" | "color" | "material" | "fabric_weight" | "theme" | "price";
  value: string;
  sentiment: "positive" | "negative";
  source: "explicit_statement" | "behavioral_inference";
  confidence: number;
  evidence: string[];
  updatedAt: string;
  strict: boolean;
}

export interface CustomerBrain {
  coldStart: boolean;
  explicitPreferences: PreferenceSignal[];
  inferredPreferences: PreferenceSignal[];
  negativePreferences: PreferenceSignal[];
  preferences: PreferenceSignal[];
  sizeProfile: Array<{ category: string; fit: string; size: string; source: string }>;
  priceRange: { min: number; max: number } | null;
  keptProductIds: string[];
  returnedProductIds: string[];
  facts: string[];
}

export function buildCustomerBrain(customer: Customer, explicit: PreferenceSignal[] = []): CustomerBrain {
  const returned = new Set(customer.returns.map((r) => r.productId));
  const kept = customer.orders.filter((o) => o.deliveredDaysAgo !== null && o.deliveredDaysAgo > 30)
    .flatMap((o) => o.items.filter((i) => !returned.has(i.productId)).map((i) => ({ item: i, order: o })));
  const inferred: PreferenceSignal[] = [];
  for (const { item, order } of kept) {
    const product = getProduct(item.productId); if (!product) continue;
    for (const [attribute, value] of [["fit", product.fit], ["color", item.color], ["material", product.material]] as const) {
      inferred.push({ attribute, value, sentiment: "positive", source: "behavioral_inference", confidence: 0.6,
        evidence: [`${product.name} on ${order.orderId} has no recorded return ${order.deliveredDaysAgo} days after delivery; this is tentative evidence, not a stated preference.`],
        updatedAt: "2026-09-29T00:00:00.000Z", strict: false });
    }
  }
  for (const returnedItem of customer.returns) {
    const product = getProduct(returnedItem.productId); if (!product) continue;
    const fitReason = returnedItem.reasonLabel.startsWith("fit_");
    inferred.push({ attribute: fitReason ? "fit" : "material", value: fitReason ? product.fit : product.material,
      sentiment: "negative", source: "behavioral_inference", confidence: 0.7,
      evidence: [`Returned ${product.name}: ${returnedItem.reasonLabel.replaceAll("_", " ")}.`],
      updatedAt: "2026-09-29T00:00:00.000Z", strict: false });
  }
  // The most recent explicit statement for an attribute/value supersedes older statements.
  const current = new Map<string, PreferenceSignal>();
  for (const signal of explicit) {
    if (signal.sentiment === "positive" && (signal.attribute === "fit" || signal.attribute === "price")) {
      for (const [key, previous] of current) if (previous.attribute === signal.attribute && previous.sentiment === "positive") current.delete(key);
    }
    current.set(`${signal.attribute}:${signal.value}`, signal);
  }
  const explicitPreferences = [...current.values()];
  const prices = customer.orders.flatMap((o) => o.items.map((i) => i.priceInr));
  const sizeProfile = new Map<string, CustomerBrain["sizeProfile"][number]>();
  for (const order of customer.orders) for (const item of order.items) {
    const product = getProduct(item.productId); if (!product) continue;
    const key = `${product.category}:${product.fit}:${item.size}`;
    if (!sizeProfile.has(key)) sizeProfile.set(key, { category: product.category, fit: product.fit, size: item.size, source: `Purchased on ${order.orderId}; not a universal size guarantee` });
  }
  const preferences = [...explicitPreferences, ...inferred];
  return { coldStart: kept.length === 0 && customer.returns.length === 0, explicitPreferences,
    inferredPreferences: inferred, negativePreferences: preferences.filter((p) => p.sentiment === "negative"), preferences,
    sizeProfile: [...sizeProfile.values()], priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    keptProductIds: [...new Set(kept.map((i) => i.item.productId))], returnedProductIds: [...returned],
    facts: [`${customer.orders.length} synthetic orders`, `${customer.returns.length} recorded past returns`, "No psychological or health profile is inferred"],
  };
}

export function extractPreferences(text: string, product: Product, diagnosis: ReturnDiagnosis): PreferenceSignal[] {
  const signals: PreferenceSignal[] = [];
  const now = new Date().toISOString();
  function add(attribute: PreferenceSignal["attribute"], value: string, sentiment: PreferenceSignal["sentiment"], strict = false) {
    signals.push({ attribute, value, sentiment, source: "explicit_statement", confidence: 0.98,
      evidence: [text], updatedAt: now, strict });
  }
  for (const fit of ["oversized", "relaxed", "regular", "slim"] as const) {
    if (new RegExp(`(?:prefer|only (?:wear|want)|love|want|like)\\b.{0,25}\\b${fit}\\b`, "i").test(text)) add("fit", fit, "positive", /only/i.test(text));
    if (new RegExp(`(?:don.t|do not|stopped|hate|avoid|dislike|no more)\\b.{0,28}\\b${fit}\\b`, "i").test(text)) add("fit", fit, "negative", true);
  }
  for (const color of ["black", "navy", "dark", "white", "bright", "red", "blue"]) {
    if (new RegExp(`(?:prefer|only|love|want|like)\\b.{0,20}\\b${color}\\b|\\b${color} only\\b`, "i").test(text)) add("color", color, "positive", /only/i.test(text));
    if (new RegExp(`(?:don.t|do not|hate|avoid|dislike)\\b.{0,20}\\b${color}\\b`, "i").test(text)) add("color", color, "negative", true);
  }
  if (diagnosis.likedAttributes.includes("fit") && !signals.some((s) => s.attribute === "fit" && s.sentiment === "positive")) add("fit", product.fit, "positive", true);
  if (diagnosis.likedAttributes.includes("theme")) add("theme", product.theme, "positive", true);
  if (diagnosis.labels.includes("material_too_heavy")) add("fabric_weight", "heavy", "negative", true);
  if (diagnosis.labels.includes("material_too_thin")) add("fabric_weight", "thin", "negative", true);
  const budget = text.match(/(?:under|below|within|at most|no more than|up to)\s*(?:rs\.?|inr|₹)?\s*(\d{3,5})/i);
  if (budget) add("price", budget[1], "positive", true);
  return signals;
}
