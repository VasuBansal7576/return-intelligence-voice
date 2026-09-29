import type { Product } from "../knowledge/types.ts";
import type { DiagnosisLabel } from "./diagnosis.ts";

/**
 * Deterministic alternate-product ranking. Every candidate must be real
 * (from the catalog), in stock in the wanted size, and score on attributes
 * that either fix the diagnosed failure or preserve what the customer liked.
 * The `why` strings are the explanation the model reads aloud.
 */

const FIT_RANK: Record<Product["fit"], number> = {
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
