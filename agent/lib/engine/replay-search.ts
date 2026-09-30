import {diagnoseReturn,assertionClauses} from './diagnosis.ts';
import {statedAttributes} from './stated-attributes.ts';
import {PUBLIC_CATALOG_EVIDENCE} from '../knowledge/public-catalog.ts';
import {REPLAY_SOURCE_PRODUCTS} from '../knowledge/replay-source-products.ts';
type CatalogProduct=typeof PUBLIC_CATALOG_EVIDENCE.products[number];
const composition=(s:string)=>s.toLowerCase().replace(/supima\s*/g,'').replace(/[^a-z0-9%]/g,'');
const theme=(name:string)=>name.split(':')[0]!.toLowerCase();
/** Public evidence only: no synthetic inventory, customer history or guessed attributes. */
export function searchReplayCatalog(sourceUrl:string,feedback:string,size:string){
 const source=[...PUBLIC_CATALOG_EVIDENCE.products,...REPLAY_SOURCE_PRODUCTS].find(p=>new URL(p.productUrl).pathname===new URL(sourceUrl).pathname);
 const diagnosis=diagnoseReturn(feedback);const kept=statedAttributes(feedback);
 let fit:string|undefined,category:string|undefined,material:string|undefined,color:string|undefined,budget:number|undefined,different=false;
 const avoidedMaterials=new Set<string>();const avoidedFits=new Set<string>();
 for(const {text} of assertionClauses(feedback)){
  if(!/\b(want|prefer|only|show|explore|keep|retain|avoid|no|not|don.t|do not)\b/i.test(text))continue;
  const negative=/\b(avoid|no|not|don.t|do not|dislike|hate)\b/i.test(text);
  const f=text.match(/\b(oversized|relaxed|regular|slim)\b/i)?.[1]?.toLowerCase();if(f){if(negative){avoidedFits.add(f);if(fit===f)fit=undefined;}else {fit=f;avoidedFits.delete(f);}}
  if(/different (?:material|composition|fabric)|another (?:material|composition|fabric)/i.test(text))different=!negative;
  const m=text.match(/\b(linen|polyester|cotton|supima)\b/i)?.[1]?.toLowerCase();if(m){if(negative){avoidedMaterials.add(m);if(material===m)material=undefined;}else {material=m;avoidedMaterials.delete(m);}}
  if(!negative){if(/\bpolo\b/i.test(text))category='polo';else if(/\b(?:t[- ]?shirts?|tees?)\b/i.test(text))category='tshirt';else if(/\bshirts?\b/i.test(text))category='shirt';
   const c=text.match(/\b(black|navy|white|red|blue|pink|green|brown|beige)\b/i)?.[1];if(c)color=c.toLowerCase();}
  const b=text.match(/(?:under|below|within|at most|up to)\s*(?:rs\.?|inr|₹)?\s*(\d{3,5})/i);if(b)budget=Number(b[1]);
 }
 const explicitExploration=different||!!material||!!fit||!!category;
 const limitations:string[]=[];const excluded:Array<{productId:string;reason:string}>=[];
 const sourceGsm=source?.gsm??null;
 if(diagnosis.labels.includes('material_too_heavy')&&sourceGsm===null)limitations.push('Source GSM unknown; no verified lower-GSM comparison is possible.');
 if(!source)limitations.push('Source garment has no matched public catalog evidence.');
 const constraints={differentComposition:different,material:material??null,fit:fit??null,category:category??null,color:color??null,maxListedPriceInr:budget??null};
 const candidates:Array<{product:CatalogProduct;why:string[];score:number}>=[];
 for(const p of PUBLIC_CATALOG_EVIDENCE.products){
  if(p.id===source?.id)continue;const reject=(reason:string)=>excluded.push({productId:p.id,reason});const why:string[]=[];
  const sourceCategory=source&&'category'in source?source.category:undefined;
  if(category ? (category==='tshirt'?!['tshirt','oversized-tshirt'].includes(p.category):p.category!==category) : sourceCategory&&p.category!==sourceCategory){reject('Category differs from the requested or known source category.');continue;}
  if(fit&&p.fit!==fit||avoidedFits.has(p.fit??'')){reject('Does not satisfy the explicit fit preference.');continue;}
  if(material&&!p.material?.toLowerCase().includes(material)||[...avoidedMaterials].some(m=>p.material?.toLowerCase().includes(m))){reject('Does not satisfy the explicit composition preference.');continue;}
  if((different||kept.get('material')==='positive')&&(!source?.material||!p.material)){reject('Composition comparison lacks published evidence.');continue;}
  if(different&&composition(p.material!)===composition(source!.material!)){reject('Repeats the source composition.');continue;}
  if(kept.get('material')==='positive'&&composition(p.material!)!==composition(source!.material!)){reject('Changes the explicitly preserved composition.');continue;}
  if(kept.get('fit')==='positive'&&(!source?.fit||p.fit!==source.fit)){reject('Cannot preserve the explicitly liked fit.');continue;}
  if(kept.get('theme')==='positive'&&(!source||theme(p.name)!==theme(source.name))){reject('Changes the explicitly preserved theme.');continue;}
  const sourceColors=source&&'colors'in source?source.colors:[];
  if(color&&!p.colors.some(c=>c.toLowerCase().includes(color!))||kept.get('color')==='positive'&&(!sourceColors.length||!p.colors.some(c=>sourceColors.includes(c)))){reject('Cannot satisfy the explicit color preference from published evidence.');continue;}
  if(budget!==undefined&&p.priceInr>budget){reject('Current listed price exceeds the stated budget; not a historical paid price.');continue;}
  if(diagnosis.labels.includes('material_too_heavy')||diagnosis.labels.includes('material_too_thin')){
   const lower=diagnosis.labels.includes('material_too_heavy');const measured=sourceGsm!==null&&p.gsm!==null&&(lower?p.gsm<sourceGsm:p.gsm>sourceGsm);
   if(measured)why.push(`Published ${p.gsm} GSM versus source listing ${sourceGsm} GSM; comfort is not established.`);
   else if(!explicitExploration){reject('No verified fabric-weight improvement; ask about composition or fit exploration instead.');continue;}
   else why.push('Requested attribute exploration only; fabric-weight improvement is unverified.');
  }
  if(different)why.push(`Different published composition: ${p.material}; not evidence of comfort or safety.`);
  if(fit)why.push(`Requested published ${p.fit} fit; not an exact fit guarantee.`);
  if(material)why.push(`Published composition includes requested ${material}.`);
  // Measurement comparisons reuse the existing engine's requirement for both known values,
  // without its synthetic stock/returnability assumptions.
  if(diagnosis.labels.some(l=>l==='fit_too_small'||l==='fit_too_large')){
   const row=p.sizeChart?.rows.find(r=>r.size===size);const src=source&&'sizeChart'in source?source.sizeChart?.rows.find(r=>r.size===size):undefined;
   const key=diagnosis.primaryReason==='fit.shoulders_tight'?'Shoulder':'Garment Chest';const smaller=diagnosis.labels.includes('fit_too_large');const measured=row?.[key]!==undefined&&src?.[key]!==undefined&&(smaller?row[key]<src[key]:row[key]>src[key]);
   if(measured)why.push(`Published size ${size} ${key} ${row![key]} versus ${src![key]} inches; availability and fit unknown.`);
   else if(!explicitExploration){reject('No verified directional garment measurement; ask about preferred cut.');continue;}
   else why.push('Fit complaint resolution unverified; requested cut exploration only.');
  }
  if(kept.get('length')==='positive'){const row=p.sizeChart?.rows.find(r=>r.size===size);const src=source&&'sizeChart'in source?source.sizeChart?.rows.find(r=>r.size===size):undefined;if(row?.Length===undefined||src?.Length===undefined||Math.abs(row.Length-src.Length)>0.5){reject('Cannot preserve explicitly liked length from published measurements.');continue;}}
  if(!why.length&&!explicitExploration){reject('No grounded change constraint identifies a relevant alternative.');continue;}
  if(category)why.push(`Requested category: ${p.category}.`);
  candidates.push({product:p,why,score:why.filter(w=>w.startsWith('Published')).length});
 }
 candidates.sort((a,b)=>b.score-a.score||a.product.id.localeCompare(b.product.id));
 return {candidates:candidates.slice(0,3),constraints,limitations,excluded,noMatchReason:candidates.length?null:'No public candidate satisfies the known constraints. Ask a focused clarification or offer support; historical refund remains completed.'};
}
