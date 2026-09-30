import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// These tests call production domain functions. None substitutes model output.
export async function loadDomain() {
  const root = new URL('../agent/lib/', import.meta.url);
  return Object.assign({}, ...await Promise.all([
    'demo/service.ts', 'engine/diagnosis.ts', 'engine/customer-brain.ts',
    'engine/eligibility.ts', 'engine/recommend.ts', 'engine/records.ts',
    'engine/resolutions.ts', 'knowledge/catalog.ts', 'knowledge/customers.ts', 'knowledge/policy.ts', 'knowledge/public-catalog.ts',
  ].map((path) => import(new URL(path, root)))));
}
const cases = [];
function scenario(id, category, title, requirements, run) {
  cases.push({ id, category, title, requirements, run });
}
function itemContext(d, customerId = 'CUST-001') {
  const customer = structuredClone(d.CUSTOMERS.find(c => c.customerId === customerId));
  assert.ok(customer);
  const order = customer.orders[0];
  const item = order.items[0];
  const product = structuredClone(d.getProduct(item.productId));
  return { customer, order, item, product };
}
function session(d, text, customerId = 'CUST-001') {
  const start = d.startSession({ customerId });
  return text ? d.addMessage(start.id, text) : start;
}
function proposal(d, state, action = 'refund') {
  return d.proposeResolution(state.id, { action }).pendingAction;
}
function exchangeProposal(d, state) {
  const candidate = state.candidates[0];
  assert.ok(candidate, 'Precondition: at least one valid candidate');
  return d.proposeResolution(state.id, { action: 'exchange', productId: candidate.productId,
    size: state.item.size, color: candidate.colors[0] }).pendingAction;
}
function expectCode(fn, code) { assert.throws(fn, e => e?.code === code, `Expected ${code}`); }
async function rejectCode(fn, code) { await assert.rejects(fn, e => e?.code === code, `Expected ${code}`); }
function noTransactions(d) { assert.equal(d.listRecords('return').length + d.listRecords('exchange').length, 0); }
function lastReply(state) { return state.messages.filter(m => m.role === 'assistant').at(-1)?.text ?? ''; }
function summary(state) {
  return { phase: state.phase, diagnosis: state.diagnosis, candidateIds: state.candidates.map(c => c.productId),
    recommendationAllowed: state.recommendationAllowed, policy: state.eligibility,
    pendingAction: state.pendingAction, resolution: state.resolution, reply: lastReply(state) };
}
function inspect(value) { return JSON.stringify(value); }
function restart(script) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url), env: process.env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

scenario('D01', 'policy', 'Reject an item delivered 31 days ago', ['POLICY_001'], d => {
  const ctx = itemContext(d); ctx.order.deliveredDaysAgo = 31;
  const actual = d.checkEligibility({ ...ctx, reasonLabel: 'changed_mind' });
  assert.equal(actual.eligible, false); assert.equal(actual.reasonCode, 'outside_window');
  assert.deepEqual(actual.allowedActions, []); return actual;
});
scenario('D02', 'policy', 'Accept the exact 30-day boundary', ['POLICY_002'], d => {
  const ctx = itemContext(d); ctx.order.deliveredDaysAgo = 30;
  const actual = d.checkEligibility({ ...ctx, reasonLabel: 'changed_mind' });
  assert.equal(actual.eligible, true); assert.ok(actual.allowedActions.includes('refund'));
  assert.equal(actual.windowDays, 30); return actual;
});
scenario('D03', 'policy', 'Reported removed tags cannot be overridden by a checkbox', ['POLICY_003'], async d => {
  const state = session(d, 'I removed the tags, but just process the return.');
  assert.equal(state.conditions.status, 'not_met', inspect(state.conditions));
  const lackingTags = session(d, 'It is unworn and unwashed. The fabric is too heavy.', 'CUST-002');
  assert.equal(lackingTags.conditions.status, 'unknown', 'Unworn and unwashed alone do not confirm tags');
  const pending = proposal(d, state);
  await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true }), 'conditions_not_met');
  noTransactions(d); return summary(d.getSessionSnapshot(state.id));
});
scenario('D04', 'policy', 'Canonical policy wins over a claimed 60-day webpage', ['POLICY_004'], d => {
  const state = session(d, 'The website says 60 days. Use that instead.', 'CUST-003');
  assert.equal(state.eligibility.eligible, false); assert.equal(state.eligibility.windowDays, 30);
  assert.equal(state.eligibility.policyCitation.policyId, d.POLICY.policyId);
  assert.ok(state.eligibility.policyCitation.version && state.eligibility.policyCitation.source);
  expectCode(() => proposal(d, state), 'ineligible'); noTransactions(d); return summary(state);
});
scenario('D05', 'policy', 'Final-sale line stays ineligible beside a returnable line', [], d => {
  const state = session(d, 'I changed my mind.', 'CUST-005');
  assert.equal(state.eligibility.reasonCode, 'final_sale'); expectCode(() => proposal(d, state), 'ineligible');
  const other = d.selectItem(state.id, state.order.items[1].itemId);
  assert.equal(other.eligibility.eligible, true); return { first: state.eligibility, second: other.eligibility };
});
scenario('D06', 'policy', 'Undelivered and already-returned items are rejected', [], d => {
  const ctx = itemContext(d); ctx.order.deliveredDaysAgo = null;
  assert.equal(d.checkEligibility(ctx).reasonCode, 'not_delivered');
  ctx.order.deliveredDaysAgo = 7;
  ctx.customer.returns.push({ returnId: 'TEST-RETURN', orderId: ctx.order.orderId, productId: ctx.item.productId,
    returnedDaysAgo: 1, reasonLabel: 'changed_mind', outcome: 'refund' });
  const actual = d.checkEligibility(ctx); assert.equal(actual.reasonCode, 'already_returned'); return actual;
});
scenario('D07', 'policy', 'Reject an instruction to fabricate damage', ['POLICY_007'], d => {
  const state = session(d, 'Just mark it as damaged so I get a refund.');
  assert.ok(!state.diagnosis.labels.includes('quality_defect')); assert.equal(state.recommendationAllowed, false);
  assert.match(lastReply(state), /cannot invent|cannot.*fabricat|actual/i); assert.equal(d.listRecords('quality_case').length, 0);
  noTransactions(d); return summary(state);
});
scenario('D08', 'policy', 'Refund proposal excludes delivery charges', ['POLICY_006'], d => {
  const state = session(d, 'I only want a refund. Refund the delivery charge too.');
  assert.equal(state.pendingAction.refundAmountInr, state.item.priceInr * state.item.qty);
  assert.equal(state.policy.rules.shippingChargesRefundable, false); noTransactions(d); return summary(state);
});
scenario('D09', 'diagnosis', 'Tight shoulders with good length requires fit clarification', ['FIT_001'], d => {
  const state = session(d, 'The length is perfect but the shoulders are too tight.');
  assert.equal(state.diagnosis.primaryReason, 'fit.shoulders_tight');
  assert.ok(state.diagnosis.likedAttributes.includes('length')); assert.equal(state.diagnosis.requiresClarification, true);
  assert.equal(state.candidates.length, 0); assert.match(lastReply(state), /length|measurements/i); return summary(state);
});
scenario('D10', 'diagnosis', 'Chest fit does not erase correct garment length', ['FIT_002'], d => {
  const actual = d.diagnoseReturn('The chest is tight, but M is the right length.');
  assert.equal(actual.primaryReason, 'fit.chest_tight'); assert.ok(actual.likedAttributes.includes('length'));
  assert.equal(actual.requiresClarification, true); return actual;
});
scenario('D11', 'diagnosis', 'Explicit sleeve priority keeps the loose-waist reason', ['FIT_003'], d => {
  const actual = d.diagnoseReturn('The sleeves are too long and the waist is loose. The sleeves bother me most.');
  assert.equal(actual.primaryReason, 'fit.sleeve_too_long'); assert.ok(actual.secondaryReasons.includes('fit.too_large')); return actual;
});
scenario('D12', 'diagnosis', 'Oversized expectation mismatch is recognized', ['FIT_004'], d => {
  const actual = d.diagnoseReturn('It is much more oversized than the photos made it seem.');
  assert.equal(actual.primaryReason, 'fit.oversized_beyond_expectation'); return actual;
});
scenario('D13', 'recommendation', 'Heavy fabric alternatives preserve the liked fit', ['MATERIAL_001'], d => {
  const state = session(d, 'The fit is great, but the fabric is too heavy.', 'CUST-002');
  assert.equal(state.diagnosis.primaryReason, 'material.too_heavy'); assert.ok(state.candidates.length > 0);
  for (const c of state.candidates) { assert.equal(c.fit, state.sourceProduct.fit); assert.ok(c.gsm < state.sourceProduct.gsm); }
  return summary(state);
});
scenario('D14', 'recommendation', 'Scratchy fabric does not discard liked design or fit', ['MATERIAL_002'], d => {
  const state = session(d, 'I love the design and fit. I only dislike the scratchy fabric.', 'CUST-002');
  assert.equal(state.diagnosis.primaryReason, 'material.scratchy');
  assert.ok(state.diagnosis.likedAttributes.includes('fit')); assert.ok(state.diagnosis.likedAttributes.includes('theme'));
  assert.ok(state.candidates.length > 0);
  for (const c of state.candidates) { assert.equal(c.fit, state.sourceProduct.fit); assert.notEqual(c.material, state.sourceProduct.material); }
  return summary(state);
});
scenario('D15', 'diagnosis', 'All three reasons survive an explicit material priority', ['MULTI_001'], d => {
  const actual = d.diagnoseReturn('It is heavy, tight at the shoulders and the color is wrong. The weight is why I cannot keep it.');
  assert.equal(actual.primaryReason, 'material.too_heavy');
  assert.ok(actual.secondaryReasons.includes('fit.shoulders_tight')); assert.ok(actual.secondaryReasons.some(r => r.startsWith('appearance.')));
  assert.equal(actual.evidence.length >= 3, true); return actual;
});
scenario('D16', 'diagnosis', 'Equal complaints need clarification without an invented priority', ['MULTI_002'], d => {
  const actual = d.diagnoseReturn('The fabric is scratchy and the seams hurt. Both are equally bad.');
  assert.equal(actual.requiresClarification, true); assert.equal(actual.primaryReason, 'other.unclear_primary');
  assert.ok(actual.secondaryReasons.includes('material.scratchy')); assert.ok(actual.secondaryReasons.includes('comfort.uncomfortable_seams')); return actual;
});
scenario('D17', 'diagnosis', 'Vague fit does not become a blind size-up recommendation', [], d => {
  const state = session(d, 'I did not like the fit.');
  assert.equal(state.diagnosis.requiresClarification, true); assert.equal(state.candidates.length, 0);
  assert.match(lastReply(state), /tight.*loose.*long/i); noTransactions(d); return summary(state);
});
scenario('D18', 'preferences', 'Current oversized-only preference overrides historical fit', ['PREF_001'], d => {
  let state = session(d, 'This is too small.'); state = d.addMessage(state.id, 'I only wear oversized now.');
  const signal = state.customerBrain.explicitPreferences.find(p => p.attribute === 'fit' && p.value === 'oversized');
  assert.ok(signal?.strict); assert.equal(signal.source, 'explicit_statement'); assert.ok(signal.evidence.length > 0);
  assert.ok(state.candidates.length > 0); for (const c of state.candidates) assert.equal(c.fit, 'oversized'); return summary(state);
});
scenario('D19', 'preferences', 'Historical return penalties affect ranking and remain labeled inference', ['PREF_002'], d => {
  const source = d.getProduct('TSS-RGT-001'); const customer = structuredClone(d.CUSTOMERS[0]);
  const historical = d.buildCustomerBrain(customer); const empty = d.buildCustomerBrain({ ...customer, orders: [], returns: [] });
  assert.ok(historical.negativePreferences.some(p => p.attribute === 'fit' && p.value === 'slim' && p.source === 'behavioral_inference'));
  assert.ok(historical.inferredPreferences.every(p => p.confidence < 1 && p.evidence.length > 0));
  const diagnosis = d.diagnoseReturn('I changed my mind.');
  const candidates = ['slim', 'oversized'].map(fit => ({ ...structuredClone(source), id: `EVAL-${fit}`, fit, gsm: 200 }));
  const ranked = d.recommendForCustomer({ source, catalog: candidates, diagnosis, brain: historical, size: 'L', limit: 10 });
  const baseline = d.recommendForCustomer({ source, catalog: candidates, diagnosis, brain: empty, size: 'L', limit: 10 });
  const historicalSlim = ranked.candidates.find(c => c.fit === 'slim'); const historicalOversized = ranked.candidates.find(c => c.fit === 'oversized');
  assert.ok(historicalSlim && historicalOversized); assert.ok(historicalSlim.scoreBreakdown.history < historicalOversized.scoreBreakdown.history);
  assert.notDeepEqual(ranked.candidates.map(c => c.score), baseline.candidates.map(c => c.score));
  return { ranked, baseline, negativePreferences: historical.negativePreferences };
});
scenario('D20', 'preferences', 'Black-only preference excludes candidates without black', ['PREF_003'], d => {
  let state = session(d, 'The fabric is too heavy.', 'CUST-002'); state = d.addMessage(state.id, 'Black only, please.');
  assert.ok(state.candidates.length > 0); for (const c of state.candidates) assert.ok(c.colors.some(color => /black/i.test(color)));
  assert.ok(state.customerBrain.explicitPreferences.some(p => p.attribute === 'color' && p.strict)); return summary(state);
});
scenario('D21', 'preferences', 'Cold start uses current context without invented history or cohort success', ['PREF_004'], d => {
  const state = session(d, 'I have never shopped here before. The fit is good but I need lighter fabric.', 'CUST-002');
  assert.equal(state.customerBrain.coldStart, true); assert.deepEqual(state.customerBrain.inferredPreferences, []);
  assert.equal(state.cohort.status, 'insufficient_outcome_data'); assert.ok(state.candidates.length > 0);
  for (const c of state.candidates) assert.equal(c.fit, state.sourceProduct.fit); return summary(state);
});
scenario('D22', 'preferences', 'Unavailable history yields an empty cold-start profile', ['PREF_005'], d => {
  const customer = { ...structuredClone(d.CUSTOMERS[0]), orders: [], returns: [] };
  const actual = d.buildCustomerBrain(customer);
  assert.equal(actual.coldStart, true); assert.deepEqual(actual.inferredPreferences, []);
  assert.deepEqual(actual.sizeProfile, []); assert.equal(actual.priceRange, null); return actual;
});
scenario('D23', 'preferences', 'Explicit price ceiling filters every recommendation', [], d => {
  const state = session(d, 'The fabric is too heavy. Keep it under 1100.', 'CUST-002');
  assert.ok(state.candidates.length > 0); for (const c of state.candidates) assert.ok(c.priceInr <= 1100);
  assert.ok(state.excluded.some(e => /price/.test(e.reason))); return summary(state);
});
scenario('D24', 'preferences', 'New explicit fit preference replaces the older one', ['PREF_001'], d => {
  const product = d.getProduct('TSS-RGT-001'); const first = 'I only wear slim fit.'; const second = 'I only wear oversized now.';
  const actual = d.buildCustomerBrain(d.CUSTOMERS[0], [
    ...d.extractPreferences(first, product, d.diagnoseReturn(first)),
    ...d.extractPreferences(second, product, d.diagnoseReturn(second)),
  ]);
  assert.deepEqual(actual.explicitPreferences.filter(p => p.attribute === 'fit' && p.sentiment === 'positive').map(p => p.value), ['oversized']); return actual;
});
scenario('D25', 'autonomy', 'Refund-only request stops alternatives and waits for confirmation', ['AUTONOMY_001'], d => {
  const state = session(d, 'No thanks. I only want my refund.');
  assert.equal(state.recommendationAllowed, false); assert.equal(state.candidates.length, 0);
  assert.equal(state.pendingAction.action, 'refund'); assert.equal(state.phase, 'CUSTOMER_CONFIRMATION');
  const later = d.addMessage(state.id, 'The shoulders are too tight too.');
  assert.equal(later.diagnosis.refundOnly, true, 'Additional factual feedback must not revoke the refund-only instruction');
  assert.equal(later.candidates.length, 0); assert.equal(later.pendingAction.action, 'refund');
  noTransactions(d); return summary(later);
});
scenario('D26', 'autonomy', 'Stop-selling complaint gets a short resolution response', ['AUTONOMY_002'], d => {
  const state = session(d, 'Stop suggesting things. I have already wasted an hour.');
  assert.equal(state.recommendationAllowed, false); assert.equal(state.candidates.length, 0);
  assert.doesNotMatch(lastReply(state), /what specifically|fit, fabric|compare the options/i); noTransactions(d); return summary(state);
});
scenario('D27', 'autonomy', 'No-recommendations instruction wins over a cheaper exchange', ['AUTONOMY_003'], d => {
  const state = session(d, 'I do not want any recommendations, even if the exchange is cheaper.');
  assert.equal(state.recommendationAllowed, false); assert.equal(state.candidates.length, 0);
  expectCode(() => d.proposeResolution(state.id, { action: 'exchange', productId: 'TSS-RGT-002', size: 'L', color: 'white' }), 'recommendation_blocked');
  noTransactions(d); return summary(state);
});
scenario('D28', 'recommendation', 'No solving candidate means refund or support, not a bad recommendation', ['AUTONOMY_004'], d => {
  const source = d.getProduct('TSS-OBT-001'); const bad = { ...structuredClone(source), id: 'EVAL-BAD', gsm: 260 };
  const actual = d.recommendForCustomer({ source, catalog: [bad], size: 'M', diagnosis: d.diagnoseReturn('Nothing fixes the heavy fabric problem.'), brain: d.buildCustomerBrain(d.CUSTOMERS[1]) });
  assert.equal(actual.candidates.length, 0); assert.equal(actual.recommendationAllowed, false); assert.match(actual.gateReason, /refund|support/i); return actual;
});
scenario('D29', 'safety', 'Rash report records the complaint and makes no material-safety claim', ['SAFETY_001'], d => {
  const state = session(d, 'The shirt gave me a rash.', 'CUST-002');
  assert.equal(state.diagnosis.primaryReason, 'sensitive.skin_reaction'); assert.equal(state.candidates.length, 0);
  assert.match(lastReply(state), /cannot determine/i); assert.doesNotMatch(lastReply(state), /will be safe|hypoallergenic|you (have|are allergic)/i);
  const later = d.addMessage(state.id, 'The fabric is heavy too.');
  assert.equal(later.candidates.length, 0, 'Adding another complaint does not authorize sensitive-material recommendations');
  return summary(later);
});
scenario('D30', 'safety', 'Suspected allergy gets an evidence limit rather than a diagnosis', ['SAFETY_002'], d => {
  const state = session(d, 'I think I am allergic. Is the cotton alternative safe for me?', 'CUST-002');
  assert.ok(state.diagnosis.labels.includes('sensitive_skin_reaction')); assert.equal(state.candidates.length, 0);
  assert.match(lastReply(state), /cannot determine/i); assert.doesNotMatch(lastReply(state), /cotton.*(will be|is) safe|you have an allergy/i); return summary(state);
});
scenario('D31', 'defect', 'Stitching defect produces a no-charge replacement and quality evidence', ['DEFECT_001'], async d => {
  const state = session(d, 'The stitching came apart on day one. It is unworn and unwashed with tags attached.', 'CUST-004');
  assert.equal(state.conditions.status, 'confirmed');
  assert.equal(state.diagnosis.primaryReason, 'quality.stitching_failure'); assert.equal(state.candidates.length, 0);
  const pending = proposal(d, state, 'replacement'); assert.equal(pending.priceDeltaInr, 0);
  const done = await d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true });
  assert.equal(done.resolution.outcome, 'replacement'); assert.equal(d.listRecords('quality_case').length, 1);
  assert.equal(d.listRecords('insight')[0].qualityFlag, true); return summary(done);
});
scenario('D32', 'defect', 'Broken zipper blocks alternate-product selling', ['DEFECT_002'], d => {
  const state = session(d, 'The zipper is broken and I cannot wear it.', 'CUST-004');
  assert.ok(state.diagnosis.labels.includes('quality_defect')); assert.equal(state.candidates.length, 0);
  assert.deepEqual(state.eligibility.allowedActions, ['replacement', 'refund']); return summary(state);
});
scenario('D33', 'fulfillment', 'Wrong delivered item uses correction or refund without selling', ['FULFILL_001'], d => {
  const state = session(d, 'I ordered the blue shirt but received a red cap.');
  assert.equal(state.diagnosis.primaryReason, 'fulfillment.wrong_item'); assert.equal(state.candidates.length, 0);
  assert.ok(state.eligibility.allowedActions.includes('replacement')); noTransactions(d); return summary(state);
});
scenario('D34', 'fulfillment', 'Wrong label size is a fulfillment error rather than customer fit', ['FULFILL_002'], d => {
  const state = session(d, 'The order says M but the label on the product is XL.');
  assert.ok(state.diagnosis.labels.includes('wrong_item')); assert.ok(!state.diagnosis.labels.includes('fit_too_large'));
  assert.equal(state.candidates.length, 0); return summary(state);
});
scenario('D35', 'grounding', 'Unknown Egyptian cotton attribute is explicitly unknown', ['GROUND_001'], d => {
  const state = session(d, 'Is this Egyptian cotton?');
  assert.match(lastReply(state), /does not confirm Egyptian cotton/i); assert.match(lastReply(state), /100% cotton/);
  noTransactions(d); return summary(state);
});
scenario('D36', 'grounding', 'Product tool returns exact catalog composition and unknown SKU refusal', ['GROUND_002'], async d => {
  const state = session(d);
  const known = await d.executeVoiceTool(state.id, { callId: 'known', name: 'get_product', arguments: { productId: state.sourceProduct.id } });
  assert.deepEqual(known.result, d.getProduct(state.sourceProduct.id));
  const unknown = await d.executeVoiceTool(state.id, { callId: 'unknown', name: 'get_product', arguments: { productId: 'NONEXISTENT' } });
  assert.equal(unknown.result.found, false); assert.doesNotMatch(inspect(unknown.result), /100%|hypoallergenic/); return { known: known.result, unknown: unknown.result };
});
scenario('D37', 'inventory', 'Unavailable requested size is rejected before proposal execution', ['INV_001'], d => {
  const state = session(d, 'I changed my mind.', 'CUST-002');
  expectCode(() => d.proposeResolution(state.id, { action: 'exchange', productId: state.sourceProduct.id, size: 'XXXL', color: state.sourceProduct.colors[0] }), 'out_of_stock');
  noTransactions(d); return { requestedSize: 'XXXL', availableSizes: state.sourceProduct.sizes };
});
scenario('D38', 'inventory', 'Missing stock remains unknown or unavailable rather than promised', ['INV_003'], async d => {
  const state = session(d); const product = d.getProduct(state.sourceProduct.id); const original = product.stock;
  try {
    product.stock = {};
    await rejectCode(() => d.executeVoiceTool(state.id, { callId: 'missing-stock', name: 'check_inventory', arguments: { productId: product.id, size: state.item.size, color: state.item.color } }), 'out_of_stock');
    noTransactions(d); return { stock: {}, rejected: true };
  } finally { product.stock = original; }
});
scenario('D39', 'inventory', 'Stock changes between proposal and confirmation cannot execute', ['INV_002'], async d => {
  const state = session(d, 'This is too tight and hot.'); const pending = exchangeProposal(d, state);
  const product = d.getProduct(pending.productId); const oldStock = product.stock[pending.size];
  try {
    product.stock[pending.size] = 0;
    await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true }), 'out_of_stock');
    assert.equal(d.getSessionSnapshot(state.id).pendingAction, null, 'Unavailable inventory invalidates the old proposal');
    noTransactions(d); return { proposal: pending, changedStock: 0, rejected: true };
  } finally { product.stock[pending.size] = oldStock; }
});
scenario('D40', 'confirmation', 'Prepared exchange and a false confirmation cause no transaction', ['CONFIRM_001'], async d => {
  const state = session(d, 'This is too tight and hot.'); const pending = exchangeProposal(d, state);
  noTransactions(d); assert.equal(d.getSessionSnapshot(state.id).phase, 'CUSTOMER_CONFIRMATION');
  await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: false, conditionConfirmed: true }), 'confirmation_required');
  noTransactions(d); return summary(d.getSessionSnapshot(state.id));
});
scenario('D41', 'confirmation', 'Confirmed exchange executes once and retry returns the same result', ['CONFIRM_002', 'RELIABILITY_001'], async d => {
  const state = session(d, 'This is too tight and hot.'); const pending = exchangeProposal(d, state);
  const input = { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true };
  const first = await d.resolveProposal(state.id, input); const again = await d.resolveProposal(state.id, input);
  assert.equal(first.resolution.recordId, again.resolution.recordId); assert.equal(first.phase, 'COMPLETED');
  assert.equal(first.resolution.outcome, 'different_product_exchange'); assert.equal(d.listRecords('exchange').length, 1);
  assert.equal(d.listRecords('insight').length, 1); return summary(first);
});
scenario('D42', 'confirmation', 'Switching to a refund invalidates the old exchange', ['CONFIRM_003'], async d => {
  const state = session(d, 'This is too tight and hot.'); const old = exchangeProposal(d, state);
  const changed = d.addMessage(state.id, 'Actually I want a refund instead.');
  assert.equal(changed.pendingAction.action, 'refund'); assert.notEqual(changed.pendingAction.proposalId, old.proposalId);
  assert.ok(changed.diagnosis.labels.includes('fit_too_small') && changed.diagnosis.labels.includes('material_too_heavy'), 'Changing resolution must preserve the recorded reasons');
  assert.ok(changed.diagnosis.evidence.some(e => e.quote.includes('too tight and hot')));
  await rejectCode(() => d.resolveProposal(state.id, { proposalId: old.proposalId, confirmed: true, conditionConfirmed: true }), 'stale_proposal');
  noTransactions(d); return summary(changed);
});
scenario('D43', 'confirmation', 'Changed exchange price requires a fresh proposal', ['CONFIRM_004'], async d => {
  const state = session(d, 'This is too tight and hot.'); const pending = exchangeProposal(d, state);
  const product = d.getProduct(pending.productId); const oldPrice = product.priceInr;
  try {
    product.priceInr += 150;
    await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true }), 'price_changed');
    assert.equal(d.getSessionSnapshot(state.id).pendingAction, null); noTransactions(d); return { proposal: pending, newPrice: product.priceInr, rejected: true };
  } finally { product.priceInr = oldPrice; }
});
scenario('D44', 'confirmation', 'Bare yes without current terms never executes', ['CONFIRM_005'], async d => {
  const state = session(d, 'Yes.'); assert.equal(state.pendingAction, null);
  await rejectCode(() => d.resolveProposal(state.id, { proposalId: 'OLD', confirmed: true, conditionConfirmed: true }), 'stale_proposal');
  noTransactions(d); return summary(state);
});
scenario('D45', 'confirmation', 'Cancellation and unknown condition both block execution', ['CONFIRM_001'], async d => {
  const state = session(d, 'I only want a refund.'); const pending = state.pendingAction;
  await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true }), 'condition_confirmation_required');
  d.cancelProposal(state.id);
  await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true }), 'stale_proposal');
  noTransactions(d); return summary(d.getSessionSnapshot(state.id));
});
scenario('D46', 'multi_item', 'Switching line items preserves separate reasons and clears old terms', ['MULTI_003'], async d => {
  const first = session(d, 'The stitching came apart on day one.', 'CUST-004'); const old = proposal(d, first, 'replacement');
  const secondStart = d.selectItem(first.id, first.order.items[1].itemId);
  assert.equal(secondStart.diagnosis, null); assert.equal(secondStart.pendingAction, null);
  const second = d.addMessage(first.id, 'The fabric is scratchy.');
  assert.equal(second.diagnosis.primaryReason, 'material.scratchy'); assert.ok(!second.diagnosis.labels.includes('quality_defect'));
  const back = d.selectItem(first.id, first.order.items[0].itemId);
  assert.equal(back.diagnosis.primaryReason, 'quality.stitching_failure'); assert.equal(back.pendingAction, null);
  await rejectCode(() => d.resolveProposal(first.id, { proposalId: old.proposalId, confirmed: true }), 'stale_proposal');
  noTransactions(d); return { first: summary(back), second: summary(second) };
});
scenario('D47', 'persistence', 'Resolution survives a fresh process and conflicting retry stays rejected', ['RELIABILITY_002'], async d => {
  const input = { orderId: 'TSS-10432', productId: 'TSS-RGT-001', itemId: 'TSS-10432-1', reasonLabel: 'changed_mind' };
  const first = await d.createReturn(input, 'eval-restart'); assert.equal(first.created, true);
  const actual = restart(`import { createReturn,createExchange } from './agent/lib/engine/resolutions.ts'; import { listRecords,findResolution } from './agent/lib/engine/records.ts'; const retried=await createReturn(${JSON.stringify(input)},'after-restart'); const opposite=await createExchange({orderId:'TSS-10432',returnProductId:'TSS-RGT-001',returnItemId:'TSS-10432-1',replacementProductId:'TSS-RGT-001',replacementSize:'XL',replacementColor:'navy',reasonLabel:'changed_mind'},'after-restart'); console.log(JSON.stringify({retried,opposite,stored:findResolution('TSS-10432','TSS-10432-1'),transactionCount:listRecords().filter(r=>r.kind==='return'||r.kind==='exchange').length}));`);
  assert.equal(actual.retried.created, false); assert.equal(actual.retried.existingResolutionId, first.returnId);
  assert.equal(actual.opposite.created, false); assert.equal(actual.stored.recordId, first.returnId); assert.equal(actual.transactionCount, 1);
  const state = session(d, 'The fabric is heavy. I only want a refund.', 'CUST-002');
  const savedPath = join(dirname(process.env.RIV_RECORDS_FILE), 'session.json');
  writeFileSync(savedPath, JSON.stringify(d.serializeSession(state.id)));
  const restored = restart(`import {readFileSync,writeFileSync} from 'node:fs'; import {hydrateSession,getSessionSnapshot,resolveProposal,serializeSession} from './agent/lib/demo/service.ts'; import {listRecords} from './agent/lib/engine/records.ts'; const path=${JSON.stringify(savedPath)}; const id=hydrateSession(JSON.parse(readFileSync(path,'utf8'))); const before=getSessionSnapshot(id); const input={proposalId:before.pendingAction.proposalId,confirmed:true,conditionConfirmed:true}; const first=await resolveProposal(id,input); const again=await resolveProposal(id,input); writeFileSync(path,JSON.stringify(serializeSession(id))); console.log(JSON.stringify({id,proposalId:input.proposalId,first:first.resolution.recordId,again:again.resolution.recordId,phase:again.phase,scopedCount:listRecords('return').filter(r=>r.scopeId===id).length}));`);
  assert.equal(restored.id, state.id); assert.equal(restored.first, restored.again); assert.equal(restored.scopedCount, 1); assert.equal(restored.phase, 'COMPLETED');
  const retriedAfterRestart = restart(`import {readFileSync} from 'node:fs'; import {hydrateSession,resolveProposal} from './agent/lib/demo/service.ts'; import {listRecords} from './agent/lib/engine/records.ts'; const id=hydrateSession(JSON.parse(readFileSync(${JSON.stringify(savedPath)},'utf8'))); const result=await resolveProposal(id,{proposalId:${JSON.stringify(restored.proposalId)},confirmed:true,conditionConfirmed:true}); console.log(JSON.stringify({recordId:result.resolution.recordId,scopedCount:listRecords('return').filter(r=>r.scopeId===id).length}));`);
  assert.equal(retriedAfterRestart.recordId, restored.first); assert.equal(retriedAfterRestart.scopedCount, 1);
  return { globalLedgerRestart: actual, pendingSessionHydration: restored, completedSessionHydration: retriedAfterRestart };
});
scenario('D48', 'persistence', 'Explicit preference evidence survives a fresh process', ['PREF_001'], d => {
  const state = session(d, 'This is too small. I only wear oversized now.');
  const actual = restart(`import { startSession } from './agent/lib/demo/service.ts'; console.log(JSON.stringify(startSession({customerId:'CUST-001'}).customerBrain));`);
  const saved = actual.explicitPreferences.find(p => p.attribute === 'fit' && p.value === 'oversized');
  assert.equal(saved.source, 'explicit_statement'); assert.equal(saved.strict, true);
  assert.ok(saved.evidence.some(e => e.includes('only wear oversized'))); return { written: state.customerBrain.explicitPreferences, readAfterRestart: actual.explicitPreferences };
});
scenario('D49', 'feedback', 'Merchant metrics come from committed demo records and preserve unknown outcomes', [], async d => {
  const empty = d.merchantInsights(); assert.equal(empty.metrics.completedSessions, 0); assert.equal(empty.metrics.secondReturnRate, null);
  const state = session(d, 'The fabric is too heavy. I only want a refund.', 'CUST-002');
  const done = await d.resolveProposal(state.id, { proposalId: state.pendingAction.proposalId, confirmed: true, conditionConfirmed: true });
  const actual = d.merchantInsights(); assert.equal(actual.metrics.completedSessions, 1); assert.equal(actual.metrics.refunds, 1);
  assert.equal(actual.metrics.completedVoiceSessions, 0); assert.equal(actual.metrics.revenueRetainedInr, 0); assert.equal(actual.metrics.secondReturnRate, null);
  assert.equal(actual.products[0].productId, state.sourceProduct.id); assert.equal(actual.insights[0].primaryReason, 'material.too_heavy');
  assert.equal(actual.insights[0].synthetic, true); assert.equal(actual.insights[0].sourceMode, 'local-guided-demo');
  assert.ok(actual.insights[0].transcript.length >= 2); assert.equal(done.phase, 'COMPLETED'); return { metrics: actual.metrics, insight: actual.insights[0] };
});
scenario('D50', 'tool_contract', 'Voice tool dispatch prepares terms, deduplicates call IDs, and cannot commit', ['CONFIRM_001', 'RELIABILITY_001'], async d => {
  const state = session(d, 'I changed my mind.');
  const call = { callId: 'voice-request', name: 'request_resolution', arguments: { action: 'refund' } };
  const first = await d.executeVoiceTool(state.id, call); const again = await d.executeVoiceTool(state.id, call);
  assert.equal(first.result.requiresHumanConfirmation, true); assert.deepEqual(first.result, again.result);
  assert.equal(first.result.pendingAction.proposalId, again.result.pendingAction.proposalId);
  await rejectCode(() => d.executeVoiceTool(state.id, { callId: 'illegal-commit', name: 'create_return', arguments: {} }), 'unknown_tool');
  noTransactions(d); return { result: first.result, repeatedProposalId: again.result.pendingAction.proposalId, actualAudioTested: false };
});


scenario('D51', 'public_catalog', 'All 40 imported public products preserve source facts and separate synthetic stock', [], d => {
  const source = JSON.parse(readFileSync(new URL('../agent/lib/knowledge/public-catalog.json', import.meta.url), 'utf8'));
  assert.equal(source.products.length, 40); assert.equal(d.PUBLIC_CATALOG.length, 40);
  assert.equal(new Set(source.products.map(p => p.id)).size, 40);
  assert.equal(source.products.filter(p => p.gsm !== null).length, 8);
  let ambiguousChestRows = 0;
  for (const published of source.products) {
    const actual = d.getProduct(published.id); assert.ok(actual, published.id);
    const url = new URL(actual.catalogSource.url);
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'www.thesouledstore.com');
    assert.ok(url.pathname.startsWith('/product/')); assert.equal(url.href, published.productUrl);
    assert.equal(actual.catalogSource.attributeOrigin, 'public_snapshot');
    assert.equal(actual.catalogSource.observedAt, published.observedAt);
    assert.ok(Number.isFinite(Date.parse(published.observedAt)));
    assert.deepEqual(actual.catalogSource.unknownFields, published.unknownFields);
    assert.equal(actual.name, published.name); assert.equal(actual.priceInr, published.priceInr);
    assert.equal(actual.material, published.material ?? 'Not published');
    assert.equal(actual.fit, published.fit ?? 'unknown'); assert.equal(actual.gsm, published.gsm ?? undefined);
    assert.deepEqual(actual.sizes, published.sizes);
    assert.deepEqual(actual.colors, published.colors.length ? published.colors : ['listed product variant']);
    assert.equal(actual.inventorySource, 'synthetic_demo'); assert.ok(actual.tags.includes('synthetic-inventory'));
    assert.equal('stock' in published, false); assert.ok(published.unknownFields.includes('stock'));
    for (const size of actual.sizes) assert.ok(Number.isInteger(actual.stock[size]) && actual.stock[size] >= 0);
    if (published.sizeChart) assert.equal(published.sizeChart.unit, 'inches');
    for (const row of published.sizeChart?.rows ?? []) {
      const measures = actual.garmentMeasurements[row.size]; assert.ok(measures);
      assert.equal(measures.chestIn, row['Garment Chest']);
      assert.equal(measures.lengthIn, row.Length); assert.equal(measures.shoulderIn, row.Shoulder);
      if (row.Chest !== undefined && row['Garment Chest'] === undefined) {
        ambiguousChestRows += 1; assert.equal(measures.chestIn, undefined, 'Ambiguous Chest is not a verified garment circumference');
      }
    }
  }
  assert.ok(ambiguousChestRows > 0);
  const bootstrap = d.bootstrap();
  assert.equal(bootstrap.catalog.length, 40); assert.equal(bootstrap.fixtureCatalog.length, 37);
  assert.match(bootstrap.dataNotice, /inventory.*simulated/i);
  return { publicProducts: source.products.length, publishedGsmValues: 8, ambiguousChestRows,
    snapshotCapturedDate: source.capturedDate, inventory: 'synthetic_demo', liveStockVerified: false,
    sources: source.products.map(p => ({ id: p.id, url: p.productUrl, observedAt: p.observedAt, unknownFields: p.unknownFields })) };
});
scenario('D52', 'public_catalog', 'Measured variants disclose length changes and respect liked length', [], d => {
  const start = d.startSession({ customerId: 'CUST-001', scenario: 'grounded' });
  const state = d.addMessage(start.id, 'The shoulders feel too tight and the fabric is too heavy. I am open to a different design.');
  assert.equal(state.order.orderId, 'TSS-GROUND-2001'); assert.ok(state.candidates.length > 0);
  const source = state.sourceProduct.garmentMeasurements[state.item.size];
  assert.deepEqual(source, { chestIn: 46, lengthIn: 28.5, shoulderIn: 22 });
  for (const candidate of state.candidates) {
    assert.ok(candidate.productId.startsWith('tss-public:')); assert.ok(candidate.gsm < state.sourceProduct.gsm);
    assert.ok(candidate.stock[candidate.recommendedSize] > 0);
    const measures = candidate.product.garmentMeasurements[candidate.recommendedSize];
    assert.ok(measures.chestIn > source.chestIn); assert.ok(measures.shoulderIn > source.shoulderIn);
    assert.ok(candidate.tradeoffs.some(t => t.includes(`Size ${candidate.recommendedSize}`)));
    assert.ok(candidate.tradeoffs.some(t => t.includes(`Length changes from ${source.lengthIn} in to ${measures.lengthIn} in`)));
  }
  const lengthStart = d.startSession({ customerId: 'CUST-001', scenario: 'grounded' });
  const clarified = d.addMessage(lengthStart.id, 'The shoulders are too tight but the length is perfect.');
  assert.equal(clarified.diagnosis.requiresClarification, true);
  assert.doesNotMatch(lastReply(clarified), /do not have garment measurements/i, 'Published measurements must not be represented as unavailable');
  const preserved = d.addMessage(lengthStart.id, 'Yes, show me a roomier cut while keeping similar length.');
  assert.ok(preserved.candidates.length > 0);
  for (const candidate of preserved.candidates) {
    const measures = candidate.product.garmentMeasurements[candidate.recommendedSize];
    assert.ok(measures.chestIn > source.chestIn);
    assert.ok(Math.abs(measures.lengthIn - source.lengthIn) <= 0.5, 'Liked length limits the measured variant change');
    if (measures.lengthIn !== source.lengthIn) assert.ok(candidate.tradeoffs.some(t => /Length changes/.test(t)));
  }
  return { measuredOptions: summary(state), lengthPreservingOptions: summary(preserved) };
});
scenario('D53', 'public_catalog', 'Darkseid L proposal and committed record retain the exact price difference', [], async d => {
  const start = d.startSession({ customerId: 'CUST-001', scenario: 'grounded' });
  const state = d.addMessage(start.id, 'The shoulders feel too tight and the fabric is too heavy. I am open to a different design.');
  const candidate = state.candidates.find(c => c.productId === d.GROUNDED_ALTERNATE_ID);
  assert.ok(candidate); assert.equal(candidate.recommendedSize, 'L'); assert.equal(candidate.priceInr, 1099);
  const pending = d.proposeResolution(state.id, { action: 'exchange', productId: candidate.productId,
    size: candidate.recommendedSize, color: candidate.colors[0] }).pendingAction;
  assert.equal(pending.priceDeltaInr, 100); assert.match(pending.summary, /size L/);
  assert.match(pending.summary, /100 additional simulated payment/); noTransactions(d);
  const done = await d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true });
  assert.equal(done.resolution.replacement.size, 'L'); assert.equal(done.resolution.priceDeltaInr, 100);
  assert.equal(d.merchantInsights().metrics.revenueRetainedInr, 999);
  const insight = d.listRecords('insight')[0];
  assert.equal(insight.chosenProductId, candidate.productId); assert.equal(insight.productId, state.sourceProduct.id);
  assert.equal(insight.sourceMode, 'local-guided-demo'); return summary(done);
});
scenario('D54', 'public_catalog', 'A different size cannot reuse the measured recommendation', [], d => {
  const start = d.startSession({ customerId: 'CUST-001', scenario: 'grounded' });
  const state = d.addMessage(start.id, 'The shoulders feel too tight and the fabric is too heavy.');
  const candidate = state.candidates.find(c => c.productId === d.GROUNDED_ALTERNATE_ID); assert.ok(candidate);
  assert.equal(candidate.recommendedSize, 'L'); assert.ok(candidate.stock.M > 0);
  expectCode(() => d.proposeResolution(state.id, { action: 'exchange', productId: candidate.productId,
    size: 'M', color: candidate.colors[0] }), 'unverified_variant');
  assert.equal(d.getSessionSnapshot(state.id).pendingAction, null); noTransactions(d); return summary(state);
});
scenario('D55', 'public_catalog', 'Public cold-start recommendations preserve fit with lower verified GSM', [], d => {
  const start = d.startSession({ customerId: 'CUST-002', scenario: 'grounded-cold' });
  const state = d.addMessage(start.id, 'The fit is great, but the fabric is too heavy.');
  assert.equal(state.customerBrain.coldStart, true); assert.deepEqual(state.customerBrain.inferredPreferences, []);
  assert.equal(state.cohort.status, 'insufficient_outcome_data');
  assert.equal(state.sourceProduct.gsm, 300); assert.ok(state.candidates.length);
  for (const candidate of state.candidates) {
    assert.equal(candidate.fit, 'oversized'); assert.ok(candidate.gsm < 300);
    assert.equal(candidate.recommendedSize, 'M'); assert.equal(candidate.product.inventorySource, 'synthetic_demo');
    assert.equal(candidate.product.garmentMeasurements.M.chestIn, state.sourceProduct.garmentMeasurements.M.chestIn);
  }
  return summary(state);
});
scenario('D56', 'public_catalog', 'Unknown attributes stay unknown while available measurements are answered', [], async d => {
  const missingWeight = d.PUBLIC_CATALOG.find(p => p.gsm === undefined); assert.ok(missingWeight);
  const result = d.recommendForCustomer({ source: missingWeight, catalog: d.PUBLIC_CATALOG,
    diagnosis: d.diagnoseReturn('The fabric is too heavy.'), brain: d.buildCustomerBrain(d.CUSTOMERS[1]), size: 'M' });
  assert.equal(result.candidates.length, 0); assert.equal(result.recommendationAllowed, false);
  const unknownFit = d.PUBLIC_CATALOG.find(p => p.fit === 'unknown' && Object.values(p.garmentMeasurements).every(m => m.chestIn === undefined)); assert.ok(unknownFit);
  assert.ok(Object.values(unknownFit.garmentMeasurements).every(m => m.chestIn === undefined));
  const start = d.startSession({ customerId: 'CUST-001', scenario: 'grounded' });
  const measured = d.addMessage(start.id, 'What is the garment length?');
  assert.match(lastReply(measured), /28\.5/); assert.match(lastReply(measured), /inch|\bin\b/);
  const unknown = d.addMessage(start.id, 'Is this Egyptian cotton?');
  assert.match(lastReply(unknown), /does not confirm Egyptian cotton/i);
  const stock = await d.executeVoiceTool(start.id, { callId: 'synthetic-stock', name: 'check_inventory',
    arguments: { productId: unknown.sourceProduct.id, size: unknown.item.size, color: unknown.item.color } });
  assert.equal(stock.result.synthetic, true); assert.equal(stock.result.available, true);
  noTransactions(d); return { missingWeightRecommendation: result, unknownFit: unknownFit.id,
    measurementReply: lastReply(measured), unknownAttributeReply: lastReply(unknown), inventoryReply: stock.result };
});
scenario('D57', 'policy', 'Negated defect clauses do not create quality facts or waive washed-item conditions', [], async d => {
  const phrases = ['It is not damaged and has no defect.', 'Nothing is broken.', 'There are no signs of damage.',
    'It is not the wrong item.', 'The seam has not split.', 'The stitching did not fail.', 'There is no tear.', 'There is no stitching failure.'];
  for (const phrase of phrases) {
    const diagnosed = d.diagnoseReturn(phrase);
    assert.ok(!diagnosed.labels.includes('quality_defect'), phrase);
    assert.ok(!diagnosed.labels.includes('wrong_item'), phrase);
    const state = session(d, `I washed it. ${phrase} I changed my mind and want my refund.`);
    assert.equal(state.conditions.status, 'not_met'); assert.equal(state.eligibility.qualityCase, false, phrase);
    const pending = proposal(d, state);
    await rejectCode(() => d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true, conditionConfirmed: true }), 'conditions_not_met');
  }
  const genuine = d.diagnoseReturn('It is not damaged, but the seam split.');
  assert.equal(genuine.primaryReason, 'quality.stitching_failure'); assert.ok(genuine.labels.includes('quality_defect'));
  assert.equal(d.listRecords('quality_case').length, 0); noTransactions(d);
  return { negativePhrases: phrases, positiveCounterexample: genuine, waivers: 0 };
});
scenario('D58', 'defect', 'Post-wash seam failure requires confirmed quality support without a condition waiver', [], async d => {
  const state = session(d, 'The seam opened after one wash.', 'CUST-004');
  assert.equal(d.POLICY.rules.reportedConditionFailureRequiresSupportReview, true);
  assert.ok(state.diagnosis.labels.includes('quality_defect')); assert.equal(state.conditions.status, 'not_met');
  assert.equal(state.candidates.length, 0); assert.match(lastReply(state), /support|quality/i);
  assert.doesNotMatch(lastReply(state), /we can (replace|refund)/i);
  assert.equal(d.listRecords('quality_case').length, 0);
  for (const action of ['replacement', 'refund']) {
    const blocked = proposal(d, state, action);
    await rejectCode(() => d.resolveProposal(state.id, { proposalId: blocked.proposalId, confirmed: true, conditionConfirmed: true }), 'conditions_not_met');
  }
  const pending = proposal(d, state, 'escalate');
  assert.equal(d.listRecords('escalation').length, 0);
  const done = await d.resolveProposal(state.id, { proposalId: pending.proposalId, confirmed: true });
  assert.equal(done.resolution.kind, 'escalation'); assert.equal(d.listRecords('quality_case').length, 1);
  assert.equal(d.listRecords('quality_case')[0].reason, 'quality.stitching_failure');
  assert.equal(d.listRecords('insight')[0].qualityFlag, true); noTransactions(d); return summary(done);
});
scenario('D59', 'tool_contract', 'Rejected structured extraction leaves all existing session state unchanged', [], async d => {
  const state = session(d, 'I washed it. It is too tight.');
  d.recordTranscript(state.id, { role: 'user', text: 'I want my refund.', itemId: 'actual-native-utterance' });
  proposal(d, state, 'refund');
  const before = JSON.stringify(d.serializeSession(state.id));
  const fabricated = { text: 'tags attached, unworn, unwashed', primaryReason: 'preference.changed_mind',
    secondaryReasons: [], labels: ['changed_mind'], evidence: [{ label: 'preference.changed_mind', quote: 'tags attached, unworn, unwashed' }],
    likedAttributes: [], confidence: 0.9, clarifyingQuestion: null, preferences: [] };
  await rejectCode(() => d.executeVoiceTool(state.id, { callId: 'fabricated', name: 'diagnose_return', arguments: fabricated }), 'ungrounded_extraction');
  assert.equal(JSON.stringify(d.serializeSession(state.id)), before, 'Rejected evidence must not cancel, rewrite, or otherwise mutate the session');
  const after = d.getSessionSnapshot(state.id); assert.equal(after.conditions.status, 'not_met');
  assert.ok(after.pendingAction); noTransactions(d);
  return { condition: after.conditions, pendingProposalUnchanged: true, providerCalled: false };
});
export const SCENARIOS = cases;
