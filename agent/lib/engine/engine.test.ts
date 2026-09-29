import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG, getProduct } from "../knowledge/catalog.ts";
import { POLICY } from "../knowledge/policy.ts";
import {
  CUSTOMERS,
  findCustomerByPhone,
  findOrder,
} from "../knowledge/customers.ts";
import { checkEligibility } from "./eligibility.ts";
import { findAlternates } from "./recommend.ts";

// Seeded fixtures the demo paths rely on — if these break, the demo breaks.

test("seed data is demo-ready", () => {
  assert.ok(CATALOG.length >= 30, `catalog has ${CATALOG.length} products, need 30+`);
  assert.ok(CUSTOMERS.length >= 3 && CUSTOMERS.length <= 5);
  for (const p of CATALOG) {
    for (const size of p.sizes) assert.ok(size in p.stock, `${p.id} missing stock for ${size}`);
  }
  for (const c of CUSTOMERS) {
    for (const o of c.orders) {
      for (const i of o.items) assert.ok(getProduct(i.productId), `${o.orderId} references unknown ${i.productId}`);
    }
  }
});

function orderItem(orderId: string, productId: string) {
  const hit = findOrder(orderId);
  assert.ok(hit, `order ${orderId} seeded`);
  const item = hit.order.items.find((i) => i.productId === productId);
  assert.ok(item, `${productId} in ${orderId}`);
  const product = getProduct(productId);
  assert.ok(product);
  return { customer: hit.customer, order: hit.order, item, product };
}

test("Aarav: in-window return is eligible with refund + both exchange kinds", () => {
  const r = checkEligibility({ ...orderItem("TSS-10432", "TSS-RGT-001"), reasonLabel: "fit_too_small" });
  assert.equal(r.eligible, true);
  assert.equal(r.reasonCode, "ok");
  assert.deepEqual(r.allowedActions, [
    "refund",
    "exchange_same_product",
    "exchange_different_product",
  ]);
  assert.equal(r.daysSinceDelivery, 22);
  assert.equal(r.windowDays, POLICY.rules.returnWindowDays);
});

test("Rohan: outside the 30-day window is denied deterministically", () => {
  const r = checkEligibility({ ...orderItem("TSS-10188", "TSS-SHT-003"), reasonLabel: "changed_mind" });
  assert.equal(r.eligible, false);
  assert.equal(r.reasonCode, "outside_window");
  assert.equal(r.allowedActions.length, 0);
});

test("Kabir: final-sale accessory is denied even inside the window", () => {
  const r = checkEligibility({ ...orderItem("TSS-10601", "TSS-ACC-003"), reasonLabel: "changed_mind" });
  assert.equal(r.eligible, false);
  assert.equal(r.reasonCode, "final_sale");
});

test("Sneha: defect routes to replacement/refund and flags a quality case", () => {
  const r = checkEligibility({ ...orderItem("TSS-10588", "TSS-WDR-001"), reasonLabel: "quality_defect" });
  assert.equal(r.eligible, true);
  assert.equal(r.qualityCase, true);
  assert.deepEqual(r.allowedActions, ["replacement", "refund"]);
});

test("Aarav: returning the already-returned polo is denied", () => {
  const r = checkEligibility({ ...orderItem("TSS-09210", "TSS-POL-001"), reasonLabel: "fit_too_small" });
  assert.equal(r.eligible, false);
  assert.equal(r.reasonCode, "already_returned");
});

test("alternates for a too-tight regular tee are looser, in stock, and explained", () => {
  const source = getProduct("TSS-RGT-001")!;
  const alts = findAlternates({
    source,
    catalog: CATALOG,
    reasonLabel: "fit_too_small",
    size: "L",
    limit: 3,
  });
  assert.ok(alts.length >= 2);
  for (const a of alts) {
    assert.notEqual(a.product.id, source.id);
    assert.ok(a.product.returnable);
    assert.ok((a.product.stock.L ?? 0) > 0, `${a.product.id} out of stock in L`);
    assert.ok(a.why.length > 0, "every candidate must carry an explanation");
  }
  assert.equal(alts[0].product.fit === "oversized" || alts[0].product.fit === "relaxed", true);
});

test("alternates for a too-heavy tee prefer lower GSM", () => {
  const source = getProduct("TSS-OBT-001")!; // 240 GSM oversized
  const alts = findAlternates({
    source,
    catalog: CATALOG,
    reasonLabel: "material_too_heavy",
    size: "M",
    limit: 3,
  });
  assert.ok(alts.length >= 1);
  assert.ok(
    alts.some((a) => a.product.gsm !== undefined && a.product.gsm < 240),
    "expected a lighter-weight candidate",
  );
});

test("no size given → alternates never claim stock; wrong size filters out", () => {
  const source = getProduct("TSS-RGT-001")!;
  const alts = findAlternates({
    source,
    catalog: CATALOG,
    reasonLabel: "changed_mind",
    size: "XXXL", // not offered anywhere
  });
  assert.equal(alts.length, 0);
});

test("customer lookup by phone finds the seeded digest", () => {
  const c = findCustomerByPhone("98765 43210");
  assert.ok(c);
  assert.equal(c.customerId, "CUST-001");
  assert.equal(c.returns.length, 1);
});
