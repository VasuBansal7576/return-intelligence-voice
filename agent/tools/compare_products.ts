import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProduct, normalizeId } from "../lib/knowledge/catalog.ts";

export default defineTool({
  description:
    "Compare two to four products side by side on the attributes a customer weighs: fit, material, fabric weight, price, colors, size availability. Use when the customer is deciding between alternates.",
  inputSchema: z.object({
    productIds: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("Product IDs to compare"),
    size: z.string().optional().describe("Size to compare stock for"),
  }),
  execute({ productIds, size }) {
    const products = productIds.map((id) => getProduct(normalizeId(id)));
    const missing = productIds.filter((id, i) => !products[i]);
    if (missing.length > 0) {
      return {
        found: false as const,
        message: `Unknown product IDs: ${missing.join(", ")}.`,
      };
    }
    return {
      found: true as const,
      comparison: products.map((p) => ({
        productId: p!.id,
        name: p!.name,
        category: p!.category,
        fit: p!.fit,
        material: p!.material,
        gsm: p!.gsm ?? null,
        priceInr: p!.priceInr,
        colors: p!.colors,
        theme: p!.theme,
        stockForSize: size ? (p!.stock[size] ?? 0) : null,
      })),
    };
  },
});
