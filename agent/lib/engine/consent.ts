/** Explicit refusal wins over an exploration phrase, including negated requests. */
export function revokesMaterialExploration(text: string): boolean {
  return /\b(stop|do not|don't|dont|no more|never)\b.{0,60}\b(alternatives?|materials?|recommendations?)\b/i.test(text);
}
