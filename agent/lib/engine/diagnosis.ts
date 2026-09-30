import { z } from "zod";

/**
 * Flat return-reason taxonomy the model must pick from. The model labels the
 * customer's free-form complaint with one of these enums; the engine, never
 * the model, decides what the label means downstream.
 */
export const DIAGNOSIS_LABELS = [
  "fit_too_small",
  "fit_too_large",
  "fit_other",
  "material_too_heavy",
  "material_too_thin",
  "material_uncomfortable",
  "appearance_mismatch",
  "quality_defect",
  "wrong_item",
  "changed_mind",
  "sensitive_skin_reaction",
  "other",
] as const;

export type DiagnosisLabel = (typeof DIAGNOSIS_LABELS)[number];

export const diagnosisLabelSchema = z.enum(DIAGNOSIS_LABELS);

export const DIAGNOSIS_DESCRIPTIONS: Record<DiagnosisLabel, string> = {
  fit_too_small: "too tight, too small, or runs small",
  fit_too_large: "too loose, too large, or runs large",
  fit_other: "any other fit problem (length, shoulders, cut)",
  material_too_heavy: "fabric feels too heavy, hot, or thick",
  material_too_thin: "fabric feels too thin, flimsy, or see-through",
  material_uncomfortable: "fabric feels rough, scratchy, or stiff",
  appearance_mismatch: "looks different from photos or expectations",
  quality_defect: "manufacturing defect: torn seam, print flaw, damage",
  wrong_item: "a different item than ordered was delivered",
  changed_mind: "no product fault; the customer changed their mind",
  sensitive_skin_reaction: "itching, rash, or any skin reaction",
  other: "none of the above",
};

export interface ReturnDiagnosis {
  primaryReason: string;
  secondaryReasons: string[];
  labels: DiagnosisLabel[];
  confidence: number;
  evidence: Array<{ label: string; quote: string }>;
  likedAttributes: string[];
  recommendationAllowed: boolean;
  gateReason: string | null;
  requiresClarification: boolean;
  clarifyingQuestion: string | null;
  refundOnly: boolean;
  frustrated: boolean;
}

const reasonPatterns: Array<{ label: DiagnosisLabel; reason: string; pattern: RegExp }> = [
  { label: "sensitive_skin_reaction", reason: "sensitive.skin_reaction", pattern: /\b(rash|allerg\w*|skin.{0,12}(itch|react|irritat)|makes? me itch)\b/i },
  { label: "quality_defect", reason: "quality.stitching_failure", pattern: /\b(seam.{0,20}(open\w*|split|torn|apart)|stitch\w*.{0,20}(apart|open\w*|broke\w*|fail\w*))\b/i },
  { label: "quality_defect", reason: "quality.defect", pattern: /\b(defect\w*|torn|tear|broken|peel\w*|damaged|zipper.{0,12}(stuck|broke))\b/i },
  { label: "wrong_item", reason: "fulfillment.wrong_item", pattern: /\b(wrong (item|product|size|colou?r)|sent.{0,12}instead|different item.{0,12}(received|sent))\b/i },
  { label: "wrong_item", reason: "fulfillment.wrong_item", pattern: /\b(ordered.{0,60}(but )?received|order says.{0,30}label.{0,30}(is|says))\b/i },
  { label: "fit_too_small", reason: "fit.shoulders_tight", pattern: /\b(shoulders?.{0,16}(tight|restrict)|tight.{0,16}shoulders?)\b/i },
  { label: "fit_too_small", reason: "fit.chest_tight", pattern: /\b(chest.{0,12}tight|tight.{0,12}chest)\b/i },
  { label: "fit_too_small", reason: "fit.too_small", pattern: /\b(too (tight|small)|tighter|restrictive|runs? small|chest.{0,12}tight)\b/i },
  { label: "fit_too_large", reason: "fit.too_large", pattern: /\b(too (large|big|loose)|waist.{0,12}loose|baggy|runs? large)\b/i },
  { label: "fit_too_large", reason: "fit.oversized_beyond_expectation", pattern: /\b(more oversized.{0,35}(photos?|expect\w*)|oversized beyond)\b/i },
  { label: "fit_other", reason: "fit.sleeve_too_long", pattern: /\bsleeves?.{0,12}too long\b/i },
  { label: "fit_other", reason: "fit.length", pattern: /\b(too (long|short|cropped)|sleeves?.{0,12}(long|short))\b/i },
  { label: "material_too_heavy", reason: "material.too_heavy", pattern: /\b(too (heavy|hot|warm|thick)|heavy|hot|need lighter|not breathable|isn.t breathable|gets? warm|heat discomfort)\b/i },
  { label: "material_too_thin", reason: "material.too_thin", pattern: /\b(too thin|flimsy|see.through|transparent)\b/i },
  { label: "material_uncomfortable", reason: "material.scratchy", pattern: /\bscratchy\b/i },
  { label: "material_uncomfortable", reason: "comfort.uncomfortable_seams", pattern: /\bseams?.{0,12}(hurt|uncomfortable|irritat)\b/i },
  { label: "material_uncomfortable", reason: "material.texture", pattern: /\b(rough|stiff|uncomfortable|texture.{0,20}(hate|dislike)|hate.{0,30}texture)\b/i },
  { label: "appearance_mismatch", reason: "appearance.expectation_mismatch", pattern: /\b(looks? different|colou?r.{0,15}(wrong|different|mismatch)|design.{0,15}(dislike|hate)|hate.{0,15}(design|print)|different.{0,12}(photo|image))\b/i },
  { label: "changed_mind", reason: "preference.changed_mind", pattern: /\b(changed my mind|unwanted gift|don.t need|do not need|already (have|own))\b/i },
];

export function assertionClauses(text: string): Array<{ text: string; assertion: "reported" | "negated" | "uncertain" }> {
  return text.split(/(?<!\d)[.;!?](?!\d)|\n|,\s+|\b(?:but|however|yet|and)\b/i).map((part) => part.trim()).filter(Boolean).map((part) => {
    // Disliking an attribute asserts dissatisfaction. Negating the existence
    // of an issue does not. Keep these distinct before classifying symptoms.
    const claim = part.replace(/\b(?:do not|don['’]?t|did not|didn['’]?t|no longer)\s+like\b/gi, "dislike").replace(/\bnot only\b/gi, "");
    const uncertain = /\b(if|suppose|imagine|hypothetical|perhaps|maybe|not sure)\b|\bI\s+(?:think|wonder)\b|\b(?:it|this|that|fabric|stitching|seam|product)\s+(?:could|might|may|would|seems)\b|\b(?:seams|products)\s+seem\b/i.test(claim);
    // Negating a remedy ("no alternative solves the problem") still affirms
    // dissatisfaction. Negating an event ("nothing is broken") does not.
    const remedyNegated = /\b(?:nothing|none|no (?:option|alternative|product))\b.{0,25}\b(?:fix|solve|help|work|address)\w*\b/i.test(claim);
    const negated = !remedyNegated && /\b(no|not|never|nothing|neither|nor|without|deny|denied|denies|undamaged|intact)\b|\b(?:isn|wasn|aren|weren|hasn|haven|hadn|doesn|don|didn|wouldn|couldn)['’]?t\b/i.test(claim.replace(/\bnot sure\b/gi, "uncertain"));
    return { text: part, assertion: negated ? "negated" as const : uncertain ? "uncertain" as const : "reported" as const };
  });
}

export function isReportedEvidence(quote: string, utterances: string[]): boolean {
  const normalized = quote.trim().replace(/[.;!?]+$/, "").toLowerCase();
  return utterances.some((utterance) => assertionClauses(utterance).some((clause) => clause.assertion === "reported" && clause.text.toLowerCase().includes(normalized)));
}

/** Local text mode is deterministic; live speech uses the same grounded state. */
export function diagnoseReturn(text: string): ReturnDiagnosis {
  const clauses = assertionClauses(text);
  const affirmativeText = clauses.filter((clause) => clause.assertion === "reported").map((clause) => clause.text).join(". ");
  const fraudulent = /\b(just|pretend|falsely|mark it as|say it.{0,8})\b.{0,45}\b(damaged|defect|broken)\b/i.test(text)
    && /\b(refund|pretend|falsely|mark it as)\b/i.test(text);
  const found = fraudulent ? [] : reasonPatterns.filter(({pattern}) => pattern.test(affirmativeText));
  // A suspected skin reaction is enough to stop selling. This records the
  // customer's concern, not a medical diagnosis or a confirmed cause.
  for (const pattern of reasonPatterns.filter((r) => r.label === "sensitive_skin_reaction")) {
    if (!found.includes(pattern) && clauses.some((c) => c.assertion !== "negated" && pattern.pattern.test(c.text))) found.push(pattern);
  }
  const labels = [...new Set(found.map((item) => item.label))];
  const reasons = [...new Set(found.map((item) => item.reason))];
  const refundOnly = /\b(just.{0,12}refund|only.{0,12}refund|want (a |my )?refund|refund instead|don.t want (anything|alternatives|recommendations)|do not want (anything|alternatives|any recommendations)|no (alternatives|recommendations)|stop (selling|recommending|suggesting)|no thanks)\b/i.test(text);
  const frustrated = /\b(furious|angry|ridiculous|fed up|wasting my time|terrible service)\b/i.test(text);
  const likedAttributes: string[] = [];
  if (!/\b(did not|do not|don.t|didn.t|never)\b.{0,10}\blike\b.{0,15}\bfit\b/i.test(text)
    && /\b(fit.{0,14}(fine|great|perfect|good)|love.{0,20}fit|like.{0,20}fit|keep.{0,12}(fit|oversized))\b/i.test(text)) likedAttributes.push("fit");
  if (/\b(love.{0,18}(design|graphic|print)|like.{0,18}(design|graphic|print)|design.{0,12}(great|fine|good))\b/i.test(text)) likedAttributes.push("theme");
  if (/\b(length.{0,12}(perfect|fine|right|good)|right length|like.{0,10}length)\b/i.test(text)) likedAttributes.push("length");
  if (/\b(love.{0,12}colou?r|like.{0,12}colou?r)\b/i.test(text)) likedAttributes.push("color");
  let gateReason: string | null = null;
  if (fraudulent) gateReason = "We cannot invent damage or change the reported facts to bypass policy.";
  else if (refundOnly) gateReason = "Customer requested a refund without recommendations.";
  else if (frustrated) gateReason = "Prioritize a short resolution or human support for a frustrated customer.";
  else if (labels.includes("sensitive_skin_reaction")) gateReason = "Reported skin reaction: offer return/support, without medical claims or unsolicited alternatives.";
  else if (labels.includes("quality_defect")) gateReason = "Quality failure: replacement, refund or quality support; no upsell.";
  else if (labels.includes("wrong_item")) gateReason = "Fulfillment error: correct the order or refund; no alternative-product selling.";
  const vagueFit = labels.length === 0 && /\bfit\b/i.test(text) && !likedAttributes.includes("fit");
  const equalReasons = /\b(both|equally).{0,15}(bad|bother|important)\b/i.test(text) && reasons.length > 1;
  const requiresClarification = !gateReason && (vagueFit || equalReasons || labels.length === 0 || (likedAttributes.includes("length") && labels.includes("fit_too_small")));
  const clarifyingQuestion = requiresClarification
    ? equalReasons ? "Which issue is the main reason you cannot keep it, or should we treat both as equally important?"
      : vagueFit ? "Was it mainly too tight, too loose, too long, or something else?"
      : likedAttributes.includes("length") ? "Would you prefer a roomier cut while keeping a similar length? I do not have garment measurements to promise an exact match."
      : "What specifically did not work for you: the fit, fabric, appearance, or something else?"
    : null;
  const preferredReason = /\b(weight|heavy).{0,20}(why|main|most)\b/i.test(text) ? "material.too_heavy"
    : /\bsleeves?.{0,20}(main|most)\b/i.test(text) ? "fit.sleeve_too_long" : reasons[0];
  const primaryReason = equalReasons ? "other.unclear_primary" : preferredReason ?? "other.unclear";
  return {
    primaryReason,
    secondaryReasons: reasons.filter((reason) => reason !== primaryReason), labels: labels.length ? labels : ["other"],
    confidence: fraudulent || labels.length === 0 ? 0.35 : 0.92,
    evidence: found.map((item) => ({ label: item.reason, quote: text })), likedAttributes,
    recommendationAllowed: gateReason === null && !requiresClarification,
    gateReason, requiresClarification, clarifyingQuestion, refundOnly, frustrated,
  };
}
