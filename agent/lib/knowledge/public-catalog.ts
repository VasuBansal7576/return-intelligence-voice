import { z } from "zod";
import snapshot from "./public-catalog.json" with { type: "json" };
import type { Product } from "./types.ts";
const rowSchema=z.object({size:z.string(),"Garment Chest":z.number().optional(),Length:z.number().optional(),Shoulder:z.number().optional()}).passthrough();
const schema=z.object({capturedDate:z.string(),notice:z.string(),products:z.array(z.object({id:z.string(),name:z.string(),productUrl:z.url(),category:z.enum(["oversized-tshirt","polo","tshirt","shirt"]),fit:z.enum(["oversized","relaxed"]).nullable(),material:z.string().nullable(),gsm:z.number().nullable(),priceInr:z.number(),sizes:z.array(z.string()),colors:z.array(z.string()),care:z.string().nullable(),description:z.string(),sizeChart:z.object({unit:z.string(),rows:z.array(rowSchema),observedAt:z.string()}).nullable(),unknownFields:z.array(z.string()),observedAt:z.string()}))});
export const PUBLIC_CATALOG_EVIDENCE=schema.parse(snapshot);
export const PUBLIC_CATALOG:Product[]=PUBLIC_CATALOG_EVIDENCE.products.map(p=>({
  id:p.id,name:p.name,category:p.category,fit:p.fit??"unknown",sizes:p.sizes,
  // Synthetic operational fixtures are intentionally separate from source
  // evidence, which contains NO stock counts or operational authorization.
  stock:Object.fromEntries(p.sizes.map(size=>[size,6])),
  colors:p.colors.length?p.colors:["listed product variant"],material:p.material??"Not published",
  ...(p.gsm===null?{}:{gsm:p.gsm}),priceInr:p.priceInr,theme:p.name.startsWith("Solids:")?"solid":p.name.split(":")[0],
  returnable:true,tags:["public-attribute-snapshot","synthetic-inventory"],inventorySource:"synthetic_demo",
  catalogSource:{url:p.productUrl,observedAt:p.observedAt,unknownFields:p.unknownFields,attributeOrigin:"public_snapshot"},
  garmentMeasurements:Object.fromEntries((p.sizeChart?.rows??[]).map(row=>[row.size,{...(row["Garment Chest"]===undefined?{}:{chestIn:row["Garment Chest"]}),...(row.Length===undefined?{}:{lengthIn:row.Length}),...(row.Shoulder===undefined?{}:{shoulderIn:row.Shoulder})}])),
}));
export const GROUNDED_SOURCE_ID="tss-public:armour-tshirt-midnight-men-oversized-tshirt";
export const GROUNDED_ALTERNATE_ID="tss-public:dc-darkseid-men-oversized-tshirt";
export const GROUNDED_COLD_SOURCE_ID="tss-public:oversized-t-shirt-pacific-men-super-oversized-t-shirt";
