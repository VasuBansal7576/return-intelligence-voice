import type { Product } from "../knowledge/types.ts";
import type { DiagnosisLabel } from "./diagnosis.ts";

/**
 * Deterministic alternate-product ranking. Every candidate must be real
 * (from the catalog), in stock in the wanted size, and score on attributes
 * that either fix the diagnosed failure or preserve what the customer liked.
 * The `why` strings are the explanation the model reads aloud.
 */

const FIT_RANK: Record<Product["fit"], number> = {
  unknown: -1,
  slim: 0,
  regular: 1,
  relaxed: 2,
  oversized: 3,
};

const ADJACENT: Record<string, string[]> = {
  "oversized-tshirt": ["tshirt", "top"],
  tshirt: ["oversized-tshirt", "polo", "top"],
  polo: ["tshirt", "shirt"],
  shirt: ["polo", "tshirt"],
  hoodie: ["sweatshirt"],
  sweatshirt: ["hoodie"],
  joggers: ["shorts"],
  shorts: ["joggers"],
  dress: ["top"],
  top: ["tshirt", "dress", "oversized-tshirt"],
  accessory: [],
};

export interface AlternateCandidate {
  product: Product;
  score: number;
  why: string[];
}

export function findAlternates(input: {
  source: Product;
  catalog: Product[];
  reasonLabel: DiagnosisLabel;
  /** Size the customer wants; candidates must have stock in it. */
  size?: string;
  excludeIds?: string[];
  limit?: number;
}): AlternateCandidate[] {
  const { source, catalog, reasonLabel, size, excludeIds = [], limit = 3 } = input;
  const excluded = new Set([source.id, ...excludeIds]);
  const fitProblem = reasonLabel.startsWith("fit_");
  const materialProblem = reasonLabel.startsWith("material_") || reasonLabel === "sensitive_skin_reaction";

  const scored: AlternateCandidate[] = [];
  for (const product of catalog) {
    if (excluded.has(product.id) || !product.returnable) continue;
    if (size !== undefined && (product.stock[size] ?? 0) <= 0) continue;

    let score = 0;
    const why: string[] = [];

    if (product.category === source.category) {
      score += 3;
      why.push(`same category (${product.category.replace(/-/g, " ")})`);
    } else if ((ADJACENT[source.category] ?? []).includes(product.category)) {
      score += 1;
      why.push(`adjacent category (${product.category.replace(/-/g, " ")})`);
    } else {
      continue; // unrelated categories are never genuine alternates
    }

    switch (reasonLabel) {
      case "fit_too_small":
        if (FIT_RANK[product.fit] > FIT_RANK[source.fit]) {
          score += 4;
          why.push(`roomier ${product.fit} fit`);
        }
        break;
      case "fit_too_large":
        if (FIT_RANK[product.fit] < FIT_RANK[source.fit]) {
          score += 4;
          why.push(`closer ${product.fit} fit`);
        }
        break;
      case "material_too_heavy":
        if (product.gsm !== undefined && source.gsm !== undefined && product.gsm < source.gsm) {
          score += 4;
          why.push(`lighter ${product.gsm} GSM fabric`);
        }
        if (product.tags.includes("lightweight") || product.tags.includes("breathable")) {
          score += 2;
          why.push("listed as lightweight/breathable");
        }
        break;
      case "material_too_thin":
        if (product.gsm !== undefined && source.gsm !== undefined && product.gsm > source.gsm) {
          score += 4;
          why.push(`heavier ${product.gsm} GSM fabric`);
        }
        break;
      case "material_uncomfortable":
      case "sensitive_skin_reaction":
        if (materialFamily(product) !== materialFamily(source)) {
          score += 3;
          why.push(`different fabric (${product.material})`);
        }
        if (product.tags.includes("soft-handfeel") || product.tags.includes("breathable")) {
          score += 1;
          why.push("soft/breathable handfeel");
        }
        break;
      case "appearance_mismatch":
      case "changed_mind":
        if (product.theme !== source.theme) {
          score += 1;
          why.push(`different look (${product.theme})`);
        }
        break;
      case "quality_defect":
        score += 2;
        why.push("same category, different product line");
        break;
      default:
        break;
    }

    // Preserve what the customer presumably liked when it isn't the complaint.
    if (!fitProblem && product.fit === source.fit) {
      score += 1;
      why.push(`keeps the ${source.fit} fit`);
    }
    if (!materialProblem && materialFamily(product) === materialFamily(source)) {
      score += 1;
      why.push(`same ${source.material} fabric`);
    }
    if (reasonLabel !== "appearance_mismatch" && product.theme === source.theme && source.theme !== "solid") {
      score += 1;
      why.push(`same ${source.theme} theme`);
    }
    if (Math.abs(product.priceInr - source.priceInr) <= source.priceInr * 0.3) {
      score += 1;
      why.push(`similar price (₹${product.priceInr})`);
    }
    if (size !== undefined) {
      why.push(`${product.stock[size]} in stock in ${size}`);
    }

    if (score > 0) scored.push({ product, score, why });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.product.priceInr - b.product.priceInr ||
      a.product.id.localeCompare(b.product.id),
  );
  return scored.slice(0, limit);
}

function materialFamily(product: Product): string {
  const m = product.material.toLowerCase();
  if (m.includes("linen")) return "linen-blend";
  if (m.includes("modal")) return "modal-blend";
  if (m.includes("fleece")) return "fleece";
  if (m.includes("french terry")) return "french-terry";
  if (m.includes("viscose") || m.includes("rayon")) return "viscose";
  if (m.includes("pique")) return "pique";
  if (m.includes("elastane") || m.includes("stretch")) return "stretch-blend";
  if (m.includes("poly")) return "poly-blend";
  if (m.includes("flannel")) return "flannel";
  if (m.includes("twill")) return "twill";
  if (m.includes("cotton")) return "cotton";
  return m;
}

import type { CustomerBrain, PreferenceSignal } from "./customer-brain.ts";
import type { ReturnDiagnosis } from "./diagnosis.ts";

export interface PersonalizedCandidate extends AlternateCandidate {
  productId: string;
  name: string;
  priceInr: number;
  fit: Product["fit"];
  material: string;
  gsm: number | null;
  colors: string[];
  sizes: string[];
  stock: Record<string, number>;
  scoreBreakdown: { problem: number; explicit: number; history: number; price: number };
  confidence: number;
  recommendedSize: string;
  tradeoffs: string[];
}
export interface RecommendationResult {
  candidates: PersonalizedCandidate[];
  excluded: Array<{ productId: string; name: string; reason: string }>;
  recommendationAllowed: boolean;
  gateReason: string | null;
  cohortStatus: "insufficient_outcome_data";
}

export function recommendForCustomer(input: {
  source: Product; catalog: Product[]; diagnosis: ReturnDiagnosis;
  brain: CustomerBrain; size: string; limit?: number; allowSensitiveExploration?: boolean;
}): RecommendationResult {
  const { source, catalog, diagnosis, brain, size, limit = 3 } = input;
  const result: RecommendationResult = { candidates: [], excluded: [], recommendationAllowed: false,
    gateReason: diagnosis.gateReason, cohortStatus: "insufficient_outcome_data" };
  const sensitiveExploration = diagnosis.labels.includes("sensitive_skin_reaction") && input.allowSensitiveExploration === true;
  const hardGate = diagnosis.refundOnly || diagnosis.frustrated || diagnosis.labels.some((label) => label === "quality_defect" || label === "wrong_item");
  if (hardGate || (!diagnosis.recommendationAllowed && !sensitiveExploration)) return result;
  const relevant = catalog.filter((p) => p.id !== source.id && p.returnable
    && (p.category === source.category || (ADJACENT[source.category] ?? []).includes(p.category)));
  for (const product of relevant) {
    const reject = (reason: string) => result.excluded.push({ productId: product.id, name: product.name, reason });
    let candidateSize = size;
    let measuredFitImprovement = false;
    const tradeoffs: string[] = [];
    const sourceMeasurements = source.garmentMeasurements?.[size];
    if (sourceMeasurements?.chestIn !== undefined && product.garmentMeasurements && diagnosis.labels.some((l) => l === "fit_too_small" || l === "fit_too_large")) {
      const sourceChest = sourceMeasurements.chestIn;
      const tighter = diagnosis.labels.includes("fit_too_large");
      const variants = Object.entries(product.garmentMeasurements).filter(([variant, measures]) =>
        (product.stock[variant] ?? 0) > 0 && measures.chestIn !== undefined
        && (tighter ? measures.chestIn < sourceChest : measures.chestIn > sourceChest)
        && (!diagnosis.likedAttributes.includes("length") || (measures.lengthIn !== undefined && sourceMeasurements.lengthIn !== undefined && Math.abs(measures.lengthIn - sourceMeasurements.lengthIn) <= 0.5)))
        .sort((a,b) => Math.abs((a[1].chestIn ?? sourceChest) - sourceChest) - Math.abs((b[1].chestIn ?? sourceChest) - sourceChest));
      const variant = variants[0];
      if (variant) {
        candidateSize = variant[0]; measuredFitImprovement = true;
        tradeoffs.push(`Size ${candidateSize}: published garment chest ${variant[1].chestIn} in versus ${sourceChest} in on the returned size ${size}`);
        if (variant[1].shoulderIn !== undefined && sourceMeasurements.shoulderIn !== undefined) tradeoffs.push(`Published shoulder ${variant[1].shoulderIn} in versus ${sourceMeasurements.shoulderIn} in`);
        if (variant[1].lengthIn !== undefined && sourceMeasurements.lengthIn !== undefined && variant[1].lengthIn !== sourceMeasurements.lengthIn) tradeoffs.push(`Length changes from ${sourceMeasurements.lengthIn} in to ${variant[1].lengthIn} in; confirm that trade-off`);
      }
    }
    if ((product.stock[candidateSize] ?? 0) <= 0) { reject(`Unavailable in ${candidateSize}`); continue; }
    const conflicts = diagnosis.labels.flatMap((label) => {
      if (label === "fit_too_small" && !measuredFitImprovement && (product.fit === "unknown" || source.fit === "unknown" || FIT_RANK[product.fit] <= FIT_RANK[source.fit])) return ["No verified roomier cut or larger garment dimensions"];
      if (label === "fit_too_large" && !measuredFitImprovement && (product.fit === "unknown" || source.fit === "unknown" || FIT_RANK[product.fit] >= FIT_RANK[source.fit])) return ["No verified closer cut or smaller garment dimensions"];
      if (label === "material_too_heavy" && (product.gsm === undefined || source.gsm === undefined || product.gsm >= source.gsm)) return ["Does not have verified lighter fabric"];
      if (label === "material_too_thin" && (product.gsm === undefined || source.gsm === undefined || product.gsm <= source.gsm)) return ["Does not have verified heavier fabric"];
      if ((label === "material_uncomfortable" || label === "sensitive_skin_reaction") && materialFamily(product) === materialFamily(source)) return ["Repeats the reported material family"];
      return [];
    });
    if (conflicts.length) { reject(conflicts.join("; ")); continue; }
    if (diagnosis.likedAttributes.includes("fit") && product.fit !== source.fit) { reject("Changes the fit the customer explicitly liked"); continue; }
    if (diagnosis.likedAttributes.includes("theme") && source.theme !== "solid" && product.theme !== source.theme) { reject("Changes the theme the customer explicitly liked"); continue; }
    const explicit = brain.explicitPreferences;
    const conflictingExplicit = explicit.find((signal) => signal.strict && (
      signal.attribute === "fit" && ((signal.sentiment === "positive" && product.fit !== signal.value) || (signal.sentiment === "negative" && product.fit === signal.value))
      || signal.attribute === "price" && product.priceInr > Number(signal.value)
      || signal.attribute === "color" && signal.sentiment === "positive" && !product.colors.some((c) => matchesColor(c, signal.value))
      || signal.attribute === "color" && signal.sentiment === "negative" && product.colors.every((c) => matchesColor(c, signal.value))));
    if (conflictingExplicit) { reject(`Conflicts with explicit ${conflictingExplicit.attribute} preference: ${conflictingExplicit.value}`); continue; }
    const why: string[] = [...tradeoffs];
    let problem = measuredFitImprovement ? 6 : 0;
    for (const label of diagnosis.labels) {
      const match = findAlternates({ source, catalog: [product], reasonLabel: label, size: candidateSize, limit: 1 })[0];
      if (match) { problem += match.score; why.push(...match.why); }
    }
    let explicitScore = 0; let historical = 0;
    for (const preference of brain.preferences) {
      if (!matchesPreference(product, preference)) continue;
      const direction = preference.sentiment === "positive" ? 1 : -1;
      // Explicit preferences take precedence. Historical preference for this
      // attribute is ignored when any newer explicit statement exists.
      if (preference.source === "behavioral_inference" && explicit.some((e) => e.attribute === preference.attribute)) continue;
      if (preference.source === "explicit_statement") explicitScore += 8 * direction;
      else historical += Math.round(4 * preference.confidence) * direction;
      why.push(`${preference.source === "explicit_statement" ? "Stated" : "Tentative historical"} ${preference.sentiment === "positive" ? "match" : "penalty"}: ${preference.attribute} ${preference.value}`);
    }
    const delta = Math.abs(product.priceInr - source.priceInr);
    const price = Math.max(0, 3 - delta / Math.max(source.priceInr, 1) * 3);
    const score = problem + explicitScore + historical + price;
    result.candidates.push({ product, productId: product.id, name: product.name, priceInr: product.priceInr,
      fit: product.fit, material: product.material, gsm: product.gsm ?? null, colors: product.colors, sizes: product.sizes,
      stock: product.stock, score, why: [...new Set(why)], scoreBreakdown: { problem, explicit: explicitScore, history: historical, price },
      confidence: diagnosis.confidence * (brain.coldStart ? 0.85 : 0.95), recommendedSize: candidateSize, tradeoffs });
  }
  result.candidates.sort((a,b) => b.score - a.score || a.priceInr - b.priceInr || a.productId.localeCompare(b.productId));
  result.candidates = result.candidates.slice(0,limit);
  result.recommendationAllowed = result.candidates.length > 0;
  result.gateReason = result.candidates.length ? null : "No in-stock candidate satisfies the known constraints. A refund or support path is appropriate.";
  return result;
}

function matchesColor(color: string, wanted: string): boolean {
  if (wanted === "dark") return /black|navy|charcoal|olive/i.test(color);
  if (wanted === "bright") return /red|yellow|pink|orange/i.test(color);
  return color.toLowerCase().includes(wanted.toLowerCase());
}
function matchesPreference(product: Product, signal: PreferenceSignal): boolean {
  switch (signal.attribute) {
    case "fit": return product.fit === signal.value;
    case "color": return product.colors.some((c) => matchesColor(c, signal.value));
    case "material": return product.material.toLowerCase().includes(signal.value.toLowerCase());
    case "fabric_weight": return signal.value === "heavy" ? (product.gsm ?? 0) >= 240 : (product.gsm ?? 999) <= 160;
    case "theme": return product.theme.toLowerCase() === signal.value.toLowerCase();
    case "price": return product.priceInr <= Number(signal.value);
    default: { const exhaustive: never = signal.attribute; return exhaustive; }
  }
}
