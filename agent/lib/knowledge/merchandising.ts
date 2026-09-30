/** Sourced collection membership only; never executable inventory or cohort evidence. */
export const MERCHANDISING_COLLECTION = {
  name: "Trending Fandoms", sourceUrl: "https://www.thesouledstore.com/trending-fandoms",
  collectionObservedAt: "2026-09-30T07:37:30Z", membershipObservedAt: "2026-09-30T07:40:30Z",
  evidenceSource: "user-authorized official-page observation supplied to this task",
  permittedClaim: "Listed in the brand’s Trending Fandoms collection",
  cohortDataAvailable: false, salesRank: null,
  items: [
    { ref: "collection-swat-kats-dark-kat", name: "Swat Kats: Dark Kat", url: "https://www.thesouledstore.com/product/swat-kats-dark-kat-men-oversized-t-shirts?get=1" },
    { ref: "collection-shinchan-scenery", name: "Shinchan: Scenery", url: "https://www.thesouledstore.com/product/shin-chan-scenery-men-oversized-t-shirts?get=1" },
    { ref: "collection-wolverine-steel-claw", name: "Wolverine: Steel Claw", url: "https://www.thesouledstore.com/product/wolverine-steel-claw-oversized-t-shirts?get=1" },
    { ref: "collection-endgame-spider-man", name: "Endgame: Spider-Man", url: "https://www.thesouledstore.com/product/spider-man-aunt-may-men-classic-fit-t-shirts?get=1" },
  ].map(item => ({ ...item, material: "100% cotton", priceInr: null, gsm: null, stock: null,
    salesRank: null, cohortSuccess: null, executableExchangeCandidate: false })),
} as const;
