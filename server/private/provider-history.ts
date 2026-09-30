import { REPLAY_SOURCE_PRODUCTS } from '../../agent/lib/knowledge/replay-source-products.ts';
import { privateHistorySchema } from './history.ts';
import { PUBLIC_CATALOG_EVIDENCE } from '../../agent/lib/knowledge/public-catalog.ts';
import { MERCHANDISING_COLLECTION } from '../../agent/lib/knowledge/merchandising.ts';
import { z } from 'zod';
const publicProducts=[...REPLAY_SOURCE_PRODUCTS.map(p=>({name:p.name,url:p.productUrl})),...PUBLIC_CATALOG_EVIDENCE.products.map(p=>({name:p.name,url:p.productUrl})),...MERCHANDISING_COLLECTION.items.map(p=>({name:p.name,url:p.url}))];
const cleanUrl=(url:string)=>{const parsed=new URL(url);return parsed.origin+parsed.pathname;};
export const sizeSchema=z.enum(['XS','S','M','L','XL','XXL','XXXL','4XL','5XL']);
export const providerHistorySchema=z.object({historicalReplay:z.literal(true),merchantIntegration:z.literal(false),items:z.array(z.object({product:z.object({name:z.string(),url:z.string().url()}).strict().nullable(),size:sizeSchema.nullable(),orderStatus:z.enum(['Delivered','Refund Completed','Cancelled'])}).strict()).min(1).max(20)}).strict().superRefine((value,ctx)=>{for(const item of value.items)if(item.product&&!publicProducts.some(p=>p.name===item.product!.name&&cleanUrl(p.url)===item.product!.url))ctx.addIssue({code:'custom',message:'Product must match exact grounded public evidence.'});});
/** Pure preparation boundary. No file reads, persistence or provider requests.
 * Unmatched products stay unknown; never forward arbitrary history name/URL text.
 * The distinct replay route consumes only this strict projection.
 */
export function sanitizedHistoryForProvider(input:unknown) {
  const history=privateHistorySchema.parse(input);
  return { historicalReplay:true as const, merchantIntegration:false as const,
    items:history.items.map(item=>{
      const match=publicProducts.find(p=>cleanUrl(p.url)===cleanUrl(item.publicUrl));
      const size=sizeSchema.safeParse(item.size);
      return {product:match?{name:match.name,url:cleanUrl(match.url)}:null,size:size.success?size.data:null,orderStatus:item.status};
    }) };
}
