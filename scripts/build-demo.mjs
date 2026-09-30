import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,readdirSync,writeFileSync,copyFileSync,rmSync } from 'node:fs';
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24 for this deployment.');
const checked=spawnSync(process.execPath,['node_modules/typescript/bin/tsc'],{stdio:'inherit'});if(checked.status!==0)process.exit(checked.status??1);
const files=['evals/scenarios.mjs','scripts/evaluate-scenarios.mjs'];
for(const dir of ['agent/lib/demo','agent/lib/engine','agent/lib/knowledge'])for(const name of readdirSync(dir))if(/\.(ts|json)$/.test(name))files.push(`${dir}/${name}`);
const sha256=Object.fromEntries(files.sort().map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
mkdirSync('data',{recursive:true});writeFileSync('data/build-manifest.json',JSON.stringify({builtAt:new Date().toISOString(),sha256},null,2)+'\n');
// Publish only the browser application, never the QA scripts or captured data.
rmSync('dist/frontend',{recursive:true,force:true});mkdirSync('dist/frontend',{recursive:true});
for(const file of ['index.html','styles.css','app.js','icons.js','art.js','voice-client.js','pcm-processor.js','demo-capture.js']) copyFileSync(`frontend/${file}`,`dist/frontend/${file}`);
console.log('Local TypeScript build verified. No model catalog, Gateway, or paid service was contacted.');
