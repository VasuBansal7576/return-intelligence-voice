import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  findCustomerById,
  findCustomerByPhone,
} from "../lib/knowledge/customers.ts";
import { getProduct } from "../lib/knowledge/catalog.ts";

export default defineTool({
  description:
    "Fetch a customer's categorised profile: name, orders grouped by status, and return history. Call this as soon as the customer gives a phone number or you have a customer ID.",
  inputSchema: z.object({
    phone: z
      .string()
      .optional()
      .describe("Customer phone number, digits only preferred"),
    customerId: z
      .string()
      .optional()
      .describe("Customer ID such as CUST-001, if already known"),
  }),
  execute({ phone, customerId }) {
    const customer = phone
      ? findCustomerByPhone(phone)
      : customerId
        ? findCustomerById(customerId)
        : undefined;
    if (!customer) {
      return {
        found: false as const,
        message:
          "No customer found for that identifier. Ask the customer to double-check the phone number, or ask for an order ID instead.",
      };
    }
    return {
      found: true as const,
      customerId: customer.customerId,
      name: customer.name,
      city: customer.city,
      orders: customer.orders.map((o) => ({
        orderId: o.orderId,
        status: o.status,
        deliveredDaysAgo: o.deliveredDaysAgo,
        items: o.items.map((i) => ({
          itemId: i.itemId,
          productId: i.productId,
          productName: getProduct(i.productId)?.name ?? i.productId,
          size: i.size,
          color: i.color,
          qty: i.qty,
          priceInr: i.priceInr,
        })),
      })),
      returnHistory: customer.returns.map((r) => ({
        returnId: r.returnId,
        orderId: r.orderId,
        productId: r.productId,
        productName: getProduct(r.productId)?.name ?? r.productId,
        returnedDaysAgo: r.returnedDaysAgo,
        reasonLabel: r.reasonLabel,
        outcome: r.outcome,
      })),
      totals: {
        orders: customer.orders.length,
        returns: customer.returns.length,
      },
    };
  },
});
