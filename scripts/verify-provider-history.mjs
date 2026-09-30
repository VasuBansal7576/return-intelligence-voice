import assert from 'node:assert/strict';
import {sanitizedHistoryForProvider} from '../server/private/provider-history.ts';
import {PUBLIC_CATALOG_EVIDENCE} from '../agent/lib/knowledge/public-catalog.ts';
const publicProduct=PUBLIC_CATALOG_EVIDENCE.products[0];
const history={customerRef:'PRIVATE_ID_SENTINEL',source:{accountSource:'https://www.thesouledstore.com/orders?PRIVATE_PROVENANCE_SENTINEL',observedAt:'2026-09-01T00:00:00Z',method:'user-authorized account UI observation',merchantIntegration:false,materialScope:'current public product attribute, not verified purchase composition'},items:[{itemRef:'PRIVATE_ORDER_SENTINEL',name:'PRIVATE_NAME_SENTINEL',size:'XL',orderedOn:'2026-01-02',deliveredOn:null,status:'Refund Completed',publicUrl:publicProduct.productUrl+'?email=PRIVATE_CONTACT_SENTINEL',currentPublicMaterial:'PRIVATE_MATERIAL_SENTINEL',returnReason:'PRIVATE_REASON_SENTINEL',keptOutcome:null,likedOutcome:null,variantId:null,sku:null,gsm:null}]};
const projection=sanitizedHistoryForProvider(history);
assert.deepEqual(Object.keys(projection.items[0]),['product','size','orderStatus']);
assert.equal(projection.items[0].product.name,publicProduct.name);assert.equal(projection.items[0].size,'XL');assert.equal(projection.items[0].orderStatus,'Refund Completed');
assert.doesNotMatch(JSON.stringify(projection),/PRIVATE_|orderedOn|deliveredOn|customerRef|itemRef|returnReason|keptOutcome|likedOutcome/);
for(const key of ['email','phone','address','payment','name','customerId']) {assert.throws(()=>sanitizedHistoryForProvider({...history,[key]:'PRIVATE_SENTINEL'}));if(key!=='name')assert.throws(()=>sanitizedHistoryForProvider({...history,items:[{...history.items[0],[key]:'PRIVATE_SENTINEL'}]}));}
history.items[0].publicUrl='https://evil.invalid/PRIVATE_CONTACT';history.items[0].size='PRIVATE_CONTACT';assert.equal(sanitizedHistoryForProvider(history).items[0].product,null);assert.equal(sanitizedHistoryForProvider(history).items[0].size,null);
console.log('PASS strict history projection: grounded public product only, enum size/status, query and identity/provenance/dates/feedback excluded; unknown product and arbitrary size null. Synthetic only, no file/provider reads.');

const {REPLAY_SOURCE_PRODUCTS}=await import("../agent/lib/knowledge/replay-source-products.ts");
const known=REPLAY_SOURCE_PRODUCTS[0];
const {providerHistorySchema}=await import("../server/private/provider-history.ts");
assert.equal(providerHistorySchema.parse({historicalReplay:true,merchantIntegration:false,items:[{product:{name:known.name,url:known.productUrl},size:"XL",orderStatus:"Refund Completed"}]}).items[0].product.name,known.name);
assert.equal(known.availability,null);assert.equal(known.gsm,null);assert.equal(known.executableExchangeCandidate,false);
console.log("PASS independently verified source garment accepted without stock/inventory fabrication");
