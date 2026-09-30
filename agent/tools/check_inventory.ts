import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProduct, normalizeId } from "../lib/knowledge/catalog.ts";

export default defineTool({
  description:
    "Check real stock for a product in a given size and color. Always call this before promising a customer that an alternate or replacement is available.",
  inputSchema: z.object({
    productId: z.string().describe("Product ID, e.g. TSS-OBT-001"),
    size: z.string().describe("Size code, e.g. L"),
    color: z.string().describe("Color name, e.g. ink black"),
  }),
  execute({ productId, size, color }) {
    const product = getProduct(normalizeId(productId));
    if (!product) {
      return { available: false, reason: `No product ${productId} in the catalog.` };
    }
    if (!product.sizes.includes(size)) {
      return {
        available: false,
        reason: `${product.name} is not offered in size ${size}. Offered sizes: ${product.sizes.join(", ")}.`,
      };
    }
    const colorOk = product.colors.some(
      (c) => c.toLowerCase() === color.toLowerCase(),
    );
    if (!colorOk) {
      return {
        available: false,
        reason: `${product.name} is not offered in ${color}. Offered colors: ${product.colors.join(", ")}.`,
      };
    }
    const units = product.stock[size] ?? 0;
    return {
      available: units > 0,
      unitsInStock: units,
      productId: product.id,
      size,
      color,
      reason:
        units > 0
          ? `${units} in stock.`
          : `${product.name} is out of stock in size ${size}.`,
    };
  },
});
