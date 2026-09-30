import { defineTool } from "eve/tools";
import { z } from "zod";
import { CATALOG, normalizeId } from "../lib/knowledge/catalog.ts";
import { findAlternates } from "../lib/engine/recommend.ts";
import { getProduct } from "../lib/knowledge/catalog.ts";
import { diagnosisLabelSchema } from "../lib/engine/diagnosis.ts";

export default defineTool({
  description:
    "Search the catalog for genuine alternates to a product. When fixing a diagnosed problem, pass sourceProductId + reasonLabel + size so results are ranked on attributes that solve it and guaranteed in stock. Without a source product it filters the catalog by the given attributes.",
  inputSchema: z.object({
    sourceProductId: z
      .string()
      .optional()
      .describe("Product being returned; enables ranked alternates"),
    reasonLabel: diagnosisLabelSchema
      .optional()
      .describe("Diagnosed reason the source product failed"),
    size: z
      .string()
      .optional()
      .describe("Size the customer needs; required for stock-grounded alternates"),
    category: z.string().optional(),
    fit: z.enum(["oversized", "relaxed", "regular", "slim"]).optional(),
    material: z.string().optional().describe("Material substring, e.g. cotton"),
    maxPriceInr: z.number().optional(),
    theme: z.string().optional(),
    color: z.string().optional(),
    excludeProductIds: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(10).default(3),
  }),
  execute(input) {
    const exclude = (input.excludeProductIds ?? []).map(normalizeId);

    if (input.sourceProductId && input.reasonLabel) {
      const source = getProduct(normalizeId(input.sourceProductId));
      if (!source) {
        return { found: false as const, message: `No product ${input.sourceProductId}.` };
      }
      const candidates = findAlternates({
        source,
        catalog: CATALOG,
        reasonLabel: input.reasonLabel,
        size: input.size ?? undefined,
        excludeIds: exclude,
        limit: input.limit,
      });
      return {
        found: true as const,
        mode: "alternates" as const,
        candidates: candidates.map((c) => ({
          productId: c.product.id,
          name: c.product.name,
          category: c.product.category,
          fit: c.product.fit,
          material: c.product.material,
          gsm: c.product.gsm ?? null,
          priceInr: c.product.priceInr,
          colors: c.product.colors,
          why: c.why,
        })),
      };
    }

    const matches = CATALOG.filter((p) => {
      if (!p.returnable) return false;
      if (exclude.includes(p.id)) return false;
      if (input.category && p.category !== input.category) return false;
      if (input.fit && p.fit !== input.fit) return false;
      if (input.material && !p.material.toLowerCase().includes(input.material.toLowerCase()))
        return false;
      if (input.maxPriceInr && p.priceInr > input.maxPriceInr) return false;
      if (input.theme && !p.theme.toLowerCase().includes(input.theme.toLowerCase()))
        return false;
      if (
        input.color &&
        !p.colors.some((c) => c.toLowerCase().includes(input.color!.toLowerCase()))
      )
        return false;
      if (input.size && (!p.sizes.includes(input.size) || (p.stock[input.size] ?? 0) <= 0))
        return false;
      return true;
    }).slice(0, input.limit);

    return {
      found: true as const,
      mode: "filter" as const,
      candidates: matches.map((p) => ({
        productId: p.id,
        name: p.name,
        category: p.category,
        fit: p.fit,
        material: p.material,
        gsm: p.gsm ?? null,
        priceInr: p.priceInr,
        colors: p.colors,
        stockForSize: input.size ? (p.stock[input.size] ?? 0) : null,
      })),
    };
  },
});
