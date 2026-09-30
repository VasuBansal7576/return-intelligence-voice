import { defineTool } from "eve/tools";
import { z } from "zod";
import { findOrder } from "../lib/knowledge/customers.ts";
import { getProduct } from "../lib/knowledge/catalog.ts";

export default defineTool({
  description:
    "Fetch an order and its items with product details resolved. Use when the customer gives an order ID like TSS-10432.",
  inputSchema: z.object({
    orderId: z.string().describe("Order ID, e.g. TSS-10432"),
  }),
  execute({ orderId }) {
    const hit = findOrder(orderId);
    if (!hit) {
      return {
        found: false as const,
        message:
          "No order found with that ID. Ask the customer to read the order ID from their confirmation email or account page.",
      };
    }
    const { customer, order } = hit;
    return {
      found: true as const,
      orderId: order.orderId,
      status: order.status,
      deliveredDaysAgo: order.deliveredDaysAgo,
      customer: { customerId: customer.customerId, name: customer.name },
      items: order.items.map((i) => {
        const product = getProduct(i.productId);
        return {
          itemId: i.itemId,
          productId: i.productId,
          productName: product?.name ?? i.productId,
          size: i.size,
          color: i.color,
          qty: i.qty,
          priceInr: i.priceInr,
          returnable: product?.returnable ?? false,
        };
      }),
    };
  },
});
