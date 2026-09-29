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
