import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProduct, normalizeId } from "../lib/knowledge/catalog.ts";

export default defineTool({
  description:
    "Fetch one product's full attributes: category, fit, material, fabric weight, price, colors, sizes. Optionally pass a size and color to check that exact variant's availability.",
  inputSchema: z.object({
    productId: z.string().describe("Product ID, e.g. TSS-OBT-001"),
    size: z.string().optional().describe("Size code to check, e.g. L"),
    color: z.string().optional().describe("Color name to check"),
  }),
  execute({ productId, size, color }) {
    const product = getProduct(normalizeId(productId));
    if (!product) {
      return {
        found: false as const,
        message: `No product ${productId} in the catalog. Never guess attributes — only describe products this tool returns.`,
      };
    }
    let variant: Record<string, unknown> | undefined;
    if (size !== undefined || color !== undefined) {
      const sizeOk = size === undefined || product.sizes.includes(size);
      const colorOk =
        color === undefined ||
        product.colors.some((c) => c.toLowerCase() === color.toLowerCase());
      const units = size !== undefined && sizeOk ? (product.stock[size] ?? 0) : null;
      variant = {
        sizeOffered: sizeOk,
        colorOffered: colorOk,
        unitsInStock: units,
        available: sizeOk && colorOk && (units === null || units > 0),
      };
    }
    return {
      found: true as const,
      product: {
        id: product.id,
        name: product.name,
        category: product.category,
        fit: product.fit,
        material: product.material,
        gsm: product.gsm ?? null,
        priceInr: product.priceInr,
        colors: product.colors,
        sizes: product.sizes,
        theme: product.theme,
        returnable: product.returnable,
      },
      variant,
    };
  },
});
