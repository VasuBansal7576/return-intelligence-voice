import type { Customer, Order } from "./types.ts";

/**
 * Synthetic customers and order history. No real PII — every record is
 * invented for the demo. `deliveredDaysAgo` keeps fixtures evergreen so the
 * demo paths survive any calendar date.
 */
export const CUSTOMERS: Customer[] = [
  {
    // Demo path A — returning customer, in-window return, alternates exist.
    customerId: "CUST-001",
    name: "Aarav Mehta",
    phone: "9876543210",
    city: "Mumbai",
    orders: [
      {
        orderId: "TSS-10432",
        placedDaysAgo: 24,
        deliveredDaysAgo: 22,
        status: "delivered",
        items: [
          {
            itemId: "TSS-10432-1",
            productId: "TSS-RGT-001",
            size: "L",
            color: "charcoal",
            qty: 1,
            priceInr: 699,
          },
        ],
      },
      {
        orderId: "TSS-09871",
        placedDaysAgo: 80,
        deliveredDaysAgo: 76,
        status: "delivered",
        items: [
          {
            itemId: "TSS-09871-1",
            productId: "TSS-OBT-001",
            size: "L",
            color: "ink black",
            qty: 1,
            priceInr: 999,
          },
          {
            itemId: "TSS-09871-2",
            productId: "TSS-JOG-001",
            size: "L",
            color: "black",
            qty: 1,
            priceInr: 1299,
          },
        ],
      },
      {
        orderId: "TSS-09210",
        placedDaysAgo: 65,
        deliveredDaysAgo: 60,
        status: "returned",
        items: [
          {
            itemId: "TSS-09210-1",
            productId: "TSS-POL-001",
            size: "L",
            color: "navy",
            qty: 1,
            priceInr: 1099,
          },
        ],
      },
    ],
    returns: [
      {
        returnId: "RET-5001",
        orderId: "TSS-09210",
        productId: "TSS-POL-001",
        returnedDaysAgo: 55,
        reasonLabel: "fit_too_small",
        outcome: "refund",
      },
    ],
  },
  {
    // Demo path B — cold start: one order, no history, no returns.
    customerId: "CUST-002",
    name: "Priya Sharma",
    phone: "9812345670",
    city: "Bengaluru",
    orders: [
      {
        orderId: "TSS-10512",
        placedDaysAgo: 12,
        deliveredDaysAgo: 10,
        status: "delivered",
        items: [
          {
            itemId: "TSS-10512-1",
            productId: "TSS-OBT-001",
            size: "M",
            color: "charcoal",
            qty: 1,
            priceInr: 999,
          },
        ],
      },
    ],
    returns: [],
  },
  {
    // Demo path C — only recent order is outside the 30-day window.
    customerId: "CUST-003",
    name: "Rohan Kapoor",
    phone: "9820098200",
    city: "Delhi",
    orders: [
      {
        orderId: "TSS-10188",
        placedDaysAgo: 48,
        deliveredDaysAgo: 45,
        status: "delivered",
        items: [
          {
            itemId: "TSS-10188-1",
            productId: "TSS-SHT-003",
            size: "M",
            color: "red check",
            qty: 1,
            priceInr: 1699,
          },
        ],
      },
    ],
    returns: [],
  },
  {
    // Demo path D — very recent delivery; quality/defect narrative.
    customerId: "CUST-004",
    name: "Sneha Iyer",
    phone: "9742012345",
    city: "Chennai",
    orders: [
      {
        orderId: "TSS-10588",
        placedDaysAgo: 7,
        deliveredDaysAgo: 5,
        status: "delivered",
        items: [
          {
            itemId: "TSS-10588-1",
            productId: "TSS-WDR-001",
            size: "S",
            color: "black",
            qty: 1,
            priceInr: 1299,
          },
          {
            itemId: "TSS-10588-2",
            productId: "TSS-WTP-002",
            size: "S",
            color: "sage",
            qty: 1,
            priceInr: 899,
          },
        ],
      },
      {
        orderId: "TSS-10002",
        placedDaysAgo: 120,
        deliveredDaysAgo: 115,
        status: "delivered",
        items: [
          {
            itemId: "TSS-10002-1",
            productId: "TSS-WTP-001",
            size: "S",
            color: "white",
            qty: 1,
            priceInr: 799,
          },
        ],
      },
    ],
    returns: [
      {
        returnId: "RET-5002",
        orderId: "TSS-10002",
        productId: "TSS-WTP-001",
        returnedDaysAgo: 100,
        reasonLabel: "material_uncomfortable",
        outcome: "exchange",
      },
    ],
  },
  {
    // Demo path E — order contains a final-sale item plus a returnable one.
    customerId: "CUST-005",
    name: "Kabir Singh",
    phone: "9650096500",
    city: "Pune",
    orders: [
      {
        orderId: "TSS-10601",
        placedDaysAgo: 9,
        deliveredDaysAgo: 7,
        status: "delivered",
        items: [
          {
            itemId: "TSS-10601-1",
            productId: "TSS-ACC-003",
            size: "OS",
            color: "charcoal",
            qty: 1,
            priceInr: 499,
          },
          {
            itemId: "TSS-10601-2",
            productId: "TSS-RGT-002",
            size: "M",
            color: "white",
            qty: 1,
            priceInr: 749,
          },
        ],
      },
    ],
    returns: [],
  },
];

function norm(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function findCustomerByPhone(phone: string): Customer | undefined {
  const digits = phone.replace(/\D/g, "");
  return CUSTOMERS.find((c) => c.phone === digits || digits.endsWith(c.phone));
}

export function findCustomerById(customerId: string): Customer | undefined {
  const id = norm(customerId);
  return CUSTOMERS.find((c) => norm(c.customerId) === id);
}

export function findOrder(orderId: string): { customer: Customer; order: Order } | undefined {
  const id = norm(orderId);
  for (const customer of CUSTOMERS) {
    const order = customer.orders.find((o) => norm(o.orderId) === id);
    if (order) return { customer, order };
  }
  return undefined;
}
