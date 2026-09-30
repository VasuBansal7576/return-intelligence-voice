import { readFileSync, writeFileSync } from 'node:fs';
const input=process.argv[2];if(!input)throw new Error('Pass the verified catalog JSON path.');
const source=JSON.parse(readFileSync(input,'utf8'));
const output={capturedDate:source.generatedDate,notice:'Public product attributes captured from official pages. Stock and operational eligibility are unknown; runtime demo inventory/policy are separate synthetic fixtures. No affiliation or image reproduction rights are claimed.',products:source.products.map(p=>({id:p.id,name:p.name,productUrl:p.productUrl,category:p.category,fit:p.fit,material:p.material,gsm:p.gsm,priceInr:p.priceInr,sizes:p.sizes,colors:p.colors,care:p.care,description:p.description,sizeChart:p.sizeChart?{unit:p.sizeChart.unit,rows:p.sizeChart.rows,observedAt:p.sizeChart.observedAt,measurementSemantics:p.sizeChart.measurementSemantics}:null,unknownFields:p.unknownFields,observedAt:p.sizeChart?.observedAt??`${source.generatedDate}T00:00:00Z`}))};
if(output.products.length!==40)throw new Error('Expected reviewed 40-product snapshot');
writeFileSync('agent/lib/knowledge/public-catalog.json',JSON.stringify(output,null,2)+'\n');
console.log(`Imported ${output.products.length} public products without image URLs, credentials or raw scrape artifacts.`);
